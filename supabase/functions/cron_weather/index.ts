// supabase/functions/cron_weather/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type OpenMeteoResponse = {
  current?: {
    time?: string; // timezone=Asia/Tokyo のとき "YYYY-MM-DDTHH:mm" で返ることがある
    temperature_2m?: number; // °C
    precipitation?: number; // mm
    wind_speed_10m?: number; // m/s
    wind_direction_10m?: number; // degrees
    weather_code?: number; // WMO code
  };
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getAuthOk(req: Request) {
  const secret = Deno.env.get("CRON_SECRET") ?? "";

  // 1) Header guard
  const h = req.headers.get("x-cron-secret") ?? "";
  if (secret && h && h === secret) return true;

  // 2) Query guard
  const url = new URL(req.url);
  const q = url.searchParams.get("secret") ?? "";
  if (secret && q && q === secret) return true;

  // 3) Dev fallback (no secret configured)
  if (!secret) return true;

  return false;
}

/**
 * current.time が TZ無しで返る場合は JST として扱い、UTC ISO に正規化する
 */
function normalizeObservedAtToUtcIso(
  currentTime: string | undefined,
  fallback = new Date(),
): string {
  if (!currentTime) return fallback.toISOString();

  // 既にTZ情報あり
  if (
    currentTime.endsWith("Z") ||
    currentTime.includes("+") ||
    currentTime.includes("-")
  ) {
    const d = new Date(currentTime);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // TZ無し → JST として扱う
  const asJst = `${currentTime}+09:00`;
  const d = new Date(asJst);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return fallback.toISOString();
}

// 16方位（日本語）にする：DBの画面が「南」などの日本語なので合わせる
function degToCompass16Jp(deg: number): string {
  const dirs = [
    "北",
    "北北東",
    "北東",
    "東北東",
    "東",
    "東南東",
    "南東",
    "南南東",
    "南",
    "南南西",
    "南西",
    "西南西",
    "西",
    "西北西",
    "北西",
    "北北西",
  ];
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[idx];
}

function weatherCodeToText(code: number | undefined): string | null {
  if (code === null || code === undefined) return null;

  const map: Record<number, string> = {
    0: "快晴",
    1: "概ね晴れ",
    2: "一部曇り",
    3: "曇り",
    45: "霧",
    48: "着氷性の霧",
    51: "弱い霧雨",
    53: "霧雨",
    55: "強い霧雨",
    56: "弱い着氷性霧雨",
    57: "強い着氷性霧雨",
    61: "弱い雨",
    63: "雨",
    65: "強い雨",
    66: "弱い着氷性雨",
    67: "強い着氷性雨",
    71: "弱い雪",
    73: "雪",
    75: "強い雪",
    77: "霧雪",
    80: "弱いにわか雨",
    81: "にわか雨",
    82: "激しいにわか雨",
    85: "弱いにわか雪",
    86: "強いにわか雪",
    95: "雷雨",
    96: "雹を伴う雷雨（弱）",
    99: "雹を伴う雷雨（強）",
  };

  return map[code] ?? `天気コード:${code}`;
}

async function fetchOpenMeteoCurrent(
  lat: number,
  lon: number,
): Promise<OpenMeteoResponse> {
  const baseUrl = Deno.env.get("OPEN_METEO_BASE_URL") ??
    "https://api.open-meteo.com/v1/forecast";

  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));

  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "precipitation",
      "wind_speed_10m",
      "wind_direction_10m",
      "weather_code",
    ].join(","),
  );

  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("precipitation_unit", "mm");
  url.searchParams.set("timezone", "Asia/Tokyo");

  const res = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Open-Meteo fetch failed: ${res.status} ${res.statusText} ${text}`,
    );
  }

  return (await res.json()) as OpenMeteoResponse;
}

serve(async (req) => {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }
    if (!getAuthOk(req)) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl) throw new Error("SUPABASE_URL is missing.");
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");

    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // projects: id, lat, lon, is_active
    const { data: projects, error: pErr } = await sb
      .from("projects")
      .select("id, lat, lon, is_active")
      .eq("is_active", true);

    if (pErr) throw pErr;
    if (!projects || projects.length === 0) {
      return json({ ok: true, message: "No active projects." });
    }

    const results: Array<{ project_id: string; ok: boolean; error?: string }> =
      [];

    for (const p of projects) {
      const project_id = p.id as string;
      const lat = p.lat as number | null;
      const lon = p.lon as number | null;

      if (lat === null || lon === null) {
        results.push({ project_id, ok: false, error: "lat/lon is null" });
        continue;
      }

      try {
        const om = await fetchOpenMeteoCurrent(lat, lon);
        const c = om.current ?? {};

        const observed_at = normalizeObservedAtToUtcIso(c.time, new Date());
        const weather = weatherCodeToText(c.weather_code);

        // ✅ あなたのDB表示に合わせる（例: 16.8°C / 2.2m/s）
        const temperature_text =
          c.temperature_2m === null || c.temperature_2m === undefined
            ? null
            : `${c.temperature_2m}°C`;

        const precipitation_mm =
          c.precipitation === null || c.precipitation === undefined
            ? null
            : Number(c.precipitation);

        const wind_speed_text =
          c.wind_speed_10m === null || c.wind_speed_10m === undefined
            ? null
            : `${c.wind_speed_10m}m/s`;

        const wind_direction =
          c.wind_direction_10m === null || c.wind_direction_10m === undefined
            ? null
            : degToCompass16Jp(Number(c.wind_direction_10m));

        // ✅ 保存先テーブル project_weather_current の列に合わせる
        // updated_at は upsert 更新時に自動では変わらないため、明示的に入れる
        const row = {
          project_id,
          weather,
          temperature_text,
          wind_direction,
          wind_speed_text,
          precipitation_mm,
          observed_at,
          updated_at: new Date().toISOString(),
        };

        // ✅ 「最新値を1行で上書き」運用：project_id で upsert（project_id は PRIMARY KEY）
        const { error: wErr } = await sb
          .from("project_weather_current")
          .upsert(row, { onConflict: "project_id" });

        if (wErr) throw wErr;

        results.push({ project_id, ok: true });
      } catch (e) {
        results.push({
          project_id,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const ngCount = results.length - okCount;

    return json({
      ok: true,
      projects: results.length,
      okCount,
      ngCount,
      results,
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
