// app/api/line/webhook/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

function s(v: any) {
  return v == null ? "" : String(v);
}

function verifySignature(channelSecret: string, body: string, signature: string) {
  const hmac = crypto.createHmac("sha256", channelSecret);
  hmac.update(body, "utf8");
  const digest = hmac.digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export async function POST(req: Request) {
  try {
    const channelSecret = (process.env.LINE_CHANNEL_SECRET || "").trim();
    if (!channelSecret) {
      return NextResponse.json({ error: "LINE_CHANNEL_SECRET missing" }, { status: 500 });
    }

    const signature = s(req.headers.get("x-line-signature")).trim();
    const bodyText = await req.text();

    if (!signature) {
      return NextResponse.json({ error: "Missing X-Line-Signature" }, { status: 400 });
    }

    const ok = verifySignature(channelSecret, bodyText, signature);
    if (!ok) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const json = JSON.parse(bodyText || "{}");
    const events = Array.isArray(json?.events) ? json.events : [];

    for (const ev of events) {
      const srcType = s(ev?.source?.type).trim(); // user / group / room
      const userId = s(ev?.source?.userId).trim();
      const groupId = s(ev?.source?.groupId).trim();
      const roomId = s(ev?.source?.roomId).trim();

      console.log(
        "[line-webhook]",
        JSON.stringify(
          {
            srcType,
            userId: userId || null,
            groupId: groupId || null,
            roomId: roomId || null,
          },
          null,
          2
        )
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[line-webhook] failed:", e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
