// app/api/weather/route.ts
import { NextResponse } from "next/server";

type WeatherPayload = {
  weather: string | null;            // 例: "晴れ"
  temperature_text: string | null;   // 例: "12.3"
  wind_direction: string | null;     // 例: "北北西"
  wind_speed_text: string | null;    // 例: "3.5"
  precipitation_mm: number | null;   // 例: 0.0（直近10分 or 1時間のどちらかで運用）
  observed_at: string | null;        // ISO
};

function jsonError(status: number, message: string, detail?: any) {
  return NextResponse.json({ ok: false, error: message, detail }, { status });
}

function toJstIsoSafe(s: string) {
  // latest_time.txt は ISO で返る（例: 2022-08-06T10:10:00+09:00） :contentReference[oaicite:4]{index=4}
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function yyyymmdd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function floorTo3HourBlock(h: number) {
  // 0,1,2 -> 00 / 3,4,5 -> 03 ... 21-23 -> 21
  const b = Math.floor(h / 3) * 3;
  return String(b).padStart(2, "0");
}

function pickLatestKeyLE(data: Record<string, any>, targetIso: string) {
  // data のキーは日時文字列（例: "2022-08-06T10:00:00+09:00"） :contentReference[oaicite:5]{index=5}
  // targetIso より「過去で最大」のキーを拾う
  const t = new Date(targetIso).getTime();
  let bestKey: string | null = null;
  let bestTime = -Infinity;

  for (const k of Object.keys(data)) {
    const kt = new Date(k).getTime();
    if (!Number.isNaN(kt) && kt <= t && kt > bestTime) {
      bestTime = kt;
      bestKey = k;
    }
  }
  return bestKey;
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // 今回は A（鹿児島固定）なので lat/lon は受け取っても未使用でOK
  // const lat = url.searchParams.get("lat");
  // const lon = url.searchParams.get("lon");

  const forecastArea =
    process.env.JMA_FORECAST_AREA_CODE?.trim() || "460100"; // 鹿児島県（奄美除く） :contentReference[oaicite:6]{index=6}
  const amedasCode =
    process.env.JMA_AMEDAS_CODE?.trim() || "88317"; // 必要なら後で差し替え

  try {
    // 1) 予報（天気文字列）: forecast/{area}.json から今日の天気を拾う :contentReference[oaicite:7]{index=7}
    const forecastUrl = `https://www.jma.go.jp/bosai/forecast/data/forecast/${forecastArea}.json`;
    const forecastRes = await fetch(forecastUrl, { cache: "no-store" });
    if (!forecastRes.ok) {
      const t = await forecastRes.text().catch(() => "");
      return jsonError(502, `JMA forecast fetch failed: ${forecastRes.status}`, t);
    }
    const forecastJson = await forecastRes.json();

    // かなり構造が深いので「安全に」探す（見つからなければ null）
    // よくある: [0].timeSeries[0].areas[0].weathers[0] に入っているケース
    let weatherText: string | null = null;
    try {
      const w =
        forecastJson?.[0]?.timeSeries?.[0]?.areas?.[0]?.weathers?.[0] ??
        forecastJson?.[0]?.timeSeries?.[0]?.areas?.[0]?.weathers?.[1] ??
        null;
      weatherText = typeof w === "string" ? w : null;
    } catch {
      weatherText = null;
    }

    // 2) アメダス（観測）: latest_time.txt → point/{code}/{YYYYMMDD}_{HH}.json :contentReference[oaicite:8]{index=8}
    const latestTimeRes = await fetch(
      "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt",
      { cache: "no-store" }
    );
    if (!latestTimeRes.ok) {
      const t = await latestTimeRes.text().catch(() => "");
      return jsonError(502, `JMA latest_time fetch failed: ${latestTimeRes.status}`, t);
    }
    const latestIso = (await latestTimeRes.text()).trim();
    const latestDate = new Date(latestIso);
    if (Number.isNaN(latestDate.getTime())) {
      return jsonError(500, "latest_time.txt の日時解釈に失敗しました。", latestIso);
    }

    const datePart = yyyymmdd(latestDate);
    const blockHH = floorTo3HourBlock(latestDate.getHours());
    const pointUrl = `https://www.jma.go.jp/bosai/amedas/data/point/${amedasCode}/${datePart}_${blockHH}.json`;

    const pointRes = await fetch(pointUrl, { cache: "no-store" });
    if (!pointRes.ok) {
      const t = await pointRes.text().catch(() => "");
      return jsonError(502, `JMA amedas point fetch failed: ${pointRes.status}`, t);
    }
    const pointJson = await pointRes.json();

    // pointJson は { "日時": { temp:[値,品質], wind:[値,品質], windDirection:[値,品質], precipitation10m:[値,品質], ... } } の形が多い :contentReference[oaicite:9]{index=9}
    const bestKey = pickLatestKeyLE(pointJson, latestIso) ?? Object.keys(pointJson).sort().pop() ?? null;
    const row = bestKey ? pointJson[bestKey] : null;

    const temp = row?.temp?.[0];
    const wind = row?.wind?.[0];
    const windDir = row?.windDirection?.[0];

    // 降水量はまず「10分降水量」を使う（手動取得ボタンの用途なら十分） :contentReference[oaicite:10]{index=10}
    const precip10m = row?.precipitation10m?.[0];
    const precip1h = row?.precipitation1h?.[0]; // あればこちらを優先してもOK

    const payload: WeatherPayload = {
      weather: weatherText,
      temperature_text:
        typeof temp === "number" ? String(temp) : temp != null ? String(temp) : null,
      wind_direction: typeof windDir === "string" ? windDir : windDir != null ? String(windDir) : null,
      wind_speed_text:
        typeof wind === "number" ? String(wind) : wind != null ? String(wind) : null,
      precipitation_mm:
        typeof precip1h === "number"
          ? precip1h
          : typeof precip10m === "number"
            ? precip10m
            : null,
      observed_at: toJstIsoSafe(bestKey ?? latestIso),
    };

    return NextResponse.json({ ok: true, data: payload }, { status: 200 });
  } catch (e: any) {
    return jsonError(500, "サーバ側で例外が発生しました。", e?.message ?? String(e));
  }
}
