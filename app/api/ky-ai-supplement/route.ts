// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type WeatherSlot = {
  hour: 9 | 12 | 15;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg?: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
};

type Body = {
  work_detail?: string | null;
  hazards?: string | null;
  countermeasures?: string | null;
  third_party_level?: string | null; // "多い" | "少ない" | etc
  worker_count?: number | null;

  weather_slots?: WeatherSlot[] | null;

  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clampText(text: string, max = 1400) {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}

type WeatherRisk = {
  flags: string[];
  summary: string;
  hints: string[];
};

function analyzeWeather(slots: WeatherSlot[] | null | undefined): WeatherRisk {
  if (!slots || slots.length === 0) return { flags: [], summary: "気象データなし", hints: [] };

  const winds = slots.map((x) => n(x.wind_speed_ms)).filter((x): x is number => x != null);
  const rains = slots.map((x) => n(x.precipitation_mm)).filter((x): x is number => x != null);
  const temps = slots.map((x) => n(x.temperature_c)).filter((x): x is number => x != null);

  const maxWind = winds.length ? Math.max(...winds) : null;
  const maxRain = rains.length ? Math.max(...rains) : null;
  const minTemp = temps.length ? Math.min(...temps) : null;
  const maxTemp = temps.length ? Math.max(...temps) : null;

  const flags: string[] = [];
  const hints: string[] = [];

  // しきい値は安全寄りの暫定
  if (maxWind != null && maxWind >= 10) {
    flags.push("強風");
    hints.push("強風：飛散・転倒防止（養生固定、資材整理、立入規制）");
    hints.push("強風：高所/吊荷は中止・停止基準を事前共有");
  } else if (maxWind != null && maxWind >= 7) {
    flags.push("やや強風");
    hints.push("風：シート/看板/軽量資材の固定・飛散物点検");
  }

  if (maxRain != null && maxRain >= 3) {
    flags.push("雨");
    hints.push("雨：滑り・視界低下（滑り止め、照明、誘導強化）");
    hints.push("雨：法面/掘削の崩落兆候（湧水/クラック）重点巡視");
  } else if (maxRain != null && maxRain >= 1) {
    flags.push("小雨");
    hints.push("小雨：歩行帯確保・通路清掃・滑り止め");
  }

  if (minTemp != null && minTemp <= 5) {
    flags.push("低温");
    hints.push("低温：防寒・凍結/結露の滑り・体調不良に注意");
  }
  if (maxTemp != null && maxTemp >= 30) {
    flags.push("高温");
    hints.push("高温：熱中症（休憩/水分塩分/声掛け）強化");
  }
  if (minTemp != null && maxTemp != null && maxTemp - minTemp >= 10) {
    flags.push("寒暖差");
    hints.push("寒暖差：服装調整・体調確認（声掛け）追加");
  }

  const summaryParts: string[] = [];
  if (maxWind != null) summaryParts.push(`最大風速${maxWind.toFixed(1)}m/s`);
  if (maxRain != null) summaryParts.push(`最大降水${maxRain.toFixed(1)}mm`);
  if (minTemp != null && maxTemp != null) summaryParts.push(`気温${minTemp.toFixed(0)}〜${maxTemp.toFixed(0)}℃`);

  return { flags, summary: summaryParts.join(" / ") || "気象データあり", hints };
}

function analyzePhotoDiff(body: Body): string[] {
  const notes: string[] = [];

  const slopeNow = s(body.slope_photo_url).trim();
  const slopePrev = s(body.slope_prev_photo_url).trim();
  const pathNow = s(body.path_photo_url).trim();
  const pathPrev = s(body.path_prev_photo_url).trim();

  const slopeChanged = slopeNow && slopePrev && slopeNow !== slopePrev;
  const pathChanged = pathNow && pathPrev && pathNow !== pathPrev;

  if (slopeChanged) notes.push("法面：前回との差分の可能性（崩れ/浮石/泥濘/湧水を要確認）");
  if (pathChanged) notes.push("通路：前回との差分の可能性（段差/滑り/障害物/水溜りを要確認）");

  if (slopeNow && !slopePrev) notes.push("法面：前回写真なし（現況の変化点を口頭共有）");
  if (!slopeNow && slopePrev) notes.push("法面：今回写真なし（更新して最終確認推奨）");

  if (pathNow && !pathPrev) notes.push("通路：前回写真なし（現況の変化点を口頭共有）");
  if (!pathNow && pathPrev) notes.push("通路：今回写真なし（更新して最終確認推奨）");

  return notes;
}

function splitLines(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toBulletLines(items: string[], limit: number) {
  const out: string[] = [];
  for (const raw of items) {
    const t = (raw || "").replace(/^\s*[-・●]\s*/g, "").trim();
    if (!t) continue;
    out.push(`- ${t}`);
    if (out.length >= limit) break;
  }
  return out.join("\n");
}

type AiOut = {
  ai_work_detail: string;
  ai_hazards: string;
  ai_countermeasures: string;
  ai_third_party: string;
};

function safeParseJson(v: string): any | null {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const workDetail = clampText(s(body.work_detail), 1200);
    const hazards = clampText(s(body.hazards), 1200);
    const countermeasures = clampText(s(body.countermeasures), 1200);
    const thirdPartyLevel = s(body.third_party_level).trim();
    const workerCount = body.worker_count == null ? null : n(body.worker_count);

    const weatherSlots = body.weather_slots ?? null;
    const weatherRisk = analyzeWeather(weatherSlots);
    const photoNotes = analyzePhotoDiff(body);

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const model =
      process.env.KY_OPENAI_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4o-mini";

    const system = [
      "あなたは日本の土木・建設現場のKY（危険予知活動）文書を作る専門家です。",
      "出力は必ずJSONのみ。前置き/説明/挨拶は禁止。",
      "短く・箇条書き・優先順位。現場でそのまま使える文にする。",
      "",
      "【厳守】",
      "1) ai_hazards は必ず上位5つ、重要度順、'- ' 箇条書き。6個以上禁止。",
      "2) ai_countermeasures も必ず上位5つ、重要度順、'- ' 箇条書き。6個以上禁止。",
      "3) 墓参者（第三者）が「多い」場合、ai_third_party に『誘導』『区画（立入規制/動線分離）』『声掛け』を必ず含める。",
      "4) 気象リスクがある場合、ai_countermeasures に短い対策文を必ず含める。",
      "5) 写真差分メモがあれば、1行だけ“要確認”を入れる（長文化禁止）。",
      "6) 作業員数が多い場合は『声掛け・合図統一・立入管理』を上位に寄せる。",
      "",
      "【JSON形式】",
      "必ず以下キーを含む：ai_work_detail, ai_hazards, ai_countermeasures, ai_third_party",
      "値はすべて文字列。ai_hazards/ai_countermeasures/ai_third_party は '- ' 箇条書き。",
    ].join("\n");

    const user = [
      "【入力データ】",
      `作業内容: ${workDetail || "（未入力）"}`,
      `危険予知（人入力）: ${hazards || "（未入力）"}`,
      `対策（人入力）: ${countermeasures || "（未入力）"}`,
      `第三者（墓参者）: ${thirdPartyLevel || "（未入力）"}`,
      `作業員数: ${workerCount == null ? "（未入力）" : String(workerCount)}`,
      "",
      "【気象（9/12/15）】",
      `サマリ: ${weatherRisk.summary}`,
      `リスク: ${weatherRisk.flags.length ? weatherRisk.flags.join(" / ") : "なし"}`,
      ...(weatherSlots && weatherSlots.length
        ? weatherSlots.map((w) => {
            const t = w.temperature_c == null ? "?" : `${w.temperature_c}℃`;
            const ws = w.wind_speed_ms == null ? "?" : `${w.wind_speed_ms}m/s`;
            const pr = w.precipitation_mm == null ? "?" : `${w.precipitation_mm}mm`;
            return `- ${w.hour}時: ${w.weather_text} / ${t} / 風${ws} / 雨${pr}`;
          })
        : ["- （気象スロットなし）"]),
      "",
      "【気象対策ヒント（短文）】",
      ...(weatherRisk.hints.length ? weatherRisk.hints.map((x) => `- ${x}`) : ["- （なし）"]),
      "",
      "【写真差分メモ（URL差分のみ）】",
      ...(photoNotes.length ? photoNotes.map((x) => `- ${x}`) : ["- （差分メモなし）"]),
    ].join("\n");

    // ✅ ここがポイント：Responses API の json_schema 型エラーを避けて、
    // ✅ Chat Completions + response_format: json_object を使う（広く互換）
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson(content) ?? {};

    const out: AiOut = {
      ai_work_detail: clampText(s(parsed.ai_work_detail), 600) || "",
      ai_hazards: s(parsed.ai_hazards) || "",
      ai_countermeasures: s(parsed.ai_countermeasures) || "",
      ai_third_party: s(parsed.ai_third_party) || "",
    };

    // --- 最終ガード（上位5・墓参者多い・写真差分・気象） ---
    out.ai_hazards = toBulletLines(splitLines(out.ai_hazards), 5) || "- （危険予知なし）";
    out.ai_countermeasures = toBulletLines(splitLines(out.ai_countermeasures), 5) || "- （対策なし）";
    out.ai_third_party = toBulletLines(splitLines(out.ai_third_party), 6) || "- （第三者対応なし）";

    // 墓参者「多い」は必須3点を強制
    if (thirdPartyLevel === "多い") {
      const needWords = ["誘導", "区画", "声掛け"];
      const missing = needWords.filter((w) => !out.ai_third_party.includes(w));
      if (missing.length) {
        const extra = [
          "- 誘導：入口〜作業帯の動線を明確化（案内/看板）",
          "- 区画：コーン/バーで立入規制・動線分離",
          "- 声掛け：接近時は作業停止→声掛け→安全確認後再開",
        ];
        const merged = splitLines(out.ai_third_party).concat(extra);
        out.ai_third_party = toBulletLines(merged, 8);
      }
    }

    // 写真差分メモがあるなら hazards に“要確認”を1行だけ混ぜる
    if (photoNotes.length && !out.ai_hazards.includes("要確認")) {
      const merged = ["- 写真差分：変化点は要確認（崩れ/滑り/障害物）"].concat(splitLines(out.ai_hazards));
      out.ai_hazards = toBulletLines(merged, 5);
    }

    // 気象リスクがあるのに対策に気象ワードが無い場合、1行だけ差し込み
    if (weatherRisk.flags.length) {
      const hasWeather = /強風|風|雨|低温|高温|寒暖差|滑り|崩落|飛散/.test(out.ai_countermeasures);
      if (!hasWeather) {
        const merged = ["- 気象：滑り/飛散/崩落の予防を強化（巡視/固定/中止基準）"].concat(
          splitLines(out.ai_countermeasures)
        );
        out.ai_countermeasures = toBulletLines(merged, 5);
      }
    }

    return NextResponse.json(out);
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : "unknown error";
    return NextResponse.json(
      {
        ai_work_detail: "",
        ai_hazards: "- （生成エラー）",
        ai_countermeasures: "- （生成エラー）",
        ai_third_party: "- （生成エラー）",
        error: msg,
      },
      { status: 500 }
    );
  }
}
