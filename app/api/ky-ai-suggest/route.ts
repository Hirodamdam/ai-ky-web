// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const workContent = s(body?.workContent).trim();
    if (!workContent) {
      return NextResponse.json({ error: "Missing workContent" }, { status: 400 });
    }

    const temperature = body?.temperature_c ?? "不明";
    const windSpeed = body?.wind_speed_ms ?? "不明";
    const windDir = body?.wind_direction ?? "不明";
    const rain = body?.precipitation_mm ?? "不明";
    const thirdParty = body?.thirdPartyLevel ?? "不明";

    const representativeNow = body?.representative_photo_url ?? null;
    const representativePrev = body?.prev_representative_url ?? null;
    const pathNow = body?.path_photo_url ?? null;
    const pathPrev = body?.prev_path_url ?? null;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const prompt = `
あなたは建設現場の安全管理（KY）の専門家です。

作業内容：${workContent}
気温：${temperature}℃
風速：${windSpeed}m/s
風向：${windDir}
降水量：${rain}mm
第三者状況：${thirdParty}

前回と今回の写真を比較し、
新たな危険や悪化点を反映してください。

不足指摘は禁止。

危険予知：
・〇〇だから、〇〇が起こる（5件以上）

対策：
・（1）〇〇
`;

    const input: any[] = [
      {
        role: "user",
        content: [{ type: "text", text: prompt }],
      },
    ];

    const images = [representativeNow, representativePrev, pathNow, pathPrev].filter(Boolean);

    for (const url of images) {
      input[0].content.push({
        type: "input_image",
        image_url: url,
      });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        input,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: "openai_error", detail: err }, { status: 502 });
    }

    const data = await response.json();
    const content =
      data?.output?.[0]?.content?.find((c: any) => c.type === "output_text")?.text || "";

    return NextResponse.json({
      ai_text: content.trim(),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "server_error", detail: s(e?.message) },
      { status: 500 }
    );
  }
}
