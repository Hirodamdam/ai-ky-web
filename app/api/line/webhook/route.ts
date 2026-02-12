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

  // timingSafeEqualは長さが違うと例外になるので防御
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/**
 * ✅ LINE Console の Verify は GET/HEAD で来ることがある
 * → 200 を返せばOK
 */
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}

/**
 * ✅ 実運用のイベントは POST
 * - X-Line-Signature があれば署名検証
 * - Verifyなどで署名なしPOSTが来ても 200 を返す（ログで判別可能）
 */
export async function POST(req: Request) {
  try {
    const channelSecret = (process.env.LINE_CHANNEL_SECRET || "").trim();
    if (!channelSecret) {
      // ただし Verify を通したい場合もあるので 200 を返しつつログに出す
      console.warn("[line-webhook] LINE_CHANNEL_SECRET missing");
      return NextResponse.json({ ok: true, warn: "LINE_CHANNEL_SECRET missing" }, { status: 200 });
    }

    const signature = s(req.headers.get("x-line-signature")).trim();
    const bodyText = await req.text();

    // 署名がある場合だけ検証（実運用は必ず付く）
    if (signature) {
      const ok = verifySignature(channelSecret, bodyText, signature);
      if (!ok) {
        console.warn("[line-webhook] invalid signature");
        // 実運用の安全のため 401
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    } else {
      // Verify等で署名なしが来た場合
      console.log("[line-webhook] no signature (likely verify)");
    }

    // イベント解析（署名OK or 署名なしverify）
    let json: any = {};
    try {
      json = JSON.parse(bodyText || "{}");
    } catch {
      json = {};
    }

    const events = Array.isArray(json?.events) ? json.events : [];
    for (const ev of events) {
      const srcType = s(ev?.source?.type).trim(); // user / group / room
      const userId = s(ev?.source?.userId).trim();
      const groupId = s(ev?.source?.groupId).trim();
      const roomId = s(ev?.source?.roomId).trim();
      const msgText = s(ev?.message?.text).trim();

      console.log(
        "[line-webhook]",
        JSON.stringify(
          {
            srcType,
            userId: userId || null,
            groupId: groupId || null,
            roomId: roomId || null,
            msgText: msgText ? msgText.slice(0, 80) : null,
          },
          null,
          2
        )
      );
    }

    // LINEには常に 200 を返す（受理）
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("[line-webhook] failed:", e);
    // LINEにリトライさせないため 200（ただしログに残す）
    return NextResponse.json({ ok: true, warn: String(e?.message ?? e) }, { status: 200 });
  }
}
