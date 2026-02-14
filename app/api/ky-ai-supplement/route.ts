// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso?: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm?: number | null;
  weather_code?: number | null;
};

type Body = {
  work_detail?: string | null;
  hazards?: string | null;
  countermeasures?: string | null;

  third_party_level?: string | null;
  worker_count?: number | null;

  weather_slots?: WeatherSlot[] | null;

  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;

  profile?: "strict" | "normal" | string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}
function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function toBullet(text: string): string {
  const lines = s(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[•・\-\*]\s*/g, "").trim())
    .filter(Boolean);
  if (!lines.length) return "";
  return lines.map((x) => `・${x}`).join("\n");
}
function normalizeThirdParty(level: string) {
  const t = s(level).trim();
  if (!t) return "";
  if (t.includes("多")) return "多い";
  if (t.includes("少")) return "少ない";
  return t;
}
function buildWeatherApplied(weather_slots?: WeatherSlot[] | null) {
  const slots = Array.isArray(weather_slots) ? weather_slots : [];
  const slot = slots[0];
  if (!slot) return "";
  const wt = s(slot.weather_text).trim();
  const tc = slot.temperature_c == null ? "—" : `${slot.temperature_c}℃`;
  const ws = slot.wind_speed_ms == null ? "—" : `${slot.wind_speed_ms}m/s`;
  const pr = slot.precipitation_mm == null ? "—" : `${slot.precipitation_mm}mm`;
  return `${slot.hour}時 / ${wt || "—"} / 気温:${tc} / 風速:${ws} / 降水:${pr}`;
}
function buildPhotoBlock(label: string, nowUrl: string, prevUrl: string) {
  const now = s(nowUrl).trim();
  const prev = s(prevUrl).trim();
  return `${label}（今回）: ${now || "なし"}\n${label}（前回）: ${prev || "なし"}`;
}
function fallbackBuild(work: string) {
  const base = `・${work ? `作業は「${work}」を想定。動線・重機近接・第三者対応を厳しめに確認する。` : "作業内容が不明のため、一般的リスクを厳しめに列挙する。"}`
  return {
    ai_work_detail: base,
    ai_hazards: "・不安全行動が起きる恐れがあるから、接触・転倒・転落が起こる\n・足元不良が残る恐れがあるから、滑り・転倒が起こる",
    ai_countermeasures: "・立入規制を実施し、誘導員を配置する\n・足元整備を行い、滑り止め対策を実施する",
    ai_third_party: "・第三者の動線を分離し、声掛け・誘導を徹底する",
    ai_supplement:
      "【作業内容】\n" +
      base +
      "\n\n【危険予知】\n" +
      "・不安全行動が起きる恐れがあるから、接触・転倒・転落が起こる\n" +
      "・足元不良が残る恐れがあるから、滑り・転倒が起こる\n\n" +
      "【対策】\n" +
      "・立入規制を実施し、誘導員を配置する\n" +
      "・足元整備を行い、滑り止め対策を実施する\n\n" +
      "【第三者】\n" +
      "・第三者の動線を分離し、声掛け・誘導を徹底する",
  };
}

async function callResponsesAPI(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  max_output_tokens: number;
}) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      input: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature,
      max_output_tokens: opts.max_output_tokens,
    }),
  });

  const j = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = s(j?.error?.message || j?.error || j?.message || "OpenAI API error");
    const err = new Error(msg);
    (err as any).status = res.status;
    throw err;
  }

  // output_text があればそれを優先
  const text = s((j as any)?.output_text).trim();
  if (text) return text;

  // 念のため output 配列から拾う
  const out = (j as any)?.output;
  if (Array.isArray(out)) {
    for (const o of out) {
      const content = o?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c?.type === "output_text" && typeof c?.text === "string") {
          return c.text.trim();
        }
      }
    }
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const work_detail = s(body?.work_detail).trim();
    const hazards_human = s(body?.hazards).trim();
    const counter_human = s(body?.countermeasures).trim();

    const third_party_level = normalizeThirdParty(body?.third_party_level || "");
    const worker_count = n(body?.worker_count);

    const weatherApplied = buildWeatherApplied(body?.weather_slots ?? null);

    const slopeNow = s(body?.slope_photo_url).trim();
    const slopePrev = s(body?.slope_prev_photo_url).trim();
    const pathNow = s(body?.path_photo_url).trim();
    const pathPrev = s(body?.path_prev_photo_url).trim();

    if (!work_detail) {
      return NextResponse.json({ error: "work_detail required" }, { status: 400 });
    }

    const apiKey = s(process.env.OPENAI_API_KEY).trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });
    }

    const model = (process.env.OPENAI_MODEL_RISKS || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
    const profile = (s(body?.profile).trim() || "strict") as string;
    const strictMode = profile !== "normal";

    const system = `
あなたは建設現場の安全管理（KY）の専門家。
ユーザー入力＋気象＋写真URL（今回/前回）を前提に、厳しめに危険予知と対策を補足する。
出力は必ずJSON。日本語。余計な前置き禁止。`.trim();

    const user = `
【入力：作業内容（必須）】
${work_detail}

【人入力：危険予知（任意）】
${hazards_human || "（なし）"}

【人入力：対策（任意）】
${counter_human || "（なし）"}

【作業員数】
${worker_count == null ? "（未入力）" : `${worker_count} 人`}

【第三者（墓参者）】
${third_party_level || "（未入力）"}

【気象（適用枠）】
${weatherApplied || "（未適用/不明）"}

【写真URL】
${buildPhotoBlock("法面", slopeNow, slopePrev)}
${"\n"}
${buildPhotoBlock("通路", pathNow, pathPrev)}

【出力ルール（絶対）】
1) ai_work_detail：作業内容の補足。箇条書き（先頭は必ず「・」）。
2) ai_hazards：危険予知。箇条書き（先頭「・」）。
   - 各行は必ず「◯◯だから◯◯が起こる/起きる/発生する」の因果形式。
   - 8〜14項目を目標（厳しめ）。
3) ai_countermeasures：対策。箇条書き（先頭「・」）。
   - 各行は「実施する/徹底する/設置する/配置する/確認する」で終わる行動文。
   - 危険予知に対応し、1対1に近づける。
4) ai_third_party：第三者対策。箇条書き（先頭「・」）。4〜8項目目標。
5) ai_supplement：上の4項目を見出し付きでまとめる（改行あり）。
6) ${strictMode ? "テンプレ禁止。厳しめに具体化。" : "標準の厳しさ。"}
7) JSON以外は出力しない。

【JSONスキーマ】
{
  "ai_work_detail": "string",
  "ai_hazards": "string",
  "ai_countermeasures": "string",
  "ai_third_party": "string",
  "ai_supplement": "string"
}
`.trim();

    let text = "";
    try {
      text = await callResponsesAPI({
        apiKey,
        model,
        system,
        user,
        temperature: strictMode ? 0.3 : 0.5,
        max_output_tokens: 1400,
      });
    } catch (e1: any) {
      // ここに落ちてもUIを壊さない
      const fb = fallbackBuild(work_detail);
      return NextResponse.json({ ...fb, meta_model: model, meta_profile: profile, meta_note: e1?.message || "openai_error" });
    }

    if (!text) {
      const fb = fallbackBuild(work_detail);
      return NextResponse.json({ ...fb, meta_model: model, meta_profile: profile, meta_note: "empty_output" });
    }

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const j = safeJsonParse(cleaned);
    if (!j) {
      const fb = fallbackBuild(work_detail);
      return NextResponse.json({ ...fb, meta_model: model, meta_profile: profile, meta_note: "model_output_not_json" });
    }

    const ai_work_detail = toBullet(j.ai_work_detail);
    const ai_hazards = toBullet(j.ai_hazards);
    const ai_countermeasures = toBullet(j.ai_countermeasures);
    const ai_third_party = toBullet(j.ai_third_party);

    const ai_supplement =
      `【作業内容】\n${ai_work_detail || "（なし）"}\n\n` +
      `【危険予知】\n${ai_hazards || "（なし）"}\n\n` +
      `【対策】\n${ai_countermeasures || "（なし）"}\n\n` +
      `【第三者】\n${ai_third_party || "（なし）"}`;

    return NextResponse.json({
      ai_work_detail,
      ai_hazards,
      ai_countermeasures,
      ai_third_party,
      ai_supplement,
      meta_model: model,
      meta_profile: profile,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ? String(e.message) : "unknown error" },
      { status: 500 }
    );
  }
}
