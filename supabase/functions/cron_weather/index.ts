/// <reference lib="deno.ns" />
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function pickWeatherLabel(code: number): string {
  // Open-Meteo weathercode: https://open-meteo.com/en/docs
  if (code === 0) return "晴れ";
  if (code === 1 || code === 2) return "晴れ/くもり";
  if (code === 3) return "くもり";
  if (code === 45 || code === 48) return "霧";
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82))
    return "雨";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "雪";
  if (code >= 95) return "雷";
  return "不明";
}

function degToDir16(deg: number): string {
  const dirs = [
    "北", "北北東", "北東", "東北東",
    "東", "東南東", "南東", "南南東",
    "南", "南南西", "南西", "西南西",
    "西", "西北西", "北西", "北北西",
  ];
  const i = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[i];
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 400);

  // ===== 固定トークン認証（CRON_SECRET一致）=====
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const expected = Deno.env.get("CRON_SECRET") ?? "";

  if (!expected) return json({ error: "CRON_SECRET is not set on server" }, 500);
  if (!token || token !== expected) return json({ error: "Unauthorized" }, 401);
  // ============================================

  // ===== Supabase（Service Role）=====
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SB_URL") ?? "";
  const SERVICE_ROLE =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL) return json({ error: "SUPABASE_URL (or SB_URL) is not set" }, 500);
  if (!SERVICE_ROLE) return json({ error: "SUPABASE_SERVICE_ROLE_KEY (or SB_SERVICE_ROLE_KEY) is not set" }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ===== 重要：対象プロジェクトを決める =====
  // 方式：project_weather_current を「常に1プロジェクト固定」で更新するならここで固定
  // 例）草牟田墓地プロジェクトIDを入れる
  const PROJECT_ID = Deno.env.get("PROJECT_ID") ?? "";
  if (!PROJECT_ID) {
    return json({ error: "PROJECT_ID is not set (set it as Edge Function secret)" }, 500);
  }

  // ===== 緯度経度：projectsテーブルから取得（確実）=====
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, lat, lon")
    .eq("id", PROJECT_ID)
    .maybeSingle();

  if (pErr) return json({ error: "Failed to read projects", detail: pErr }, 500);
  if (!project) return json({ error: "Project not found", project_id: PROJECT_ID }, 404);
  if (project.lat == null || project.lon == null) {
    return json({ error: "Project lat/lon is null", project_id: PROJECT_ID }, 500);
  }

  const lat = Number(project.lat);
  const lon = Number(project.lon);
  const tz = "Asia/Tokyo";

  // ===== Open-Meteo（current）=====
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weathercode,wind_speed_10m,wind_direction_10m,precipitation` +
    `&timezone=${encodeURIComponent(tz)}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return json({ error: "Open-Meteo request failed", status: res.status, body: txt }, 502);
  }

  const data = await res.json();
  const cur = data?.current;
  if (!cur) return json({ error: "Open-Meteo response missing 'current'" }, 502);

  const temperature = Number(cur.temperature_2m);
  const weathercode = Number(cur.weathercode);
  const windSpeed = Number(cur.wind_speed_10m);
  const windDirDeg = Number(cur.wind_direction_10m);
  const precipitation = Number(cur.precipitation ?? 0);
  const observedAt = String(cur.time ?? new Date().toISOString());

  const weatherLabel = pickWeatherLabel(weathercode);
  const windDirLabel = Number.isFinite(windDirDeg) ? degToDir16(windDirDeg) : null;

  const temperature_text = Number.isFinite(temperature) ? `${temperature.toFixed(1)}℃` : null;
  const wind_speed_text = Number.isFinite(windSpeed) ? `${windSpeed.toFixed(1)} m/s` : null;
  const precipitation_mm = Number.isFinite(precipitation) ? precipitation : null;

  // ===== 最新だけ更新（project_weather_current に upsert）=====
  // 前提：project_weather_current に project_id があり、ユニーク（またはPK）になっていること
  const payload = {
    project_id: PROJECT_ID,
    observed_at: observedAt,
    weather: weatherLabel,
    weathercode,
    temperature_text,
    wind_direction: windDirLabel,
    wind_speed_text,
    precipitation_mm,
    // もし他の列があるならここに追加
  };

  const { error: uErr } = await supabase
    .from("project_weather_current")
    .upsert(payload, { onConflict: "project_id" });

  if (uErr) return json({ ok: false, error: uErr, payload }, 500);

  return json({ ok: true, updated: payload }, 200);
});
