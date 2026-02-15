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

  // ✅ 受け取っても「AIへは送らない」（比較用：以前の名残。今回は“削除なし”方針なので未使用でOK）
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
  return x.replace(/^\s*(?:[•・\-*]\s*)/, "").trim();
}

function safeUrl(u: any): string | null {
  const t = s(u).trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/** 先頭タグを外す（【作業】など） */
function peelTag(line: string): { tag: string; body: string } {
  const t = stripBulletLead(normalizeText(line));
  const m = t.match(/^(【(作業|気象|写真)】)\s*(.*)$/);
  if (!m) return { tag: "", body: t };
  return { tag: m[1], body: (m[3] || "").trim() };
}

/** 因果形式を保証（タグがあれば維持） */
function ensureCausal(line: string): string {
  const { tag, body } = peelTag(line);
  const t = stripBulletLead(normalizeText(body));
  if (!t) return "";

  // 既に因果っぽいならそのまま
  if (/(だから|ため|恐れ|起こる|発生|転倒|転落|接触|巻き込まれ|飛来|墜落|滑落|挟まれ)/.test(t)) {
    return tag ? `${tag} ${t}` : t;
  }

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

  const out = `${base}だから、${risk}`;
  return tag ? `${tag} ${out}` : out;
}

function joinLines(arr: string[]): string {
  return arr
    .map((x) => normalizeText(x))
    .map((x) => stripBulletLead(x))
    .filter((x) => x.length >= 1)
    .join("\n");
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
          (typeof (x as any).text === "string" ? (x as any).text : "") ||
          (typeof (x as any).content === "string" ? (x as any).content : "") ||
          (typeof (x as any).value === "string" ? (x as any).value : "") ||
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
    .filter((x) => x.length >= 1);
}

function weatherSummary(slots: WeatherSlot[] | null | undefined): {
  text: string;
  isFineDry: boolean;
  isWindy: boolean;
  isHot: boolean;
} {
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

    const thirdLevel = normalizeText(s(body?.third_party_level));

    // AIへ渡す気象とフラグ
    const wx = weatherSummary(Array.isArray(body?.weather_slots) ? (body.weather_slots as WeatherSlot[]) : []);
    const slopeNow = safeUrl(body?.slope_photo_url);
    const slopePrev = safeUrl(body?.slope_prev_photo_url);
    const pathNow = safeUrl(body?.path_photo_url);
    const pathPrev = safeUrl(body?.path_prev_photo_url);

    const systemText = [
      "あなたは日本の建設現場の安全管理（所長補佐）。",
      "出力は必ずJSONのみ。前置き/解説/挨拶は禁止。JSON以外を出力しない。",
      "",
      "入力は「作業内容」「気象要約」「写真（今回/前回）」「第三者（墓参者）の多寡」のみ。",
      "",
      "【超重要：本システム仕様】",
      "・この出力は『新規作成画面』と『レビューの再生成』で同じ形式・同じ行数で扱う。",
      "・要約/短縮/上位抽出は絶対に禁止。『重要なものだけ』にしない。",
      "・必ず“指定の最低行数”を満たす。足りない場合は作業内容/気象/写真から追加で捻出して埋める。",
      "",
      "【出力ルール】",
      "1) hazards は必ず『〇〇だから、〇〇が起こる』形式。1行=1項目。改行ではなく配列要素で区切る。",
      "2) measures は具体策（誰が/配置/手順/合図/停止基準/点検/保護具/立入規制）。『注意する』だけは禁止。1行=1項目。",
      "3) third は第三者（墓参者）向けの危険/対策混在でも良いが、現場運用の手順になるように書く。1行=1項目。",
      "4) hazards/measures の各行の先頭にタグを付ける：",
      "   - 作業内容由来 → 【作業】",
      "   - 気象由来（乾燥/粉じん/強風/雨/高温/眩しさ等）→ 【気象】",
      "   - 写真差分由来（ぬかるみ/段差/崩れ兆候/養生不足/資機材散乱/区画不足等）→ 【写真】",
      "5) third はタグ不要（付けても良いが必須ではない）。",
      "",
      "【最低行数（絶対）】",
      "・hazards: 12行以上（推奨 14〜18）",
      "・measures: 12行以上（推奨 14〜18、hazardsに概ね対応する順が望ましい）",
      "・third: 8行以上（多い場合は10〜14推奨）",
      "",
      "【作り方】",
      "・作業内容を工程分解（準備→運搬→施工→片付け）し、工程ごとの危険を具体化。",
      "・気象フラグ（乾燥/強風/高温）と写真差分（今回/前回）を必ず反映。",
      "・画像が無い場合でも想定で補完して最低行数を満たす。",
    ].join("\n");

    const userText = [
      "【作業内容】",
      workDetail,
      "",
      "【第三者（墓参者）の多寡】",
      thirdLevel ? thirdLevel : "（未指定）",
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
        third: { type: "array", items: { type: "string" } },
      },
      required: ["hazards", "measures", "third"],
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
      resp = await callOpenAIResponses(buildPayload(2800), apiKey, timeout1);
    } catch (e: any) {
      if (!isAbortError(e)) {
        return NextResponse.json({ error: e?.message ?? "OpenAI API error", detail: e?.detail ?? null }, { status: 500 });
      }
      resp = await callOpenAIResponses(buildPayload(2200), apiKey, timeout2);
    }

    const anyText = extractAnyTextFromResponses(resp);
    const parsed = parseJsonLoosely(anyText) ?? {};

    // ✅ “削らない/並べ替えない/重複除外しない” 方針
    const hazardsRaw = normalizeArrayToStrings(parsed?.hazards);
    const measuresRaw = normalizeArrayToStrings(parsed?.measures);
    const thirdRaw = normalizeArrayToStrings(parsed?.third);

    // hazards は因果形式だけ保証（内容は削らない）
    const hazards = hazardsRaw.map(ensureCausal).filter((x) => x.length >= 1);
    const measures = measuresRaw.map((x) => stripBulletLead(normalizeText(x))).filter((x) => x.length >= 1);
    const third = thirdRaw.map((x) => stripBulletLead(normalizeText(x))).filter((x) => x.length >= 1);

    return NextResponse.json({
      ai_hazards: joinLines(hazards),
      ai_countermeasures: joinLines(measures),
      ai_third_party: joinLines(third),

      // デバッグ/将来用（新規作成と完全一致させるため “そのまま” 返す）
      ai_hazards_items: hazards,
      ai_countermeasures_items: measures,
      ai_third_party_items: third,

      model_used: model,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
