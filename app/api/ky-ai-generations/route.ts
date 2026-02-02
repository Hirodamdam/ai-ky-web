// app/api/ky-ai-generations/route.ts
import { NextResponse } from "next/server";

type Body = {
  work_detail: string;
  hazards: string;
  countermeasures: string;
  third_party_level: "多い" | "少ない" | string;

  // 気象（適用中を優先）
  applied_hour?: 9 | 12 | 15 | null;
  weather_text?: string | null;
  temperature_c?: number | null;
  wind_direction_deg?: number | null;
  wind_speed_ms?: number | null;
  precipitation_mm?: number | null;

  // 9/12/15 スロット（任意：あるなら使う）
  weather_slots?: any[] | null;
};

function wdToCardinal(deg: number | null | undefined): string {
  if (deg === null || deg === undefined) return "—";
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const i = Math.round(((deg % 360) / 45)) % 8;
  return dirs[i];
}

function normalizeBullets(text: string): string {
  // 返答が「文章1本」になっても、句点で分割して bullet に寄せる
  const raw = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  const lines = raw.split("\n").map((s) => s.trim()).filter(Boolean);

  const cleaned = lines.flatMap((line) => {
    const s = line.replace(/^[\u3001,，。．・•\-\–\—\*\u2022]+\s*/g, "").trim();
    if (!s) return [];
    // 句点で分割（長文救済）
    if (s.length > 40 && s.includes("。")) {
      return s.split("。").map((x) => x.trim()).filter(Boolean).map((x) => x + "。");
    }
    return [s.endsWith("。") || s.endsWith("！") || s.endsWith("!") ? s : s];
  });

  // bullet形式に統一
  return cleaned.map((s) => `・${s}`).join("\n");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const work = (body.work_detail ?? "").trim();
    const haz = (body.hazards ?? "").trim();
    const ctr = (body.countermeasures ?? "").trim();
    const tp = (body.third_party_level ?? "少ない").toString();

    if (!work) {
      return NextResponse.json({ error: "work_detail required" }, { status: 400 });
    }

    const hour = body.applied_hour ?? null;
    const w = body.weather_text ?? "";
    const t = body.temperature_c ?? null;
    const wd = body.wind_direction_deg ?? null;
    const ws = body.wind_speed_ms ?? null;
    const p = body.precipitation_mm ?? null;

    const appliedWeatherSummary =
      hour === 9 || hour === 12 || hour === 15
        ? `${hour}:00 / ${w || "—"} / 気温${t ?? "—"}℃ / 風向${wdToCardinal(wd)} / 風速${ws ?? "—"}m/s / 雨量${p ?? "—"}mm`
        : `（未適用） / ${w || "—"} / 気温${t ?? "—"}℃ / 風向${wdToCardinal(wd)} / 風速${ws ?? "—"}m/s / 雨量${p ?? "—"}mm`;

    const slots = Array.isArray(body.weather_slots) ? body.weather_slots : [];
    const slotText =
      slots.length > 0
        ? slots
            .map((s: any) => {
              const hh = s?.hour ?? "—";
              const ww = s?.weather_text ?? "—";
              const tt = s?.temperature_c ?? "—";
              const wdd = wdToCardinal(s?.wind_direction_deg ?? null);
              const wss = s?.wind_speed_ms ?? "—";
              const pp = s?.precipitation_mm ?? "—";
              return `${hh}:00 ${ww} 気温${tt}℃ 風向${wdd} 風速${wss}m/s 雨量${pp}mm`;
            })
            .join("\n")
        : "（スロットなし）";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });
    }

    // ✅ ここが肝：気象（適用中＋スロット）を“必ず”条件に入れる
    const system = [
      "あなたは建設現場の安全衛生（KY）に詳しい安全管理者。",
      "出力は必ず日本語。",
      "出力は必ず4セクション：",
      "1) 作業内容の補足 2) 危険予知の補足 3) 対策の補足 4) 第三者の補足。",
      "各セクションは必ず箇条書き（・）で8～12項目。",
      "各項目は“具体的な行動”で書く（名詞だけで終わらない）。",
      "気象条件（雨量/風/低温/凍結/視界/ぬかるみ）を必ず反映し、危険と対策に落とし込む。",
      "第三者（墓参者）の状況（多い/少ない）を必ず反映し、誘導・区画・合図・見張りを具体化する。",
    ].join("\n");

    const user = [
      "【入力】",
      `作業内容：${work}`,
      `危険予知：${haz || "（未入力）"}`,
      `対策：${ctr || "（未入力）"}`,
      `第三者（墓参者）：${tp}`,
      "",
      "【気象（適用中）】",
      appliedWeatherSummary,
      "",
      "【気象（9/12/15スロット）】",
      slotText,
      "",
      "【出力形式（厳守）】",
      "作業内容の補足：",
      "・...",
      "",
      "危険予知の補足：",
      "・...",
      "",
      "対策の補足：",
      "・...",
      "",
      "第三者の補足：",
      "・...",
    ].join("\n");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ error: `OpenAI failed: ${t}` }, { status: 500 });
    }

    const json = await res.json();
    const content = (json?.choices?.[0]?.message?.content ?? "").toString();

    // ✅ 受け側が箇条書きで崩れても最低限整形
    // セクションごとに split して bullet 正規化して返す
    const pick = (label: string) => {
      const idx = content.indexOf(label);
      if (idx < 0) return "";
      const rest = content.slice(idx + label.length);
      // 次セクションまで
      const nextLabels = ["作業内容の補足：", "危険予知の補足：", "対策の補足：", "第三者の補足："].filter((l) => l !== label);
      const nextIdx = nextLabels
        .map((l) => rest.indexOf(l))
        .filter((n) => n >= 0)
        .sort((a, b) => a - b)[0];
      const chunk = nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
      return chunk.trim();
    };

    const ai_work_detail = normalizeBullets(pick("作業内容の補足："));
    const ai_hazards = normalizeBullets(pick("危険予知の補足："));
    const ai_countermeasures = normalizeBullets(pick("対策の補足："));
    const ai_third_party = normalizeBullets(pick("第三者の補足："));

    return NextResponse.json({
      ai_work_detail,
      ai_hazards,
      ai_countermeasures,
      ai_third_party,
      appliedWeatherSummary,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
