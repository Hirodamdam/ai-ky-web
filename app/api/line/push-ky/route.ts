import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "LINE token missing" }, { status: 500 });
    }

    const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messages: [
          {
            type: "text",
            text,
          },
        ],
      }),
    });

    const data = await res.text();
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
