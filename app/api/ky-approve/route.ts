// app/api/ky-approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  projectId?: string;
  kyId?: string;

  // ✅ あってもなくてもOK（あれば管理者チェックに使う）
  accessToken?: string;

  // 任意
  approvalNote?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = body.projectId?.trim();
    const kyId = body.kyId?.trim();

    if (!projectId || !kyId) {
      return NextResponse.json({ error: "projectId/kyId required" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // サーバー側の管理者ID（あれば厳密化できる）
    const adminUserId = process.env.KY_ADMIN_USER_ID?.trim() || null;

    // ✅ 1) accessToken が来ている場合だけ「管理者本人か」を検証する
    // ※ 今回は「accessToken必須をやめる」方針なので、無い場合はスキップして進めます
    let authedUserId: string | null = null;
    if (body.accessToken) {
      try {
        const anon = createClient(url, anonKey, { auth: { persistSession: false } });
        const { data, error } = await anon.auth.getUser(body.accessToken);
        if (error) {
          return NextResponse.json({ error: `Invalid accessToken: ${error.message}` }, { status: 401 });
        }
        authedUserId = data.user?.id ?? null;

        if (adminUserId && authedUserId !== adminUserId) {
          return NextResponse.json({ error: "Forbidden: not admin user" }, { status: 403 });
        }
      } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Invalid accessToken" }, { status: 401 });
      }
    }

    // ✅ 2) service_role で確実に承認更新
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // まず対象KYが存在するか（project_id一致も確認）
    const exists = await admin
      .from("ky_entries")
      .select("id, project_id, is_approved")
      .eq("id", kyId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (exists.error) {
      return NextResponse.json({ error: exists.error.message }, { status: 500 });
    }
    if (!exists.data) {
      return NextResponse.json({ error: "KY entry not found" }, { status: 404 });
    }

    // すでに承認済みならそのまま返す（安全）
    if (exists.data.is_approved === true) {
      return NextResponse.json({ ok: true, alreadyApproved: true });
    }

    // 更新payload（列が存在している前提。無い列があると Supabase がエラーを返します）
    // もしあなたのDBに approved_by 等が無い場合は、該当行だけコメントアウトでOKです。
    const payload: Record<string, any> = {
      is_approved: true,
      approved_at: new Date().toISOString(),
      approved_by: authedUserId || adminUserId || null,
      approval_note: body.approvalNote ?? null,
    };

    const upd = await admin
      .from("ky_entries")
      .update(payload)
      .eq("id", kyId)
      .eq("project_id", projectId)
      .select("id, project_id, is_approved, approved_at, approved_by, approval_note")
      .maybeSingle();

    if (upd.error) {
      return NextResponse.json({ error: upd.error.message }, { status: 500 });
    }

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
