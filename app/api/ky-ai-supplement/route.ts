// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** =========================
 *  Types
 * ========================= */

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

  hazards?: string | null;
  countermeasures?: string | null;
  third_party_level?: string | null; // "多い" | "少ない" | null

  worker_count?: number | null;

  lat?: number | null;
  lon?: number | null;

  weather_slots?: WeatherSlot[] | null;

  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;
};

/** =========================
 *  Small utils
 * ========================= */

function s(v: any) {
  return v == null ? "" : String(v);
}

function normalizeText(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").replace(/\u3000/g, " ").trim();
}

function safeUrl(u: any): string | null {
  const t = s(u).trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

function stripBulletLead(x: string): string {
  return x.replace(/^[•・\-*]\s*/, "").trim();
}

/** 危険予知の因果形式の軽い補正（最後の砦）
 *  例: "足元不良" → "足元が不安定だから、つまずき・転倒が起こる"
 */
function ensureCausal(line: string): string {
  const t = stripBulletLead(normalizeText(line));
  if (!t) return "";
  // すでに「だから」「ため」「恐れ」「起こる」等があればそのまま採用
  if (/(だから|ため|恐れ|起こる|発生|転倒|転落|接触|巻き込まれ)/.test(t)) return t;

  // 雑な補完（現場KY向けに厳しめ）
  const base = t;
  const risk =
    /(足元|段差|滑り|ぬかるみ)/.test(base)
      ? "つまずき・転倒"
      : /(法面|斜面|崩壊|土砂)/.test(base)
      ? "崩壊・転落"
      : /(重機|バックホウ|ユンボ|車両|接触|死角)/.test(base)
      ? "接触・巻き込まれ"
      : "事故";
  return `${base}だから、${risk}が起こる`;
}

/** =========================
 *  Robust JSON extraction
 * ========================= */

/** どのモデル返却でも最終的に “何らかのテキスト” を取り出す */
function extractAnyTextFromResponses(resp: any): string {
  // 1) output_text が直である場合
  const direct = s(resp?.output_text).trim();
  if (direct) return direct;

  // 2) output[].content[] を探索
  const out = resp?.output;
  if (Array.isArray(out)) {
    for (const block of out) {
      const content = block?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        // typical: { type: "output_text", text: "..." }
        const t1 = s(c?.text).trim();
        if (t1) return t1;
        const t2 = s(c?.output_text).trim();
        if (t2) return t2;
        // Structured outputs の場合、parsed っぽいものが入ることがある
        if (c?.parsed != null) {
          try {
            return JSON.stringify(c.parsed);
          } catch {}
        }
      }
    }
  }

  // 3) response_formatが効いていて、トップにそれっぽいのがある場合
  if (resp?.text?.value) return s(resp.text.value);

  // 4) 最終fallback
  try {
    return JSON.stringify(resp);
  } catch {
    return s(resp);
  }
}

/** 文字列から JSON “っぽい部分” を取り出して parse する（失敗しても null） */
function parseJsonLoosely(text: string): any | null {
  const src = s(text);

  // まず素直にJSON.parse
  try {
    return JSON.parse(src);
  } catch {}

  // コードブロック ```json ... ``` を除去
  const deFenced = src
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim();

  // { ... } の最大範囲を抜く（前後の余計な文字を除去）
  const start = deFenced.indexOf("{");
  const end = deFenced.lastIndexOf("}");
  if (start >= 0 && end >= 0 && end > start) {
    const sliced = deFenced.slice(start, end + 1);
    try {
      return JSON.parse(sliced);
    } catch {}
  }

  // それでも無理なら null
  return null;
}

/** 配列が string / object / mixed でも “string[]” に正規化 */
function normalizeArrayToStrings(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        // よくある揺れを吸収
        const t =
          (typeof x.text === "string" ? x.text : "") ||
          (typeof x.content === "string" ? x.content : "") ||
          (typeof x.value === "string" ? x.value : "") ||
          (typeof x.message === "string" ? x.message : "") ||
          "";
        if (t) return t;
        // objectでも何か残す
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

/** 返りJSONの key 揺れを吸収して {hazards, measures, third_party} を確実に作る */
function normalizeResultObject(obj: any): { hazards: string[]; measures: string[]; third_party: string[] } {
  const hazards =
    normalizeArrayToStrings(obj?.hazards) ||
    normalizeArrayToStrings(obj?.ai_hazards_items) ||
    normalizeArrayToStrings(obj?.risk_hazards) ||
    [];

  const measures =
    normalizeArrayToStrings(obj?.measures) ||
    normalizeArrayToStrings(obj?.countermeasures) ||
    normalizeArrayToStrings(obj?.ai_countermeasures_items) ||
    normalizeArrayToStrings(obj?.actions) ||
    [];

  const third_party =
    normalizeArrayToStrings(obj?.third_party) ||
    normalizeArrayToStrings(obj?.third) ||
    normalizeArrayToStrings(obj?.ai_third_party_items) ||
    normalizeArrayToStrings(obj?.thirdParty) ||
    [];

  return { hazards, measures, third_party };
}

/** 文字列の複数行も配列化して混ぜられる */
function mergeHumanLines(arr: string[], human: string, limit = 0): string[] {
  const lines = normalizeText(human)
    .split("\n")
    .map((x) => stripBulletLead(x))
    .map((x) => normalizeText(x))
    .filter(Boolean);

  const merged = [...arr, ...lines];

  // 重複除去（順序維持）
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of merged) {
    const k = x.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }

  if (limit > 0) return out.slice(0, limit);
  return out;
}

function joinLines(items: string[]): string {
  return items.map((x) => normalizeText(x)).filter(Boolean).join("\n");
}

/** =========================
 *  OpenAI call (Responses API)
 * ========================= */

async function callOpenAIResponses(payload: any, apiKey: string, timeoutMs = 25000): Promise<any> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
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

/** =========================
 *  Route
 * ========================= */

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const workDetail = normalizeText(s(body?.work_detail));
    if (!workDetail) {
      return NextResponse.json({ error: "work_detail is required" }, { status: 400 });
    }

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim();
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });
    }

    const humanHazards = normalizeText(s(body?.hazards));
    const humanMeasures = normalizeText(s(body?.countermeasures));
    const thirdLevel = normalizeText(s(body?.third_party_level));

    // 入力コンテキスト（濃くするほど品質が上がる）
    const context = {
      work_detail: workDetail,
      hazards: humanHazards || null,
      countermeasures: humanMeasures || null,
      third_party_level: thirdLevel || null,
      worker_count: body?.worker_count ?? null,
      weather_slots: body?.weather_slots ?? null,
      location: { lat: body?.lat ?? null, lon: body?.lon ?? null },
      photos: {
        slope_now: safeUrl(body?.slope_photo_url),
        slope_prev: safeUrl(body?.slope_prev_photo_url),
        path_now: safeUrl(body?.path_photo_url),
        path_prev: safeUrl(body?.path_prev_photo_url),
      },
    };

    // ✅ system：厳しめ＋形式固定＋JSON以外禁止
    const systemText = [
      "あなたは日本の建設現場（法面・重機・第三者/墓参者あり）の安全管理に強い所長補佐。",
      "出力は必ずJSONのみ。前置き/解説/挨拶/文章は一切禁止。JSON以外を出したら失格。",
      "",
      "必須ルール：",
      "1) hazards（危険予知）は必ず『〇〇だから、〇〇が起こる』の因果形式。1項目=1行。",
      "2) measures（対策）は具体（配置/合図/停止基準/立入規制/点検/保護具/周知）まで書く。抽象語のみは禁止。",
      "3) third_party（第三者対策）は動線分離、立入規制、声掛け、誘導員、掲示、作業一時停止基準を含める。",
      "4) 人の入力があれば、それをベースに補強・拡張しつつ、同じ内容の重複は避ける。",
      "5) 項目数は必要なだけ（上限なし）。短文化しない。現場でそのまま読める密度。",
      "",
      "現場特性：墓地で第三者が急に現れる。法面は足元不良と転落・崩壊リスク。重機は死角が多い。厳しめに。",
    ].join("\n");

    const userText = [
      "次の入力JSONをもとに、hazards / measures / third_party を作成せよ。",
      "入力JSON:",
      JSON.stringify(context, null, 2),
    ].join("\n");

    // ✅ Structured Outputs（効くときは最高に安定）
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        hazards: { type: "array", items: { type: "string" } },
        measures: { type: "array", items: { type: "string" } },
        third_party: { type: "array", items: { type: "string" } },
      },
      required: ["hazards", "measures", "third_party"],
    } as const;

    const payload = {
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        { role: "user", content: [{ type: "input_text", text: userText }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ky_ai_supplement",
          strict: true,
          schema,
        },
      },
      temperature: 0.2,
      max_output_tokens: 2200,
    };

    // 1) OpenAI呼び出し
    let resp: any;
    try {
      resp = await callOpenAIResponses(payload, apiKey, 25000);
    } catch (e: any) {
      // APIエラーはここで返す（画面に原因を見せる）
      return NextResponse.json(
        { error: e?.message ?? "OpenAI API error", detail: e?.detail ?? null },
        { status: 500 }
      );
    }

    // 2) 返却から “何かしら” を抽出
    const anyText = extractAnyTextFromResponses(resp);

    // 3) JSONとしてパース（壊れてたら loose で救う）
    const parsed = parseJsonLoosely(anyText);

    // 4) parsedが取れたら key揺れ吸収して正規化
    let out = parsed ? normalizeResultObject(parsed) : { hazards: [], measures: [], third_party: [] };

    // 5) もし全部空なら “人入力” を最低限反映（空で返さない）
    out.hazards = mergeHumanLines(out.hazards, humanHazards);
    out.measures = mergeHumanLines(out.measures, humanMeasures);

    // third_partyは「多い/少ない」しか無いこともあるので、空なら軽い補完
    if (!out.third_party.length) {
      if (thirdLevel === "多い") {
        out.third_party = [
          "第三者の動線を完全分離し、立入禁止柵・ロープ・看板で区画する",
          "誘導員を配置し、第三者が近づいたら作業を一時停止する基準を周知する",
          "声掛けを徹底し、第三者の通過導線を安全側へ誘導する",
        ];
      } else if (thirdLevel === "少ない") {
        out.third_party = [
          "第三者が来る可能性を前提に、出入口・通路側を区画し看板を掲示する",
          "第三者が見えた時は重機を停止し、合図者が安全誘導してから再開する",
        ];
      } else {
        out.third_party = [];
      }
    }

    // 6) hazards は因果形式を最後に強制（崩れた行を補正）
    out.hazards = out.hazards.map((x) => ensureCausal(x)).filter(Boolean);

    // 7) 最終的に “文字列” を返す（KyNewClient互換）
    const ai_hazards = joinLines(out.hazards);
    const ai_countermeasures = joinLines(out.measures);
    const ai_third_party = joinLines(out.third_party);

    return NextResponse.json({
      ai_work_detail: "",

      ai_hazards,
      ai_countermeasures,
      ai_third_party,

      // 配列も返す（将来レビューで箇条書きに使える）
      ai_hazards_items: out.hazards,
      ai_countermeasures_items: out.measures,
      ai_third_party_items: out.third_party,

      model_used: model,
      // デバッグ（困った時だけ見たいなら残す）
      // raw_text: anyText,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
