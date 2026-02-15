// app/lib/risk/calcRisk.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

export type WeatherSlot = {
  hour: 9 | 12 | 15;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg?: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
};

export type RiskBody = {
  human?: {
    work_detail?: string | null;
    hazards?: string | null;
    countermeasures?: string | null;
    third_party_level?: string | null;
    worker_count?: number | null;
  } | null;

  ai?: {
    ai_hazards?: string | null;
    ai_countermeasures?: string | null;
    ai_third_party?: string | null;
  } | null;

  weather_applied?: WeatherSlot | null;

  photos?: {
    slope_now_url?: string | null;
    slope_prev_url?: string | null;
    path_now_url?: string | null;
    path_prev_url?: string | null;
  } | null;
};

export type BreakdownItem = { score: number; reasons: string[] };

export type SummaryItem = {
  key: "weather" | "photo" | "third_party" | "workers" | "text_quality_ai";
  label: string;
  score: number;
  reason: string; // 1行（要点）
};

export type RiskOut = {
  total_human: number; // 0-100
  total_ai: number; // 0-100
  delta: number; // (ai - human) ※-100〜100の範囲に丸め
  breakdown: {
    weather: BreakdownItem;
    photo: BreakdownItem;
    third_party: BreakdownItem;
    workers: BreakdownItem;
    keyword: BreakdownItem;
    text_quality_human: BreakdownItem;
    text_quality_ai: BreakdownItem;
  };
  ai_top5: SummaryItem[];
  meta: {
    base_human: number;
    base_ai: number;
    bias_multiplier: number;

    // ✅ 正規化の上限（ここを上げると100張り付きが減る）
    max_raw_human: number;
    max_raw_ai: number;

    // デバッグ用
    raw_human: number;
    raw_ai: number;
    computed_at: string;
  };
};

function s(v: any) {
  return v == null ? "" : String(v);
}
function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function clamp(min: number, max: number, x: number) {
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}
function clamp100(x: number) {
  return clamp(0, 100, Math.round(x));
}
function clampDelta(x: number) {
  return clamp(-100, 100, Math.round(x));
}

function splitLines(text: string): string[] {
  return s(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[•・\-*]\s*/g, "").trim())
    .filter(Boolean);
}

/** ===================== 第三者 ===================== */

function normalizeThird(level: string): "多い" | "少ない" | "" {
  const t = s(level).trim();
  if (!t) return "";
  if (t.includes("多")) return "多い";
  if (t.includes("少")) return "少ない";
  return "";
}

function calcThirdParty(levelRaw: string): BreakdownItem {
  const lv = normalizeThird(levelRaw);
  if (lv === "多い") {
    return { score: 22, reasons: ["第三者：多い（立入・動線・声掛けの負荷が増える恐れ）"] };
  }
  if (lv === "少ない") {
    return { score: 10, reasons: ["第三者：少ない（接近リスクは残るため注意）"] };
  }
  return { score: 6, reasons: ["第三者：未入力（実態不明のため控えめに加点）"] };
}

/** ===================== 作業員数 ===================== */

function calcWorkers(workerCount: number | null | undefined): BreakdownItem {
  const v = n(workerCount);
  if (v == null || v <= 0) return { score: 6, reasons: ["作業員数：未入力（連絡・立入管理の負荷を見込み加点）"] };
  if (v <= 5) return { score: 6, reasons: [`作業員数：${v}人（少数でも重機・法面なら注意）`] };
  if (v <= 10) return { score: 10, reasons: [`作業員数：${v}人（接触/合図の統一が必要）`] };
  if (v <= 20) return { score: 15, reasons: [`作業員数：${v}人（立入管理/誘導の負荷が増える恐れ）`] };
  return { score: 20, reasons: [`作業員数：${v}人（多人数：合図/動線/立入規制の難度が高い恐れ）`] };
}

/** ===================== 気象 ===================== */

function calcWeather(applied: WeatherSlot | null | undefined): BreakdownItem {
  if (!applied) return { score: 0, reasons: ["気象：データなし（評価対象外）"] };

  const reasons: string[] = [];
  let score = 0;

  const pr = n(applied.precipitation_mm) ?? 0;
  const ws = n(applied.wind_speed_ms) ?? 0;
  const tc = n(applied.temperature_c);

  if (pr >= 6) {
    score += 30;
    reasons.push(`降雨：${pr}mm（大）→ 滑り/視界低下/法面不安定化の恐れ`);
  } else if (pr >= 3) {
    score += 22;
    reasons.push(`降雨：${pr}mm（中）→ 滑り/泥濘/崩落兆候の恐れ`);
  } else if (pr >= 1) {
    score += 12;
    reasons.push(`降雨：${pr}mm（小）→ 滑り/足元不良の恐れ`);
  } else {
    reasons.push(`降雨：${pr}mm`);
  }

  if (ws >= 10) {
    score += 20;
    reasons.push(`風速：${ws}m/s（強）→ 飛散/転倒/吊荷リスク増の恐れ`);
  } else if (ws >= 7) {
    score += 14;
    reasons.push(`風速：${ws}m/s（やや強）→ 養生固定/飛散対策が必要な恐れ`);
  } else if (ws >= 5) {
    score += 8;
    reasons.push(`風速：${ws}m/s（弱〜中）→ 軽量物の飛散に注意の恐れ`);
  } else {
    reasons.push(`風速：${ws}m/s`);
  }

  if (tc != null) {
    if (tc >= 30) {
      score += 8;
      reasons.push(`気温：${tc}℃（高）→ 熱中症・判断低下の恐れ`);
    } else if (tc <= 5) {
      score += 6;
      reasons.push(`気温：${tc}℃（低）→ かじかみ/判断低下/凍結の恐れ`);
    } else {
      reasons.push(`気温：${tc}℃`);
    }
  }

  const wt = s(applied.weather_text).trim();
  if (wt) {
    if (/(雷|霧|強風|暴風|大雨)/.test(wt)) {
      score += 10;
      reasons.push(`天気：${wt} → 視界/突風/急変の恐れ`);
    } else if (/雨/.test(wt)) {
      score += 5;
      reasons.push(`天気：${wt}`);
    } else {
      reasons.push(`天気：${wt}`);
    }
  }

  return { score: clamp100(score), reasons };
}

/** ===================== 写真 ===================== */

function calcPhoto(photos: RiskBody["photos"]): BreakdownItem {
  const slopeNow = s(photos?.slope_now_url).trim();
  const slopePrev = s(photos?.slope_prev_url).trim();
  const pathNow = s(photos?.path_now_url).trim();
  const pathPrev = s(photos?.path_prev_url).trim();

  const reasons: string[] = [];
  let score = 0;

  if (slopeNow && slopePrev) {
    if (slopeNow !== slopePrev) {
      score += 18;
      reasons.push("法面：前回との差分あり → 崩れ/浮石/湧水/泥濘の恐れ（要確認）");
    } else {
      score += 8;
      reasons.push("法面：前回と同一URL（変化小の可能性）※ただし現況確認は必要");
    }
  } else if (slopeNow && !slopePrev) {
    score += 10;
    reasons.push("法面：前回写真なし → 変化点比較ができず見落としの恐れ");
  } else if (!slopeNow && slopePrev) {
    score += 12;
    reasons.push("法面：今回写真なし → 現況不明のため加点（更新推奨）");
  } else {
    score += 6;
    reasons.push("法面：写真なし（評価の不確実性あり）");
  }

  if (pathNow && pathPrev) {
    if (pathNow !== pathPrev) {
      score += 14;
      reasons.push("通路：前回との差分あり → 段差/滑り/障害物/水溜りの恐れ（要確認）");
    } else {
      score += 6;
      reasons.push("通路：前回と同一URL（変化小の可能性）※ただし現況確認は必要");
    }
  } else if (pathNow && !pathPrev) {
    score += 8;
    reasons.push("通路：前回写真なし → 比較できず見落としの恐れ");
  } else if (!pathNow && pathPrev) {
    score += 10;
    reasons.push("通路：今回写真なし → 現況不明のため加点（更新推奨）");
  } else {
    score += 4;
    reasons.push("通路：写真なし（評価の不確実性あり）");
  }

  return { score: clamp100(score), reasons };
}

/** ===================== キーワード（人入力） ===================== */

function calcKeywordHuman(text: string): BreakdownItem {
  const t = s(text);

  const rules: Array<{ re: RegExp; add: number; label: string }> = [
    { re: /(バックホウ|ユンボ|重機|クレーン|玉掛|吊)/, add: 10, label: "重機/吊り" },
    { re: /(法面|斜面|のり面|高所|転落)/, add: 10, label: "法面/高所" },
    { re: /(掘削|床掘|開削|崩壊|土砂)/, add: 10, label: "掘削/崩壊" },
    { re: /(車両|搬入|運搬|交通|誘導)/, add: 8, label: "車両/交通" },
    { re: /(第三者|墓参者|通行人)/, add: 8, label: "第三者" },
  ];

  let score = 0;
  const hits: string[] = [];
  for (const r of rules) {
    if (r.re.test(t)) {
      score += r.add;
      hits.push(r.label);
    }
  }

  if (!hits.length) return { score: 0, reasons: ["キーワード：顕著な危険ワード未検出（※未入力/短文の可能性）"] };
  return { score: clamp100(score), reasons: [`キーワード：${hits.join(" / ")}（簡易加点）`] };
}

/** ===================== 文章品質 ===================== */

function countCausalLines(lines: string[]): number {
  const causalRe = /(だから|ので|ため|したので|して.*(なる|なり|となる|事故|災害|負傷)|恐れ|可能性)/;
  let c = 0;
  for (const ln of lines) if (causalRe.test(ln)) c++;
  return c;
}

function calcTextQualityHuman(haz: string, measures: string, third: string): BreakdownItem {
  const hz = splitLines(haz);
  const ms = splitLines(measures);
  const th = splitLines(third);

  const causal = countCausalLines(hz);

  let score = 0;
  const reasons: string[] = [];

  if (hz.length === 0) {
    score += 15;
    reasons.push("人入力：危険予知が未入力 → 見落としの恐れ");
  } else {
    reasons.push(`人入力：危険予知 ${hz.length}項目 / 因果らしき表現 ${causal}行`);
    if (causal < Math.min(hz.length, 3)) {
      score += 6;
      reasons.push("人入力：因果の明確さが弱い可能性（恐れ/可能性の記載不足）");
    }
  }

  if (ms.length === 0) {
    score += 10;
    reasons.push("人入力：対策が未入力 → 低減策不足の恐れ");
  } else {
    reasons.push(`人入力：対策 ${ms.length}項目`);
    if (hz.length > 0 && ms.length < Math.min(hz.length, 3)) {
      score += 6;
      reasons.push("人入力：危険予知に対して対策が不足の恐れ（1対1未満）");
    }
  }

  if (th.length === 0) {
    score += 6;
    reasons.push("人入力：第三者対策が薄い/未入力の恐れ");
  } else {
    reasons.push(`人入力：第三者対策 ${th.length}項目`);
  }

  return { score: clamp100(score), reasons };
}

function calcTextQualityAi(aiHaz: string, aiMeasures: string, aiThird: string): BreakdownItem {
  const hz = splitLines(aiHaz);
  const ms = splitLines(aiMeasures);
  const th = splitLines(aiThird);

  const causal = countCausalLines(hz);

  let score = 0;
  const reasons: string[] = [];

  const hazardExtraction = Math.min(30, hz.length * 2 + causal * 1);
  score += hazardExtraction;
  reasons.push(`AI補足：危険抽出 ${hz.length}項目 / 因果らしき表現 ${causal}行 → 抽出加点 ${hazardExtraction}`);

  if (hz.length < 8) {
    score += 14;
    reasons.push("AI補足：危険予知が8項目未満 → 不足加点（見落としの恐れ）");
  } else if (hz.length > 12) {
    score += 6;
    reasons.push("AI補足：危険予知が12項目超 → 読み落としの恐れ（整理推奨）");
  }

  if (ms.length < Math.min(hz.length, 8)) {
    score += 12;
    reasons.push("AI補足：対策が危険予知に対して不足（1対1未達の恐れ）");
  } else {
    reasons.push(`AI補足：対策 ${ms.length}項目（危険予知に対応できている可能性）`);
  }

  if (th.length < 4) {
    score += 10;
    reasons.push("AI補足：第三者対策が4項目未満 → 不足加点");
  } else {
    reasons.push(`AI補足：第三者対策 ${th.length}項目`);
  }

  if (causal < Math.min(hz.length, 6)) {
    score += 8;
    reasons.push("AI補足：因果/恐れ表現が薄い可能性 → 加点（表現補強推奨）");
  }

  return { score: clamp100(score), reasons };
}

/** ===================== TOP5（AI側要因のみ） ===================== */

function buildAiTop5(breakdown: RiskOut["breakdown"]): SummaryItem[] {
  const items: SummaryItem[] = [
    { key: "weather", label: "気象（適用枠）", score: breakdown.weather.score, reason: breakdown.weather.reasons[0] || "気象リスク" },
    { key: "photo", label: "写真（差分/不足）", score: breakdown.photo.score, reason: breakdown.photo.reasons[0] || "写真リスク" },
    { key: "third_party", label: "第三者", score: breakdown.third_party.score, reason: breakdown.third_party.reasons[0] || "第三者リスク" },
    { key: "workers", label: "作業員数", score: breakdown.workers.score, reason: breakdown.workers.reasons[0] || "作業員数リスク" },
    { key: "text_quality_ai", label: "AI補足（文章評価）", score: breakdown.text_quality_ai.score, reason: breakdown.text_quality_ai.reasons[0] || "AI補足リスク" },
  ];

  // 0点は後ろへ、同点は順序維持
  const sorted = [...items].sort((a, b) => b.score - a.score);
  return sorted.slice(0, 5);
}

/** ===================== 正規化（100張り付き対策の核心） ===================== */

/**
 * ✅ ここを調整すると挙動が変わります
 * - max_raw_ai を上げるほど「100張り付き」は減る（ただし全体が低めに出る）
 * - bias_multiplier はAIを厳しめにする係数（1.08 なら +8%）
 *
 * いまのテスト（raw_ai ≈ 155 前後）だと、max_raw_ai=190 で total_ai が90前後になる想定
 */
const DEFAULTS = {
  baseHuman: 12,
  baseAi: 18,
  biasMultiplier: 1.08,

  // ✅ 人側は今のスケール感（あなたの画面：human 76）を維持しやすい
  maxRawHuman: 140,

  // ✅ AI側は張り付き回避のため少し上げる（100になりにくくする）
  maxRawAi: 190,
};

function normalizeTo100(raw: number, maxRaw: number) {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (!Number.isFinite(maxRaw) || maxRaw <= 0) return 0;
  return clamp100((raw / maxRaw) * 100);
}

/** ===================== 公開関数 ===================== */

export function calcRisk(body: RiskBody): RiskOut {
  const human = body.human ?? {};
  const ai = body.ai ?? {};
  const photos = body.photos ?? {};
  const applied = body.weather_applied ?? null;

  const third = calcThirdParty(s(human?.third_party_level));
  const workers = calcWorkers(human?.worker_count ?? null);
  const weather = calcWeather(applied);
  const photo = calcPhoto(photos);

  const humanText = `${s(human?.work_detail)}\n${s(human?.hazards)}\n${s(human?.countermeasures)}\n${s(human?.third_party_level)}`;
  const keyword = calcKeywordHuman(humanText);

  const tqHuman = calcTextQualityHuman(s(human?.hazards), s(human?.countermeasures), "");
  const tqAi = calcTextQualityAi(s(ai?.ai_hazards), s(ai?.ai_countermeasures), s(ai?.ai_third_party));

  const baseHuman = DEFAULTS.baseHuman;
  const baseAi = DEFAULTS.baseAi;

  // raw（合計点）
  const rawHuman = baseHuman + workers.score + third.score + weather.score + keyword.score + tqHuman.score;
  const rawAi = baseAi + workers.score + third.score + weather.score + photo.score + tqAi.score;

  // ✅ AIは厳しめ係数（ただし最後に正規化するので100張り付きしにくい）
  const biasedAi = rawAi * DEFAULTS.biasMultiplier;

  // ✅ 0-100 へ正規化
  const totalHuman = normalizeTo100(rawHuman, DEFAULTS.maxRawHuman);
  const totalAi = normalizeTo100(biasedAi, DEFAULTS.maxRawAi);

  const out: RiskOut = {
    total_human: totalHuman,
    total_ai: totalAi,
    delta: clampDelta(totalAi - totalHuman),
    breakdown: {
      weather,
      photo,
      third_party: third,
      workers,
      keyword,
      text_quality_human: tqHuman,
      text_quality_ai: tqAi,
    },
    ai_top5: [],
    meta: {
      base_human: baseHuman,
      base_ai: baseAi,
      bias_multiplier: DEFAULTS.biasMultiplier,
      max_raw_human: DEFAULTS.maxRawHuman,
      max_raw_ai: DEFAULTS.maxRawAi,
      raw_human: Math.round(rawHuman * 10) / 10,
      raw_ai: Math.round(rawAi * 10) / 10,
      computed_at: new Date().toISOString(),
    },
  };

  out.ai_top5 = buildAiTop5(out.breakdown);
  return out;
}
