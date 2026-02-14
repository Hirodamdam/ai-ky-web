// app/lib/risk/types.ts
export type RiskScale1to5 = 1 | 2 | 3 | 4 | 5;

export type AccidentCategory =
  | "墜落・転落"
  | "飛来・落下"
  | "崩壊・土砂"
  | "接触・挟まれ"
  | "交通・第三者"
  | "転倒"
  | "熱中症"
  | "感電"
  | "有害物"
  | "火災・爆発"
  | "その他";

export type ThirdPartyLevel = "" | "なし" | "少ない" | "多い";

export type WeatherApplied = {
  hour: 9 | 12 | 15;
  weather_text?: string | null;
  temperature_c?: number | null;
  wind_direction_deg?: number | null;
  wind_speed_ms?: number | null;
  precipitation_mm?: number | null;
};

export type RiskContext = {
  third_party_level?: ThirdPartyLevel | string | null;
  worker_count?: number | null;
  weather_applied?: WeatherApplied | null;
  photo_score?: number | null; // 0..1
  work_detail?: string | null;
};

export type HazardExtractItem = {
  hazard: string;
  countermeasure: string;
  P: RiskScale1to5;
  S: RiskScale1to5;
  category: AccidentCategory;
};

export type RiskBreakdown = {
  R0: number;
  T: number;
  W: number;
  D: number;
  I: number;
  G: number;
};

export type RiskComputedItem = HazardExtractItem & {
  R0: number;
  Ri: number;
  breakdown: RiskBreakdown;
  trade?: string;
};
