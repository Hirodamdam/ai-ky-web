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

【作業内容】
${workContent}

【気象条件】
気温：${temperature}℃
風速：${windSpeed}m/s
風向：${windDir}
降水量：${rain}mm

【第三者状況】
${thirdParty}

【写真比較指示】
前回と今回の写真を比較し、
・新たに発生した危険
・改善された点
・悪化した点
を必ず危険予知へ反映してください。

不足指摘は禁止。
作業内容と気象条件を必ず反映してください。

【出力形式】
危険予知：
・〇〇だから、〇〇が起こる
（5項目以上）

対策：
・（1）〇〇
（危険予知と対応）
`;

    const userContent: any[] = [
      { type: "text", text: prompt },
    ];

    if (representativeNow)
      userContent.push({ type: "image_url", image_url: { url: representativeNow } });

    if (representativePrev)
      userContent.push({ type: "image_url", image_url: { url: representativePrev } });

    if (pathNow)
      userContent.push({ type: "image_url", image_url: { url: pathNow } });

    if (pathPrev)
      userContent.push({ type: "image_url", image_url: { url: pathPrev } });

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: "建設現場KY専門AI。必ず箇条書きで出力。" },
          { role: "user", content: userContent },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: "openai_error", detail: errText }, { status: 502 });
    }

    const data = await response.json();
    const content = s(data?.choices?.[0]?.message?.content).trim();

    return NextResponse.json({
      ai_text: content,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "server_error", detail: s(e?.message) },
      { status: 500 }
    );
  }
}
