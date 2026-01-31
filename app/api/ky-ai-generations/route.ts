// app/api/ky-ai-generations/route.ts
import { NextResponse } from "next/server";

type Body = {
  work_detail?: string | null;
  hazards?: string | null;
  countermeasures?: string | null;

  third_party_situation?: string | null; // "多い" / "少ない" / null

  weather?: string | null;
  temperature_text?: string | null;
  wind_direction?: string | null;
  wind_speed_text?: string | null; // "2.7m/s" など
  precipitation_mm?: number | null;

  output_format?: string | null; // "sections_v1"
};

function s(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function clamp(t: string, max = 5000): string {
  const x = (t ?? "").trim();
  return x.length > max ? x.slice(0, max) : x;
}

function buildWeatherLine(b: Body): string {
  const parts: string[] = [];
  if (b.weather) parts.push(`天気:${b.weather}`);
  if (b.temperature_text) parts.push(`気温:${b.temperature_text}`);
  if (b.wind_direction) parts.push(`風向:${b.wind_direction}`);
  if (b.wind_speed_text) parts.push(`風速:${b.wind_speed_text}`);
  if (typeof b.precipitation_mm === "number") parts.push(`降雨:${b.precipitation_mm}mm`);
  return parts.join(" / ");
}

function extractJsonObject(text: string): string | null {
  // 返答が前置き付きでも、最初の { ... } を拾う
  const t = (text ?? "").trim();
  if (!t) return null;
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return t.slice(first, last + 1);
}

function mustString(x: any): string {
  const v = s(x).trim();
  return v;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const workDetail = clamp(s(body.work_detail));
    const hazardsIn = clamp(s(body.hazards));
    const measuresIn = clamp(s(body.countermeasures));
    const third = clamp(s(body.third_party_situation));

    if (!workDetail) {
      return NextResponse.json({ error: "work_detail is required" }, { status: 400 });
    }

    const weatherLine = buildWeatherLine(body) || "(未適用)";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    // モデルは環境で変わるので「設定→なければ既定」を採用
    // 例: OPENAI_MODEL="gpt-4o-mini" や "gpt-4.1-mini"
    const model = process.env.OPENAI_MODEL || process.env.KY_OPENAI_MODEL || "gpt-4o-mini";

    const system = `
あなたは日本の建設現場向け「危険予知活動（KY）」の支援AIです。
現場は墓地内工事で、第三者（墓参者）の安全配慮が必須です。
出力は必ずJSONのみ（前置き/説明/Markdown/コードフェンスは禁止）。
内容は抽象論ではなく、現場で実行できる具体手順に落としてください。
`.trim();

    const user = `
【入力】
作業内容: ${workDetail}
危険予知(人): ${hazardsIn || "(未入力)"}
対策(人): ${measuresIn || "(未入力)"}
第三者(墓参者)の状況: ${third || "(未選択)"}
気象: ${weatherLine}

【出力仕様：JSON固定（キー名厳守）】
{
  "work": "作業内容の補足（箇条書き中心。優先順位付き）",
  "hazards": "危険予知の補足（人的/重機/足元・法面/資機材/動線/第三者 を網羅）",
  "measures": "対策の補足（具体手順、合図、立入禁止/誘導、保護具、点検、停止基準、緊急時対応）",
  "thirdParty": "第三者（墓参者）向け補足（誘導、掲示、区画分離、時間帯配慮、声掛け例）",
  "meta": {
    "summary": "1行要約",
    "priority": ["最優先3つを短文で"],
    "stop_criteria": ["中止/退避の判断基準を短文で"]
  }
}

【品質要件】
- 各フィールドは最低でも5項目以上（短すぎる場合は加筆）
- 第三者が「多い/少ない」で thirdParty と hazards/measures を変える
- 気象が未適用でも一般的注意、適用済みなら気象起因を最優先
- 禁止：精神論だけ、同語反復、法令条文の引用
`.trim();

    // ✅ Chat Completions + response_format で JSON を強制
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1400,
      }),
    });

    const upJson = await upstream.json();

    if (!upstream.ok) {
      return NextResponse.json(
        { error: upJson?.error?.message ?? "OpenAI API error", detail: upJson },
        { status: 500 }
      );
    }

    const content: string = s(upJson?.choices?.[0]?.message?.content);

    // response_format が効けば基本ここでJSONになるが、念のため保険
    const jsonText = extractJsonObject(content) ?? content;
    let parsed: any = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        { error: "AI response was not valid JSON", raw: content },
        { status: 500 }
      );
    }

    const work = mustString(parsed?.work);
    const hazards = mustString(parsed?.hazards);
    const measures = mustString(parsed?.measures);
    const thirdParty = mustString(parsed?.thirdParty);
    const meta = parsed?.meta ?? {};

    if (!work || !hazards || !measures || !thirdParty) {
      return NextResponse.json(
        { error: "AI JSON missing required fields", parsed },
        { status: 500 }
      );
    }

    const combined =
      `【作業内容の補足】\n${work}\n\n` +
      `【危険予知の補足】\n${hazards}\n\n` +
      `【対策の補足】\n${measures}\n\n` +
      `【第三者（墓参者）の補足】\n${thirdParty}`;

    return NextResponse.json({
      sections: { work, hazards, measures, thirdParty, meta },
      text: combined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
