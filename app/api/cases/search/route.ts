import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const q = String(body?.q ?? "").trim();
    const weather = String(body?.weather ?? "").trim();
    const workDetail = String(body?.work_detail ?? "").trim();
    const hazards = String(body?.hazards ?? "").trim();

    const query = [q, weather, workDetail, hazards].filter(Boolean).join(" ").trim();
    if (!query) return jsonError("q or work_detail etc required", 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // TS検索（tsvector）で上位を返す
    const { data, error } = await supabase
      .from("accident_cases")
      .select("source_title, source_url, published_date, industry, work_type, accident_type, summary, cause, measures")
      .textSearch("search_tsv", query, { type: "websearch", config: "simple" })
      .limit(7);

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({
      query,
      hits: data ?? [],
      source: "mhlw_anzeninfo(accident_cases)",
    });
  } catch (e: any) {
    return jsonError("server error", 500);
  }
}
