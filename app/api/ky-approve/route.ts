// app/api/ky-approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

type Body = {
  projectId?: string;
  kyId?: string;

  // ✅ あってもなくてもOK（あれば管理者チェックに使う）
  accessToken?: string;

  // 互換のため残す（今回はDBへ保存しない）
  approvalNote?: string | null;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function newTokenHex(bytes = 24) {
  // 48文字（24bytes=192bit）
  return crypto.randomBytes(bytes).toString("hex");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = s(body.projectId).trim();
    const kyId = s(body.kyId).trim();

    if (!projectId || !kyId) {
      return NextResponse.json({ error: "projectId/kyId required" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminUserId = s(process.env.KY_ADMIN_USER_ID).trim() || null; // UUID想定

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // ✅ accessTokenが来た時だけ「そのユーザーが管理者か」を検証
    let authedUserId: string | null = null;
    if (body.accessToken) {
      try {
        const anon = createClient(url, anonKey, { auth: { persistSession: false } });
        const { data, error } = await anon.auth.getUser(body.accessToken);
        if (error) return NextResponse.json({ error: `Invalid accessToken: ${error.message}` }, { status: 401 });

        authedUserId = data.user?.id ?? null;

        if (adminUserId && authedUserId !== adminUserId) {
          return NextResponse.json({ error: "Forbidden: not admin user" }, { status: 403 });
        }
      } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Invalid accessToken" }, { status: 401 });
      }
    }

    // ✅ service_roleで確実に更新
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 対象KY確認（project_id一致も必須）
    // public_* も読み、存在していれば流用
    const exists = await admin
      .from("ky_entries")
      .select("id, project_id, is_approved, public_id, public_token, public_enabled")
      .eq("id", kyId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (exists.error) return NextResponse.json({ error: exists.error.message }, { status: 500 });
    if (!exists.data) return NextResponse.json({ error: "KY entry not found" }, { status: 404 });

    const nowIso = new Date().toISOString();

    // ✅ 公開用ID/トークン（無ければ生成）
    const publicId = s((exists.data as any).public_id).trim() || crypto.randomUUID();
    // 承認のたびにトークンをローテーションしてもOKだが、運用上は「初回生成＋解除でローテ」で十分
    const publicToken = s((exists.data as any).public_token).trim() || newTokenHex(24);

    // ✅ DB列に合わせる（approved_at / approved_by は存在確認済み）
    // approved_by は uuid 列なので、入れる値は UUID のみ
    const payload: Record<string, any> = {
      is_approved: true,
      approved_at: nowIso,
      approved_by: authedUserId || adminUserId || null,

      // ✅ 承認＝公開ON（安全運用：公開は承認と連動）
      public_id: publicId,
      public_token: publicToken,
      public_enabled: true,
      public_enabled_at: nowIso,
    };

    const upd = await admin
      .from("ky_entries")
      .update(payload)
      .eq("id", kyId)
      .eq("project_id", projectId)
      .select("id, project_id, is_approved, approved_at, approved_by, public_id, public_token, public_enabled, public_enabled_at")
      .maybeSingle();

    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

    // ✅ 公開URL組み立て用の情報を返す（レビュー側でコピーに使える）
    return NextResponse.json({
      ok: true,
      data: upd.data,
      public: {
        public_id: (upd.data as any)?.public_id ?? publicId,
        public_token: (upd.data as any)?.public_token ?? publicToken,
        enabled: true,
      },
      note: body.accessToken
        ? "Approved (authenticated)"
        : "Approved (accessToken not provided; approval executed via service_role)",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
