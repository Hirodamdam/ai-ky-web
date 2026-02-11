// app/api/ky-read/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  token: string; // public token
  entrantNo?: string | null; // 個人No（推奨）
  readerName?: string | null; // 氏名（保険）
  readerRole?: string | null;
  readerDevice?: string | null; // "pc" / "mobile"
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function normEntrantNo(v: any): string {
  return s(v).trim();
}

function normName(v: any): string {
  // 空白ゆれ吸収（半角/全角/タブ）
  return s(v).replace(/[ 　\t]/g, "").trim();
}

function isValidToken(v: string): boolean {
  const t = s(v).trim();
  if (!t) return false;
  // URLセーフ想定
  return /^[0-9A-Za-z_-]{8,128}$/.test(t);
}

function isValidEntrantNo(v: string): boolean {
  const x = s(v).trim();
  if (!x) return false;
  return /^[0-9A-Za-z_-]{1,32}$/.test(x);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const token = s(body.token).trim();
    const entrantNo = normEntrantNo(body.entrantNo);
    const readerNameRaw = s(body.readerName).trim();
    const readerName = normName(readerNameRaw); // 比較用
    const readerRole = s(body.readerRole).trim() || null;
    const readerDevice = s(body.readerDevice).trim() || null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    if (!isValidToken(token)) return NextResponse.json({ error: "token required" }, { status: 400 });

    // entrantNo も readerName も無いのはNG（どっちかは必要）
    const enoOk = isValidEntrantNo(entrantNo);
    const nameOk = !!readerName;
    if (!enoOk && !nameOk) {
      return NextResponse.json({ error: "entrantNo or readerName required" }, { status: 400 });
    }

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ✅ token -> ky_id を解決（公開ONだけ許可）
    // ※テーブル名/カラム名は実装に合わせています（違う場合はここだけ直す）
    // 想定：ky_public_tokens { token, ky_id, project_id, enabled }
    const { data: pub, error: pubErr } = await adminClient
      .from("ky_public_tokens")
      .select("token, ky_id, project_id, enabled")
      .eq("token", token)
      .maybeSingle();

    if (pubErr) return NextResponse.json({ error: pubErr.message }, { status: 500 });
    if (!pub) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    if (pub.enabled !== true) return NextResponse.json({ error: "Public disabled" }, { status: 403 });

    const kyId = s((pub as any).ky_id).trim();
    const projectId = s((pub as any).project_id).trim();

    if (!kyId) return NextResponse.json({ error: "ky_id missing for token" }, { status: 500 });

    // ✅ entrantNo が来ている場合は「project_entrant_entries に存在」しているか確認（なりすまし抑止）
    if (enoOk && projectId) {
      const { data: ent, error: entErr } = await adminClient
        .from("project_entrant_entries")
        .select("entrant_no")
        .eq("project_id", projectId)
        .eq("entrant_no", entrantNo)
        .maybeSingle();

      if (entErr) return NextResponse.json({ error: entErr.message }, { status: 500 });
      if (!ent) {
        return NextResponse.json({ error: "entrantNo not found" }, { status: 400 });
      }
    }

    // ✅ 二重登録防止：
    // - entrantNo があるなら entrantNo で最新1件を見る
    // - entrantNo が無い場合は reader_name + device で最新1件を見る
    let already = false;

    if (enoOk) {
      const { data: last } = await adminClient
        .from("ky_read_logs")
        .select("id, created_at")
        .eq("ky_id", kyId)
        .eq("entrant_no", entrantNo)
        .order("created_at", { ascending: false })
        .limit(1);

      if (Array.isArray(last) && last.length) already = true;
    } else if (nameOk) {
      const { data: last } = await adminClient
        .from("ky_read_logs")
        .select("id, reader_name, created_at")
        .eq("ky_id", kyId)
        .order("created_at", { ascending: false })
        .limit(50);

      const arr = Array.isArray(last) ? last : [];
      // DBのreader_nameも空白除去して比較
      already = arr.some((r: any) => normName(r?.reader_name) === readerName && s(r?.reader_device).trim() === (readerDevice || ""));
    }

    if (!already) {
      const insertRow: any = {
        ky_id: kyId,
        entrant_no: enoOk ? entrantNo : null,
        reader_name: readerNameRaw || null, // 表示用は生の氏名
        reader_role: readerRole,
        reader_device: readerDevice,
      };

      const { error: insErr } = await adminClient.from("ky_read_logs").insert(insertRow);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, kyId, entrantNo: enoOk ? entrantNo : null, readerName: readerNameRaw || null, skipped: already });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
