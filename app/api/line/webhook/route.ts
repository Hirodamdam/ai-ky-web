// app/api/line/webhook/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

/**
 * LINE Webhook
 * - 署名検証（X-Line-Signature）
 * - event.source.groupId / userId / roomId を抽出してログに出す
 * - 返信はしない（受信ログ用途）
 */

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function timingSafeEqual(a: string, b: string) {
  // 長さが違うと例外なので、先に揃える
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyLineSignature(rawBody: string, channelSecret: string, signatureHeader: string) {
  if (!channelSecret) return { ok: false, reason: "LINE_CHANNEL_SECRET missing" as const };
  if (!signatureHeader) return { ok: false, reason: "X-Line-Signature missing" as const };

  const hmac = crypto.createHmac("sha256", channelSecret);
  hmac.update(rawBody);
  const digest = hmac.digest("base64");

  const ok = timingSafeEqual(digest, signatureHeader);
  return ok ? { ok: true as const } : { ok: false as const, reason: "signature mismatch" as const };
}

export async function GET() {
  // 疎通確認用
  return NextResponse.json({ ok: true, route: "/api/line/webhook" }, { status: 200 });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}

export async function POST(req: Request) {
  try {
    // ✅ raw body を取る（署名検証に必要）
    const rawBody = await req.text();

    const channelSecret = (process.env.LINE_CHANNEL_SECRET || "").trim();
    const signature = (req.headers.get("x-line-signature") || "").trim();

    const v = verifyLineSignature(rawBody, channelSecret, signature);
    if (!v.ok) {
      console.warn("[line-webhook] unauthorized:", v.reason);
      return NextResponse.json({ ok: false, error: "unauthorized", reason: v.reason }, { status: 401 });
    }

    // ✅ JSON解析
    const payload = JSON.parse(rawBody || "{}") as any;
    const events = Array.isArray(payload?.events) ? payload.events : [];

    // ✅ event から to（LINEの宛先ID）を拾ってログに出す
    const extracted = events.map((ev: any) => {
      const type = s(ev?.type);
      const srcType = s(ev?.source?.type); // user / group / room
      const userId = s(ev?.source?.userId) || null;
      const groupId = s(ev?.source?.groupId) || null;
      const roomId = s(ev?.source?.roomId) || null;

      // メッセージ本文も参考に出す（必要最低限）
      const messageType = s(ev?.message?.type);
      const text = messageType === "text" ? s(ev?.message?.text) : "";

      // ✅ 送信先として使える "to"
      // groupなら groupId、roomなら roomId、userなら userId
      const to = groupId || roomId || userId || null;

      return { type, srcType, to, groupId, roomId, userId, messageType, text };
    });

    console.log("[line-webhook] events:", JSON.stringify(extracted, null, 2));

    // ✅ LINE側は200を返せばOK（返信不要）
    return NextResponse.json({ ok: true, count: extracted.length }, { status: 200 });
  } catch (e: any) {
    console.error("[line-webhook] failed:", e);
    return NextResponse.json({ ok: false, error: "failed", message: String(e?.message ?? e) }, { status: 500 });
  }
}
