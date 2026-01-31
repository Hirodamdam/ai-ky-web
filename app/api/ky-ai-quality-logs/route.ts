// app/api/ky-ai-quality-logs/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  "";

function getAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function json(ok: boolean, body: any, status = 200) {
  return NextResponse.json({ ok, ...body }, { status });
}

function safeTrim(v: any) {
  return (v ?? "").toString().trim();
}

/**
 * 受け取り例（KyEditClient.tsx から送信している payload）
 * {
 *   ky_entry_id: string,
 *   ai_generation_id: string | null,
 *   event: "apply",
 *   applied_fields: string[],
 *   values_before: Record<string, any>,
 *   values_ai: Record<string, any>,
 *   values_after: Record<string, any>,
 *   client_ts: string (ISO)
 * }
 *
 * ※ただし DBの ky_ai_quality_logs には applied_fields 等の列は無い
 * → summary_json / per_field / meta / counts / rates にまとめて格納する
 */

export async function POST(req: Request) {
  const admin = getAdmin();
  if (!admin) {
    return json(false, { error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return json(false, { error: "Invalid JSON body" }, 400);
  }

  const ky_entry_id = safeTrim(body?.ky_entry_id);
  const ai_generation_id = safeTrim(body?.ai_generation_id) || null;

  // event はテーブル列に無いので meta に入れる
  const event = safeTrim(body?.event) || "apply";

  const applied_fields = Array.isArray(body?.applied_fields)
    ? body.applied_fields.map((x: any) => safeTrim(x)).filter(Boolean)
    : [];

  const values_before = body?.values_before ?? {};
  const values_ai = body?.values_ai ?? {};
  const values_after = body?.values_after ?? {};
  const client_ts = body?.client_ts ?? null;

  if (!ky_entry_id) {
    return json(false, { error: "ky_entry_id is required" }, 400);
  }

  if (applied_fields.length === 0) {
    return json(false, { error: "applied_fields is required" }, 400);
  }

  // ここで「ky_ai_quality_logs テーブル定義」に完全準拠させる
  const version = 1;

  // per_field は { field: { before, ai, after, result } } の形にする
  // result は簡易で "overwrite" 扱い（今回は反映ログなので）
  const per_field: Record<string, any> = {};
  for (const f of applied_fields) {
    per_field[f] = {
      field: f,
      before: values_before?.[f] ?? null,
      ai: values_ai?.[f] ?? null,
      after: values_after?.[f] ?? null,
      result: "apply", // overwrite/ask/skip の体系にしたいなら後で変更可
    };
  }

  // counts / rates は最低限（あとで本格集計に拡張できる）
  const counts = {
    applied_fields: applied_fields.length,
  };

  const rates = {
    // 将来の拡張用。現時点は仮置きでOK
  };

  // summary_json は「このログ1回分の情報をまとめる」
  const summary_json = {
    ky_entry_id,
    ai_generation_id,
    event,
    applied_fields,
    client_ts,
    values_before,
    values_ai,
    values_after,
  };

  const meta = {
    source: "KyEditClient",
    event,
    client_ts,
    applied_fields,
  };

  // target_field は 1つだけ入れる想定っぽいので
  // 反映した中で先頭を入れる（不要なら null にしてOK）
  const target_field = applied_fields[0] ?? null;

  // user_id はクライアントから送ってないので null（列が NOT NULL の場合は要対応）
  // ※あなたのテーブルは user_id が uuid なので、NOT NULL ならここで落ちます
  // その場合は route.ts で auth の user を取る or nullable にする必要があります。
  const insertPayload: any = {
    ky_entry_id,
    ai_generation_id,
    user_id: null,
    summary_json,
    meta,
    rates,
    counts,
    per_field,
    version,
    target_field,
  };

  const { data, error } = await admin
    .from("ky_ai_quality_logs")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();

  if (error) {
    return json(false, { error: error.message }, 500);
  }

  return json(true, { data }, 200);
}

/**
 * GET /api/ky-ai-quality-logs?ky_entry_id=xxxx&limit=50
 */
export async function GET(req: Request) {
  const admin = getAdmin();
  if (!admin) {
    return json(false, { error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const { searchParams } = new URL(req.url);
  const ky_entry_id = safeTrim(searchParams.get("ky_entry_id"));
  const limitRaw = safeTrim(searchParams.get("limit"));

  const limit = Math.max(1, Math.min(200, Number(limitRaw || "50") || 50));

  if (!ky_entry_id) {
    return json(false, { error: "ky_entry_id is required" }, 400);
  }

  const { data, error } = await admin
    .from("ky_ai_quality_logs")
    .select("*")
    .eq("ky_entry_id", ky_entry_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return json(false, { error: error.message }, 500);
  }

  return json(true, { data }, 200);
}
