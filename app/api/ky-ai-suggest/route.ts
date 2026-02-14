// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  workContent?: string; // 人の作業内容（必須）
  hazardsText?: string; // 人の危険予知（重複除外用）
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

function allowSlope(work: string) {
  return /法面|切土|盛土|崩壊|落石|小崩落|浮石|崩土|滑落/.test(work);
}
function containsSlopeWord(text: string) {
  return /法面|切土|盛土|浮石|崩土|小崩落|崩壊|落石|滑落/.test(text);
}

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
  if (!/こと$/.test(t)) t = `${t}すること`;
  return t;
}

function isDuplicate(hazard: string, userHazards: string[]) {
  const a = hazard.replace(/[・\s　→]/g, "");
  return userHazards.some((u) => u.replace(/[・\s　→]/g, "").includes(a.slice(0, 8)));
}

// ---- フォールバック（不足補完用：最低限） ----
const FALLBACK: Array<{ re: RegExp; score: number; tags: string[]; hazard: string; counter: string }> = [
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
    score: 90,
    tags: ["高温", "火傷"],
    hazard: "高温のアスファルト材料を扱うため → 火傷が起こる恐れ",
    counter: "耐熱手袋・長袖着用、材料の飛散箇所へ近づかない運用を徹底すること",
  },
  {
    re: /ダンプ|重機|バックホウ|ユンボ|クレーン|フォークリフト|ローラー/,
    score: 92,
    tags: ["重機", "挟まれ"],
    hazard: "重機周辺での作業が発生するため → 挟まれ・接触事故が起こる恐れ",
    counter: "重機作業範囲を明確化し、合図者を固定して合図統一すること",
  },
  {
    re: /交通|車線|規制|誘導|片側交互/,
    score: 88,
    tags: ["交通", "規制"],
    hazard: "交通規制下での作業となるため → 第三者・一般車両との接触が起こる恐れ",
    counter: "規制範囲を明確化し、誘導員配置・注意喚起を徹底すること",
  },
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
    items.push({
      rank: items.length + 1,
      hazard: fb.hazard,
      countermeasure: fb.counter,
      score: profile === "strict" ? fb.score : Math.max(0, fb.score - 8),
      tags: fb.tags,
    });
  }
  while (items.length < 5) {
    items.push({
      rank: items.length + 1,
      hazard: "作業が輻輳しやすいため → 不安全行動による事故が起こる恐れ",
      countermeasure: "作業分担と立入範囲を事前共有し、声掛け・指差呼称を徹底すること",
      score: profile === "strict" ? 60 : 52,
      tags: ["基本"],
    });
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
    `【要求】`,
    `- 危険予知をリスク高い順に5件`,
    `- 各危険予知に対して対策を1件（1対1）`,
    `- 危険予知の形式は必ず「〇〇だから → 〇〇が起こる恐れ」`,
    `- 対策は簡潔に実行可能な内容（末尾は「～すること」）`,
    `- 厳しさ：${strictness}`,
    `- 出力JSONスキーマ：`,
    `  {"items":[{"rank":1,"hazard":"...","countermeasure":"...","score":95,"tags":["..."]}, ... ]}`,
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

    const raw = await callOpenAI(workContent, userHazards, profile);

    const items: RiskItem[] = [];
    const slopeAllowed = allowSlope(workContent);

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
        if (isDuplicate(hazard, userHazards)) continue;

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

    if (items.length < 5) fillWithFallback(workContent, items, profile);

    const ai_hazards = bulletize(items.map((x) => x.hazard));
    const ai_countermeasures = bulletize(items.map((x) => `（${x.rank}）${x.countermeasure}`));

    return NextResponse.json({
      profile,
      ai_risk_items: items.slice(0, 5),
      ai_hazards,
      ai_countermeasures,
      ai_work_detail: "",
    });
  } catch (e: any) {
    console.error("[ky-ai-suggest] error", e);
    return NextResponse.json({ error: e?.message ?? "internal error" }, { status: 500 });
  }
}
