// app/api/line/push-ky/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type WeatherSlot = {
  hour: 9 | 12 | 15;
  weather_text?: string | null;
  temperature_c?: number | null;
  wind_direction_deg?: number | null;
  wind_speed_ms?: number | null;
  precipitation_mm?: number | null;
};

type Body =
  | { text: string; to?: string | string[]; also_to?: string | string[] }
  | {
      title: string;
      url?: string;
      note?: string;
      to?: string | string[];
      also_to?: string | string[];

      work_detail?: string | null;
      workers?: number | null;
      third_party_level?: string | null;
      weather_slots?: WeatherSlot[] | null;

      ai_hazards?: string | null;
      ai_countermeasures?: string | null;
      ai_third_party?: string | null;
    };

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isValidLineTo(id: string): boolean {
  // userId: U + 32hex, groupId: C + 32hex, roomId: R + 32hex
  const x = s(id).trim().replace(/^"+|"+$/g, ""); // 念のため両端の " を除去
  return /^[UCR][0-9a-f]{32}$/i.test(x);
}

function parseRecipients(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => s(x).trim()).filter(Boolean);
  const one = s(v).trim();
  return one ? [one] : [];
}

function parseAdminRecipientsFromEnv(): string[] {
  const raw = (process.env.LINE_ADMIN_RECIPIENT_IDS || "").trim();
  if (!raw) return [];
  return raw.split(",").map((x) => x.trim()).filter(Boolean);
}

async function callLinePush(token: string, to: string, text: string) {
  const url = "https://api.line.me/v2/bot/message/push";
  const payload = { to, messages: [{ type: "text", text }] };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text().catch(() => "");
  const retryAfter = Number(res.headers.get("retry-after") || "0") || 0;
  return { ok: res.ok, status: res.status, bodyText, retryAfter };
}

// 既存テンプレ関数（あなたの現行をそのまま使う想定）
function trimLineOne(text: string, max = 60) {
  const t = s(text).replace(/\r\n/g, "\n").trim();
  if (!t) return "";
  const first = t.split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
  if (first.length <= max) return first;
  return first.slice(0, max - 1) + "…";
}
function normalizeBullets(text: string, maxLines = 3, maxLen = 120) {
  const t = s(text).replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  const lines = t
    .split("\n")
    .map((x) => x.replace(/^[•・\-*]\s*/g, "").trim())
    .filter(Boolean);

  const picked: string[] = [];
  for (const ln of lines) {
    if (picked.length >= maxLines) break;
    const v = ln.length > maxLen ? ln.slice(0, maxLen - 1) + "…" : ln;
    picked.push(v);
  }
  return picked;
}
function degToDirJp(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "—";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}
const WIND_WARN_MS = 8;
const RAIN_WARN_MM = 3;

function pickWorstWeather(slots: WeatherSlot[] | null | undefined) {
  const arr = Array.isArray(slots) ? slots : [];
  const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
  if (!filtered.length) return null;

  const score = (x: WeatherSlot) => {
    const ws = x.wind_speed_ms ?? null;
    const pr = x.precipitation_mm ?? null;
    let sc = 0;
    if (ws != null) sc += Math.min(Math.max(ws, 0), 30) * 10;
    if (pr != null) sc += Math.min(Math.max(pr, 0), 50) * 8;
    return sc;
  };

  filtered.sort((a, b) => score(b) - score(a) || a.hour - b.hour);
  return filtered[0];
}
function weatherWarningLine(slot: WeatherSlot | null) {
  if (!slot) return "";
  const ws = slot.wind_speed_ms ?? null;
  const pr = slot.precipitation_mm ?? null;

  const parts: string[] = [];
  if (ws != null && ws >= WIND_WARN_MS) parts.push(`強風（${degToDirJp(slot.wind_direction_deg)} ${ws}m/s）`);
  if (pr != null && pr >= RAIN_WARN_MM) parts.push(`雨（降水 ${pr}mm）`);
  if (!parts.length) return "";
  return `⚠ 気象：${slot.hour}時 ${parts.join(" / ")}`;
}

function buildCompletedTemplate(body: Extract<Body, { title: string }>) {
  const title = s(body.title).trim();
  const url = s(body.url).trim();
  const note = s(body.note).trim();

  const lines: string[] = [];
  lines.push(`【本日KY】${title}`);

  const work = trimLineOne(s((body as any).work_detail), 70);
  const workers = (body as any).workers != null ? `${(body as any).workers}名` : "";
  const third = s((body as any).third_party_level).trim();

  const summaryParts: string[] = [];
  if (work) summaryParts.push(`作業：${work}`);
  const suffix: string[] = [];
  if (workers) suffix.push(`作業員${workers}`);
  if (third) suffix.push(`墓参者 ${third}`);
  if (suffix.length) {
    if (summaryParts.length) summaryParts[0] += `（${suffix.join(" / ")}）`;
    else summaryParts.push(`${suffix.join(" / ")}`);
  }
  if (summaryParts.length) lines.push(summaryParts.join(""));

  const worst = pickWorstWeather((body as any).weather_slots);
  const warn = weatherWarningLine(worst);
  if (warn) lines.push(warn);

  if (note) {
    lines.push("");
    lines.push(note);
  } else {
    const hz = normalizeBullets((body as any).ai_hazards || "", 1, 120)[0] || "";
    const cm = normalizeBullets((body as any).ai_countermeasures || "", 1, 120)[0] || "";
    const th = normalizeBullets((body as any).ai_third_party || "", 1, 120)[0] || "";
    if (hz || cm || th) {
      if (hz) lines.push(`・危険：${hz}`);
      if (cm) lines.push(`・対策：${cm}`);
      if (th) lines.push(`・第三者：${th}`);
    }
  }

  lines.push(`必ず作業前に確認（確認ボタンで既読登録）`);
  if (url) {
    lines.push(`▼KY公開リンク`);
    lines.push(url);
  }

  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");
  return text.length > 4900 ? text.slice(0, 4899) + "…" : text;
}

export async function POST(req: Request) {
  const started = Date.now();

  try {
    const secret = (process.env.LINE_PUSH_SECRET || "").trim();
    if (secret) {
      const header = (req.headers.get("x-line-push-secret") || "").trim();
      if (header !== secret) {
        console.warn("[line-push-ky] unauthorized");
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    const body = (await req.json()) as Body;

    let text = "";
    if ("text" in body) {
      text = s((body as any).text).trim();
    } else {
      const title = s((body as any).title).trim();
      if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
      text = buildCompletedTemplate(body as any);
    }
    if (!text) return NextResponse.json({ error: "text empty" }, { status: 400 });

    const token = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
    if (!token) return NextResponse.json({ error: "LINE token missing" }, { status: 500 });

    const toFromBody = parseRecipients((body as any)?.to);
    const alsoFromBody = parseRecipients((body as any)?.also_to);
    const adminFromEnv = parseAdminRecipientsFromEnv();

    const rawTargets = Array.from(new Set([...toFromBody, ...alsoFromBody, ...adminFromEnv]));
    const validTargets = rawTargets.map((x) => x.trim().replace(/^"+|"+$/g, "")).filter(isValidLineTo);
    const invalidTargets = rawTargets.filter((x) => !isValidLineTo(x));

    if (invalidTargets.length) {
      console.warn("[line-push-ky] invalid targets filtered:", invalidTargets);
    }
    if (!validTargets.length) {
      return NextResponse.json({ error: "no valid recipients", invalidTargets }, { status: 400 });
    }

    const results: Array<{ to: string; ok: boolean; status: number; body: string }> = [];

    for (const to of validTargets) {
      let ok = false;
      let lastStatus = 0;
      let lastBody = "";

      for (let attempt = 1; attempt <= 3; attempt++) {
        const r = await callLinePush(token, to, text);
        lastStatus = r.status;
        lastBody = r.bodyText;
        ok = r.ok;

        console.log(
          `[line-push-ky] mode=push to=${to} attempt=${attempt} status=${lastStatus} ok=${ok} body=${lastBody.slice(0, 200)}`
        );

        if (ok) break;

        if (lastStatus === 429) {
          const wait = Math.min(Math.max(r.retryAfter || 1, 1), 10);
          await sleep(wait * 1000);
          continue;
        }
        break;
      }

      results.push({ to, ok, status: lastStatus, body: lastBody.slice(0, 500) });
    }

    const ms = Date.now() - started;

    // 1件でも成功していれば OK 扱いにする（現場運用優先）
    const anyOk = results.some((r) => r.ok);
    if (!anyOk) {
      return NextResponse.json({ error: "line api error (all failed)", targets: validTargets.length, results, ms }, { status: 500 });
    }

    return NextResponse.json({ ok: true, targets: validTargets.length, results, ms, invalidTargets });
  } catch (e: any) {
    console.error("[line-push-ky] failed:", e);
    return NextResponse.json({ error: "failed", message: String(e?.message ?? e) }, { status: 500 });
  }
}
