// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = Record<string, unknown>;

type RiskItem = {
  rank: number;
  hazard: string;
  countermeasure: string;
  score?: number;
  tags?: string[];
};

function s(v: unknown) {
  if (v == null) return "";
  return String(v);
}

function nf(v: unknown): number | null {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(x) ? x : null;
}

// ✅ string固定だとビルドで落ちるので unknown 受けにする（中で s() するため安全）
function normalizeNewlines(text: unknown): string {
  return s(text).replace(/\r\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();
}

function firstNonEmpty(body: Body, keys: string[]) {
  for (const k of keys) {
    const t = s((body as any)?.[k]).trim();
    if (t) return t;
  }
  return "";
}

function pickInput(body: Body) {
  const workContent = firstNonEmpty(body, ["workContent", "work_content", "work_detail", "workDetail", "work", "title", "content"]);
  const hazardsText = firstNonEmpty(body, ["hazardsText", "hazards_text", "hazards"]);
  const thirdPartyLevel = firstNonEmpty(body, ["thirdPartyLevel", "third_party_level", "thirdParty", "third_party"]);
  const profile = (firstNonEmpty(body, ["profile"]) || "strict").trim();

  const weather_text = firstNonEmpty(body, ["weather_text", "weatherText", "weather"]);
  const wbgt = nf((body as any)?.wbgt ?? (body as any)?.wbgt_c ?? (body as any)?.WBGT);
  const temperature_c = nf((body as any)?.temperature_c ?? (body as any)?.temp_c ?? (body as any)?.temperature);
  const wind_speed_ms = nf((body as any)?.wind_speed_ms ?? (body as any)?.windSpeed ?? (body as any)?.wind);
  const precipitation_mm = nf((body as any)?.precipitation_mm ?? (body as any)?.rain_mm ?? (body as any)?.precipitation);
  const wind_direction = firstNonEmpty(body, ["wind_direction", "windDirection", "wind_dir", "windDir"]);

  const representative_photo_url = firstNonEmpty(body, ["representative_photo_url", "photo_url", "image_url", "representativeUrl"]);
  const prev_representative_url = firstNonEmpty(body, ["prev_representative_url", "prev_photo_url", "prev_image_url", "prevRepresentativeUrl"]);
  const path_photo_url = firstNonEmpty(body, ["path_photo_url", "pathUrl"]);
  const prev_path_url = firstNonEmpty(body, ["prev_path_url", "prevPathUrl"]);

  return {
    workContent,
    hazardsText,
    thirdPartyLevel,
    profile,
    weather_text,
    wbgt,
    temperature_c,
    wind_speed_ms,
    precipitation_mm,
    wind_direction,
    representative_photo_url,
    prev_representative_url,
    path_photo_url,
    prev_path_url,
  };
}

function buildUserInstruction(input: ReturnType<typeof pickInput>) {
  return [
    "あなたは建設現場の安全管理（KY）の専門家です。",
    "作業内容に対して、危険予知と対策を『現場で使える具体性』で作ってください。",
    "",
    "【重要禁止事項】",
    "・『写真がないから危険』『気象が不明だから危険』など“不足指摘”を危険予知の主題にしない。",
    "・一般論だけで終わらせない（誘導・区画・合図・PPE・手順・確認など具体化）。",
    "",
    "【熱中症ルール】",
    "WBGT < 21 → 熱中症を一切出さない。",
    "WBGT >= 25 → 熱中症を必ず含める。",
    "WBGT不明時：気温30℃以上なら含める。25℃未満なら出さない。25〜29℃は推測と明記。",
    "",
    "【気象反映ルール（危険・対策に必ず反映）】",
    "・降水量がある → すべり/視認性低下/感電/資材転倒/路肩崩れ等を優先。",
    "・風速が強い → 飛散/転倒/吊荷/コーン倒れ/第三者突入リスクを優先。",
    "・低温/高温 → 体調・防寒/防暑・凍結/熱による材料影響も加味。",
    "",
    "【画像反映ルール】",
    "画像がある場合、以下の“観察可能な危険”を1〜3件は必ず含める：",
    "・区画不良/立入防止不足/開口/法肩/段差/足元不良/資材仮置き不良/重機近接/保安不足 等",
    "",
    "【入力】",
    `作業内容: ${input.workContent}`,
    `第三者状況: ${input.thirdPartyLevel || "（未選択）"}`,
    `気象: ${input.weather_text || "（なし）"}`,
    `気温: ${input.temperature_c == null ? "（不明）" : input.temperature_c}`,
    `風速(m/s): ${input.wind_speed_ms == null ? "（不明）" : input.wind_speed_ms}`,
    `風向: ${input.wind_direction || "（不明）"}`,
    `降水(mm): ${input.precipitation_mm == null ? "（不明）" : input.precipitation_mm}`,
    `WBGT: ${input.wbgt == null ? "（不明）" : input.wbgt}`,
    `手入力危険予知(参考): ${input.hazardsText || "（なし）"}`,
    "",
    "【出力仕様】",
    "・必ずJSONのみで返す（コードブロック禁止）。",
    "・ai_risk_items は 8件（rank 1..8）。不足したら自分で補って8件にする。",
    "・hazard は必ず『〇〇だから、〇〇が起こる』形式で1行。",
    "・countermeasure は hazard と1対1対応で具体策のみ（1行）。",
    "・ai_hazards は『・』箇条書き（8行）。",
    "・ai_countermeasures は『・（1）』形式（8行）。",
    "・ai_text は画面表示用に、次の体裁で作る：",
    "  危険予知：\\n・...\\n・...\\n\\n対策：\\n・（1）...\\n・（2）...",
  ].join("\n");
}

type OpenAIJson = {
  ai_risk_items: RiskItem[];
  ai_hazards: string;
  ai_countermeasures: string;
  ai_third_party?: string;
  ai_text?: string;
};

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
          minItems: 8,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              rank: { type: "integer", minimum: 1, maximum: 8 },
              hazard: { type: "string", minLength: 3 },
              countermeasure: { type: "string", minLength: 3 },
              score: { type: "number" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["rank", "hazard", "countermeasure"],
          },
        },
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
      const jsonPart = contentArr.find((c: any) => c?.type === "output_json") ?? contentArr.find((c: any) => c?.type === "output_text");

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

  const err = new Error(`openai_error: ${lastErr || "unknown"}`);
  (err as any).code = "OPENAI_ERROR";
  throw err;
}

function fallbackItems(workContent: string): RiskItem[] {
  const base = [
    { hazard: "作業半径が重なるから、接触・巻き込まれが起こる", countermeasure: "誘導員配置・立入禁止範囲を明確化し、合図を統一する" },
    { hazard: "資材を手持ち搬送するから、転倒・挟まれが起こる", countermeasure: "搬送経路を確保し、仮置きは安定化し、手元合図で共同作業する" },
    { hazard: "工具を使用するから、飛来・落下が起こる", countermeasure: "保護具着用・落下防止・使用前点検を行う" },
    { hazard: "路肩や段差があるから、転倒・転落が起こる", countermeasure: "足元整地・段差表示・滑り止め安全靴で無理な姿勢を避ける" },
    { hazard: "第三者が接近するから、接触事故が起こる", countermeasure: "区画・規制を設け、接近時は一時停止して誘導する" },
    { hazard: "姿勢が不安定になるから、腰部負担・災害が起こる", countermeasure: "作業姿勢を改善し、補助具使用・交代作業で負担を分散する" },
    { hazard: "確認不足があるから、手順逸脱・事故が起こる", countermeasure: "着手前に手順・危険箇所を指差呼称で確認し、KYを共有する" },
    { hazard: `「${workContent}」の作業が並行するから、作業干渉で事故が起こる`, countermeasure: "工程・担当・立入範囲を分け、監視者を置いて干渉を防ぐ" },
  ];
  return base.map((x, i) => ({ rank: i + 1, hazard: x.hazard, countermeasure: x.countermeasure }));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const input = pickInput(body);

    if (!input.workContent.trim()) {
      return NextResponse.json({ error: "Missing workContent" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();

    const instruction = buildUserInstruction(input);

    const images: string[] = [];
    const addIfUrl = (u: string) => {
      const t = u.trim();
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
      const ai_hazards = items.map((x) => `・${x.hazard}`).join("\n");
      const ai_countermeasures = items.map((x) => `・（${x.rank}）${x.countermeasure}`).join("\n");
      const ai_text = `危険予知：\n${ai_hazards}\n\n対策：\n${ai_countermeasures}`;

      return NextResponse.json(
        {
          ai_risk_items: items,
          ai_hazards,
          ai_countermeasures,
          ai_third_party: "",
          ai_text,
          meta_model: `${model} (fallback)`,
          warn: "openai_error_fallback",
          detail: s(e?.message || e).slice(0, 600),
        },
        { status: 200 }
      );
    }

    const rawItems = Array.isArray(obj?.ai_risk_items) ? obj.ai_risk_items : [];
    const cleaned: RiskItem[] = rawItems
      .map((x: any, idx: number) => ({
        rank: Number(x?.rank) || idx + 1,
        hazard: s(x?.hazard).trim(),
        countermeasure: s(x?.countermeasure).trim(),
        score: typeof x?.score === "number" ? x.score : undefined,
        tags: Array.isArray(x?.tags) ? (x.tags as unknown[]).map((t: unknown) => s(t)) : undefined,
      }))
      .filter((it) => it.hazard && it.countermeasure);

    let items = cleaned.slice(0, 8);
    if (items.length < 8) {
      const fb = fallbackItems(input.workContent.trim());
      for (const it of fb) {
        if (items.length >= 8) break;
        items.push({ ...it, rank: items.length + 1 });
      }
    }
    items = items.slice(0, 8).map((it, i) => ({ ...it, rank: i + 1 }));

    const ai_hazards = normalizeNewlines((obj as any)?.ai_hazards || items.map((x) => `・${x.hazard}`).join("\n"));
    const ai_countermeasures = normalizeNewlines(
      (obj as any)?.ai_countermeasures || items.map((x) => `・（${x.rank}）${x.countermeasure}`).join("\n")
    );
    const ai_text =
      normalizeNewlines((obj as any)?.ai_text) ||
      `危険予知：\n${ai_hazards}\n\n対策：\n${ai_countermeasures}`;

    const ai_third_party = normalizeNewlines((obj as any)?.ai_third_party || "");

    return NextResponse.json({
      ai_risk_items: items,
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
