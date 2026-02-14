// app/api/ky-create/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function s(v: any) {
  return v == null ? "" : String(v);
}

function pick(src: Record<string, any>, keys: string[]) {
  const out: Record<string, any> = {};
  for (const k of keys) if (k in src) out[k] = src[k];
  return out;
}

function isValidUuid(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const x = v.trim();
  if (!x || x === "undefined") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const accessToken = m?.[1];
    if (!accessToken) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
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

    // ✅ ユーザーセッション検証（なりすまし防止）
    const authed = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const userRes = await authed.auth.getUser();
    if (userRes.error || !userRes.data.user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, any>;

    const project_id = s(body.project_id || body.projectId).trim();
    if (!isValidUuid(project_id)) {
      return NextResponse.json({ error: "project_id required (uuid)" }, { status: 400 });
    }

    // ✅ 許可キーのみDBに入れる（ゴミ混入防止）
    const allowed = [
      "project_id",
      "work_date",
      "partner_company_id",
      "partner_company_name",
      "worker_count",

      // 人の入力
      "work_content",
      "hazards",
      "countermeasures",
      "third_party_level",

      // 気象
      "weather_slots",
      "weather_applied_slots",
      "weather_applied_at",

      // 写真スコアなど（将来用）
      "photo_urls",
      "photo_score",
      "photo_score_detail",

      // リスク評価
      "risk_score_total",
      "risk_score_breakdown",

      // AI（互換）
      "ai_work_detail",
      "ai_hazards",
      "ai_countermeasures",
      "ai_third_party",
      "ai_supplement",

      // ✅ AI正本
      "ai_risk_items",
      "ai_profile",
      "ai_generated_at",
    ];

    const payload = pick(body, allowed);
    payload.project_id = project_id;

    const nowIso = new Date().toISOString();
    if (!payload.ai_profile) payload.ai_profile = "strict";
    if (payload.ai_risk_items && !payload.ai_generated_at) payload.ai_generated_at = nowIso;

    const admin = createClient(url, serviceKey);

    const { data, error } = await admin
      .from("ky_entries")
      .insert(payload)
      .select("id, project_id")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message, details: error.details, hint: error.hint, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, kyId: data?.id, projectId: data?.project_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "ky create failed" }, { status: 500 });
  }
}
