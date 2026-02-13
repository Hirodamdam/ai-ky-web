// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type WeatherSlot = {
  hour: 9 | 12 | 15;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg?: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
};

type Body = {
  work_detail?: string | null;
  hazards?: string | null;
  countermeasures?: string | null;
  third_party_level?: string | null; // "多い" | "少ない" | etc
  worker_count?: number | null;

  weather_slots?: WeatherSlot[] | null;

  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function n(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function clampText(text: string, max = 1400) {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}

type WeatherRisk = {
  flags: string[];
  summary: string;
  hints: string[];
};

function analyzeWeather(slots: WeatherSlot[] | null | undefined): WeatherRisk {
  if (!slots || slots.length === 0) return { flags: [], summary: "気象データなし", hints: [] };

  const winds = slots.map((x) => n(x.wind_speed_ms)).filter((x): x is number => x != null);
  const rains = slots.map((x) => n(x.precipitation_mm)).filter((x): x is number => x != null);
  const temps = slots.map((x) => n(x.temperature_c)).filter((x): x is number => x != null);

  const maxWind = winds.length ? Math.max(...winds) : null;
  const maxRain = rains.length ? Math.max(...rains) : null;
  const minTemp = temps.length ? Math.min(...temps) : null;
  const maxTemp = temps.length ? Math.max(...temps) : null;

  const flags: string[] = [];
  const hints: string[] = [];

  // ✅ しきい値は「厳しめ」寄り（注意喚起を強く出す）
  if (maxWind != null && maxWind >= 10) {
    flags.push("強風");
    hints.push("強風の恐れ：飛散・転倒（養生固定、資材整理、立入規制）");
    hints.push("強風の恐れ：吊荷/高所は中止・停止基準を事前共有");
  } else if (maxWind != null && maxWind >= 7) {
    flags.push("やや強風");
    hints.push("風の恐れ：シート/看板/軽量資材の固定・飛散物点検");
  }

  if (maxRain != null && maxRain >= 3) {
    flags.push("雨");
    hints.push("雨の恐れ：滑り・視界低下（滑り止め、照明、誘導強化）");
    hints.push("雨の恐れ：法面/掘削の崩落兆候（湧水/クラック）重点巡視");
  } else if (maxRain != null && maxRain >= 1) {
    flags.push("小雨");
    hints.push("小雨の恐れ：歩行帯確保・通路清掃・滑り止め");
  }

  if (minTemp != null && minTemp <= 5) {
    flags.push("低温");
    hints.push("低温の恐れ：防寒・凍結/結露による滑り・体調不良に注意");
  }
  if (maxTemp != null && maxTemp >= 30) {
    flags.push("高温");
    hints.push("高温の恐れ：熱中症（休憩/水分塩分/声掛け）強化");
  }
  if (minTemp != null && maxTemp != null && maxTemp - minTemp >= 10) {
    flags.push("寒暖差");
    hints.push("寒暖差の恐れ：服装調整・体調確認（声掛け）追加");
  }

  const summaryParts: string[] = [];
  if (maxWind != null) summaryParts.push(`最大風速${maxWind.toFixed(1)}m/s`);
  if (maxRain != null) summaryParts.push(`最大降水${maxRain.toFixed(1)}mm`);
  if (minTemp != null && maxTemp != null) summaryParts.push(`気温${minTemp.toFixed(0)}〜${maxTemp.toFixed(0)}℃`);

  return { flags, summary: summaryParts.join(" / ") || "気象データあり", hints };
}

function analyzePhotoDiff(body: Body): string[] {
  const notes: string[] = [];

  const slopeNow = s(body.slope_photo_url).trim();
  const slopePrev = s(body.slope_prev_photo_url).trim();
  const pathNow = s(body.path_photo_url).trim();
  const pathPrev = s(body.path_prev_photo_url).trim();

  const slopeChanged = slopeNow && slopePrev && slopeNow !== slopePrev;
  const pathChanged = pathNow && pathPrev && pathNow !== pathPrev;

  if (slopeChanged) notes.push("法面：前回との差分の可能性（崩れ/浮石/泥濘/湧水を要確認）");
  if (pathChanged) notes.push("通路：前回との差分の可能性（段差/滑り/障害物/水溜りを要確認）");

  if (slopeNow && !slopePrev) notes.push("法面：前回写真なし（変化点の見落としの恐れ）");
  if (!slopeNow && slopePrev) notes.push("法面：今回写真なし（最終確認不足の恐れ）");

  if (pathNow && !pathPrev) notes.push("通路：前回写真なし（変化点の見落としの恐れ）");
  if (!pathNow && pathPrev) notes.push("通路：今回写真なし（最終確認不足の恐れ）");

  return notes;
}

function safeParseJson(v: string): any | null {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function splitLines(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^\s*[-・●]\s*/g, "").trim())
    .filter(Boolean);
}

function toBullet(items: string[], limit?: number) {
  const out: string[] = [];
  for (const it of items) {
    const t = (it || "").trim();
    if (!t) continue;
    out.push(`- ${t}`);
    if (limit && out.length >= limit) break;
  }
  return out.join("\n");
}

function ensureCausal(line: string): { ok: boolean; fixed: string } {
  const t = (line || "").trim();
  if (!t) return { ok: false, fixed: "" };

  // ✅ 例：『○○だから → ○○が起こる恐れ』を必須化
  const ok =
    /だから\s*→\s*.+(恐れ|可能性)/.test(t) ||
    /ため\s*→\s*.+(恐れ|可能性)/.test(t) ||
    /ので\s*→\s*.+(恐れ|可能性)/.test(t);

  if (ok) return { ok: true, fixed: t };

  // 既存文を「因果」に寄せる（断定は禁止 → 恐れ/可能性に統一）
  const fixed = `${t} だから → 不安全行動/事故につながる恐れ`;
  return { ok: false, fixed };
}

function normalizeProbabilistic(text: string) {
  // 断定を避けたい（現場文書）：強すぎる断定語を弱める
  return (text || "")
    .replace(/必ず(?!\s*→)/g, "可能性がある")
    .replace(/絶対/g, "恐れがある")
    .replace(/起こる(?!恐れ|可能性)/g, "起こる恐れ")
    .replace(/発生する(?!恐れ|可能性)/g, "発生する恐れ")
    .replace(/危険である/g, "危険となる恐れがある");
}

function buildFallbackHazards(opts: {
  hasSlope: boolean;
  hasHeavy: boolean;
  thirdPartyLevel: string;
  weatherFlags: string[];
  workerCount: number | null;
  hasPhotoNotes: boolean;
}): string[] {
  const items: string[] = [];

  // 法面
  if (opts.hasSlope) {
    items.push("法面での作業がある だから → 浮石/崩土で転倒・落石が起こる恐れ");
    items.push("法面で足場が不安定になりやすい だから → 滑落・墜落が起こる恐れ");
    items.push("湧水/泥濘の変化に気づきにくい だから → 小崩落に巻き込まれる恐れ");
  }

  // 重機（汎用）
  if (opts.hasHeavy) {
    items.push("重機の旋回半径内に人が入り得る だから → 接触・挟まれが起こる恐れ");
    items.push("吊荷/積載物が揺れやすい だから → 落下・飛来が起こる恐れ");
  } else {
    items.push("資材運搬や手作業で姿勢が崩れやすい だから → 腰痛悪化・転倒が起こる恐れ");
  }

  // 天候
  if (opts.weatherFlags.includes("雨") || opts.weatherFlags.includes("小雨")) {
    items.push("降雨で路面・法面が滑りやすい だから → 転倒・滑落が起こる恐れ");
    items.push("雨で視界や足元確認が甘くなる だから → つまずき・接触が起こる恐れ");
  }
  if (opts.weatherFlags.includes("強風") || opts.weatherFlags.includes("やや強風")) {
    items.push("強風で養生・資材が飛散しやすい だから → 飛来物で負傷が起こる恐れ");
  }
  if (opts.weatherFlags.includes("低温")) {
    items.push("低温で手がかじかむ だから → 操作ミス・転倒が起こる恐れ");
  }
  if (opts.weatherFlags.includes("高温")) {
    items.push("高温で疲労・脱水が出やすい だから → 判断低下で事故が起こる恐れ");
  }

  // 墓参者（第三者）
  if (opts.thirdPartyLevel === "多い") {
    items.push("墓参者が作業帯に接近し得る だから → 接触・転倒に巻き込む恐れ");
    items.push("説明不足で立入が発生し得る だから → 立入事故が起こる恐れ");
  } else {
    items.push("第三者が少なくても突発的に接近し得る だから → 接触事故が起こる恐れ");
  }

  // 作業員数
  if (opts.workerCount != null && opts.workerCount >= 6) {
    items.push("作業員数が多く同時作業になりやすい だから → 合図不統一で接触が起こる恐れ");
    items.push("人の動線が交錯しやすい だから → つまずき・転倒が起こる恐れ");
  }

  // 写真差分
  if (opts.hasPhotoNotes) {
    items.push("現況変化の見落としが起こり得る だから → 不意の段差/滑りで転倒が起こる恐れ");
  }

  // 最後の保険
  items.push("慣れで指差呼称が省略されやすい だから → 取り違え・誤操作が起こる恐れ");

  // 重複を軽く排除
  const uniq: string[] = [];
  for (const x of items) {
    if (!uniq.some((u) => u === x)) uniq.push(x);
  }
  return uniq;
}

function buildFallbackCounter(hazardLine: string) {
  // hazardLine は「○○だから → ○○が起こる恐れ」
  // 対策は短文で「恐れを下げる行動」
  if (/墜落|滑落/.test(hazardLine)) return "足場/歩行帯を確保し、親綱/墜落制止用器具の使用を徹底する";
  if (/崩土|崩落|落石|浮石/.test(hazardLine)) return "法面の変状（浮石/クラック/湧水）を事前巡視し、危険時は立入禁止・作業中止とする";
  if (/挟まれ|接触/.test(hazardLine)) return "重機旋回/作業半径を区画し、合図者を固定して合図統一・立入管理を行う";
  if (/飛散|飛来|落下/.test(hazardLine)) return "養生・資材を固定し、吊荷下立入禁止と保護具（ヘルメット等）を徹底する";
  if (/熱中症|脱水|高温/.test(hazardLine)) return "休憩・水分塩分・体調確認（声掛け）を増やし、無理な継続を避ける";
  if (/低温|凍結/.test(hazardLine)) return "防寒と滑り対策を実施し、手元が確実になるまで操作を急がない";
  if (/転倒|つまずき|滑り/.test(hazardLine)) return "通路の清掃・段差表示・滑り止めを実施し、歩行帯を明確化する";
  if (/取り違え|誤操作|確認/.test(hazardLine)) return "指差呼称・ダブルチェックを実施し、手順を省略しない";
  return "手順確認（指差呼称）と区画・立入管理を徹底し、危険時は作業を止める";
}

type AiOut = {
  ai_work_detail: string;
  ai_hazards: string; // 8-12 / 因果
  ai_countermeasures: string; // 1:1
  ai_third_party: string; // 4+
  // 追加（フロント未対応でもOK）
  ai_meta?: string;
  ai_risk_add?: number; // 不足ほど加点 + 厳しめバイアス
  ai_counts?: {
    hazards_count: number;
    causal_ok_count: number;
    countermeasures_count: number;
    paired_count: number;
    third_party_count: number;
  };
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const workDetail = clampText(s(body.work_detail), 1400);
    const hazardsIn = clampText(s(body.hazards), 1400);
    const counterIn = clampText(s(body.countermeasures), 1400);
    const thirdPartyLevel = s(body.third_party_level).trim();
    const workerCount = body.worker_count == null ? null : n(body.worker_count);

    const weatherSlots = body.weather_slots ?? null;
    const weatherRisk = analyzeWeather(weatherSlots);
    const photoNotes = analyzePhotoDiff(body);

    // ✅ 現場条件（想定リスクに必ず織り込む）
    const hasSlope = true; // 草牟田墓地法面の想定（一般化するなら project種別等で切替）
    const hasHeavy = true; // 重機想定（一般化するなら入力や現場属性で切替）
    const hasPhotoNotes = photoNotes.length > 0;

    // ✅ 厳しめバイアス（係数）
    // - 充実していても「安全」とは言わない
    // - 不足は強く加点
    const STRICT_BIAS_BASE = 10; // 常に最低これだけ上乗せ（見逃し防止）
    const DEFICIT_POINT = 3; // 不足1つあたりの加点

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const model = process.env.KY_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const system = [
      "あなたは日本の土木・建設現場のKY（危険予知活動）文書を作る専門家です。",
      "現場文書として、断定を避け『恐れ』『可能性』で統一してください。",
      "出力は必ずJSONのみ。前置き/説明/挨拶は禁止。",
      "",
      "【最重要ルール】",
      "1) ai_hazards：必ず8〜12項目。各項目は必ず『〇〇だから → 〇〇が起こる恐れ/可能性』の因果形式。",
      "2) ai_countermeasures：ai_hazardsと1対1対応。項目数を一致させ、対応関係が分かるように [1] [2]… を付与。",
      "3) ai_third_party：第三者（墓参者）対策を別枠で最低4項目。『誘導』『区画（立入規制/動線分離）』『声掛け』『作業中断/停止』を優先。",
      "4) 現場条件（法面・重機・墓参者・天候・作業員数）を“想定リスク”として必ず織り込む。",
      "5) 生成内容は“厳しめ”に。見逃し防止の観点で、起こり得る不具合を優先的に抽出する。",
      "",
      "【JSON形式】",
      "必ず以下キーを含む：ai_work_detail, ai_hazards, ai_countermeasures, ai_third_party",
      "値はすべて文字列。",
      "ai_hazards / ai_countermeasures / ai_third_party は '- ' 箇条書き。",
      "ai_countermeasures の各行は必ず '- [番号] ' から開始。",
    ].join("\n");

    const user = [
      "【入力データ】",
      `作業内容: ${workDetail || "（未入力）"}`,
      `危険予知（人入力）: ${hazardsIn || "（未入力）"}`,
      `対策（人入力）: ${counterIn || "（未入力）"}`,
      `第三者（墓参者）: ${thirdPartyLevel || "（未入力）"}`,
      `作業員数: ${workerCount == null ? "（未入力）" : String(workerCount)}`,
      "",
      "【気象（9/12/15）】",
      `サマリ: ${weatherRisk.summary}`,
      `リスク: ${weatherRisk.flags.length ? weatherRisk.flags.join(" / ") : "なし"}`,
      ...(weatherSlots && weatherSlots.length
        ? weatherSlots.map((w) => {
            const t = w.temperature_c == null ? "?" : `${w.temperature_c}℃`;
            const ws = w.wind_speed_ms == null ? "?" : `${w.wind_speed_ms}m/s`;
            const pr = w.precipitation_mm == null ? "?" : `${w.precipitation_mm}mm`;
            return `- ${w.hour}時: ${w.weather_text} / ${t} / 風${ws} / 雨${pr}`;
          })
        : ["- （気象スロットなし）"]),
      "",
      "【気象対策ヒント（短文）】",
      ...(weatherRisk.hints.length ? weatherRisk.hints.map((x) => `- ${x}`) : ["- （なし）"]),
      "",
      "【写真差分メモ（URL差分のみ）】",
      ...(photoNotes.length ? photoNotes.map((x) => `- ${x}`) : ["- （差分メモなし）"]),
      "",
      "【現場条件（必ず織り込み）】",
      "- 法面あり（滑落/落石/小崩落の恐れ）",
      "- 重機あり（旋回/接触/挟まれの恐れ）",
      `- 墓参者（第三者）: ${thirdPartyLevel || "不明"}（接近/立入の恐れ）`,
      `- 作業員数: ${workerCount == null ? "不明" : String(workerCount)}（同時作業/合図不統一の恐れ）`,
    ].join("\n");

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.15, // ✅ 厳しめ：ブレを抑えて確実に形式を守らせる
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    const parsed = safeParseJson(content) ?? {};

    // --- 取り出し（モデル出力） ---
    const rawWork = clampText(s(parsed.ai_work_detail), 800);
    const rawHaz = s(parsed.ai_hazards);
    const rawCtr = s(parsed.ai_countermeasures);
    const rawThird = s(parsed.ai_third_party);

    // --- 正規化（断定回避） ---
    let workOut = normalizeProbabilistic(rawWork);

    // hazards
    let hazLines = splitLines(normalizeProbabilistic(rawHaz));
    // counter
    let ctrLines = splitLines(normalizeProbabilistic(rawCtr));
    // third party
    let thirdLines = splitLines(normalizeProbabilistic(rawThird));

    // --- hazards: 因果形式強制 ---
    const fixedHaz: string[] = [];
    let causalOk = 0;
    for (const line of hazLines) {
      const r = ensureCausal(line);
      if (r.fixed) fixedHaz.push(r.fixed);
      if (r.ok) causalOk += 1;
    }
    hazLines = fixedHaz;

    // --- hazards: 8〜12に調整（不足はフォールバックで補う） ---
    const fallbackHaz = buildFallbackHazards({
      hasSlope,
      hasHeavy,
      thirdPartyLevel,
      weatherFlags: weatherRisk.flags,
      workerCount,
      hasPhotoNotes,
    }).map((x) => normalizeProbabilistic(x));

    // 重複除去しつつ補充
    const hazUniq: string[] = [];
    for (const x of hazLines) {
      const t = x.trim();
      if (!t) continue;
      if (!hazUniq.some((u) => u === t)) hazUniq.push(t);
    }
    for (const x of fallbackHaz) {
      if (hazUniq.length >= 12) break;
      if (!hazUniq.some((u) => u === x)) hazUniq.push(x);
    }
    // まだ足りない場合の保険
    while (hazUniq.length < 8) {
      hazUniq.push("指示の伝達が曖昧になり得る だから → 手順逸脱で事故が起こる恐れ");
    }
    // 上限
    const hazardsFinal = hazUniq.slice(0, 12);

    // 因果成立数を再計測（補完分含む）
    causalOk = 0;
    const causalFixedFinal: string[] = [];
    for (const h of hazardsFinal) {
      const r = ensureCausal(h);
      causalFixedFinal.push(r.fixed);
      if (r.ok) causalOk += 1;
    }

    // --- counter: 1対1対応を強制 ---
    // 形式：'- [1] ...' を想定。無ければ順序で合わせる。
    const ctrMap = new Map<number, string>();
    const ctrRest: string[] = [];
    for (const line of ctrLines) {
      const m = line.match(/^\[(\d{1,2})\]\s*(.+)$/);
      if (m) {
        const idx = Number(m[1]);
        const text = (m[2] || "").trim();
        if (Number.isFinite(idx) && idx >= 1 && idx <= 50 && text) ctrMap.set(idx, text);
      } else {
        ctrRest.push(line);
      }
    }

    const counterFinal: string[] = [];
    let paired = 0;
    for (let i = 0; i < causalFixedFinal.length; i++) {
      const num = i + 1;
      const fromMap = ctrMap.get(num);
      const fromRest = ctrRest[i];
      const base = fromMap || fromRest || buildFallbackCounter(causalFixedFinal[i]);
      const text = normalizeProbabilistic(base).trim();
      if (text) paired += 1;
      counterFinal.push(`[${num}] ${text || buildFallbackCounter(causalFixedFinal[i])}`);
    }

    // --- third party: 最低4、必須語を優先挿入 ---
    const thirdNeed = ["誘導", "区画", "声掛け", "停止"];
    const thirdBase: string[] = [];

    // 既存をユニーク化
    for (const x of thirdLines) {
      const t = x.trim();
      if (!t) continue;
      if (!thirdBase.some((u) => u === t)) thirdBase.push(t);
    }

    // 必須要素（不足を補う）
    const thirdFallback: string[] = [
      "誘導：入口〜作業帯の動線を明確化（案内/看板/誘導員）",
      "区画：コーン/バーで立入規制し、作業帯と動線を分離する",
      "声掛け：接近時は作業を一時停止し、声掛け→安全確認後に再開する",
      "停止：第三者が区画内に入った場合は重機/吊荷/手作業を停止する",
      "掲示：注意喚起（工事中・足元注意）を見やすい位置に掲示する",
      "夜間/薄暗い場合：照明を追加し、つまずきの恐れを下げる",
    ].map((x) => normalizeProbabilistic(x));

    for (const x of thirdFallback) {
      if (thirdBase.length >= 8) break;
      if (!thirdBase.some((u) => u === x)) thirdBase.push(x);
    }
    while (thirdBase.length < 4) {
      thirdBase.push("第三者の接近が起こり得るため、区画と誘導を強化する");
    }

    // 「多い」ならより強く（先頭寄せ）
    let thirdFinal = thirdBase.slice(0, 8);
    if (thirdPartyLevel === "多い") {
      // 必須ワードが含まれないなら、先頭に差し込む（強制）
      const must: string[] = [];
      if (!thirdFinal.some((x) => x.includes("誘導"))) must.push("誘導：入口〜作業帯の動線を明確化（案内/看板/誘導員）");
      if (!thirdFinal.some((x) => x.includes("区画"))) must.push("区画：コーン/バーで立入規制し、動線分離を徹底する");
      if (!thirdFinal.some((x) => x.includes("声掛け"))) must.push("声掛け：接近時は作業停止→声掛け→安全確認後再開");
      if (!thirdFinal.some((x) => x.includes("停止"))) must.push("停止：第三者が近接した場合は重機/吊荷を停止する");
      thirdFinal = must.concat(thirdFinal).slice(0, 8);
    }

    // --- 想定リスク（work_detail）へ最低限織り込み（短く） ---
    // ※「断定」禁止
    const assumedRisk: string[] = [];
    assumedRisk.push(`法面作業があるため、滑落・落石・小崩落が起こる恐れ`);
    assumedRisk.push(`重機作業があるため、接触・挟まれ・飛来が起こる恐れ`);
    if (thirdPartyLevel) assumedRisk.push(`墓参者（第三者）が${thirdPartyLevel}ため、接近・立入が起こる恐れ`);
    if (weatherRisk.flags.length) assumedRisk.push(`気象（${weatherRisk.flags.join(" / ")}）により、滑り・飛散・崩落が起こる恐れ`);
    if (workerCount != null) assumedRisk.push(`作業員数${workerCount}名のため、同時作業で合図不統一が起こる恐れ`);
    if (photoNotes.length) assumedRisk.push("写真差分があるため、現況変化の見落としが起こる恐れ");

    // 既存workOutが薄い場合でも、最低限は出す
    const workLines = splitLines(workOut);
    const workFinal = toBullet(
      [
        ...(workLines.length ? workLines : []),
        "【想定リスク（見逃し防止）】",
        ...assumedRisk.map((x) => `・${x}`),
      ].slice(0, 18)
    );

    // --- スコア化 → 不足ほどリスク加点（充実＝安全ではない） ---
    const hazardsCount = causalFixedFinal.length;
    const thirdCount = thirdFinal.length;
    const counterCount = counterFinal.length;

    const deficitHaz = Math.max(0, 8 - hazardsCount);
    const deficitCausal = Math.max(0, hazardsCount - causalOk); // 因果未成立ぶん
    const deficitPair = Math.max(0, hazardsCount - counterCount);
    const deficitThird = Math.max(0, 4 - thirdCount);

    const deficitTotal = deficitHaz + deficitCausal + deficitPair + deficitThird;

    // ✅ 厳しめバイアス：常に基礎加点 + 不足に応じて増える
    const aiRiskAdd = STRICT_BIAS_BASE + deficitTotal * DEFICIT_POINT;

    const metaLines: string[] = [];
    metaLines.push(`hazards=${hazardsCount}（目標8〜12）`);
    metaLines.push(`因果成立=${causalOk}/${hazardsCount}`);
    metaLines.push(`対策対応=${Math.min(counterCount, hazardsCount)}/${hazardsCount}`);
    metaLines.push(`第三者対策=${thirdCount}（最低4）`);
    metaLines.push(`不足加点=${deficitTotal}項目×${DEFICIT_POINT} + 基礎${STRICT_BIAS_BASE} = ${aiRiskAdd}`);
    metaLines.push("※充実していても『安全』とは判定しない（見逃し防止のためリスクは高めに出やすい設計）");

    const out: AiOut = {
      ai_work_detail: workFinal || "",
      ai_hazards: toBullet(causalFixedFinal),
      ai_countermeasures: toBullet(counterFinal.map((x) => x)), // '- [n] ...' 形式
      ai_third_party: toBullet(thirdFinal),
      ai_meta: toBullet(metaLines),
      ai_risk_add: aiRiskAdd,
      ai_counts: {
        hazards_count: hazardsCount,
        causal_ok_count: causalOk,
        countermeasures_count: counterCount,
        paired_count: Math.min(counterCount, hazardsCount),
        third_party_count: thirdCount,
      },
    };

    return NextResponse.json(out);
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : "unknown error";
    return NextResponse.json(
      {
        ai_work_detail: "",
        ai_hazards: "- （生成エラー）",
        ai_countermeasures: "- （生成エラー）",
        ai_third_party: "- （生成エラー）",
        ai_meta: `- error: ${msg}`,
        ai_risk_add: 999,
      },
      { status: 500 }
    );
  }
}
