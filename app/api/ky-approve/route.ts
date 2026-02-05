// app/api/ky-approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  projectId?: string;
  kyId?: string;

  // ✅ あってもなくてもOK（あれば管理者チェックに使う）
  accessToken?: string;

  // 互換のため残す（今回はDBへ保存しない）
  approvalNote?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = (body.projectId ?? "").trim();
    const kyId = (body.kyId ?? "").trim();

    if (!projectId || !kyId) {
      return NextResponse.json({ error: "projectId/kyId required" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminUserId = (process.env.KY_ADMIN_USER_ID ?? "").trim() || null; // UUID想定

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
    const exists = await admin
      .from("ky_entries")
      .select("id, project_id, is_approved")
      .eq("id", kyId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (exists.error) return NextResponse.json({ error: exists.error.message }, { status: 500 });
    if (!exists.data) return NextResponse.json({ error: "KY entry not found" }, { status: 404 });

    // すでに承認済みならそのまま返す
    if (exists.data.is_approved === true) {
      return NextResponse.json({ ok: true, alreadyApproved: true });
    }

    // ✅ DB列に合わせる（approved_at / approved_by は存在確認済み）
    // approved_by は uuid 列なので、入れる値は UUID のみ（管理者UUID固定）
    const payload: Record<string, any> = {
      is_approved: true,
      approved_at: new Date().toISOString(),
      approved_by: authedUserId || adminUserId || null,
    };

    const upd = await admin
      .from("ky_entries")
      .update(payload)
      .eq("id", kyId)
      .eq("project_id", projectId)
      .select("id, project_id, is_approved, approved_at, approved_by")
      .maybeSingle();

    if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      data: upd.data,
      note: body.accessToken
        ? "Approved (authenticated)"
        : "Approved (accessToken not provided; approval executed via service_role)",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
