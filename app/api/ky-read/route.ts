// app/api/ky-read/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  token: string;
  readerName?: string | null;
  readerRole?: string | null;
  readerDevice?: string | null;

  // ✅ 個人（新規入場者教育のエントリーNo）
  entrantNo?: string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function dayKeyJst(d = new Date()) {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function normEntrantNo(v: any): string | null {
  const x = s(v).trim();
  if (!x) return null;
  // 数字/英数字/ハイフン/アンダーバー程度（運用ブレ吸収）
  if (!/^[0-9A-Za-z_-]{1,32}$/.test(x)) return null;
  return x;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const token = s(body.token).trim();
    const readerName = s(body.readerName).trim();
    const readerRole = s(body.readerRole).trim() || null;
    const readerDevice = s(body.readerDevice).trim() || null;

    const entrantNo = normEntrantNo(body.entrantNo);

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

    // 1) token から ky を特定
    const { data: ky, error: kyErr } = await supabase
      .from("ky_entries")
      .select("id, project_id, is_approved")
      .eq("public_token", token)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    if (!ky.is_approved) return NextResponse.json({ error: "Not approved" }, { status: 403 });

    const kyId = s(ky.id).trim();
    const today = dayKeyJst();

    // ✅ 重複防止キー：eno がある場合は eno、無い場合は氏名
    const dedupeKey = entrantNo ? `ENO:${entrantNo}` : `NAME:${readerName}`;

    if (!entrantNo && !readerName) {
      return NextResponse.json({ error: "readerName required (or provide entrantNo)" }, { status: 400 });
    }

    // 2) 同日重複チェック（ky_id + day + dedupeKey）
    const { data: dup, error: dupErr } = await supabase
      .from("ky_read_logs")
      .select("id, created_at")
      .eq("ky_id", kyId)
      .eq("day_key", today)
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();

    if (dupErr) return NextResponse.json({ error: dupErr.message }, { status: 500 });
    if (dup?.id) {
      return NextResponse.json({ ok: true, duplicated: true, created_at: dup.created_at }, { status: 200 });
    }

    // 3) 追加
    const { data: ins, error: insErr } = await supabase
      .from("ky_read_logs")
      .insert({
        ky_id: kyId,
        project_id: ky.project_id ?? null,

        reader_name: entrantNo ? null : readerName || null,
        reader_role: readerRole,
        reader_device: readerDevice,

        entrant_no: entrantNo, // ✅ ここが個人キー
        day_key: today,
        dedupe_key: dedupeKey,
      })
      .select("id, created_at")
      .maybeSingle();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, created_at: ins?.created_at ?? new Date().toISOString() }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
