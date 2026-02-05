// app/api/weather/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  lat?: number;
  lon?: number;
  date?: string; // YYYY-MM-DD（JST）
};

type Slot = {
  hour: 9 | 12 | 15;
  time_iso: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
};

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function s(v: any): string {
  if (v == null) return "";
  return String(v);
}

function weatherTextFromCode(code: number | null): string {
  if (code == null) return "（不明）";
  // Open-Meteo weathercode のざっくり分類（現場用途）
  if (code === 0) return "快晴";
  if (code === 1 || code === 2) return "概ね晴れ";
  if (code === 3) return "くもり";
  if (code === 45 || code === 48) return "霧";
  if (code >= 51 && code <= 57) return "霧雨";
  if (code >= 61 && code <= 67) return "雨";
  if (code >= 71 && code <= 77) return "雪";
  if (code >= 80 && code <= 82) return "にわか雨";
  if (code >= 85 && code <= 86) return "にわか雪";
  if (code === 95) return "雷雨";
  if (code === 96 || code === 99) return "激しい雷雨";
  return `天気コード${code}`;
}

async function getSlots(lat: number, lon: number, date: string): Promise<Slot[]> {
  // timezone=Asia/Tokyo で time が JST になる
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&hourly=temperature_2m,precipitation,windspeed_10m,winddirection_10m,weathercode` +
    `&start_date=${encodeURIComponent(date)}` +
    `&end_date=${encodeURIComponent(date)}` +
    `&timezone=Asia%2FTokyo`;

  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(j?.reason || j?.error || "気象APIに失敗しました");
  }

  const time: string[] = Array.isArray(j?.hourly?.time) ? j.hourly.time : [];
  const t2m: any[] = Array.isArray(j?.hourly?.temperature_2m) ? j.hourly.temperature_2m : [];
  const pr: any[] = Array.isArray(j?.hourly?.precipitation) ? j.hourly.precipitation : [];
  const ws: any[] = Array.isArray(j?.hourly?.windspeed_10m) ? j.hourly.windspeed_10m : [];
  const wd: any[] = Array.isArray(j?.hourly?.winddirection_10m) ? j.hourly.winddirection_10m : [];
  const wc: any[] = Array.isArray(j?.hourly?.weathercode) ? j.hourly.weathercode : [];

  const wantHours: Array<9 | 12 | 15> = [9, 12, 15];

  const slots: Slot[] = [];
  for (const h of wantHours) {
    // time は "YYYY-MM-DDTHH:00" 形式（JST）
    const idx = time.findIndex((x) => x?.includes(`T${String(h).padStart(2, "0")}:00`));
    if (idx < 0) {
      slots.push({
        hour: h,
        time_iso: `${date}T${String(h).padStart(2, "0")}:00`,
        weather_text: "（未取得）",
        temperature_c: null,
        wind_direction_deg: null,
        wind_speed_ms: null,
        precipitation_mm: null,
        weather_code: null,
      });
      continue;
    }

    const tempC = num(t2m[idx]);
    const precMm = num(pr[idx]);
    const windKmh = num(ws[idx]); // open-meteo は km/h
    const windMs = windKmh == null ? null : Math.round((windKmh / 3.6) * 10) / 10; // m/s へ
    const windDeg = num(wd[idx]);
    const code = num(wc[idx]);

    slots.push({
      hour: h,
      time_iso: s(time[idx]),
      weather_text: weatherTextFromCode(code),
      temperature_c: tempC,
      wind_direction_deg: windDeg,
      wind_speed_ms: windMs,
      precipitation_mm: precMm,
      weather_code: code,
    });
  }

  return slots;
}

function readBodyFromReq(req: Request): Promise<Body> {
  return req.json().catch(() => ({} as Body));
}

export async function POST(req: Request) {
  try {
    const body = await readBodyFromReq(req);

    const lat = num(body.lat);
    const lon = num(body.lon);
    const date = s(body.date).trim();

    if (lat == null || lon == null) {
      return NextResponse.json({ error: "lat/lon が未設定です" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date は YYYY-MM-DD で指定してください" }, { status: 400 });
    }

    const slots = await getSlots(lat, lon, date);
    return NextResponse.json({ slots });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "気象取得に失敗しました" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = num(searchParams.get("lat"));
    const lon = num(searchParams.get("lon"));
    const date = s(searchParams.get("date")).trim();

    if (lat == null || lon == null) {
      return NextResponse.json({ error: "lat/lon が未設定です" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date は YYYY-MM-DD で指定してください" }, { status: 400 });
    }

    const slots = await getSlots(lat, lon, date);
    return NextResponse.json({ slots });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "気象取得に失敗しました" }, { status: 500 });
  }
}
