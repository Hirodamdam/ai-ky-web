// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type WeatherSlot = {
  hour: 9 | 12 | 15;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
};

type Body = {
  work_detail: string;

  // ✅ 受け取っても「AIへは送らない」（比較用：重複除外のみ）
  hazards?: string | null;
  countermeasures?: string | null;

  third_party_level?: string | null; // "多い" | "少ない" | ""

  // ✅ AIへ送る
  weather_slots?: WeatherSlot[] | null;

  slope_photo_url?: string | null; // 今回
  slope_prev_photo_url?: string | null; // 前回
  path_photo_url?: string | null; // 今回
  path_prev_photo_url?: string | null; // 前回
};

function s(v: any) {
  return v == null ? "" : String(v);
}
function normalizeText(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").replace(/\u3000/g, " ").trim();
}
function stripBulletLead(x: string): string {
  return x.replace(/^[•・\-*]\s*/, "").trim();
}
function safeUrl(u: any): string | null {
  const t = s(u).trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}
function splitLines(text: string): string[] {
  return normalizeText(text)
    .split("\n")
    .map((x) => stripBulletLead(normalizeText(x)))
    .filter(Boolean);
}

/** 因果形式を最後に保証 */
function ensureCausal(line: string): string {
  const t = stripBulletLead(normalizeText(line));
  if (!t) return "";
  if (/(だから|ため|恐れ|起こる|発生|転倒|転落|接触|巻き込まれ|飛来|墜落|滑落)/.test(t)) return t;

  const base = t;
  const risk =
    /(足元|段差|滑り|ぬかるみ|凍結)/.test(base)
      ? "つまずき・転倒が起こる"
      : /(法面|斜面|崩壊|土砂|滑落|落石)/.test(base)
      ? "転落・崩壊が起こる"
      : /(吹付|ノズル|ホース|圧送|ポンプ|跳ね返り)/.test(base)
      ? "飛散・高圧噴射による受傷が起こる"
      : /(回転|巻き込|攪拌|ミキサ|ベルト|チェーン)/.test(base)
      ? "巻き込まれが起こる"
      : /(重機|バックホウ|ユンボ|車両|死角)/.test(base)
      ? "接触・巻き込まれが起こる"
      : "事故が起こる";
  return `${base}だから、${risk}`;
}

/** =========================
 *  重複判定（人入力と似てたら落とす）
 *  ※落とし過ぎ防止：閾値は「似てても残す」方向（前回の増える版）
 * ========================= */
function normalizeForSim(x: string): string {
  return (x || "")
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[（）()\[\]【】「」『』]/g, "")
    .replace(/[、，,。．.・:：;；/／|｜]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function charBigrams(x: string): Set<string> {
  const t = normalizeForSim(x).replace(/\s+/g, "");
  const out = new Set<string>();
  if (t.length <= 1) return out;
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}
function isTooSimilar(line: string, humanLines: string[], threshold: number): boolean {
  if (!humanLines.length) return false;
  const a = charBigrams(line);
  if (!a.size) return false;
  for (const h of humanLines) {
    const b = charBigrams(h);
    const sim = jaccard(a, b);
    if (sim >= threshold) return true;
  }
  return false;
}
function dedupeKeepOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}
function joinLines(arr: string[]): string {
  return arr.map((x) => normalizeText(x)).filter(Boolean).join("\n");
}

/** =========================
 *  OpenAI Responses API（タイムアウト/リトライ）
 * ========================= */
function isAbortError(e: any): boolean {
  const msg = s(e?.message).toLowerCase();
  return msg.includes("aborted") || msg.includes("abort") || e?.name === "AbortError";
}
async function callOpenAIResponses(payload: any, apiKey: string, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = s(j?.error?.message) || `OpenAI API error (${res.status})`;
      const err: any = new Error(msg);
      err.detail = j?.error ?? j;
      throw err;
    }
    return j;
  } finally {
    clearTimeout(to);
  }
}
function extractAnyTextFromResponses(resp: any): string {
  const direct = s(resp?.output_text).trim();
  if (direct) return direct;

  const out = resp?.output;
  if (Array.isArray(out)) {
    for (const block of out) {
      const content = block?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        const t1 = s(c?.text).trim();
        if (t1) return t1;
        if (c?.parsed != null) {
          try {
            return JSON.stringify(c.parsed);
          } catch {}
        }
      }
    }
  }

  try {
    return JSON.stringify(resp);
  } catch {
    return s(resp);
  }
}
function parseJsonLoosely(text: string): any | null {
  const src = s(text);
  try {
    return JSON.parse(src);
  } catch {}

  const deFenced = src.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = deFenced.indexOf("{");
  const end = deFenced.lastIndexOf("}");
  if (start >= 0 && end >= 0 && end > start) {
    const sliced = deFenced.slice(start, end + 1);
    try {
      return JSON.parse(sliced);
    } catch {}
  }
  return null;
}
function normalizeArrayToStrings(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const t =
          (typeof x.text === "string" ? x.text : "") ||
          (typeof x.content === "string" ? x.content : "") ||
          (typeof x.value === "string" ? x.value : "") ||
          "";
        if (t) return t;
        try {
          return JSON.stringify(x);
        } catch {
          return "";
        }
      }
      return "";
    })
    .map((x) => stripBulletLead(normalizeText(x)))
    .filter(Boolean);
}

function weatherSummary(slots: WeatherSlot[] | null | undefined): { text: string; isFineDry: boolean; isWindy: boolean; isHot: boolean } {
  const arr = Array.isArray(slots) ? slots : [];
  if (!arr.length) return { text: "（気象データなし）", isFineDry: false, isWindy: false, isHot: false };

  const srt = arr
    .filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15))
    .sort((a, b) => a.hour - b.hour);

  let maxWind = 0;
  let maxTemp = -999;
  let maxPrec = 0;
  let fineLike = 0;

  const lines = srt.map((x) => {
    const w = s(x.weather_text) || "不明";
    const t = x.temperature_c == null ? null : Number(x.temperature_c);
    const ws = x.wind_speed_ms == null ? null : Number(x.wind_speed_ms);
    const p = x.precipitation_mm == null ? null : Number(x.precipitation_mm);

    if (ws != null && !Number.isNaN(ws)) maxWind = Math.max(maxWind, ws);
    if (t != null && !Number.isNaN(t)) maxTemp = Math.max(maxTemp, t);
    if (p != null && !Number.isNaN(p)) maxPrec = Math.max(maxPrec, p);

    if (/晴|快晴|日差し/.test(w)) fineLike++;

    return `${x.hour}時: ${w} / 気温${t == null ? "—" : `${t}℃`} / 風速${ws == null ? "—" : `${ws}m/s`} / 降水${p == null ? "—" : `${p}mm`}`;
  });

  const isWindy = maxWind >= 6;
  const isHot = maxTemp >= 28;
  const isFineDry = maxPrec === 0 && fineLike >= 1;

  return { text: lines.join("\n"), isFineDry, isWindy, isHot };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const workDetail = normalizeText(s(body?.work_detail));
    if (!workDetail) return NextResponse.json({ error: "work_detail is required" }, { status: 400 });

    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim();

    // 人入力（比較用だけ）
    const humanHazLines = splitLines(s(body?.hazards));
    const humanMeaLines = splitLines(s(body?.countermeasures));
    const thirdLevel = normalizeText(s(body?.third_party_level));

    // AIへ渡す気象とフラグ
    const wx = weatherSummary(Array.isArray(body?.weather_slots) ? (body.weather_slots as WeatherSlot[]) : []);
    const slopeNow = safeUrl(body?.slope_photo_url);
    const slopePrev = safeUrl(body?.slope_prev_photo_url);
    const pathNow = safeUrl(body?.path_photo_url);
    const pathPrev = safeUrl(body?.path_prev_photo_url);

    /** ✅ ここだけ “加える” ：作業内容からの危険予知/対策を濃くする指示（前回コードに追記） */
    const systemText = [
      "あなたは日本の建設現場の安全管理（所長補佐）。",
      "出力は必ずJSONのみ。前置き/解説/挨拶は禁止。JSON以外を出力しない。",
      "",
      "入力は「作業内容」「気象要約」「写真（今回/前回）」のみ。",
      "",
      "【最重要】作業内容（工程固有）由来を薄くしない：",
      "・作業内容を工程として分解して考える（準備→運搬→施工→片付け 等）。",
      "・各工程で「いつ/どこで/何を/誰が/何の道具で」危険が出るかを具体化する。",
      "・対策は『誰が（役割）』『配置（位置）』『手順』『停止基準』『合図』まで書く。",
      "・抽象語だけ（注意する等）は禁止。現場でそのまま使える密度で。",
      "",
      "必須：",
      "1) hazards は必ず『〇〇だから、〇〇が起こる』形式で1項目=1行。",
      "2) measures は具体策（手順/配置/合図/停止基準/点検/保護具/立入規制）を1項目=1行。",
      "3) 気象に応じたリスクと対策を必ず含める（降雨ゼロでも『乾燥/粉じん/眩しさ/日射/熱中症/風による飛散』を検討）。",
      "4) 写真は今回/前回を比較し、足元状況（ぬかるみ/段差/落石/崩れ兆候/養生不足/資機材散乱/立入規制の有無）を読み取り反映する。",
      "5) 項目数は多め（上限なし）。ただし薄くするくらいなら増やす。",
    ].join("\n");

    const userText = [
      "【作業内容】",
      workDetail,
      "",
      "【気象要約】",
      wx.text,
      "",
      `【気象フラグ】快晴乾燥=${wx.isFineDry ? "Yes" : "No"} / 強風=${wx.isWindy ? "Yes" : "No"} / 高温=${wx.isHot ? "Yes" : "No"}`,
      "",
      "【写真】",
      "以下の画像（今回/前回）を比較し、危険予知と対策に反映してください。",
      "※ 画像が無い場合は、その項目は想定リスクで補完してください。",
    ].join("\n");

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        hazards: { type: "array", items: { type: "string" } },
        measures: { type: "array", items: { type: "string" } },
      },
      required: ["hazards", "measures"],
    } as const;

    const userContent: any[] = [{ type: "input_text", text: userText }];
    if (slopeNow) userContent.push({ type: "input_image", image_url: slopeNow });
    if (slopePrev) userContent.push({ type: "input_image", image_url: slopePrev });
    if (pathNow) userContent.push({ type: "input_image", image_url: pathNow });
    if (pathPrev) userContent.push({ type: "input_image", image_url: pathPrev });

    const buildPayload = (maxTokens: number) => ({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        { role: "user", content: userContent },
      ],
      text: { format: { type: "json_schema", name: "ky_ai_supplement", strict: true, schema } },
      temperature: 0.4,
      max_output_tokens: maxTokens,
    });

    const timeout1 = Number(process.env.OPENAI_TIMEOUT_MS || "60000");
    const timeout2 = Number(process.env.OPENAI_TIMEOUT_MS_RETRY || "60000");

    let resp: any = null;
    try {
      resp = await callOpenAIResponses(buildPayload(1800), apiKey, timeout1);
    } catch (e: any) {
      if (!isAbortError(e)) {
        return NextResponse.json({ error: e?.message ?? "OpenAI API error", detail: e?.detail ?? null }, { status: 500 });
      }
      resp = await callOpenAIResponses(buildPayload(1200), apiKey, timeout2);
    }

    const anyText = extractAnyTextFromResponses(resp);
    const parsed = parseJsonLoosely(anyText) ?? {};

    let hazards = normalizeArrayToStrings(parsed?.hazards).map(ensureCausal).filter(Boolean);
    let measures = normalizeArrayToStrings(parsed?.measures).map((x) => stripBulletLead(normalizeText(x))).filter(Boolean);

    // ✅ 落とし過ぎ防止：閾値を上げて「似てても残す」
    hazards = hazards.filter((x) => !isTooSimilar(x, humanHazLines, 0.48));
    measures = measures.filter((x) => !isTooSimilar(x, humanMeaLines, 0.46));

    hazards = dedupeKeepOrder(hazards);
    measures = dedupeKeepOrder(measures);

    // ✅ 前回の“増える保険”はそのまま（項目数はこだわらないが、薄い時の底上げとして残す）
    if (hazards.length < 12) {
      const extra = [
        ensureCausal("乾燥で粉じんが舞いやすい"),
        ensureCausal("日差しで眩しく足元確認が遅れやすい"),
        ensureCausal("日射で熱中症が起きやすい"),
        ensureCausal("風で飛散物が発生しやすい"),
        ensureCausal("資機材の仮置きが不安定になりやすい"),
        ensureCausal("通路側の区画が不十分だと第三者が侵入しやすい"),
      ].filter(Boolean);
      hazards = dedupeKeepOrder([...hazards, ...extra]).slice(0, 16);
    }
    if (measures.length < 12) {
      const extra = [
        "散水・集じん・防じんマスクで粉じん対策を実施する（乾燥時は必須）",
        "日差しで視認性が落ちるため、合図者配置・指差呼称・反射材で見落としを防止する",
        "WBGT/休憩/水分塩分補給で熱中症対策を実施し、異常時は即中止する基準を周知する",
        "風で飛散する資材は固定し、養生のめくれ・飛散が出たら作業を停止して復旧する",
        "資機材は転倒防止の位置決めと仮置き禁止帯を設定する",
        "第三者動線は区画し、立入禁止表示と誘導員で接近時は作業一時停止する",
      ];
      measures = dedupeKeepOrder([...measures, ...extra]).slice(0, 18);
    }

    const third =
      thirdLevel === "多い"
        ? [
            "第三者の動線を完全分離し、立入禁止柵・ロープ・看板で区画する",
            "誘導員を配置し、第三者が近づいたら作業を一時停止する基準を周知する",
            "声掛けを徹底し、第三者の通過導線を安全側へ誘導する",
          ]
        : thirdLevel === "少ない"
        ? [
            "第三者が来る可能性を前提に、出入口・通路側を区画し看板を掲示する",
            "第三者を確認したら作業を一時停止し、安全側へ誘導してから再開する",
          ]
        : [];

    return NextResponse.json({
      ai_hazards: joinLines(hazards),
      ai_countermeasures: joinLines(measures),
      ai_third_party: joinLines(third),

      ai_hazards_items: hazards,
      ai_countermeasures_items: measures,
      ai_third_party_items: third,

      model_used: model,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
