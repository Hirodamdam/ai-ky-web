// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  workContent?: string;
  hazardsText?: string;
  thirdPartyLevel?: "多い" | "少ない" | "" | null;
  profile?: "strict" | "normal";
};

type RiskItem = {
  rank: number;
  hazard: string; // 「〇〇だから → 〇〇が起こる恐れ」
  countermeasure: string; // 1対1
  score: number;
  tags: string[];
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function normalizeLines(text: string): string[] {
  return s(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[•・\-*]\s*/, "").trim())
    .filter(Boolean);
}

function bulletize(lines: string[]) {
  return lines.map((l) => (l.startsWith("・") ? l : `・${l}`)).join("\n");
}

// --- 法面混入ガード（作業内容に明示が無い限り除外） ---
function allowSlope(work: string) {
  return /法面|切土|盛土|崩壊|落石|小崩落|浮石|崩土|滑落/.test(work);
}
function containsSlopeWord(text: string) {
  return /法面|切土|盛土|浮石|崩土|小崩落|崩壊|落石|滑落/.test(text);
}

// --- 形式強制：「〇〇だから → 〇〇が起こる恐れ」 ---
function enforceBecauseArrow(line: string): string {
  let t = line.trim().replace(/^[•・\-*]\s*/, "").trim();
  t = t.replace(/⇒|->/g, "→");

  if (t.includes("→")) {
    if (!/恐れ|可能性/.test(t)) t = `${t}の恐れ`;
    if (!/起こる/.test(t)) t = t.replace(/の恐れ$/, "が起こる恐れ");
    return t;
  }

  const m = t.match(/(.+?)(ため|ので|から|により)\s*(.+)/);
  if (m) {
    const left = `${m[1]}${m[2]}`.trim();
    let right = m[3].trim();
    if (!/恐れ|可能性/.test(right)) right = `${right}が起こる恐れ`;
    if (!/起こる/.test(right)) right = right.replace(/の恐れ$/, "が起こる恐れ");
    return `${left} → ${right}`;
  }

  if (!/恐れ|可能性/.test(t)) t = `${t}が起こる恐れ`;
  if (!/起こる/.test(t)) t = t.replace(/の恐れ$/, "が起こる恐れ");
  return `作業特性により → ${t}`;
}

function enforceMeasure(line: string): string {
  let t = line.trim().replace(/^[•・\-*]\s*/, "").trim();
  // 末尾「こと」に寄せる
  if (!/こと$/.test(t)) t = `${t}すること`;
  return t;
}

// --- ざっくり同一判定（重複ゼロにするため） ---
function keyForDedupe(text: string) {
  return s(text)
    .replace(/[・\s　]/g, "")
    .replace(/[()（）［］\[\]「」"']/g, "")
    .replace(/→/g, "")
    .toLowerCase();
}
function tooSimilar(a: string, b: string) {
  const ka = keyForDedupe(a);
  const kb = keyForDedupe(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  // 片方が他方を大きく含む場合も重複扱い
  const shorter = ka.length <= kb.length ? ka : kb;
  const longer = ka.length > kb.length ? ka : kb;
  if (shorter.length >= 10 && longer.includes(shorter)) return true;
  return false;
}

function isDuplicateAgainstUser(hazard: string, userHazards: string[]) {
  return userHazards.some((u) => tooSimilar(hazard, u));
}

function isDuplicateInside(items: RiskItem[], hazard: string, counter: string) {
  return items.some((x) => tooSimilar(x.hazard, hazard) || tooSimilar(x.countermeasure, counter));
}

// ---- フォールバック（舗装・道路系を厚くして重複ゼロで埋める） ----
const FALLBACK: Array<{ re: RegExp; score: number; tags: string[]; hazard: string; counter: string }> = [
  // 舗装/合材/フィニッシャ/ローラ
  {
    re: /舗装|アスファルト|フィニッシャ|合材|転圧|ローラ|ローラー/,
    score: 95,
    tags: ["交通", "接触"],
    hazard: "車両（ダンプ等）の出入りが多いため → 接触事故が起こる恐れ",
    counter: "誘導員を配置し、バック時の合図統一・後方確認を徹底すること",
  },
  {
    re: /フィニッシャ|合材|投入/,
    score: 93,
    tags: ["重機", "巻込み"],
    hazard: "フィニッシャーへ合材投入を行うため → 巻き込まれ事故が起こる恐れ",
    counter: "立入禁止範囲を明確化し、投入時は接近禁止・合図者を固定すること",
  },
  {
    re: /アスファルト|合材|高温/,
    score: 91,
    tags: ["高温", "火傷"],
    hazard: "高温材料の取り扱いがあるため → 火傷が起こる恐れ",
    counter: "耐熱手袋・長袖着用とし、飛散範囲へ近づかない運用を徹底すること",
  },
  {
    re: /転圧|ローラ|ローラー/,
    score: 90,
    tags: ["重機", "挟まれ"],
    hazard: "転圧機械が旋回・後退するため → 挟まれ・接触事故が起こる恐れ",
    counter: "旋回範囲を明示し、接近禁止・合図者配置で死角をなくすこと",
  },
  {
    re: /切断|カッター|目地|コンクリ|舗装切断/,
    score: 88,
    tags: ["飛散", "切創"],
    hazard: "切断作業により破片が飛散するため → 目・切創災害が起こる恐れ",
    counter: "保護メガネ・防護具を着用し、飛散方向に人を立ち入らせないこと",
  },
  {
    re: /規制|片側交互|カラーコーン|保安|交通/,
    score: 89,
    tags: ["交通", "第三者"],
    hazard: "交通規制下で第三者が近接するため → 一般車両・歩行者との接触が起こる恐れ",
    counter: "規制帯を明確化し、誘導員配置と注意喚起で第三者を規制外へ誘導すること",
  },
  {
    re: /夜間|暗い|早朝/,
    score: 86,
    tags: ["視認性", "交通"],
    hazard: "視認性が低下するため → 車両・重機との接触が起こる恐れ",
    counter: "照明・反射材を増設し、誘導員の配置で接触リスクを低減すること",
  },
  {
    re: /雨|濡れ|滑る|水/,
    score: 85,
    tags: ["転倒", "滑り"],
    hazard: "路面が滑りやすくなるため → 転倒・滑倒が起こる恐れ",
    counter: "滑り止め靴を徹底し、ぬかるみ・段差を随時補修して通路を確保すること",
  },
  {
    re: /段差|マンホール|縁石|掘削|開口/,
    score: 84,
    tags: ["転倒", "段差"],
    hazard: "段差・開口部が発生するため → つまずき転倒が起こる恐れ",
    counter: "段差養生とバリケード設置を行い、歩行動線を明示すること",
  },
  // 汎用（最後の保険：同じ文は入れない）
  {
    re: /./,
    score: 70,
    tags: ["基本"],
    hazard: "作業が輻輳しやすいため → 不安全行動による事故が起こる恐れ",
    counter: "作業分担と立入範囲を事前共有し、声掛け・指差呼称を徹底すること",
  },
];

function fillWithFallback(work: string, items: RiskItem[], profile: "strict" | "normal") {
  for (const fb of FALLBACK) {
    if (items.length >= 5) break;
    if (!fb.re.test(work)) continue;

    const hazard = fb.hazard;
    const counter = fb.counter;

    // ✅ 重複は絶対に入れない
    if (isDuplicateInside(items, hazard, counter)) continue;

    items.push({
      rank: items.length + 1,
      hazard,
      countermeasure: counter,
      score: profile === "strict" ? fb.score : Math.max(0, fb.score - 8),
      tags: fb.tags,
    });
  }

  // 最後まで埋まらない場合も、別文で埋める（重複禁止）
  const lastResorts: Array<{ hazard: string; counter: string; score: number; tags: string[] }> = [
    {
      hazard: "資材・工具の散乱が発生しやすいため → つまずき転倒が起こる恐れ",
      counter: "通路を確保し、資材置場を固定して整理整頓を徹底すること",
      score: 62,
      tags: ["整理整頓"],
    },
    {
      hazard: "作業間の合図が不統一になりやすいため → 誤動作による接触事故が起こる恐れ",
      counter: "合図者を固定し、開始前に合図手順を周知徹底すること",
      score: 61,
      tags: ["合図", "連携"],
    },
    {
      hazard: "熱中症リスクが上がる環境になりやすいため → 体調不良が起こる恐れ",
      counter: "WBGTを確認し、休憩・水分塩分補給と体調確認を徹底すること",
      score: 60,
      tags: ["熱中症"],
    },
  ];

  for (const r of lastResorts) {
    if (items.length >= 5) break;
    if (isDuplicateInside(items, r.hazard, r.counter)) continue;
    items.push({
      rank: items.length + 1,
      hazard: r.hazard,
      countermeasure: r.counter,
      score: profile === "strict" ? r.score : Math.max(0, r.score - 8),
      tags: r.tags,
    });
  }

  // 念のため（ここでも重複を作らない）
  while (items.length < 5) {
    const h = `作業計画が不明確になりやすいため → 不安全行動による事故が起こる恐れ`;
    const c = `作業手順と危険ポイントを開始前に周知し、声掛けを徹底すること`;
    if (!isDuplicateInside(items, h, c)) {
      items.push({
        rank: items.length + 1,
        hazard: h,
        countermeasure: c,
        score: profile === "strict" ? 58 : 50,
        tags: ["基本"],
      });
    } else {
      // 万一重複なら別案
      items.push({
        rank: items.length + 1,
        hazard: "周囲確認が不足しやすいため → 接触事故が起こる恐れ",
        countermeasure: "指差呼称で周囲確認を行い、危険範囲に立ち入らないこと",
        score: profile === "strict" ? 57 : 49,
        tags: ["基本"],
      });
    }
  }
}

async function callOpenAI(work: string, userHazards: string[], profile: "strict" | "normal") {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;

  const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const strictness = profile === "strict" ? "厳しめ（最悪ケース想定、注意喚起強め）" : "通常";

  const system = [
    "あなたは建設現場の安全管理（KY）支援AIです。",
    "入力の『作業内容』から、事故に直結しやすい危険を優先して抽出し、必ず危険と対策を1対1で対応させてください。",
    "出力は必ずJSONのみ。余計な文章は禁止。",
  ].join("\n");

  const user = [
    `【作業内容】${work}`,
    `【人が書いた危険予知（重複回避用）】${userHazards.join(" / ") || "なし"}`,
    "",
    "【要求（重要：重複禁止）】",
    "- 危険予知は必ず5件、全件“別の事故型”にする（同じ内容の言い換えは禁止）",
    "- 例：接触／巻き込まれ／挟まれ／転倒／火傷／飛散／第三者接触…など事故型を分ける",
    "- 各危険予知に対して対策を1件（1対1）",
    "- 危険予知の形式は必ず「〇〇だから → 〇〇が起こる恐れ」",
    "- 対策は現場で実行可能・具体（末尾は「～すること」）",
    `- 厳しさ：${strictness}`,
    "- 出力JSONスキーマ：",
    '  {"items":[{"rank":1,"hazard":"...","countermeasure":"...","score":95,"tags":["..."]}, ... ]}',
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: { format: { type: "json_object" } },
      reasoning: { effort: "low" },
    }),
  });

  const j = await res.json().catch(() => null);
  if (!res.ok || !j) return null;

  const text =
    j?.output?.[0]?.content?.find((c: any) => c?.type === "output_text")?.text ??
    j?.output_text ??
    "";

  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    const rawItems = Array.isArray(parsed?.items) ? parsed.items : [];
    return rawItems as any[];
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const workContent = s(body.workContent).trim();
    if (!workContent) {
      return NextResponse.json({ error: "workContent required" }, { status: 400 });
    }

    const profile: "strict" | "normal" = body.profile === "normal" ? "normal" : "strict";
    const userHazards = normalizeLines(s(body.hazardsText));
    const slopeAllowed = allowSlope(workContent);

    const raw = await callOpenAI(workContent, userHazards, profile);

    const items: RiskItem[] = [];

    if (raw && Array.isArray(raw)) {
      for (const r of raw) {
        if (items.length >= 5) break;

        const hazard0 = s(r?.hazard).trim();
        const counter0 = s(r?.countermeasure).trim();
        if (!hazard0 || !counter0) continue;

        const hazard = enforceBecauseArrow(hazard0);
        const counter = enforceMeasure(counter0);

        // ✅ 法面混入ガード
        if (!slopeAllowed && (containsSlopeWord(hazard) || containsSlopeWord(counter))) continue;

        // ✅ 人の危険予知と被り回避
        if (isDuplicateAgainstUser(hazard, userHazards)) continue;

        // ✅ 生成内重複を禁止
        if (isDuplicateInside(items, hazard, counter)) continue;

        const scoreIn = Number(r?.score);
        const score = Number.isFinite(scoreIn) ? scoreIn : 80;
        const tags = Array.isArray(r?.tags) ? r.tags.map((x: any) => s(x).trim()).filter(Boolean) : [];

        items.push({
          rank: items.length + 1,
          hazard,
          countermeasure: counter,
          score: profile === "strict" ? score : Math.max(0, score - 8),
          tags,
        });
      }
    }

    // 足りなければフォールバックで“重複ゼロ”のまま5件へ
    if (items.length < 5) fillWithFallback(workContent, items, profile);

    // rankを振り直し（念のため）
    const finalItems = items.slice(0, 5).map((x, i) => ({ ...x, rank: i + 1 }));

    const ai_hazards = bulletize(finalItems.map((x) => x.hazard));
    const ai_countermeasures = bulletize(finalItems.map((x) => `（${x.rank}）${x.countermeasure}`));

    return NextResponse.json({
      profile,
      ai_risk_items: finalItems,
      ai_hazards,
      ai_countermeasures,
      ai_work_detail: "",
    });
  } catch (e: any) {
    console.error("[ky-ai-suggest] error", e);
    return NextResponse.json({ error: e?.message ?? "internal error" }, { status: 500 });
  }
}
