// app/api/ky-read/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  token?: string;
  entrantNo?: string | null;
  readerName?: string | null;
  readerRole?: string | null;
  readerDevice?: string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const token = s(body.token).trim();
    if (!token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: "env missing" }, { status: 500 });
    }

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // KY取得
    const { data: ky, error: kyErr } = await supabase
      .from("ky_entries")
      .select("id, project_id, is_approved, public_enabled")
      .eq("public_token", token)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    if (!ky.is_approved) return NextResponse.json({ error: "Not approved" }, { status: 403 });
    if (ky.public_enabled !== true) return NextResponse.json({ error: "Public disabled" }, { status: 403 });

    let readerName = s(body.readerName).trim();
    const entrantNo = s(body.entrantNo).trim();

    // entrantNoだけのときは名前補完
    if (!readerName && entrantNo) {
      const { data: ent } = await supabase
        .from("project_entrant_entries")
        .select("entrant_name")
        .eq("entrant_no", entrantNo)
        .eq("project_id", ky.project_id)
        .maybeSingle();

      readerName = s(ent?.entrant_name).trim();
    }

    // 最終fallback
    if (!readerName) readerName = "（未入力）";

    const { error: insErr } = await supabase.from("ky_read_logs").insert({
      ky_id: ky.id,
      reader_name: readerName,
      entrant_no: entrantNo || null,
      reader_role: s(body.readerRole) || null,
      reader_device: s(body.readerDevice) || null,
    });

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
