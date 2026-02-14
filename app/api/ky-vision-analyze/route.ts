import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  imageUrl?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const imageUrl = body?.imageUrl?.trim();

    // 画像が無い場合は補正なし
    if (!imageUrl) {
      return NextResponse.json({
        image_factor: 1.0,
        details: {
          open_edges: false,
          heavy_equipment_near_people: false,
          third_party_visible: false,
          safety_barrier_missing: false,
          height_difference_detected: false,
        },
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `
この建設現場写真を安全管理視点で分析し、
以下をJSONで返してください。

{
  "open_edges": boolean,
  "heavy_equipment_near_people": boolean,
  "third_party_visible": boolean,
  "safety_barrier_missing": boolean,
  "height_difference_detected": boolean
}
`,
              },
              {
                type: "input_image",
                image_url: imageUrl,
              },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      }),
    });

    const json = await res.json();

    const text =
      json?.output?.[0]?.content?.find((c: any) => c.type === "output_text")?.text || "{}";

    const parsed = JSON.parse(text);

    // 補正係数計算
    let I = 1.0;
    if (parsed.open_edges) I += 0.1;
    if (parsed.heavy_equipment_near_people) I += 0.15;
    if (parsed.third_party_visible) I += 0.15;
    if (parsed.safety_barrier_missing) I += 0.1;
    if (parsed.height_difference_detected) I += 0.1;

    if (I > 1.5) I = 1.5;

    return NextResponse.json({
      image_factor: Number(I.toFixed(2)),
      details: parsed,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
