// app/api/ky-read-list/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  kyId?: string;
  accessToken?: string;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const projectId = s(body?.projectId).trim();
    const kyId = s(body?.kyId).trim();
    const accessToken = s(body?.accessToken).trim();

    if (!projectId || !kyId) {
      return NextResponse.json({ error: "projectId/kyId required" }, { status: 400 });
    }
    if (!accessToken) {
      return NextResponse.json({ error: "accessToken required" }, { status: 401 });
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

    // ✅ 1) accessToken 検証（管理画面用）
    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: userRes, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // ✅ 2) 管理者権限でDB参照
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ✅ 3) kyId が projectId のKYであることを確認（漏えい防止）
    const { data: kyRow, error: kyErr } = await adminClient
      .from("ky_entries")
      .select("id, project_id")
      .eq("id", kyId)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!kyRow) return NextResponse.json({ error: "KY not found" }, { status: 404 });

    const kyProjectId = s((kyRow as any).project_id).trim();
    if (!kyProjectId || kyProjectId !== projectId) {
      return NextResponse.json({ error: "KY does not belong to project" }, { status: 403 });
    }

    // ✅ 4) 既読ログ取得
    const { data: logs, error: logErr } = await adminClient
      .from("ky_read_logs")
      .select("id, reader_name, reader_role, reader_device, created_at")
      .eq("ky_id", kyId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

    return NextResponse.json({ logs: logs ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
