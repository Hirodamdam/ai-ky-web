// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = Record<string, any>;

function s(v: any) {
  if (v == null) return "";
  return String(v);
}
function nf(v: any): number | null {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(x) ? x : null;
}
function ni(v: any): number {
  const x = nf(v);
  return x == null ? 0 : x;
}
function firstNonEmpty(body: Body, keys: string[]) {
  for (const k of keys) {
    const v = body?.[k];
    const t = s(v).trim();
    if (t) return t;
  }
  return "";
}

// ✅ ここ重要：JSON内の "\\n" や "\\r\\n" を実改行に戻す（¥n対策）
function normalizeNewlines(text: string): string {
  return s(text)
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

function pickBody(body: Body) {
  const work_detail = firstNonEmpty(body, [
    "work_detail",
    "workDetail",
    "work",
    "work_content",
    "workContent",
    "work_text",
    "workText",
    "task",
    "description",
    "content",
    "title",
  ]);

  const weather_text = firstNonEmpty(body, [
    "weather_text",
    "weatherText",
    "weather",
    "applied_weather_text",
    "appliedWeatherText",
    "applied_weather_label",
    "appliedWeatherLabel",
  ]);

  const photo_url = firstNonEmpty(body, [
    "photo_url",
    "photoUrl",
    "photo",
    "photo_slope_url",
    "photoSlopeUrl",
    "slope_photo_url",
    "slopePhotoUrl",
    "photo_path_url",
    "photoPathUrl",
    "path_photo_url",
    "pathPhotoUrl",
  ]);

  const wbgt = nf(body?.wbgt ?? body?.wbgt_c ?? body?.WBGT);
  const temperature_c = nf(body?.temperature_c ?? body?.temp_c ?? body?.temperature);

  const worker_count = ni(body?.worker_count ?? body?.workerCount ?? body?.workers ?? body?.worker);
  const third_party_level = firstNonEmpty(body, ["third_party_level", "thirdPartyLevel", "third_party", "thirdParty"]);

  return {
    work_detail,
    weather_text,
    photo_url,
    wbgt,
    temperature_c,
    worker_count,
    third_party_level,
  };
}

function buildPrompt(input: ReturnType<typeof pickBody>) {
  const { work_detail, weather_text, wbgt, temperature_c, worker_count, third_party_level, photo_url } = input;

  return [
    "あなたは建設現場の安全管理（KY）の専門家です。出力は必ず日本語。",
    "甘い評価は禁止。根拠のない断定は禁止。推測は『推測』と明記。",
    "",
    "【最重要ルール】",
    "・入力不足（写真がない/気象が不明/作業員数が未入力 等）を危険予知の主題にしない。",
    "・不足を理由にした一般論は禁止。必ず『作業内容』に紐づく危険と対策を出す。",
    "",
    "【熱中症ルール（厳守）】",
    "・WBGT < 21 → 熱中症の危険予知・対策を一切出さない。",
    "・WBGT >= 25 → 熱中症を必ず含める。",
    "・WBGT不明時：気温30℃以上なら含める。25℃未満なら出さない。25〜29℃は推測と明記。",
    "",
    "【入力】",
    `作業内容: ${work_detail || "（未入力）"}`,
    `作業員数: ${worker_count || 0}`,
    `第三者状況: ${third_party_level || "（未選択）"}`,
    `気象要約: ${weather_text || "（なし）"}`,
    `WBGT: ${wbgt == null ? "（不明）" : wbgt}`,
    `気温: ${temperature_c == null ? "（不明）" : temperature_c}`,
    `写真URL: ${photo_url || "（なし）"}`,
    "",
    "【出力仕様（JSONのみ）】",
    "キーは4つ固定：ai_work_detail, ai_hazards, ai_countermeasures, ai_third_party",
    "ai_hazards：『・』箇条書き。各行は必ず『〇〇だから、〇〇が起こる』形式。上位5項目。",
    "ai_countermeasures：hazardsと1対1で対応（同数）。具体策のみ。",
    "ai_third_party：第三者が少ない/多いに応じて、誘導・区画・一時停止を具体化。空欄禁止。",
    "",
    "【強制：作業内容が『ガードレール設置工』系なら必ず含める観点】",
    "・交通規制/車両接触（車道側へ出る、誘導不備）",
    "・資材（支柱・レール）取回しの落下/挟まれ",
    "・穿孔/削孔/工具使用（飛来・目/手指）",
    "・足元不整地/段差（転倒）",
  ].join("\n");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const input = pickBody(body);

    if (!input.work_detail.trim()) {
      return NextResponse.json({ error: "作業内容（必須）を入力してください" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    const model = (process.env.OPENAI_MODEL || "gpt-5.1").trim();

    const prompt = buildPrompt(input);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "JSON以外は禁止。余計な文章禁止。" },
          { role: "user", content: prompt },
        ],
        // Structured Outputs（json_schema）はモデル依存なので、まずjson_objectで堅く行く :contentReference[oaicite:0]{index=0}
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json({ error: "openai_error", status: r.status, detail: t.slice(0, 1500) }, { status: 502 });
    }

    const data = (await r.json()) as any;
    const content = s(data?.choices?.[0]?.message?.content).trim();
    if (!content) return NextResponse.json({ error: "openai_error", detail: "empty content" }, { status: 502 });

    let obj: any;
    try {
      obj = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "openai_error", detail: "non-json response", raw: content.slice(0, 1500) }, { status: 502 });
    }

    const ai_work_detail = normalizeNewlines(obj?.ai_work_detail || "");
    const ai_hazards = normalizeNewlines(obj?.ai_hazards || "");
    const ai_countermeasures = normalizeNewlines(obj?.ai_countermeasures || "");
    const ai_third_party = normalizeNewlines(obj?.ai_third_party || "");

    return NextResponse.json({
      ai_work_detail,
      ai_hazards,
      ai_countermeasures,
      ai_third_party,
      // 互換キー
      hazards: ai_hazards,
      countermeasures: ai_countermeasures,
      third_party: ai_third_party,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "server_error", detail: s(e?.message).slice(0, 1000) }, { status: 500 });
  }
}
