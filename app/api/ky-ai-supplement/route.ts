// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  work_detail: string;

  // ✅ 受け取っても「AIへは送らない」
  hazards?: string | null;
  countermeasures?: string | null;

  third_party_level?: string | null; // "多い" | "少ない" | ""
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function normalizeText(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").replace(/\u3000/g, " ").trim();
}

function stripBulletLead(x: string): string {
  return x.replace(/^[•・\-*]\s*/, "").trim();
}

function splitLines(text: string): string[] {
  return normalizeText(text)
    .split("\n")
    .map((x) => stripBulletLead(normalizeText(x)))
    .filter(Boolean);
}

/** 危険予知の因果形式の軽い補正（最後の砦） */
function ensureCausal(line: string): string {
  const t = stripBulletLead(normalizeText(line));
  if (!t) return "";
  if (/(だから|ため|恐れ|起こる|発生|転倒|転落|接触|巻き込まれ|飛来|墜落)/.test(t)) return t;

  const base = t;
  const risk =
    /(足元|段差|滑り|ぬかるみ)/.test(base)
      ? "つまずき・転倒"
      : /(法面|斜面|崩壊|土砂)/.test(base)
      ? "崩壊・転落"
      : /(吹付|ノズル|ホース|圧送|ポンプ)/.test(base)
      ? "飛散・高圧噴射による受傷"
      : /(回転|巻き込|攪拌|ミキサ|ベルト)/.test(base)
      ? "巻き込まれ"
      : /(重機|バックホウ|ユンボ|車両|死角)/.test(base)
      ? "接触・巻き込まれ"
      : "事故";
  return `${base}だから、${risk}が起こる`;
}

/** =========================
 *  “同じ内容”除外（AIの意味を担保）
 *  - 人入力と近い行を落とす（AIへは送らない）
 * ========================= */

function normalizeForSim(x: string): string {
  return (x || "")
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[（）()\[\]【】「」『』]/g, "")
    .replace(/[、，,。．.・:：;；/／|｜]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function charBigrams(x: string): Set<string> {
  const t = normalizeForSim(x).replace(/\s+/g, "");
  const out = new Set<string>();
  if (t.length <= 1) return out;
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

function isTooSimilar(line: string, humanLines: string[], threshold: number): boolean {
  if (!humanLines.length) return false;
  const a = charBigrams(line);
  if (!a.size) return false;

  for (const h of humanLines) {
    const b = charBigrams(h);
    const sim = jaccard(a, b);
    if (sim >= threshold) return true;
  }
  return false;
}

function dedupeKeepOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function joinLines(arr: string[]): string {
  return arr.map((x) => normalizeText(x)).filter(Boolean).join("\n");
}

/** =========================
 *  OpenAI Responses API
 * ========================= */

function isAbortError(e: any): boolean {
  const msg = s(e?.message).toLowerCase();
  return msg.includes("aborted") || msg.includes("abort") || e?.name === "AbortError";
}

async function callOpenAIResponses(payload: any, apiKey: string, timeoutMs: number): Promise<any> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = s(j?.error?.message) || `OpenAI API error (${res.status})`;
      const err: any = new Error(msg);
      err.detail = j?.error ?? j;
      throw err;
    }

    return j;
  } finally {
    clearTimeout(to);
  }
}

function extractAnyTextFromResponses(resp: any): string {
  const direct = s(resp?.output_text).trim();
  if (direct) return direct;

  const out = resp?.output;
  if (Array.isArray(out)) {
    for (const block of out) {
      const content = block?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        const t1 = s(c?.text).trim();
        if (t1) return t1;
        if (c?.parsed != null) {
          try {
            return JSON.stringify(c.parsed);
          } catch {}
        }
      }
    }
  }

  try {
    return JSON.stringify(resp);
  } catch {
    return s(resp);
  }
}

function parseJsonLoosely(text: string): any | null {
  const src = s(text);

  try {
    return JSON.parse(src);
  } catch {}

  const deFenced = src.replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = deFenced.indexOf("{");
  const end = deFenced.lastIndexOf("}");
  if (start >= 0 && end >= 0 && end > start) {
    const sliced = deFenced.slice(start, end + 1);
    try {
      return JSON.parse(sliced);
    } catch {}
  }
  return null;
}

function normalizeArrayToStrings(arr: any): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const t =
          (typeof x.text === "string" ? x.text : "") ||
          (typeof x.content === "string" ? x.content : "") ||
          (typeof x.value === "string" ? x.value : "") ||
          "";
        if (t) return t;
        try {
          return JSON.stringify(x);
        } catch {
          return "";
        }
      }
      return "";
    })
    .map((x) => stripBulletLead(normalizeText(x)))
    .filter(Boolean);
}

/** =========================
 *  Route
 * ========================= */

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const workDetail = normalizeText(s(body?.work_detail));
    if (!workDetail) {
      return NextResponse.json({ error: "work_detail is required" }, { status: 400 });
    }

    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });
    }

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim();

    // ✅ 人入力（危険予知/対策）は「AIへ送らない」
    // ただし “同じ内容を返されたら落とす” 比較用にだけ使う
    const humanHazLines = splitLines(s(body?.hazards));
    const humanMeaLines = splitLines(s(body?.countermeasures));

    const thirdLevel = normalizeText(s(body?.third_party_level)); // 第三者は今回はローカル補完でOK（AIへ送らない）

    const systemText = [
      "あなたは日本の建設現場の安全管理（所長補佐）。",
      "出力は必ずJSONのみ。前置き/解説/挨拶は禁止。JSON以外を出力しない。",
      "",
      "必須：",
      "1) hazards は必ず『〇〇だから、〇〇が起こる』形式で1項目=1行。",
      "2) measures は具体策（手順/配置/合図/停止基準/点検/保護具/立入規制）を1項目=1行。",
      "3) hazards と measures は現場でそのまま使える密度で。抽象語だけは禁止。",
      "4) 事故になりやすい項目を厳しめに多めに出す（項目数上限なし）。",
      "",
      "重要：入力は「作業内容」だけ。そこから危険予知と対策を作れ。",
    ].join("\n");

    // ✅ ChatGPT5.2に投げるのは “作業内容だけ”
    const userText = [
      "作業内容：",
      workDetail,
      "",
      "この作業内容に対して、hazards と measures を作成せよ。",
    ].join("\n");

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        hazards: { type: "array", items: { type: "string" } },
        measures: { type: "array", items: { type: "string" } },
      },
      required: ["hazards", "measures"],
    } as const;

    const buildPayload = (maxTokens: number) => ({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        { role: "user", content: [{ type: "input_text", text: userText }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ky_ai_supplement",
          strict: true,
          schema,
        },
      },
      temperature: 0.3,
      max_output_tokens: maxTokens,
    });

    const timeout1 = Number(process.env.OPENAI_TIMEOUT_MS || "60000");
    const timeout2 = Number(process.env.OPENAI_TIMEOUT_MS_RETRY || "60000");

    let resp: any = null;
    try {
      resp = await callOpenAIResponses(buildPayload(1400), apiKey, timeout1);
    } catch (e: any) {
      if (!isAbortError(e)) {
        return NextResponse.json({ error: e?.message ?? "OpenAI API error", detail: e?.detail ?? null }, { status: 500 });
      }
      // リトライ（軽量化：出力短め）
      try {
        resp = await callOpenAIResponses(buildPayload(900), apiKey, timeout2);
      } catch {
        // ✅ 最終Fallback（ローカル拡張：人入力コピーは禁止）
        const fbHaz = [
          ensureCausal("足元がぬかるみやすい"),
          ensureCausal("ホース・電源コードが散乱しやすい"),
          ensureCausal("噴射圧・飛散が発生しやすい"),
          ensureCausal("回転部・攪拌部が露出しやすい"),
        ].filter(Boolean);

        const fbMea = [
          "足元を事前整備し、滑り止め・段差解消を実施する",
          "ホース/コードを整理固定し、通路を明確化してつまずき防止する",
          "噴射方向を人に向けない・防護メガネ/防じんマスク/保護手袋を着用する",
          "攪拌・回転部はカバーを確実にし、運転中は手を入れない（停止→電源遮断→確認）",
        ];

        const third = thirdLevel
          ? thirdLevel === "多い"
            ? [
                "第三者の動線を完全分離し、立入禁止柵・ロープ・看板で区画する",
                "誘導員を配置し、第三者が近づいたら作業を一時停止する基準を周知する",
              ]
            : [
                "第三者が来る可能性を前提に、出入口・通路側を区画し看板を掲示する",
                "第三者を確認したら作業を一時停止し、安全側へ誘導してから再開する",
              ]
          : [];

        return NextResponse.json(
          {
            ai_hazards: joinLines(fbHaz),
            ai_countermeasures: joinLines(fbMea),
            ai_third_party: joinLines(third),
            model_used: model,
            warning: "OpenAI timeout; returned local expanded fallback",
          },
          { status: 200 }
        );
      }
    }

    const anyText = extractAnyTextFromResponses(resp);
    const parsed = parseJsonLoosely(anyText) ?? {};

    const hazardsRaw = normalizeArrayToStrings(parsed?.hazards);
    const measuresRaw = normalizeArrayToStrings(parsed?.measures);

    // ✅ 因果形式を最終保証
    let hazards = hazardsRaw.map((x) => ensureCausal(x)).filter(Boolean);
    let measures = measuresRaw.map((x) => stripBulletLead(normalizeText(x))).filter(Boolean);

    // ✅ 人入力と“同じ内容”は落とす（AIの意味を担保）
    hazards = hazards.filter((x) => !isTooSimilar(x, humanHazLines, 0.42));
    measures = measures.filter((x) => !isTooSimilar(x, humanMeaLines, 0.40));

    hazards = dedupeKeepOrder(hazards);
    measures = dedupeKeepOrder(measures);

    // ✅ 最低件数を保証（薄い返答なら追加で補完）
    if (hazards.length < 5) {
      const extra = [
        ensureCausal("足元がぬかるみやすい"),
        ensureCausal("ホース・電源コードが散乱しやすい"),
        ensureCausal("噴射圧・飛散が発生しやすい"),
        ensureCausal("回転部・攪拌部が露出しやすい"),
        ensureCausal("工具・資機材の落下が起きやすい"),
      ].filter(Boolean);
      hazards = dedupeKeepOrder([...hazards, ...extra]).slice(0, 8);
    }

    if (measures.length < 5) {
      const extra = [
        "足元を事前整備し、滑り止め・段差解消を実施する",
        "ホース/コードを整理固定し、通路を明確化してつまずき防止する",
        "噴射方向を人に向けない・保護具（保護メガネ/防じんマスク/手袋）を徹底する",
        "攪拌・回転部はカバーを確実にし、運転中は手を入れない（停止→遮断→確認）",
        "作業範囲を区画し、第三者/周囲作業との干渉を避ける（合図統一）",
      ];
      measures = dedupeKeepOrder([...measures, ...extra]).slice(0, 10);
    }

    // ✅ 第三者は今回は“ローカル補完”で十分（AIへ送らない方針）
    const third =
      thirdLevel === "多い"
        ? [
            "第三者の動線を完全分離し、立入禁止柵・ロープ・看板で区画する",
            "誘導員を配置し、第三者が近づいたら作業を一時停止する基準を周知する",
            "声掛けを徹底し、第三者の通過導線を安全側へ誘導する",
          ]
        : thirdLevel === "少ない"
        ? [
            "第三者が来る可能性を前提に、出入口・通路側を区画し看板を掲示する",
            "第三者を確認したら作業を一時停止し、安全側へ誘導してから再開する",
          ]
        : [];

    return NextResponse.json({
      // KyNewClient互換
      ai_hazards: joinLines(hazards),
      ai_countermeasures: joinLines(measures),
      ai_third_party: joinLines(third),

      // 参考（将来レビューで箇条書きにしたい時用）
      ai_hazards_items: hazards,
      ai_countermeasures_items: measures,
      ai_third_party_items: third,

      model_used: model,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
