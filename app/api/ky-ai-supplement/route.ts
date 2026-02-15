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

  // ✅ AIへ送らない（比較用：重複除外のみ）
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

/** 危険予知：因果形式を最後に保証（1行内で濃く書いてOK） */
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
 *  重複判定（人入力と近い行は落とす）
 *  ※落とし過ぎを避けるため threshold は中庸
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

/** 気象要約（表示用＋AI投入用） */
function weatherSummary(slots: WeatherSlot[] | null | undefined): string {
  const arr = Array.isArray(slots) ? slots : [];
  if (!arr.length) return "（気象データなし）";
  const lines = arr
    .filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15))
    .sort((a, b) => a.hour - b.hour)
    .map((x) => {
      const w = s(x.weather_text) || "不明";
      const t = x.temperature_c == null ? "—" : `${x.temperature_c}℃`;
      const ws = x.wind_speed_ms == null ? "—" : `${x.wind_speed_ms}m/s`;
      const p = x.precipitation_mm == null ? "—" : `${x.precipitation_mm}mm`;
      return `${x.hour}時: ${w} / 気温${t} / 風速${ws} / 降水${p}`;
    });
  return lines.join("\n");
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

    // AI投入：気象＋写真
    const slots = Array.isArray(body?.weather_slots) ? (body.weather_slots as WeatherSlot[]) : [];
    const weatherText = weatherSummary(slots);

    const slopeNow = safeUrl(body?.slope_photo_url);
    const slopePrev = safeUrl(body?.slope_prev_photo_url);
    const pathNow = safeUrl(body?.path_photo_url);
    const pathPrev = safeUrl(body?.path_prev_photo_url);

    // ✅ ここが本丸：作業内容由来を“主役”にする指示
    const systemText = [
      "あなたは日本の建設現場の安全管理（所長補佐）。",
      "出力は必ずJSONのみ。前置き/解説/挨拶は禁止。JSON以外を出力しない。",
      "",
      "入力は「作業内容」「気象要約」「写真（今回/前回）」のみ。",
      "",
      "最重要ルール：",
      "A) hazards/measures の主役は『作業内容（工程固有）』。ここを薄くしない。工程の手順・道具・人員動線・合図・停止基準まで踏み込む。",
      "B) 気象・写真は“追加補強”。作業内容由来を置き換えない。",
      "",
      "出力ルール：",
      "1) hazards は必ず『原因（工程/状況）だから、結果（何が起こる）』の因果形式。1行に「どの瞬間」「どこで」「何が」を入れて濃く書く（句読点/セミコロンOK）。",
      "2) measures は具体策のみ。『誰が（役割）』『どこで（位置）』『いつ（タイミング）』『停止基準（条件）』を可能な限り含める。抽象語（注意する等）禁止。",
      "3) 工程固有の観点を必ず含める：重機/車両の死角、合図統一、誘導員配置、資機材吊り/運搬、ホース/コード、足元、飛散/粉じん、保護具、点検。",
      "4) 気象観点：降雨0でも粉じん・風による飛散・日射/眩しさ・熱中症を検討し、必要なら追加する。",
      "5) 写真観点：今回/前回の差分から、養生・区画・足元・崩れ兆候・資機材散乱を読み取り、必要なら追加する。",
      "6) 項目数は固定しない。薄くならないことが最優先。",
    ].join("\n");

    const userText = [
      "【作業内容】",
      workDetail,
      "",
      "【気象要約】",
      weatherText,
      "",
      "【写真】",
      "以下の画像（今回/前回）を比較し、気象・写真由来の追加リスクがあれば hazards/measures に追加してください。",
      "※ 画像が無い場合は、写真由来は“想定”で補完してよい。",
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
      temperature: 0.3,
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

    // ✅ 人入力と同じ/近い内容は落とす（AIの追加価値を担保）
    hazards = hazards.filter((x) => !isTooSimilar(x, humanHazLines, 0.46));
    measures = measures.filter((x) => !isTooSimilar(x, humanMeaLines, 0.44));

    hazards = dedupeKeepOrder(hazards);
    measures = dedupeKeepOrder(measures);

    // ✅ “薄い返答”の最終保険（項目数ではなく「工程固有の濃さ」を最低限入れる）
    if (!hazards.length || !measures.length) {
      const fbHaz = [
        ensureCausal("作業手順の入替時に合図が曖昧になりやすい（重機・人の交錯）"),
        ensureCausal("ホース・コード・資機材が作業動線に入りやすい"),
        ensureCausal("足元条件が変化しやすく、踏み外しが起きやすい"),
      ].filter(Boolean);

      const fbMea = [
        "合図者を1名固定し、重機は合図者の合図以外では動かさない（見失い＝停止）",
        "ホース/コードは固定・跨ぎ禁止とし、通路と作業帯を分離して整理整頓を維持する",
        "足元を事前整備し、段差解消・滑り止めを行い、危険箇所はマーキングして周知する",
      ];

      hazards = hazards.length ? hazards : fbHaz;
      measures = measures.length ? measures : fbMea;
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
