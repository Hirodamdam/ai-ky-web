import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  token: string;
  readerName: string;
  readerRole?: string | null;
  readerDevice?: string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function dayKeyJst(d = new Date()) {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const token = s(body.token).trim();
    const readerName = s(body.readerName).trim();
    const readerRole = s(body.readerRole).trim() || null;
    const readerDevice = s(body.readerDevice).trim() || null;

    if (!token || !readerName) {
      return NextResponse.json({ error: "token/readerName required" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // token検証（承認済みのみ）
    const { data: ky, error: kyErr } = await adminClient
      .from("ky_entries")
      .select("id, project_id, is_approved, public_token, work_date")
      .eq("public_token", token)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky || !ky.is_approved) {
      return NextResponse.json({ error: "invalid token or not approved" }, { status: 404 });
    }

    const kyId = s(ky.id);
    const projectId = s(ky.project_id);
    const today = dayKeyJst();

    // 同日・同KY・同氏名は二重登録抑止
    const start = `${today}T00:00:00+09:00`;
    const end = `${today}T23:59:59+09:00`;

    const { data: existing, error: exErr } = await adminClient
      .from("ky_read_logs")
      .select("id, created_at")
      .eq("ky_id", kyId)
      .eq("reader_name", readerName)
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false })
      .limit(1);

    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, duplicated: true, created_at: existing[0].created_at });
    }

    const { error: insErr } = await adminClient.from("ky_read_logs").insert({
      project_id: projectId,
      ky_id: kyId,
      public_token: token,
      reader_name: readerName,
      reader_role: readerRole,
      reader_device: readerDevice,
    });

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, duplicated: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
