import { NextResponse } from "next/server";

type Body =
  | { text: string }
  | { title: string; url?: string; note?: string };

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

export async function POST(req: Request) {
  try {
    // ✅ 簡易認証（このAPIを外部から勝手に叩かせない）
    const secret = process.env.LINE_PUSH_SECRET || "";
    if (secret) {
      const header = req.headers.get("x-line-push-secret") || "";
      if (header !== secret) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    const body = (await req.json()) as Body;

    // ✅ 送信テキストを組み立て（text優先）
    let text = "";
    if ("text" in body) {
      text = s(body.text).trim();
    } else {
      const title = s(body.title).trim();
      const url = s(body.url).trim();
      const note = s(body.note).trim();

      if (!title) {
        return NextResponse.json({ error: "title required" }, { status: 400 });
      }

      // 現場向けテンプレ
      text =
        `【本日KY】${title}\n` +
        `必ず作業前に確認（確認ボタンで既読登録）\n` +
        (note ? `\n${note}\n` : "\n") +
        (url ? `▼KY公開リンク\n${url}\n` : "");
    }

    if (!text) {
      return NextResponse.json({ error: "text empty" }, { status: 400 });
    }

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
        messages: [{ type: "text", text }],
      }),
    });

    const data = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "line api error", status: res.status, data },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json(
      { error: "failed", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
