// app/api/ky-public/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  token?: string;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const token = s(body?.token).trim();

    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // ✅ 公開ページは認証なしで読める必要があるので service role で読む（RLS回避）
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 1) tokenでKYを取得
    const { data: ky, error: kyErr } = await supabase
      .from("ky_entries")
      .select(
        `
        id,
        project_id,
        work_date,
        partner_company_name,
        third_party_level,
        weather_slots,
        ai_work_detail,
        ai_hazards,
        ai_countermeasures,
        ai_third_party,
        ai_supplement,
        is_approved,
        public_token
      `
      )
      .eq("public_token", token)
      .maybeSingle();

    if (kyErr) {
      return NextResponse.json({ error: kyErr.message }, { status: 500 });
    }

    // token不正
    if (!ky) {
      return NextResponse.json({ ky: null, project: null }, { status: 200 });
    }

    // ✅ 承認済みのみ公開（ここが重要）
    if (!ky.is_approved) {
      return NextResponse.json({ ky: null, project: null }, { status: 200 });
    }

    // 2) project を取得（施工会社名など）
    const projectId = s(ky.project_id);
    let project: any = null;

    if (projectId) {
      const { data: p, error: pErr } = await supabase
        .from("projects")
        .select("name, contractor_name")
        .eq("id", projectId)
        .maybeSingle();

      if (pErr) {
        // project取得失敗でもKYは返す（公開ページが落ちないように）
        project = null;
      } else {
        project = p ?? null;
      }
    }

    // 公開側に返す形（KyPublicClient.tsx の型に合わせる）
    return NextResponse.json(
      {
        ky: {
          work_date: ky.work_date ?? null,
          partner_company_name: ky.partner_company_name ?? null,
          third_party_level: ky.third_party_level ?? null,
          weather_slots: ky.weather_slots ?? null,

          ai_work_detail: ky.ai_work_detail ?? null,
          ai_hazards: ky.ai_hazards ?? null,
          ai_countermeasures: ky.ai_countermeasures ?? null,
          ai_third_party: ky.ai_third_party ?? null,

          ai_supplement: ky.ai_supplement ?? null,

          is_approved: ky.is_approved ?? null,

          // ※あなたの型にある public_enabled は使ってないので null にしておく
          public_enabled: null,
        },
        project,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
