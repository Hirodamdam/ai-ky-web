import { NextResponse } from "next/server";
import OpenAI from "openai";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const work_detail = (body?.work_detail ?? "").toString().trim();
    const existing_hazards: string[] = Array.isArray(body?.existing_hazards) ? body.existing_hazards : [];
    const existing_countermeasures: string[] = Array.isArray(body?.existing_countermeasures) ? body.existing_countermeasures : [];

    if (!work_detail) {
      return NextResponse.json({ ok: false, error: "work_detail が空です" }, { status: 400 });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = `あなたは建設現場のKY（危険予知）支援AIです。
出力は必ずJSONのみ。説明文は禁止。`;

    const user = `作業内容：
${work_detail}

既に出ている危険要因候補（重複回避）：
${existing_hazards.map((x) => `- ${x}`).join("\n")}

既に出ている対策候補（重複回避）：
${existing_countermeasures.map((x) => `- ${x}`).join("\n")}

要件：
- 危険要因を3〜5件、対策を3〜5件
- 既存候補と同じ表現の重複は避ける（言い換えも極力避ける）
- 簡潔で現場で読み上げ可能な文体

出力JSON形式：
{"hazards":["..."],"countermeasures":["..."]}`;

    const resp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    let json: any = null;

    try {
      json = JSON.parse(text);
    } catch {
      // まれに前後にテキストが混ざる場合の簡易救済
      const m = text.match(/\{[\s\S]*\}/);
      if (m) json = JSON.parse(m[0]);
    }

    const hazards = Array.isArray(json?.hazards) ? json.hazards : [];
    const countermeasures = Array.isArray(json?.countermeasures) ? json.countermeasures : [];

    return NextResponse.json({
      ok: true,
      hazards,
      countermeasures,
      source: "openai",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
