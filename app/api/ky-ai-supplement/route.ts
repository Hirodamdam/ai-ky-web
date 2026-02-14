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

function s(v: any) {
  return v == null ? "" : String(v);
}

function normalizeText(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").replace(/\u3000/g, " ").trim();
}

function joinLines(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((x) => normalizeText(String(x ?? "")))
    .map((x) => x.replace(/^[•・\-*]\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

function safeUrl(u: any): string | null {
  const t = s(u).trim();
  if (!t) return null;
  // ざっくり危険なスキームは排除（http/httpsのみ）
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/**
 * Responses API の返却から "structured output(JSON文字列)" を取り出す
 * 返却形式が多少変わっても耐えるように、content配列を走査する
 */
function extractOutputText(resp: any): string {
  // 1) output_text がある場合
  const direct = s(resp?.output_text).trim();
  if (direct) return direct;

  // 2) output[].content[] を探索
  const out = resp?.output;
  if (Array.isArray(out)) {
    for (const block of out) {
      const content = block?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        // Responses APIでは type: "output_text" のことが多い
        const t1 = s(c?.text).trim();
        if (t1) return t1;
        const t2 = s(c?.output_text).trim();
        if (t2) return t2;
      }
    }
  }

  // 3) それでも無理なら丸ごと
  const fallback = s(resp).trim();
  return fallback;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const workDetail = normalizeText(s(body?.work_detail));
    if (!workDetail) {
      return NextResponse.json({ error: "work_detail is required" }, { status: 400 });
    }

    const humanHazards = normalizeText(s(body?.hazards));
    const humanMeasures = normalizeText(s(body?.countermeasures));
    const thirdLevel = normalizeText(s(body?.third_party_level)); // 多い/少ない/空

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim(); // ← スクショの OPENAI_MODEL
    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });
    }

    // 入力（できるだけ“素晴らしい返答”を再現するため、現場文脈を濃くする）
    const context = {
      work_detail: workDetail,
      hazards: humanHazards || null,
      countermeasures: humanMeasures || null,
      third_party_level: thirdLevel || null,
      worker_count: body?.worker_count ?? null,
      weather_slots: body?.weather_slots ?? null,
      location: {
        lat: body?.lat ?? null,
        lon: body?.lon ?? null,
      },
      photos: {
        slope_now: safeUrl(body?.slope_photo_url),
        slope_prev: safeUrl(body?.slope_prev_photo_url),
        path_now: safeUrl(body?.path_photo_url),
        path_prev: safeUrl(body?.path_prev_photo_url),
      },
    };

    // ✅ system：厳しめ・現場向け・余計な文章禁止・形式固定
    const systemText = [
      "あなたは日本の建設現場（法面・墓地・第三者あり）の所長補佐として、KYのAI補足を作る専門家。",
      "出力は必ずJSONスキーマに完全一致。前置き/解説/挨拶/補足文は禁止。JSON以外は一切出さない。",
      "",
      "品質要件：",
      "1) 危険予知は『〇〇だから、〇〇が起こる』の因果形式で1行=1項目。",
      "2) 対策は具体（配置/合図/停止基準/立入規制/点検/保護具/周知）まで書く。抽象語だけは禁止。",
      "3) 第三者は動線分離、立入規制、声掛け、誘導員、掲示、作業一時停止基準まで含める。",
      "4) 人の入力（危険予知/対策）がある場合は、それを補強・拡張する（重複は避ける）。",
      "5) 項目数は必要なだけ（上限なし）。ただし短文化せず、現場で使える密度にする。",
      "",
      "現場特性：法面、重機、足元不良、第三者（墓参者）動線が混在しやすい。厳しめに評価する。",
    ].join("\n");

    // ✅ user：人入力＋気象＋写真URLなどをそのまま渡す
    const userText = [
      "次の入力（JSON）をもとに、危険予知・対策・第三者対策を作成してください。",
      "入力JSON:",
      JSON.stringify(context, null, 2),
    ].join("\n");

    // ✅ Structured Outputs（json_schema）
    // Responses APIでは text.format に schema を入れる。 :contentReference[oaicite:2]{index=2}
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        hazards: {
          type: "array",
          items: { type: "string" },
          description: "危険予知。必ず『〇〇だから、〇〇が起こる』形式。1行=1項目。",
        },
        measures: {
          type: "array",
          items: { type: "string" },
          description: "対策。具体策（配置/合図/停止基準/点検/立入規制など）。1行=1項目。",
        },
        third_party: {
          type: "array",
          items: { type: "string" },
          description: "第三者対策。動線分離/誘導/掲示/停止基準など。1行=1項目。",
        },
      },
      required: ["hazards", "measures", "third_party"],
    } as const;

    const payload = {
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemText }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userText }],
        },
      ],
      // Structured Outputs
      text: {
        format: {
          type: "json_schema",
          name: "ky_ai_supplement",
          strict: true,
          schema,
        },
      },
      // 安定性重視（必要なら微調整）
      temperature: 0.2,
      max_output_tokens: 2000,
    };

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = s(j?.error?.message) || "OpenAI API error";
      return NextResponse.json(
        { error: msg, detail: j?.error ?? j },
        { status: 500 }
      );
    }

    const outText = extractOutputText(j);
    let parsed: any = null;

    try {
      parsed = JSON.parse(outText);
    } catch {
      // Structured outputsのはずだが、万一崩れた場合の保険
      return NextResponse.json(
        { error: "AI output was not valid JSON", raw: outText },
        { status: 500 }
      );
    }

    // 配列で受けて、UI互換のために改行文字列も返す
    const hazardsArr = Array.isArray(parsed?.hazards) ? parsed.hazards : [];
    const measuresArr = Array.isArray(parsed?.measures) ? parsed.measures : [];
    const thirdArr = Array.isArray(parsed?.third_party) ? parsed.third_party : [];

    const ai_hazards = joinLines(hazardsArr);
    const ai_countermeasures = joinLines(measuresArr);
    const ai_third_party = joinLines(thirdArr);

    // 既存クライアント互換キー（KyNewClientはここを読んでいる）
    return NextResponse.json({
      ai_hazards,
      ai_countermeasures,
      ai_third_party,

      // 互換のため残す（将来使うなら）
      ai_work_detail: "",

      // 配列も返しておく（レビュー側で箇条書きにしたくなった時に便利）
      ai_hazards_items: hazardsArr,
      ai_countermeasures_items: measuresArr,
      ai_third_party_items: thirdArr,

      // デバッグ用（不要なら後で消してOK）
      model_used: model,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "server error" },
      { status: 500 }
    );
  }
}
