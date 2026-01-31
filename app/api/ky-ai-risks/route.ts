import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

type RiskItem = {
  hazard: string;
  measure: string;
  severity: number;
  likelihood: number;
  exposure: number;
  risk_score: number;
  weather_factor?: string;
  rationale?: string;
};

function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function pickText(v: any) {
  if (v == null) return "";
  return String(v).trim();
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.round(x)));
}

function normalizeRiskItems(list: any): RiskItem[] {
  const arr = Array.isArray(list) ? list : [];
  const out: RiskItem[] = [];

  for (const it of arr) {
    const hazard = pickText(it?.hazard);
    const measure = pickText(it?.measure ?? it?.countermeasure);
    if (!hazard || !measure) continue;

    const severity = clampInt(it?.severity, 1, 5, 3);
    const likelihood = clampInt(it?.likelihood, 1, 5, 3);
    const exposure = clampInt(it?.exposure, 1, 5, 3);
    const risk_score = clampInt(it?.risk_score, 1, 125, severity * likelihood * exposure);

    out.push({
      hazard,
      measure,
      severity,
      likelihood,
      exposure,
      risk_score,
      weather_factor: it?.weather_factor ? String(it.weather_factor) : undefined,
      rationale: it?.rationale ? String(it.rationale) : undefined,
    });
  }

  out.sort((a, b) => b.risk_score - a.risk_score);
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const ky_entry_id = String(body?.ky_entry_id ?? "").trim();
    if (!ky_entry_id || !isUuidLike(ky_entry_id)) {
      return NextResponse.json({ error: "ky_entry_id required" }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // テーブルUNRESTRICTEDなら anon でも動く

    const sb = createClient(supabaseUrl, supabaseKey);

    // 1) ky_entries 取得（当日条件）
    const { data: entry, error: e1 } = await sb
      .from("ky_entries")
      .select(
        "id, project_id, work_date, weather, temperature_text, wind_direction, wind_speed_text, precipitation_mm, workers, work_detail, hazards, countermeasures, notes"
      )
      .eq("id", ky_entry_id)
      .maybeSingle();

    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    if (!entry) return NextResponse.json({ error: "ky_entry not found" }, { status: 404 });

    // 2) ky_items（人入力があれば材料に追加）
    const { data: items, error: e2 } = await sb
      .from("ky_items")
      .select("id, ky_entry_id, sort_no, work_detail_human, hazards_human, countermeasures_human")
      .eq("ky_entry_id", ky_entry_id)
      .order("sort_no", { ascending: true })
      .limit(200);

    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

    const humanPieces: string[] = [];
    for (const it of items ?? []) {
      const w = pickText((it as any)?.work_detail_human);
      const h = pickText((it as any)?.hazards_human);
      const c = pickText((it as any)?.countermeasures_human);
      if (w || h || c) {
        humanPieces.push(
          `【行 sort_no=${(it as any)?.sort_no ?? ""}】\n作業内容:${w}\n危険:${h}\n対策:${c}`.trim()
        );
      }
    }

    const conditions = {
      weather: pickText((entry as any)?.weather),
      temperature_text: pickText((entry as any)?.temperature_text),
      wind_direction: pickText((entry as any)?.wind_direction),
      wind_speed_text: pickText((entry as any)?.wind_speed_text),
      precipitation_mm: (entry as any)?.precipitation_mm ?? null,
      workers: (entry as any)?.workers ?? null,
      work_detail: pickText((entry as any)?.work_detail),
      hazards_human: pickText((entry as any)?.hazards),
      countermeasures_human: pickText((entry as any)?.countermeasures),
      notes: pickText((entry as any)?.notes),
      ky_items_human: humanPieces.join("\n\n"),
    };

    // 3) OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });

    const client = new OpenAI({ apiKey });

    const system = `
あなたは建設現場の安全管理（KY活動）支援AI。
出力は必ずJSON配列のみ。各要素は次の形：
{
 "hazard": "予想される危険（短く具体的）",
 "measure": "対策（実行可能に）",
 "severity": 1-5,
 "likelihood": 1-5,
 "exposure": 1-5,
 "risk_score": 1-125,
 "weather_factor": "天候が影響する場合のみ（任意）",
 "rationale": "なぜ高リスクか（任意・短く）"
}
ルール：
- 当日の条件（気象＋作業内容＋人が書いた危険/対策）から、抜け漏れが出ないように列挙。
- リスク高い順で網羅的に（ただし重複はまとめる）。
- hazard と measure は必須、空は禁止。
`.trim();

    const user = `
【当日の条件】
${JSON.stringify(conditions, null, 2)}

この条件を材料に、「危険予知活動KY」用のリストを作成してください。
`.trim();

    const resp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // JSON以外が混ざった場合の救済：最初の[ ... ]を抜く
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("AIの返答がJSONになっていません");
      parsed = JSON.parse(m[0]);
    }

    const risks = normalizeRiskItems(parsed);

    // 4) ky_items に保存（sort_no=0 の1行に hazards_ai 配列で保持）
    // 既存があれば更新、なければ作成
    const nowIso = new Date().toISOString();

    const { data: existing, error: e3 } = await sb
      .from("ky_items")
      .select("id")
      .eq("ky_entry_id", ky_entry_id)
      .eq("sort_no", 0)
      .maybeSingle();

    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });

    if (existing?.id) {
      const { error: eUp } = await sb
        .from("ky_items")
        .update({
          hazards_ai: risks as any,
          countermeasures_ai: [] as any,
          ai_generated_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", existing.id);

      if (eUp) return NextResponse.json({ error: eUp.message }, { status: 500 });
    } else {
      const { error: eIn } = await sb.from("ky_items").insert({
        ky_entry_id,
        sort_no: 0,
        hazards_ai: risks as any,
        countermeasures_ai: [] as any,
        ai_generated_at: nowIso,
      } as any);

      if (eIn) return NextResponse.json({ error: eIn.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, count: risks.length, risks });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ? String(e.message) : "unknown error" }, { status: 500 });
  }
}
