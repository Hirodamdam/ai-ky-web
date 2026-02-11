// app/api/public-ky-roster/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = { token?: string };

function s(v: any) {
  return v == null ? "" : String(v);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const token = s(body.token).trim();
    if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 1) token → ky → project_id
    const { data: ky, error: kyErr } = await supabase
      .from("ky_entries")
      .select("id, project_id, is_approved, public_enabled")
      .eq("public_token", token)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "Invalid token" }, { status: 404 });

    // ✅ 公開の定義を統一：approved + public_enabled=true 以外はNG
    if (ky.is_approved !== true) return NextResponse.json({ error: "Not approved" }, { status: 403 });
    if (ky.public_enabled !== true) return NextResponse.json({ error: "Public disabled" }, { status: 403 });

    const projectId = s(ky.project_id).trim();
    if (!projectId) return NextResponse.json({ error: "ky.project_id is empty" }, { status: 500 });

    // 2) 会社一覧
    const { data: partners, error: pErr } = await supabase
      .from("project_partner_entries")
      .select("id, partner_company_name")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

    // 3) 個人一覧（会社別）
    const { data: entrants, error: eErr } = await supabase
      .from("project_entrant_entries")
      .select("id, partner_entry_id, entrant_no, entrant_name")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });

    return NextResponse.json(
      {
        ok: true,
        project_id: projectId,
        partners: Array.isArray(partners) ? partners : [],
        entrants: Array.isArray(entrants) ? entrants : [],
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
