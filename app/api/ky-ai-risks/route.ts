// app/api/ky-ai-risks/route.ts
import { NextResponse } from "next/server";
import { calcRiskItems } from "@/app/lib/risk/calcRisk";
import type { HazardExtractItem, RiskContext } from "@/app/lib/risk/types";

export const runtime = "nodejs";

type Body = {
  work_detail?: string | null;
  photo_urls?: string[] | null;
  worker_count?: number | null;
  third_party_level?: string | null;
  weather_applied?: {
    hour: 9 | 12 | 15;
    weather_text?: string | null;
    temperature_c?: number | null;
    wind_direction_deg?: number | null;
    wind_speed_ms?: number | null;
    precipitation_mm?: number | null;
  } | null;
  photo_score?: number | null; // 0..1
  max_items?: number | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}
function safeArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => s(x).trim()).filter(Boolean);
}
function clampInt(v: any, min: number, max: number) {
  const x = Math.floor(Number(v));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function buildInstruction(body: Body) {
  const maxItems = clampInt(body.max_items ?? 8, 4, 12);
  const wt = body.weather_applied ?? null;

  return [
    "あなたは建設現場の安全管理（KY）専門家です。出力は厳しめ（安全側）。",
    "hazardは必ず『○○だから○○が起こる』の因果文。",
    "countermeasureは具体行動。",
    "P(1-5) S(1-5) category(事故分類)も付与。",
    "出力はJSONのみ。",
    "",
    "【入力】",
    `作業内容: ${s(body.work_detail).trim() || "（未入力）"}`,
    `作業員数: ${body.worker_count ?? "（不明）"}`,
    `第三者: ${s(body.third_party_level).trim() || "（不明）"}`,
    wt
      ? `気象(適用): ${wt.hour}時 ${s(wt.weather_text)} 気温${wt.temperature_c ?? "—"}℃ 風速${wt.wind_speed_ms ?? "—"}m/s 降水${wt.precipitation_mm ?? "—"}mm`
      : "気象(適用): （なし）",
    "",
    `件数は${maxItems}件前後（4〜12件）。重複禁止。一般論のみ禁止。`,
  ].join("\n");
}

async function callOpenAIJson(args: { apiKey: string; model: string; instruction: string; images: string[] }) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.model,
      input: [
        {
          role: "user",
          content: [
            { type: "text", text: args.instruction },
            ...args.images.map((u) => ({ type: "input_image", image_url: u })),
          ],
        },
      ],
      temperature: 0.2,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ky_ai_risks",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              items: {
                type: "array",
                minItems: 4,
                maxItems: 12,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    hazard: { type: "string", minLength: 3 },
                    countermeasure: { type: "string", minLength: 3 },
                    P: { type: "integer", minimum: 1, maximum: 5 },
                    S: { type: "integer", minimum: 1, maximum: 5 },
                    category: {
                      type: "string",
                      enum: [
                        "墜落・転落",
                        "飛来・落下",
                        "崩壊・土砂",
                        "接触・挟まれ",
                        "交通・第三者",
                        "転倒",
                        "熱中症",
                        "感電",
                        "有害物",
                        "火災・爆発",
                        "その他",
                      ],
                    },
                  },
                  required: ["hazard", "countermeasure", "P", "S", "category"],
                },
              },
            },
            required: ["items"],
          },
        },
      },
    }),
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`OpenAI error status=${r.status} body=${text.slice(0, 800)}`);

  const data = JSON.parse(text || "{}");
  const out = Array.isArray(data?.output) ? data.output : [];
  const msg = out.find((x: any) => x?.type === "message") ?? out[0];
  const contentArr = Array.isArray(msg?.content) ? msg.content : [];
  const jsonPart = contentArr.find((c: any) => c?.type === "output_json");
  const raw = jsonPart?.json;
  if (!raw) throw new Error("OpenAI output_json missing");
  return raw as { items: HazardExtractItem[] };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    // ✅ あなたの設定：OPENAI_MODEL_RISKS=gpt-5 を使う
    const model = (process.env.OPENAI_MODEL_RISKS || process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

    const work_detail = s(body.work_detail).trim();
    if (!work_detail) return NextResponse.json({ error: "work_detail required" }, { status: 400 });

    const images = safeArray(body.photo_urls).filter((u) => /^https?:\/\//i.test(u));
    const instruction = buildInstruction(body);

    const j = await callOpenAIJson({ apiKey, model, instruction, images });
    const extracted = Array.isArray(j?.items) ? j.items : [];

    const ctx: RiskContext = {
      third_party_level: body.third_party_level ?? null,
      worker_count: body.worker_count ?? null,
      weather_applied: body.weather_applied ?? null,
      photo_score: body.photo_score ?? null,
      work_detail,
    };

    const computed = calcRiskItems(extracted, ctx);
    return NextResponse.json({ ok: true, meta_model: model, items: computed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "ky-ai-risks error" }, { status: 500 });
  }
}
