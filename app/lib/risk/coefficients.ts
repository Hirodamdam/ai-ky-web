// app/lib/risk/coefficients.ts
import type { ThirdPartyLevel, WeatherApplied } from "./types";

export type CoeffConfig = {
  thirdParty: Record<"なし" | "少ない" | "多い", number>;
  weather: { rainWeight: number; windWeight: number; heatWeight: number; max: number };
  density: { baselineWorkers: number; weight: number; max: number };
  photo: { weight: number; min: number; max: number };
};

export const DEFAULT_COEFF: CoeffConfig = {
  thirdParty: { なし: 1.0, 少ない: 1.2, 多い: 1.5 },
  weather: { rainWeight: 0.2, windWeight: 0.1, heatWeight: 0.08, max: 1.5 },
  density: { baselineWorkers: 10, weight: 0.3, max: 1.5 },
  photo: { weight: 0.5, min: 1.0, max: 1.5 },
};

function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}

export function normalizeThirdPartyLevel(v: any): "なし" | "少ない" | "多い" {
  const t = String(v ?? "").trim();
  if (t === "多い") return "多い";
  if (t === "少ない") return "少ない";
  return "なし";
}

export function calcT(level: ThirdPartyLevel | string | null | undefined, cfg = DEFAULT_COEFF): number {
  return cfg.thirdParty[normalizeThirdPartyLevel(level)];
}

export function calcW(applied: WeatherApplied | null | undefined, cfg = DEFAULT_COEFF): number {
  if (!applied) return 1.0;
  const pr = n(applied.precipitation_mm) ?? 0;
  const ws = n(applied.wind_speed_ms) ?? 0;
  const tc = n(applied.temperature_c);

  const rainIndex = clamp(pr / 6, 0, 1);
  const windIndex = clamp(ws / 10, 0, 1);

  let heatIndex = 0;
  if (tc != null) heatIndex = clamp((tc - 28) / 5, 0, 1);

  const W = 1 + rainIndex * cfg.weather.rainWeight + windIndex * cfg.weather.windWeight + heatIndex * cfg.weather.heatWeight;
  return clamp(W, 1.0, cfg.weather.max);
}

export function calcD(workerCount: number | null | undefined, cfg = DEFAULT_COEFF): number {
  const w = n(workerCount);
  if (w == null || w <= 0) return 1.0;
  const D = 1 + (w / cfg.density.baselineWorkers) * cfg.density.weight;
  return clamp(D, 1.0, cfg.density.max);
}

export function calcI(photoScore: number | null | undefined, cfg = DEFAULT_COEFF): number {
  const s = n(photoScore);
  if (s == null) return cfg.photo.min;
  const I = 1 + clamp(s, 0, 1) * cfg.photo.weight;
  return clamp(I, cfg.photo.min, cfg.photo.max);
}
