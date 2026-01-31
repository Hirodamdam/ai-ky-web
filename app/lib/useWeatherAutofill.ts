"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type WeatherPayload = {
  date: string;
  lat: number;
  lon: number;
  weather: string | null;
  weathercode: number | null;
  temperature_text: string | null;
  wind_direction: string | null;
  wind_speed_text: string | null;
  precipitation_mm: number | null;
  fetched_at: string;
  source: string;
  units?: Record<string, string>;
};

type UseWeatherAutofillArgs = {
  lat: number | null;
  lon: number | null;
  date: string | null; // YYYY-MM-DD
  enabled?: boolean;

  /**
   * 「フォームに反映する」実装は呼び出し元に寄せる
   * 例: setForm((p)=>({...p, weather: w.weather, ...}))
   */
  apply: (w: WeatherPayload) => void;

  /**
   * 既にユーザーが入力した値を上書きしたくない場合に使う
   * true を返した項目は、その項目だけスキップする運用も可能
   * 今回は Hook 側で “全部反映” なので、必要なら呼び出し側で分岐してください
   */
};

export function useWeatherAutofill({ lat, lon, date, enabled = true, apply }: UseWeatherAutofillArgs) {
  const [status, setStatus] = useState<{ type: "idle" | "loading" | "ok" | "error"; message?: string }>({
    type: "idle",
  });
  const [last, setLast] = useState<WeatherPayload | null>(null);

  const key = useMemo(() => {
    if (!enabled) return null;
    if (lat == null || lon == null || !date) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return `${lat.toFixed(6)}:${lon.toFixed(6)}:${date}`;
  }, [enabled, lat, lon, date]);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  async function fetchAndApply(explicit = false) {
    if (!key || lat == null || lon == null || !date) return;

    // 連打・変更に強いように中断
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      setStatus({ type: "loading", message: explicit ? "天気を取得中…" : undefined });

      const url = new URL("/api/weather", window.location.origin);
      url.searchParams.set("lat", String(lat));
      url.searchParams.set("lon", String(lon));
      url.searchParams.set("date", date);

      const res = await fetch(url.toString(), { cache: "no-store", signal: ac.signal });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`weather fetch failed (${res.status}) ${txt.slice(0, 120)}`);
      }

      const w: WeatherPayload = await res.json();

      setLast(w);
      apply(w);
      setStatus({ type: "ok", message: explicit ? "天気を反映しました" : undefined });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setStatus({ type: "error", message: e?.message ?? "天気取得に失敗しました" });
    }
  }

  // key が変わったら自動取得（300ms デバウンス）
  useEffect(() => {
    if (!key) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(() => {
      fetchAndApply(false);
    }, 300);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    status,
    last,
    refetch: () => fetchAndApply(true),
  };
}
