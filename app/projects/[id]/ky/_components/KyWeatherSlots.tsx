"use client";

import React, { useMemo } from "react";

type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
};

type Props = {
  title?: string;
  slots?: WeatherSlot[] | null;
  loading?: boolean;
  note?: string;
};

function degToCompassJa(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "";
  const d = ((deg % 360) + 360) % 360;
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
  const idx = Math.round(d / 22.5) % 16;
  return dirs[idx];
}

function msToKmhText(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const kmh = ms * 3.6;
  const v = Math.round(kmh * 10) / 10;
  return v % 1 === 0 ? String(Math.round(v)) : String(v);
}

function dash(v: any) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export default function KyWeatherSlots({
  title = "予報（9:00 / 12:00 / 15:00）",
  slots,
  loading,
  note = "※ この横並び表示は自動取得です（作業日変更・強制再取得で更新）",
}: Props) {
  const byHour = useMemo(() => {
    const m = new Map<number, WeatherSlot>();
    (slots ?? []).forEach((s) => {
      if (s && (s.hour === 9 || s.hour === 12 || s.hour === 15)) m.set(s.hour, s);
    });
    return m;
  }, [slots]);

  const renderSlotValue = (s: WeatherSlot | null) => {
    if (!s) return <div style={{ color: "#6b7280", fontSize: 12 }}>—</div>;

    const wd = degToCompassJa(s.wind_direction_deg);
    const ws = msToKmhText(s.wind_speed_ms);
    const t = s.temperature_c == null ? "" : `${Math.round(s.temperature_c)}℃`;
    const p =
      s.precipitation_mm == null || !Number.isFinite(s.precipitation_mm)
        ? ""
        : `${Math.round(Number(s.precipitation_mm) * 10) / 10}mm`;

    return (
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "#111827" }}>{dash(s.weather_text)}</div>
        <div style={{ fontSize: 12, color: "#111827" }}>気温：{t || "—"}</div>
        <div style={{ fontSize: 12, color: "#111827" }}>
          風：{wd || "—"} {ws ? `${ws}km/h` : ""}
        </div>
        <div style={{ fontSize: 12, color: "#111827" }}>降水：{p || "—"}</div>
      </div>
    );
  };

  return (
    <div className="kywx" style={{ marginTop: 10 }}>
      {/* 印刷/PDFでも同じ3枠を安定表示 */}
      <style jsx global>{`
        @media print {
          .kywx-grid {
            gap: 6px !important;
          }
          .kywx-card {
            break-inside: avoid;
            page-break-inside: avoid;
            background: white !important;
          }
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>{title}</div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: loading ? "#111827" : "#6b7280", fontWeight: 700 }}>
          {loading ? "取得中…" : "—"}
        </span>
      </div>

      <div
        className="kywx-grid"
        style={{
          marginTop: 8,
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {[9, 12, 15].map((h) => {
          const s = (byHour.get(h) as WeatherSlot | undefined) ?? null;
          return (
            <div
              key={h}
              className="kywx-card"
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 12,
                background: "#f9fafb",
                minHeight: 96,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>{h}:00</div>
              {renderSlotValue(s)}
            </div>
          );
        })}
      </div>

      {note ? <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>{note}</div> : null}
    </div>
  );
}
