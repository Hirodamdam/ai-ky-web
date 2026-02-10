import { NextResponse } from "next/server";

type Body =
  | { text: string }
  | { title: string; url?: string; note?: string };

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: Request) {
  const started = Date.now();

  try {
    // ✅ 簡易認証（このAPIを外部から勝手に叩かせない）
    const secret = process.env.LINE_PUSH_SECRET || "";
    if (secret) {
      const header = req.headers.get("x-line-push-secret") || "";
      if (header !== secret) {
        console.warn("[line-push-ky] unauthorized");
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
      console.error("[line-push-ky] LINE_CHANNEL_ACCESS_TOKEN missing");
      return NextResponse.json({ error: "LINE token missing" }, { status: 500 });
    }

    const payload = { messages: [{ type: "text", text }] };

    // ✅ 429対策：最大3回リトライ
    let lastStatus = 0;
    let lastBody = "";
    let ok = false;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch("https://api.line.me/v2/bot/message/broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      lastStatus = res.status;
      lastBody = await res.text();
      ok = res.ok;

      // ✅ 重要：Vercel Logs に残す（次に止まっても原因が一発で出る）
      console.log(
        `[line-push-ky] attempt=${attempt} status=${lastStatus} ok=${ok} body=${lastBody.slice(
          0,
          300
        )}`
      );

      if (ok) break;

      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after") ?? "1");
        await sleep(Math.min(Math.max(ra, 1), 10) * 1000);
        continue;
      }

      // 429以外は即終了
      break;
    }

    const ms = Date.now() - started;

    if (!ok) {
      return NextResponse.json(
        { error: "line api error", status: lastStatus, data: lastBody, ms },
        { status: 500 }
      );
    }

    // ✅ 200でも返ってくるbody（通常は空）を返す
    return NextResponse.json({ ok: true, status: lastStatus, data: lastBody, ms });
  } catch (e: any) {
    console.error("[line-push-ky] failed:", e);
    return NextResponse.json(
      { error: "failed", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
