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
 *  Utils
 * ========================= */

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

/** 危険予知の因果形式の軽い補正（最後の砦） */
function ensureCausal(line: string): string {
  const t = stripBulletLead(normalizeText(line));
  if (!t) return "";
  if (/(だから|ため|恐れ|起こる|発生|転倒|転落|接触|巻き込まれ)/.test(t)) return t;

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
 *  Robust JSON handling
 * ========================= */

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
        const t2 = s(c?.output_text).trim();
        if (t2) return t2;
        if (c?.parsed != null) {
          try {
            return JSON.stringify(c.parsed);
          } catch {}
        }
      }
    }
  }

  if (resp?.text?.value) return s(resp.text.value);

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
          (typeof x.message === "string" ? x.message : "") ||
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

function mergeHumanLines(arr: string[], human: string): string[] {
  const lines = normalizeText(human)
    .split("\n")
    .map((x) => stripBulletLead(x))
    .map((x) => normalizeText(x))
    .filter(Boolean);

  const merged = [...arr, ...lines];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of merged) {
    const k = x.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function joinLines(items: string[]): string {
  return items.map((x) => normalizeText(x)).filter(Boolean).join("\n");
}

/** =========================
 *  OpenAI call (Responses API)
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

    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });
    }

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim();

    const humanHazards = normalizeText(s(body?.hazards));
    const humanMeasures = normalizeText(s(body?.countermeasures));
    const thirdLevel = normalizeText(s(body?.third_party_level));

    // コンテキスト（重いので、リトライ時には軽量版へ切替）
    const fullContext = {
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

    const lightContext = {
      work_detail: workDetail,
      hazards: humanHazards || null,
      countermeasures: humanMeasures || null,
      third_party_level: thirdLevel || null,
      worker_count: body?.worker_count ?? null,
      // ※ weather/写真/位置は落とす（速度優先）
    };

    const systemText = [
      "あなたは日本の建設現場（法面・重機・第三者/墓参者あり）の安全管理に強い所長補佐。",
      "出力は必ずJSONのみ。前置き/解説/挨拶/文章は一切禁止。JSON以外を出したら失格。",
      "",
      "必須ルール：",
      "1) hazards（危険予知）は必ず『〇〇だから、〇〇が起こる』の因果形式。1項目=1行。",
      "2) measures（対策）は具体（配置/合図/停止基準/立入規制/点検/保護具/周知）まで書く。抽象語のみは禁止。",
      "3) third_party（第三者対策）は動線分離、立入規制、声掛け、誘導員、掲示、作業一時停止基準を含める。",
      "4) 人の入力があれば、それをベースに補強・拡張しつつ、重複は避ける。",
      "5) 項目数は必要なだけ（上限なし）。短文化しない。現場でそのまま読める密度。",
      "",
      "現場特性：墓地で第三者が急に現れる。法面は足元不良と転落・崩壊リスク。重機は死角が多い。厳しめに。",
    ].join("\n");

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

    const buildPayload = (ctx: any, maxTokens: number) => ({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: ["次の入力JSONをもとに hazards / measures / third_party を作成せよ。", "入力JSON:", JSON.stringify(ctx, null, 2)].join(
                "\n"
              ),
            },
          ],
        },
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
      max_output_tokens: maxTokens,
    });

    // ✅ 1st try：フル文脈・60秒・少し長め
    const timeout1 = Number(process.env.OPENAI_TIMEOUT_MS || "60000");
    const timeout2 = Number(process.env.OPENAI_TIMEOUT_MS_RETRY || "60000");

    let resp: any = null;

    try {
      resp = await callOpenAIResponses(buildPayload(fullContext, 1600), apiKey, timeout1);
    } catch (e: any) {
      // タイムアウト/中断系は軽量化してリトライ
      if (!isAbortError(e)) {
        return NextResponse.json({ error: e?.message ?? "OpenAI API error", detail: e?.detail ?? null }, { status: 500 });
      }

      try {
        resp = await callOpenAIResponses(buildPayload(lightContext, 900), apiKey, timeout2);
      } catch (e2: any) {
        // 2回ともダメなら “絶対に空にしない” ローカル補完で返す
        const fallbackThird =
          thirdLevel === "多い"
            ? [
                "第三者の動線を完全分離し、立入禁止柵・ロープ・看板で区画する",
                "誘導員を配置し、第三者が近づいたら作業を一時停止する基準を周知する",
                "声掛けを徹底し、第三者の通過導線を安全側へ誘導する",
              ]
            : thirdLevel === "少ない"
            ? [
                "第三者が来る可能性を前提に、出入口・通路側を区画し看板を掲示する",
                "第三者を確認したら重機を停止し、合図者が安全誘導してから再開する",
              ]
            : [];

        const hazardsFb = mergeHumanLines([], humanHazards).map((x) => ensureCausal(x)).filter(Boolean);
        const measuresFb = mergeHumanLines([], humanMeasures);

        // 作業内容だけは必須なので、最低限の危険予知を1つ追加
        if (!hazardsFb.length) hazardsFb.push(ensureCausal("足元・作業半径の変化"));

        return NextResponse.json(
          {
            ai_work_detail: "",
            ai_hazards: joinLines(hazardsFb),
            ai_countermeasures: joinLines(measuresFb.length ? measuresFb : ["立入規制・合図統一・重機停止基準を周知し、指差呼称で確認する"]),
            ai_third_party: joinLines(fallbackThird),
            ai_hazards_items: hazardsFb,
            ai_countermeasures_items: measuresFb,
            ai_third_party_items: fallbackThird,
            model_used: model,
            warning: "OpenAI timeout; returned local fallback",
          },
          { status: 200 }
        );
      }
    }

    // ✅ ここから通常のパース処理
    const anyText = extractAnyTextFromResponses(resp);
    const parsed = parseJsonLoosely(anyText);

    let out = parsed ? normalizeResultObject(parsed) : { hazards: [], measures: [], third_party: [] };

    // 人入力は必ず反映（空回避＋補強）
    out.hazards = mergeHumanLines(out.hazards, humanHazards);
    out.measures = mergeHumanLines(out.measures, humanMeasures);

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
          "第三者を確認したら重機を停止し、合図者が安全誘導してから再開する",
        ];
      }
    }

    out.hazards = out.hazards.map((x) => ensureCausal(x)).filter(Boolean);

    const ai_hazards = joinLines(out.hazards);
    const ai_countermeasures = joinLines(out.measures);
    const ai_third_party = joinLines(out.third_party);

    return NextResponse.json({
      ai_work_detail: "",
      ai_hazards,
      ai_countermeasures,
      ai_third_party,
      ai_hazards_items: out.hazards,
      ai_countermeasures_items: out.measures,
      ai_third_party_items: out.third_party,
      model_used: model,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
