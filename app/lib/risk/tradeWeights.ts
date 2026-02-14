// app/lib/risk/tradeWeights.ts
import type { AccidentCategory } from "./types";

export const TRADE_CATEGORY_WEIGHTS: Record<string, Partial<Record<AccidentCategory, number>>> = {
  交通規制: { "交通・第三者": 1.3, "接触・挟まれ": 1.1 },
  法面: { "墜落・転落": 1.4, "崩壊・土砂": 1.35, 転倒: 1.15 },
  土工: { "崩壊・土砂": 1.25, "接触・挟まれ": 1.15 },
  管布設: { "崩壊・土砂": 1.15, "接触・挟まれ": 1.2, 転倒: 1.1 },
  舗装: { "交通・第三者": 1.15, 転倒: 1.1, 有害物: 1.05 },
  橋梁: { "墜落・転落": 1.2, "飛来・落下": 1.15 },
  トンネル: { 有害物: 1.2, "飛来・落下": 1.15, "火災・爆発": 1.1 },
  解体: { "飛来・落下": 1.25, "接触・挟まれ": 1.2, "墜落・転落": 1.15 },
};

export function getTradeWeight(trade: string, category: AccidentCategory): number {
  const t = (trade || "").trim();
  if (!t) return 1.0;
  const map = TRADE_CATEGORY_WEIGHTS[t];
  if (!map) return 1.0;
  const v = map[category];
  return typeof v === "number" && Number.isFinite(v) ? v : 1.0;
}
