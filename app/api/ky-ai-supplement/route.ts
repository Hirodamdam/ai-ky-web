// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";

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
  third_party_level?: string | null;
  worker_count?: number | null;

  weather_slots?: WeatherSlot[] | null;

  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;

  profile?: "strict" | "normal" | string | null;
};

type RiskItem = {
  rank: number;
  hazard: string;
  countermeasure: string;
  score?: number;
  tags?: string[];
};

type OpenAIJson = {
  ai_risk_items?: Array<{
    rank?: number;
    hazard?: string;
    countermeasure?: string;
    score?: number;
    tags?: string[];
  }>;
  ai_work_detail?: string;
  ai_hazards?: string;
  ai_countermeasures?: string;
  ai_third_party?: string;
  ai_text?: string;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function normalizeNewlines(t: string) {
  return s(t).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function toBullets(text: string): string {
  const raw = normalizeNewlines(text || "");
  if (!raw) return "";
  const lines = raw
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((ln) => {
      const stripped = ln
        .replace(/^[-*・]\s*/, "")
        .replace(/^\(?\d+\)?[.)\]]\s*/, "")
        .replace(/^\[\d+\]\s*/, "")
        .replace(/^\（?\(?\d+\)?\）?\s*/, "")
        .trim();
      return stripped ? `・${stripped}` : "";
    })
    .filter(Boolean);
  return lines.join("\n").trim();
}

function pickAppliedSlot(slots: WeatherSlot[] | null | undefined): WeatherSlot | null {
  const arr = Array.isArray(slots) ? slots : [];
  const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
  if (!filtered.length) return null;

  // 単純に「最悪（強風+雨）」寄りを採用
  const score = (x: WeatherSlot) => {
    const ws = n(x.wind_speed_ms) ?? 0;
    const pr = n(x.precipitation_mm) ?? 0;
    return ws * 10 + pr * 8;
  };
  filtered.sort((a, b) => score(b) - score(a) || a.hour - b.hour);
  return filtered[0];
}

function fallbackItems(work: string): RiskItem[] {
  const base = [
    { hazard: `「${work}」で足元不良があるから→転倒・滑落が起こる恐れ`, countermeasure: "通路整備・段差マーキング・滑り止め、危険部は立入禁止" },
    { hazard: `「${work}」で人と重機が近接するから→接触・巻込まれが起こる恐れ`, countermeasure: "区画分離・誘導員配置・合図統一、バックは必ず誘導" },
    { hazard: `「${work}」で飛散/落下物が出るから→飛来落下が起こる恐れ`, countermeasure: "養生固定・落下防止・保護具徹底（ヘルメット/ゴーグル等）" },
    { hazard: `「${work}」で作業が並行するから→作業干渉で事故が起こる恐れ`, countermeasure: "工程・担当・立入範囲を分離し、監視者で干渉防止" },
    { hazard: `「${work}」で確認不足になりやすいから→手順逸脱で事故が起こる恐れ`, countermeasure: "作業前KY・指差呼称・停止基準共有、迷ったら中止" },
  ];
  return base.map((x, i) => ({ rank: i + 1, hazard: x.hazard, countermeasure: x.countermeasure }));
}

function buildSchema(): any {
  return {
    name: "ky_supplement",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ai_risk_items: {
          type: "array",
          minItems: 6,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              rank: { type: "integer", minimum: 1, maximum: 12 },
              hazard: { type: "string", minLength: 3 },
              countermeasure: { type: "string", minLength: 3 },
              score: { type: "number" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["hazard", "countermeasure"],
          },
        },
        ai_work_detail: { type: "string" },
        ai_hazards: { type: "string" },
        ai_countermeasures: { type: "string" },
        ai_third_party: { type: "string" },
        ai_text: { type: "string" },
      },
      required: ["ai_risk_items", "ai_hazards", "ai_countermeasures", "ai_text"],
    },
  };
}

async function callOpenAIResponsesJson(args: { apiKey: string; model: string; instruction: string; images: string[] }): Promise<OpenAIJson> {
  const url = "https://api.openai.com/v1/responses";
  const attempts = 3;
  const timeoutMs = 25000;
  let lastErr = "";

  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const input: any[] = [
        {
          role: "user",
          content: [
            { type: "text", text: args.instruction },
            ...args.images.map((u) => ({ type: "input_image", image_url: u })),
          ],
        },
      ];

      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: ac.signal,
        body: JSON.stringify({
          model: args.model,
          input,
          temperature: 0.2,
          response_format: { type: "json_schema", json_schema: buildSchema() },
        }),
      });

      const text = await r.text().catch(() => "");
      if (!r.ok) {
        lastErr = `status=${r.status} body=${text.slice(0, 1200)}`;
        continue;
      }

      const data = JSON.parse(text || "{}");
      const out = Array.isArray(data?.output) ? data.output : [];
      const msg = out.find((x: any) => x?.type === "message") ?? out[0];
      const contentArr = Array.isArray(msg?.content) ? msg.content : [];
      const jsonPart =
        contentArr.find((c: any) => c?.type === "output_json") ??
        contentArr.find((c: any) => c?.type === "output_text");
      const raw = jsonPart?.json ?? jsonPart?.text ?? "";
      if (!raw) {
        lastErr = "empty output_json";
        continue;
      }
      const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      return obj as OpenAIJson;
    } catch (e: any) {
      lastErr = s(e?.message || e);
      continue;
    } finally {
      clearTimeout(t);
    }
  }

  throw new Error(lastErr || "openai_responses_failed");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const work = s(body?.work_detail).trim();
    if (!work) return NextResponse.json({ error: "work_detail required" }, { status: 400 });

    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    const model = (process.env.OPENAI_MODEL_RISKS || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

    const slot = pickAppliedSlot(body.weather_slots);
    const strict = (s(body.profile) || "strict").toLowerCase().includes("strict");

    const instruction = [
      "あなたは土木工事の安全管理AIです。出力は必ず日本語。",
      "次の入力から、KY用の危険予知と対策を『因果』で具体化して生成してください。",
      "重要ルール：",
      "1) 危険予知は必ず『〇〇だから→〇〇が起こる恐れ』の因果形式にする。",
      "2) 対策は必ず『実行可能な手順』にする（抽象語だけ禁止）。",
      "3) 箇条書きは必ず「・」のみ（番号・(1)・[1]・ハイフン禁止）。",
      `4) リスクは安全側（${strict ? "厳しめ" : "標準"}）に寄せる。`,
      "",
      "【入力】",
      `作業内容: ${work}`,
      body.third_party_level ? `第三者(墓参者): ${s(body.third_party_level).trim()}` : "",
      slot
        ? `気象(代表): ${slot.weather_text || "—"} / 気温:${slot.temperature_c ?? "—"}℃ / 風:${slot.wind_speed_ms ?? "—"}m/s / 降水:${slot.precipitation_mm ?? "—"}mm`
        : "",
      "",
      "【画像】",
      "代表(今回/前回) と 通路(今回/前回) を参照し、危険箇所を可能な範囲で反映する。",
      "",
      "【出力要件】json_schemaで返す。ai_risk_items は 6〜12件（固定数にしない）。",
    ]
      .filter(Boolean)
      .join("\n");

    const images: string[] = [];
    const add = (u: any) => {
      const t = s(u).trim();
      if (!t) return;
      if (!/^https?:\/\//i.test(t)) return;
      images.push(t);
    };
    add(body.slope_photo_url);
    add(body.slope_prev_photo_url);
    add(body.path_photo_url);
    add(body.path_prev_photo_url);

    let obj: OpenAIJson | null = null;

    try {
      obj = await callOpenAIResponsesJson({ apiKey, model, instruction, images });
    } catch (e: any) {
      const items = fallbackItems(work);
      const ai_work_detail = toBullets(work);
      const ai_hazards = items.map((x) => `・${x.hazard}`).join("\n");
      const ai_countermeasures = items.map((x) => `・${x.countermeasure}`).join("\n");
      const ai_third_party = body.third_party_level ? `・墓参者 ${s(body.third_party_level).trim()}：立入規制と誘導を強化` : "";
      const ai_text = [
        "作業内容：",
        ai_work_detail,
        "",
        "危険予知：",
        ai_hazards,
        "",
        "対策：",
        ai_countermeasures,
        "",
        "第三者：",
        ai_third_party,
      ].join("\n");

      return NextResponse.json(
        {
          ai_risk_items: items,
          ai_work_detail,
          ai_hazards,
          ai_countermeasures,
          ai_third_party,
          ai_text,
          meta_model: `${model} (fallback)`,
          warn: "openai_error_fallback",
          detail: s(e?.message || e).slice(0, 600),
        },
        { status: 200 }
      );
    }

    const rawItems = Array.isArray(obj?.ai_risk_items) ? obj!.ai_risk_items! : [];
    const cleaned: RiskItem[] = rawItems
      .map((x: any, idx: number) => ({
        rank: idx + 1,
        hazard: s(x?.hazard).trim(),
        countermeasure: s(x?.countermeasure).trim(),
        score: typeof x?.score === "number" ? x.score : undefined,
        tags: Array.isArray(x?.tags) ? (x.tags as unknown[]).map((t: unknown) => s(t)) : undefined,
      }))
      .filter((it) => it.hazard && it.countermeasure);

    let items = cleaned.slice(0, 12);
    if (items.length < 6) {
      const fb = fallbackItems(work);
      for (const it of fb) {
        if (items.length >= 6) break;
        items.push({ ...it, rank: items.length + 1 });
      }
    }
    items = items.map((it, i) => ({ ...it, rank: i + 1 }));

    const ai_work_detail = toBullets((obj as any)?.ai_work_detail || work);
    const ai_hazards = toBullets((obj as any)?.ai_hazards) || items.map((x) => `・${x.hazard}`).join("\n");
    const ai_countermeasures =
      toBullets((obj as any)?.ai_countermeasures) || items.map((x) => `・${x.countermeasure}`).join("\n");
    const ai_third_party = toBullets((obj as any)?.ai_third_party || "");

    const ai_text =
      normalizeNewlines((obj as any)?.ai_text) ||
      [
        "作業内容：",
        ai_work_detail,
        "",
        "危険予知：",
        ai_hazards,
        "",
        "対策：",
        ai_countermeasures,
        "",
        "第三者：",
        ai_third_party,
      ].join("\n");

    return NextResponse.json({
      ai_risk_items: items,
      ai_work_detail,
      ai_hazards,
      ai_countermeasures,
      ai_third_party,
      ai_text,
      meta_model: model,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "server_error", detail: s(e?.message ?? e).slice(0, 1500) }, { status: 500 });
  }
}
