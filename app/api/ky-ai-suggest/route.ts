// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  workContent?: string | null;
  thirdPartyLevel?: string | null;

  // weather (applied slot)
  temperature_c?: number | null;
  wind_speed_ms?: number | null;
  wind_direction?: string | null;
  precipitation_mm?: number | null;
  weather_text?: string | null;

  // photos (now/prev)
  representative_photo_url?: string | null;
  prev_representative_url?: string | null;
  path_photo_url?: string | null;
  prev_path_url?: string | null;

  // profile
  profile?: "strict" | "normal" | string | null;

  // optional human notes
  hazardsText?: string | null;
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

function normalizeNewlines(t: string) {
  return s(t).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// 「番号」や「-」などが混ざっても、最終表示は「・」に統一
function toBullets(text: string): string {
  const raw = normalizeNewlines(text || "");
  if (!raw) return "";
  const lines = raw
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((ln) => {
      // 先頭記号を剥がす（- * ・ 1. (1) [1] 等）
      const stripped = ln
        .replace(/^[-*・]\s*/, "")
        .replace(/^\(?\d+\)?[.)\]]\s*/, "")
        .replace(/^\[\d+\]\s*/, "")
        .replace(/^\（?\(?\d+\)?\）?\s*/, "")
        .trim();
      return stripped ? `・${stripped}` : "";
    })
    .filter(Boolean);

  // すでに「・」が入っている文章塊でも、行頭を統一したい
  return lines.join("\n").trim();
}

function pickInput(body: Body) {
  return {
    workContent: s(body?.workContent).trim(),
    thirdPartyLevel: s(body?.thirdPartyLevel).trim(),
    temperature_c: body?.temperature_c ?? null,
    wind_speed_ms: body?.wind_speed_ms ?? null,
    wind_direction: s(body?.wind_direction).trim(),
    precipitation_mm: body?.precipitation_mm ?? null,
    weather_text: s(body?.weather_text).trim(),
    representative_photo_url: s(body?.representative_photo_url).trim(),
    prev_representative_url: s(body?.prev_representative_url).trim(),
    path_photo_url: s(body?.path_photo_url).trim(),
    prev_path_url: s(body?.prev_path_url).trim(),
    profile: s(body?.profile).trim(),
    hazardsText: s(body?.hazardsText).trim(),
  };
}

function fallbackItems(workContent: string): RiskItem[] {
  const base = [
    { hazard: `「${workContent}」の作業が急ぎになり、確認不足で事故が起こる恐れ`, countermeasure: "作業前KY→指差呼称→停止基準を共有し、焦り作業を止める" },
    { hazard: `「${workContent}」で人と重機が近接し、接触・巻込まれが起こる恐れ`, countermeasure: "立入区画・誘導員・合図統一（バック時は必ず誘導）" },
    { hazard: `「${workContent}」で足元不良・段差により転倒・墜落が起こる恐れ`, countermeasure: "足場/通路整備、段差マーキング、滑り止め、危険箇所は進入禁止" },
    { hazard: `「${workContent}」で飛来落下・飛散が起こる恐れ`, countermeasure: "養生・落下防止・保護具（ヘルメット/ゴーグル等）を徹底" },
    { hazard: `「${workContent}」の作業が並行し、干渉で事故が起こる恐れ`, countermeasure: "工程・担当・立入範囲を分け、監視者を置いて干渉を防ぐ" },
  ];
  return base.map((x, i) => ({ rank: i + 1, hazard: x.hazard, countermeasure: x.countermeasure }));
}

function buildUserInstruction(input: ReturnType<typeof pickInput>) {
  const strict = (input.profile || "").toLowerCase().includes("strict");
  const tone = strict ? "厳しめ（安全側）" : "標準";

  const lines: string[] = [];
  lines.push("あなたは土木工事の安全管理AIです。出力は必ず日本語。");
  lines.push("次の入力から、KY用の危険予知と対策を『因果』で具体化して生成してください。");
  lines.push("重要ルール：");
  lines.push("1) 危険予知は必ず『〇〇だから→〇〇が起こる恐れ』の因果形式にする。");
  lines.push("2) 対策は必ず『実行可能な手順』にする（抽象語だけ禁止）。");
  lines.push("3) 箇条書きは必ず「・」のみ（番号・(1)・[1]・ハイフン禁止）。");
  lines.push("4) リスクは安全側（厳しめ）に寄せる。");
  lines.push("");
  lines.push(`【トーン】${tone}`);
  lines.push("");
  lines.push("【入力】");
  lines.push(`作業内容: ${input.workContent}`);
  if (input.thirdPartyLevel) lines.push(`第三者(墓参者): ${input.thirdPartyLevel}`);
  if (input.weather_text || input.temperature_c != null || input.wind_speed_ms != null || input.precipitation_mm != null) {
    lines.push(
      `気象(適用枠): ${input.weather_text || "—"} / 気温:${input.temperature_c ?? "—"}℃ / 風:${input.wind_direction || "—"} ${input.wind_speed_ms ?? "—"}m/s / 降水:${input.precipitation_mm ?? "—"}mm`
    );
  }
  if (input.hazardsText) lines.push(`手入力(参考): ${input.hazardsText}`);
  lines.push("");
  lines.push("【画像】");
  lines.push("代表(今回/前回) と 通路(今回/前回) を参照し、危険箇所（開口部・法肩・養生不足・重機近接・保安未設置など）を可能な範囲で反映する。");
  lines.push("");
  lines.push("【出力要件】");
  lines.push("json_schemaで返すこと。ai_risk_items は 6〜12件（固定数にしない）。");
  lines.push("ai_work_detail / ai_hazards / ai_countermeasures / ai_third_party も返すこと。");
  return lines.join("\n");
}

function buildSchema(): any {
  return {
    name: "ky_suggest",
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

async function callOpenAIResponsesJson(args: {
  apiKey: string;
  model: string;
  instruction: string;
  images: string[];
}): Promise<OpenAIJson> {
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
          response_format: {
            type: "json_schema",
            json_schema: buildSchema(),
          },
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

// ✅ 405対策：GETで当たっても200で返す（PWA/SW/参照対策）
export async function GET() {
  return NextResponse.json({ ok: true, note: "ky-ai-suggest alive (use POST for generation)" });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const input = pickInput(body);

    if (!input.workContent.trim()) {
      return NextResponse.json({ error: "Missing workContent" }, { status: 400 });
    }

    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    // ✅ ここが重要：RISK専用 → 通常 → デフォルト
    const model = (
      process.env.OPENAI_MODEL_RISKS ||
      process.env.OPENAI_MODEL ||
      "gpt-4o-mini"
    ).trim();

    const instruction = buildUserInstruction(input);

    const images: string[] = [];
    const addIfUrl = (u: string) => {
      const t = s(u).trim();
      if (!t) return;
      if (!/^https?:\/\//i.test(t)) return;
      images.push(t);
    };
    addIfUrl(input.representative_photo_url);
    addIfUrl(input.prev_representative_url);
    addIfUrl(input.path_photo_url);
    addIfUrl(input.prev_path_url);

    let obj: OpenAIJson | null = null;

    try {
      obj = await callOpenAIResponsesJson({ apiKey, model, instruction, images });
    } catch (e: any) {
      const items = fallbackItems(input.workContent.trim());
      const ai_work_detail = toBullets(input.workContent);
      const ai_hazards = items.map((x) => `・${x.hazard}`).join("\n");
      const ai_countermeasures = items.map((x) => `・${x.countermeasure}`).join("\n");
      const ai_third_party = input.thirdPartyLevel ? `・墓参者 ${input.thirdPartyLevel}：立入規制と誘導を強化` : "";
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

    // 6〜12件に丸める（固定しない）
    let items = cleaned.slice(0, 12);
    if (items.length < 6) {
      const fb = fallbackItems(input.workContent.trim());
      for (const it of fb) {
        if (items.length >= 6) break;
        items.push({ ...it, rank: items.length + 1 });
      }
    }
    items = items.map((it, i) => ({ ...it, rank: i + 1 }));

    const ai_work_detail = toBullets((obj as any)?.ai_work_detail || input.workContent);
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
    const msg = s(e?.message ?? e);
    return NextResponse.json({ error: "server_error", detail: msg.slice(0, 1500) }, { status: 500 });
  }
}
