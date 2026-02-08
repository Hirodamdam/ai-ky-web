import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type Body = {
  work_detail?: string | null;
  hazards?: string | null;
  countermeasures?: string | null;
  third_party_level?: string | null;

  // ✅ 追加（現場位置）
  lat?: number | null;
  lon?: number | null;

  weather_slots?: Array<{
    hour: 9 | 12 | 15;
    weather_text: string;
    temperature_c: number | null;
    wind_direction_deg: number | null;
    wind_speed_ms: number | null;
    precipitation_mm: number | null;
  }> | null;

  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function toNum(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtSlots(slots: any[] | null | undefined): string {
  const arr = Array.isArray(slots) ? slots : [];
  if (!arr.length) return "（未取得）";

  return arr
    .map((x) => {
      const h = x?.hour;
      const w = x?.weather_text ?? "";
      const t = x?.temperature_c == null ? "—" : `${x.temperature_c}℃`;
      const wd = x?.wind_direction_deg == null ? "—" : String(x.wind_direction_deg);
      const ws = x?.wind_speed_ms == null ? "—" : `${x.wind_speed_ms}m/s`;
      const p = x?.precipitation_mm == null ? "—" : `${x.precipitation_mm}mm`;
      return `${h}:00 ${w} / 気温${t} / 風向${wd} / 風速${ws} / 雨量${p}`;
    })
    .join("\n");
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  const u = s(url).trim();
  if (!u) return null;

  try {
    const res = await fetch(u);
    if (!res.ok) return null;

    const ct = res.headers.get("content-type") || "image/jpeg";
    const ab = await res.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");

    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const workDetail = s(body.work_detail).trim();
    if (!workDetail) {
      return NextResponse.json({ error: "作業内容が空です" }, { status: 400 });
    }

    const hazardsHuman = s(body.hazards).trim();
    const measuresHuman = s(body.countermeasures).trim();
    const third = s(body.third_party_level).trim();

    const lat = toNum(body.lat);
    const lon = toNum(body.lon);

    const slots = Array.isArray(body.weather_slots) ? body.weather_slots : [];
    const slotsText = fmtSlots(slots);

    // ===== 安衛則ベース中止判定 =====
    const windMax = Math.max(0, ...slots.map((x) => toNum(x?.wind_speed_ms) ?? 0));
    const rainMax = Math.max(0, ...slots.map((x) => toNum(x?.precipitation_mm) ?? 0));

    const stopStrongWind = windMax >= 10;
    const stopHeavyRain = rainMax >= 50;

    const stopCriteriaNote =
      `【作業中止基準 判定】\n` +
      `・強風：最大 ${windMax}m/s → ${stopStrongWind ? "中止検討" : "継続可"}\n` +
      `・大雨：最大 ${rainMax}mm → ${stopHeavyRain ? "中止検討" : "継続可"}\n` +
      `・WBGT/視程/地震/積雪は未入力`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // ===== 画像取得 =====
    const images: Array<{ label: string; dataUrl: string }> = [];

    const slopeNow = await fetchAsDataUrl(body.slope_photo_url || "");
    const slopePrev = await fetchAsDataUrl(body.slope_prev_photo_url || "");
    const pathNow = await fetchAsDataUrl(body.path_photo_url || "");
    const pathPrev = await fetchAsDataUrl(body.path_prev_photo_url || "");

    if (slopeNow) images.push({ label: "法面今回", dataUrl: slopeNow });
    if (slopePrev) images.push({ label: "法面前回", dataUrl: slopePrev });
    if (pathNow) images.push({ label: "通路今回", dataUrl: pathNow });
    if (pathPrev) images.push({ label: "通路前回", dataUrl: pathPrev });

    const system = `
あなたは建設現場KY（危険予知活動）の安全衛生専門AI。

必ず以下を守る：

■ 出力形式
【AI補足｜作業内容】
- 箇条書き最大5行
【AI補足｜危険予知】
- 箇条書き最大5行
【AI補足｜対策】
- 箇条書き最大5行
【AI補足｜第三者】
- 箇条書き最大5行

■ 安衛則ベース中止判定
- 強風10m/s以上 → 高所・揚重・法面作業停止を明記
- 大雨50mm以上 → 作業中止・退避を明記
- 未入力項目は断定禁止

■ 位置情報
緯度経度は参考情報として扱う。
地形や気象の断定は禁止。

■ 曖昧語禁止
「注意する」「徹底」などは禁止。
具体行動を書く。

余計な説明は禁止。
`.trim();

    const userText = `
【作業内容】
${workDetail}

【危険（人入力）】
${hazardsHuman || "未入力"}

【対策（人入力）】
${measuresHuman || "未入力"}

【第三者】
${third || "未入力"}

【位置】
緯度:${lat ?? "未設定"}
経度:${lon ?? "未設定"}

【気象】
${slotsText}

${stopCriteriaNote}
`.trim();

    const content: any[] = [{ type: "text", text: userText }];

    for (const img of images) {
      content.push({ type: "text", text: img.label });
      content.push({ type: "image_url", image_url: { url: img.dataUrl } });
    }

    const r = await openai.chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
    });

    const text = (r.choices?.[0]?.message?.content ?? "").trim();

    return NextResponse.json({
      ai_supplement: text,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "AI補足生成失敗" },
      { status: 500 }
    );
  }
}
