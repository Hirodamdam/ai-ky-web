// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

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

  // 人入力（あれば参照）
  hazards?: string | null;
  countermeasures?: string | null;

  third_party_level?: string | null; // "少ない"/"多い"/""
  worker_count?: number | null;

  // 「適用枠」だけ渡す想定（9/12/15のうち1件）
  weather_slots?: WeatherSlot[] | null;

  // 写真URL（今回/前回）
  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;

  // 厳しめ運用
  profile?: "strict" | "normal" | string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}
function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clampText(t: string, max = 8000) {
  const x = s(t);
  if (x.length <= max) return x;
  return x.slice(0, max);
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
    .map((x) => x.replace(/^[•・\-\*]\s*/, "").trim())
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
  // 適用枠は先頭1件だけが来る想定（KyNewの appliedSlots）
  const slot = slots[0];
  if (!slot) return "";
  const hour = slot.hour;
  const wt = s(slot.weather_text).trim();
  const tc = slot.temperature_c == null ? "—" : `${slot.temperature_c}℃`;
  const ws = slot.wind_speed_ms == null ? "—" : `${slot.wind_speed_ms}m/s`;
  const pr = slot.precipitation_mm == null ? "—" : `${slot.precipitation_mm}mm`;
  return `${hour}時 / ${wt || "—"} / 気温:${tc} / 風速:${ws} / 降水:${pr}`;
}

function buildPhotoBlock(label: string, nowUrl: string, prevUrl: string) {
  const now = s(nowUrl).trim();
  const prev = s(prevUrl).trim();
  return `${label}（今回）: ${now || "なし"}\n${label}（前回）: ${prev || "なし"}`;
}

function fallbackBuild(work: string) {
  // 最低限、落ちてもUIを壊さない
  const base = `・${work ? `作業は「${work}」を想定。手順・動線・重機近接・第三者対応を厳しめに確認。` : "作業内容が不明のため、一般的リスクを厳しめに列挙。"}`
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

    // ---- Prompt（厳しめ・箇条書き強制）----
    const system = `
あなたは建設現場の安全管理（KY）の専門家。
ユーザー入力＋気象＋写真URL（今回/前回）を前提に、厳しめに危険予知と対策を補足する。
出力は必ずJSON。日本語。余計な前置き禁止。`.trim();

    const user = `
【入力：作業内容（必須）】
${clampText(work_detail, 4000)}

【人入力：危険予知（任意）】
${clampText(hazards_human, 3000) || "（なし）"}

【人入力：対策（任意）】
${clampText(counter_human, 3000) || "（なし）"}

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
   - 各行は必ず「◯◯だから◯◯が起こる/起きる/発生する」の因果形式にする。
   - 厳しめ：見落としを避けるため、8〜14項目を目標。
3) ai_countermeasures：対策。箇条書き（先頭「・」）。
   - 各行は「実施する/徹底する/設置する/配置する/確認する」で終える行動文。
   - 危険予知に対応し、1対1に近づける（不足しない）。
4) ai_third_party：第三者対策。箇条書き（先頭「・」）。4〜8項目目標。
5) ai_supplement：上の4項目を見出し付きでまとめる（改行あり）。
6) 文章は「恐れがある」を多用しすぎず、具体的に。現場で実行可能な内容にする。
7) ${strictMode ? "厳しめに評価し、手抜き・テンプレ・一般論だけは禁止。" : "標準の厳しさ。"} 
8) JSON以外は出力しない。

【JSONスキーマ】
{
  "ai_work_detail": "string",
  "ai_hazards": "string",
  "ai_countermeasures": "string",
  "ai_third_party": "string",
  "ai_supplement": "string"
}
`.trim();

    const client = new OpenAI({ apiKey });

    // Responses API 互換（SDKが古い場合はchat.completionsにフォールバック）
    let text = "";
    try {
      // @ts-ignore
      const r = await client.responses.create({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // なるべく脱線を防ぐ
        temperature: strictMode ? 0.3 : 0.5,
        max_output_tokens: 1400,
      });
      // @ts-ignore
      text = s(r?.output_text).trim();
    } catch (e1: any) {
      // chat.completions fallback
      // @ts-ignore
      const r2 = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: strictMode ? 0.3 : 0.5,
        max_tokens: 1400,
      });
      // @ts-ignore
      text = s(r2?.choices?.[0]?.message?.content).trim();
    }

    if (!text) {
      const fb = fallbackBuild(work_detail);
      return NextResponse.json({ ...fb, meta_model: model, meta_profile: profile });
    }

    // JSON抽出（モデルが```json```で包む場合もあるので剥がす）
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    const j = safeJsonParse(cleaned);

    if (!j) {
      // JSONになっていない場合：最低限整形して返す（UIを壊さない）
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
      {
        error: e?.message ? String(e.message) : "unknown error",
      },
      { status: 500 }
    );
  }
}
