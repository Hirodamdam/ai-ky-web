// app/api/ky-read/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  token?: string;

  // ✅ どちらかあればOK（eno優先で運用している）
  entrantNo?: string | null;
  readerName?: string | null;

  readerRole?: string | null;
  readerDevice?: string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function isValidEntrantNo(v: string): boolean {
  const x = s(v).trim();
  if (!x) return false;
  return /^[0-9A-Za-z_-]{1,32}$/.test(x);
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

    // 1) token -> ky を取得（project_id と ky_id を確実に得る）
    const { data: ky, error: kyErr } = await supabase
      .from("ky_entries")
      .select("id, project_id, is_approved, public_enabled")
      .eq("public_token", token)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    if (!ky.is_approved) return NextResponse.json({ error: "Not approved" }, { status: 403 });
    if (ky.public_enabled === false) return NextResponse.json({ error: "Public disabled" }, { status: 403 });

    const projectId = s(ky.project_id).trim();
    const kyId = s(ky.id).trim();
    if (!projectId) return NextResponse.json({ error: "ky.project_id is empty" }, { status: 500 });
    if (!kyId) return NextResponse.json({ error: "ky.id is empty" }, { status: 500 });

    // 2) reader_name を絶対に NULL にしない
    const eno = s(body.entrantNo).trim();
    const enoOk = isValidEntrantNo(eno);
    const nameRaw = s(body.readerName).trim();

    // enoがあるなら、名前が空でも落ちないように補完
    const readerName = nameRaw || (enoOk ? `No:${eno}` : "");

    if (!readerName) {
      return NextResponse.json({ error: "readerName required (or valid entrantNo)" }, { status: 400 });
    }

    const readerRole = s(body.readerRole).trim() || null;
    const readerDevice = s(body.readerDevice).trim() || null;

    // 3) ky_read_logs へ保存（NOT NULL: project_id / reader_name を確実に入れる）
    const insertRow: any = {
      project_id: projectId,
      ky_id: kyId,
      reader_name: readerName,
      reader_role: readerRole,
      reader_device: readerDevice,
    };

    // entrant_no 列がある環境なら入れたいが、列が無いと失敗するので安全にしない
    // → もし entrant_no 列が「確実にある」ことが分かったら、ここに追加します。

    const { error: insErr } = await supabase.from("ky_read_logs").insert(insertRow);

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
