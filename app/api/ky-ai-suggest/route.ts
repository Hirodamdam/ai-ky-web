// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = Record<string, unknown>;

type RiskItem = {
  rank: number;
  hazard: string;
  countermeasure: string;
  score?: number;
  tags?: string[];
};

function s(v: unknown) {
  if (v == null) return "";
  return String(v);
}

function nf(v: unknown): number | null {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(x) ? x : null;
}

function normalizeNewlines(text: string): string {
  return s(text)
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

function firstNonEmpty(body: Body, keys: string[]) {
  for (const k of keys) {
    const t = s((body as any)?.[k]).trim();
    if (t) return t;
  }
  return "";
}

function pickInput(body: Body) {
  const workContent = firstNonEmpty(body, ["workContent", "work_content", "work_detail", "workDetail", "work", "title", "content"]);
  const hazardsText = firstNonEmpty(body, ["hazardsText", "hazards_text", "hazards"]);
  const thirdPartyLevel = firstNonEmpty(body, ["thirdPartyLevel", "third_party_level", "thirdParty", "third_party"]);
  const profile = (firstNonEmpty(body, ["profile"]) || "strict").trim();

  // あってもなくてもOK（将来拡張）
  const weather_text = firstNonEmpty(body, ["weather_text", "weatherText", "weather"]);
  const wbgt = nf((body as any)?.wbgt ?? (body as any)?.wbgt_c ?? (body as any)?.WBGT);
  const temperature_c = nf((body as any)?.temperature_c ?? (body as any)?.temp_c ?? (body as any)?.temperature);

  return { workContent, hazardsText, thirdPartyLevel, profile, weather_text, wbgt, temperature_c };
}

function buildPrompt(input: ReturnType<typeof pickInput>) {
  return [
    "あなたは建設現場の安全管理（KY）の専門家。出力は必ずJSONのみ。",
    "不足指摘（写真がない等）を危険予知の主題にするのは禁止。必ず作業内容に紐づける。",
    "",
    "【熱中症ルール】",
    "WBGT < 21 → 熱中症を一切出さない。",
    "WBGT >= 25 → 熱中症を必ず含める。",
    "WBGT不明時：気温30℃以上なら含める。25℃未満なら出さない。25〜29℃は推測と明記。",
    "",
    "【入力】",
    `作業内容: ${input.workContent}`,
    `第三者状況: ${input.thirdPartyLevel || "（未選択）"}`,
    `気象: ${input.weather_text || "（なし）"}`,
    `WBGT: ${input.wbgt == null ? "（不明）" : input.wbgt}`,
    `気温: ${input.temperature_c == null ? "（不明）" : input.temperature_c}`,
    `手入力危険予知: ${input.hazardsText || "（なし）"}`,
    "",
    "【出力仕様（JSON）】",
    "次のキーを必ず返す：ai_risk_items, ai_hazards, ai_countermeasures, ai_third_party",
    "ai_risk_items：必ず5件。各要素は rank(1..5), hazard, countermeasure を持つ。",
    "hazardは必ず『〇〇だから、〇〇が起こる』形式の1行。",
    "countermeasureはhazardと1対1対応で具体策のみ。",
    "ai_hazards：『・』箇条書き（5行）。ai_countermeasures：『・（1）』形式（5行）。",
  ].join("\n");
}

// ✅ OpenAIを“失敗しにくく”する：タイムアウト + リトライ（フォールバックは返さない）
async function callOpenAIJson(prompt: string, model: string, apiKey: string): Promise<any> {
  const url = "https://api.openai.com/v1/chat/completions";

  const attempts = 3;          // 3回リトライ
  const timeoutMs = 20000;     // 20秒で打ち切り（無限待ちを防ぐ）

  let lastErrText = "";

  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: ac.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "JSON以外は禁止。コードブロック禁止。" },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      });

      const text = await r.text().catch(() => "");
      if (!r.ok) {
        lastErrText = `status=${r.status} body=${text.slice(0, 1200)}`;
        // 4xxでも一時的なことがあるのでリトライ継続（ただし3回まで）
        continue;
      }

      const data = JSON.parse(text || "{}");
      const content = s(data?.choices?.[0]?.message?.content).trim();
      if (!content) {
        lastErrText = "empty content";
        continue;
      }

      return JSON.parse(content);
    } catch (e: any) {
      lastErrText = s(e?.message || e);
      // abort / network もリトライ
      continue;
    } finally {
      clearTimeout(t);
    }
  }

  const err = new Error(`openai_error: ${lastErrText || "unknown"}`);
  (err as any).code = "OPENAI_ERROR";
  throw err;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const input = pickInput(body);

    if (!input.workContent.trim()) {
      return NextResponse.json({ error: "Missing workContent" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    const model = (process.env.OPENAI_MODEL || "gpt-5.1").trim();
    const prompt = buildPrompt(input);

    const obj = await callOpenAIJson(prompt, model, apiKey);

    const raw = Array.isArray(obj?.ai_risk_items) ? (obj.ai_risk_items as unknown[]) : [];
    const parsed: RiskItem[] = raw
      .map((x: unknown, idx: number) => {
        const xx = x as any;
        return {
          rank: Number(xx?.rank) || idx + 1,
          hazard: s(xx?.hazard).trim(),
          countermeasure: s(xx?.countermeasure).trim(),
          score: typeof xx?.score === "number" ? xx.score : undefined,
          tags: Array.isArray(xx?.tags) ? (xx.tags as unknown[]).map((t) => s(t)) : undefined,
        } as RiskItem;
      })
      .filter((it) => it.hazard && it.countermeasure);

    // ✅ “必ず5件”を強制（足りない＝不正回答 → エラー扱いで返す）
    if (parsed.length < 5) {
      return NextResponse.json(
        { error: "openai_error", detail: `ai_risk_items insufficient (${parsed.length}/5)` },
        { status: 502 }
      );
    }

    const items = parsed.slice(0, 5).map((it, i) => ({ ...it, rank: i + 1 }));

    const ai_hazards = normalizeNewlines(obj?.ai_hazards || items.map((x) => `・${x.hazard}`).join("\n"));
    const ai_countermeasures = normalizeNewlines(
      obj?.ai_countermeasures || items.map((x) => `・（${x.rank}）${x.countermeasure}`).join("\n")
    );
    const ai_third_party = normalizeNewlines(obj?.ai_third_party || "");

    return NextResponse.json({
      ai_risk_items: items,
      ai_hazards,
      ai_countermeasures,
      ai_third_party,
      // 互換キー
      hazards: ai_hazards,
      countermeasures: ai_countermeasures,
      third_party: ai_third_party,
      meta_model: model,
    });
  } catch (e: any) {
    const msg = s(e?.message ?? e);
    // ✅ OpenAI失敗は502で返す（UI側は前回表示を消さない実装にしてある前提）
    if (String(msg).includes("openai_error")) {
      return NextResponse.json({ error: "openai_error", detail: msg.slice(0, 1500) }, { status: 502 });
    }
    return NextResponse.json({ error: "server_error", detail: msg.slice(0, 1500) }, { status: 500 });
  }
}
