// app/lib/risk/calcRisk.ts
import type { HazardExtractItem, RiskComputedItem, RiskContext } from "./types";
import { DEFAULT_COEFF, calcD, calcI, calcT, calcW } from "./coefficients";
import { classifyTrade } from "./tradeClassifier";
import { getTradeWeight } from "./tradeWeights";

function safeNum(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function calcRiskItem(
  item: HazardExtractItem,
  ctx: RiskContext,
  opts?: { coeff?: typeof DEFAULT_COEFF }
): RiskComputedItem {
  const coeff = opts?.coeff ?? DEFAULT_COEFF;

  const R0 = item.P * item.S;
  const T = calcT(ctx.third_party_level ?? null, coeff);
  const W = calcW(ctx.weather_applied ?? null, coeff);
  const D = calcD(ctx.worker_count ?? null, coeff);
  const I = calcI(ctx.photo_score ?? null, coeff);

  const trade = classifyTrade(ctx.work_detail ?? "");
  const G = getTradeWeight(trade, item.category);

  const Ri = Math.round(R0 * T * W * D * I * G * 100) / 100;

  return { ...item, R0, Ri, breakdown: { R0, T, W, D, I, G }, trade };
}

export function calcRiskItems(
  items: HazardExtractItem[],
  ctx: RiskContext,
  opts?: { coeff?: typeof DEFAULT_COEFF }
): RiskComputedItem[] {
  const out = (Array.isArray(items) ? items : []).map((it) => calcRiskItem(it, ctx, opts));
  out.sort((a, b) => safeNum(b.Ri) - safeNum(a.Ri));
  return out;
}
