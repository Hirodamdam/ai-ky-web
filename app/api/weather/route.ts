// app/api/weather/route.ts
import { NextResponse } from "next/server";

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

function ymdJst(d: Date): string {
  // JST基準のYYYY-MM-DD
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  // ymd は YYYY-MM-DD 前提
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const utc = Date.UTC(y, m - 1, d); // 00:00 UTC
  const next = new Date(utc + days * 24 * 60 * 60 * 1000);
  // ここは UTC の日付でOK（ymdは暦日指定に使うだけ）
  const yy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function weatherCodeToJa(code: number | null | undefined): string {
  if (code == null || !Number.isFinite(code)) return "不明";
  // Open-Meteo weathercode: https://open-meteo.com/en/docs
  const c = Number(code);

  if (c === 0) return "快晴";
  if (c === 1) return "晴れ";
  if (c === 2) return "薄曇り";
  if (c === 3) return "曇り";

  if (c === 45 || c === 48) return "霧";

  if (c === 51 || c === 53 || c === 55) return "霧雨";
  if (c === 56 || c === 57) return "着氷性の霧雨";

  if (c === 61 || c === 63 || c === 65) return "雨";
  if (c === 66 || c === 67) return "着氷性の雨";

  if (c === 71 || c === 73 || c === 75) return "雪";
  if (c === 77) return "霰";

  if (c === 80 || c === 81 || c === 82) return "にわか雨";
  if (c === 85 || c === 86) return "にわか雪";

  if (c === 95) return "雷雨";
  if (c === 96 || c === 99) return "ひょうを伴う雷雨";

  return `天気コード${c}`;
}

function pickNearestIndex(times: string[], targetIso: string): number | null {
  if (!Array.isArray(times) || times.length === 0) return null;
  const exact = times.indexOf(targetIso);
  if (exact >= 0) return exact;

  // 近い時刻を探す（念のため）
  const t = new Date(targetIso).getTime();
  if (!Number.isFinite(t)) return null;

  let bestIdx = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const ti = new Date(times[i]).getTime();
    if (!Number.isFinite(ti)) continue;
    const diff = Math.abs(ti - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return Number.isFinite(bestDiff) ? bestIdx : null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const lat = searchParams.get("lat");
    const lon = searchParams.get("lon");
    const date = searchParams.get("date"); // YYYY-MM-DD（任意）

    if (!lat || !lon) {
      return NextResponse.json({ error: "lat/lon required" }, { status: 400 });
    }

    const targetDate =
      date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ymdJst(new Date());

    // ✅ Open-Meteo の end_date は排他的に扱われるので「翌日」を指定する
    const endDate = addDaysYmd(targetDate, 1);

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("timezone", "Asia/Tokyo");

    // ✅ 指定日（0:00〜23:00）を確実に含める
    url.searchParams.set("start_date", targetDate);
    url.searchParams.set("end_date", endDate);

    url.searchParams.set(
      "hourly",
      [
        "temperature_2m",
        "precipitation",
        "windspeed_10m",
        "winddirection_10m",
        "weathercode",
      ].join(",")
    );

    // 風速単位を m/s に揃える
    url.searchParams.set("windspeed_unit", "ms");
    url.searchParams.set("temperature_unit", "celsius");
    url.searchParams.set("precipitation_unit", "mm");

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: "open-meteo fetch failed", status: res.status },
        { status: 500 }
      );
    }

    const json = await res.json();

    const times: string[] = json?.hourly?.time ?? [];
    const temp: (number | null)[] = json?.hourly?.temperature_2m ?? [];
    const precip: (number | null)[] = json?.hourly?.precipitation ?? [];
    const windMs: (number | null)[] = json?.hourly?.windspeed_10m ?? [];
    const windDeg: (number | null)[] = json?.hourly?.winddirection_10m ?? [];
    const code: (number | null)[] = json?.hourly?.weathercode ?? [];

    const hours: (9 | 12 | 15)[] = [9, 12, 15];

    const slots: Slot[] = hours.map((h) => {
      const hh = String(h).padStart(2, "0");
      // Asia/Tokyo の hourly time は "YYYY-MM-DDTHH:00" 形式
      const targetIso = `${targetDate}T${hh}:00`;
      const idx = pickNearestIndex(times, targetIso);

      const c = idx == null ? null : (code[idx] ?? null);

      return {
        hour: h,
        time_iso: idx == null ? targetIso : (times[idx] ?? targetIso),
        weather_text: weatherCodeToJa(c),
        temperature_c:
          idx == null ? null : typeof temp[idx] === "number" ? temp[idx] : null,
        wind_direction_deg:
          idx == null ? null : typeof windDeg[idx] === "number" ? windDeg[idx] : null,
        wind_speed_ms:
          idx == null ? null : typeof windMs[idx] === "number" ? windMs[idx] : null,
        precipitation_mm:
          idx == null ? null : typeof precip[idx] === "number" ? precip[idx] : null,
        weather_code: c,
      };
    });

    return NextResponse.json({
      date: targetDate,
      lat: Number(lat),
      lon: Number(lon),
      slots,
      raw: {
        has_hourly: Array.isArray(times) && times.length > 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "unexpected error" },
      { status: 500 }
    );
  }
}
