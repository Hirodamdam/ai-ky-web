// app/projects/[id]/ky/_components/KyWeatherSlots.tsx
"use client";

import React from "react";

export type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso?: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
  weather_code?: number | null;
};

function degToDirJp(deg: number | null | undefined): string {
  if (deg == null || Number.isNaN(Number(deg))) return "—";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  return dirs[Math.round(d / 45) % 8];
}

export default function KyWeatherSlots(props: {
  slots: WeatherSlot[];
  selectedHour: 9 | 12 | 15 | null;
  appliedHour: 9 | 12 | 15 | null;
  onSelect: (hour: 9 | 12 | 15) => void;
  onApply: () => void;
  disabled?: boolean;
}) {
  const { slots, selectedHour, appliedHour, onSelect, onApply, disabled } = props;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>
        <button
          type="button"
          className={`rounded-lg px-3 py-1 text-sm border ${
            disabled ? "bg-slate-100 text-slate-400 border-slate-200" : "bg-white text-slate-800 border-slate-300 hover:bg-slate-50"
          }`}
          onClick={onApply}
          disabled={disabled || !selectedHour}
        >
          気象を適用
        </button>
      </div>

      {slots.length ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {slots.map((slot) => {
            const isSelected = selectedHour === slot.hour;
            const isApplied = appliedHour === slot.hour;
            const cls = isApplied
              ? "border-emerald-300 bg-emerald-50"
              : isSelected
              ? "border-blue-300 bg-blue-50"
              : "border-slate-200 bg-slate-50";

            return (
              <button
                type="button"
                key={slot.hour}
                className={`text-left rounded-lg border p-3 ${cls} hover:opacity-95`}
                onClick={() => onSelect(slot.hour)}
                disabled={disabled}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
                  {isApplied ? (
                    <div className="text-xs font-semibold text-emerald-700">適用</div>
                  ) : isSelected ? (
                    <div className="text-xs font-semibold text-blue-700">選択中</div>
                  ) : null}
                </div>

                <div className="mt-1 text-sm text-slate-700">{slot.weather_text || "（不明）"}</div>

                <div className="mt-2 text-xs text-slate-600 space-y-1">
                  <div>気温：{slot.temperature_c ?? "—"} ℃</div>
                  <div>
                    風：{degToDirJp(slot.wind_direction_deg)} {slot.wind_speed_ms != null ? `${slot.wind_speed_ms} m/s` : "—"}
                  </div>
                  <div>降水：{slot.precipitation_mm ?? "—"} mm</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-sm text-slate-600">気象データがありません。</div>
      )}

      <div className="text-xs text-slate-500">※「適用」した枠がレビューのリスク評価に使われます。</div>
    </div>
  );
}
