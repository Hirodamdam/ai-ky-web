import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ありがちな ```json ... ``` や前後テキスト混入に強いJSON抽出 */
function extractJsonObject(text: string): any | null {
  const t = String(text ?? "").trim();

  // 1) まずはそのまま
  const direct = safeJsonParse(t);
  if (direct && typeof direct === "object") return direct;

  // 2) code fence除去
  const unfenced = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const j2 = safeJsonParse(unfenced);
  if (j2 && typeof j2 === "object") return j2;

  // 3) 最初の { ... } を抜く（簡易）
  const m = t.match(/\{[\s\S]*\}/);
  if (m?.[0]) {
    const j3 = safeJsonParse(m[0]);
    if (j3 && typeof j3 === "object") return j3;
  }

  return null;
}

type SafetyCaseRow = {
  url: string;
  title: string | null;
  content_summary: string | null;
  content_text?: string | null;
  similarity?: number | null;
};

function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** AIが見出し混入した場合に軽く除去 */
function cleanAiText(s: string): string {
  const t = String(s ?? "").replace(/\r\n/g, "\n").trim();
  return t.replace(/^(AI)?\s*(作業内容|危険要因|対策|備考)\s*案\s*[:：]?\s*/i, "");
}

function buildQuery(body: any): string {
  const parts: string[] = [];
  const title = toText(body?.title).trim();
  const work_detail = toText(body?.work_detail).trim();
  const notes = toText(body?.notes).trim();

  // 追加項目（あれば使う）
  const weather = toText(body?.weather).trim();
  const temperature_text = toText(body?.temperature_text).trim();
  const wind_direction = toText(body?.wind_direction).trim();
  const wind_speed_text = toText(body?.wind_speed_text).trim();
  const precipitation_mm = body?.precipitation_mm ?? null;
  const workers = body?.workers ?? null;
  const work_date = body?.work_date ?? null;
  const subcontractor_id = body?.subcontractor_id ?? null;

  if (title) parts.push(`タイトル: ${title}`);
  if (work_detail) parts.push(`作業内容: ${work_detail}`);
  if (notes) parts.push(`備考: ${notes}`);

  // 気象・条件（短く）
  const cond: string[] = [];
  if (work_date) cond.push(`作業日=${work_date}`);
  if (workers !== null && workers !== undefined && workers !== "") cond.push(`人数=${workers}`);
  if (weather) cond.push(`天気=${weather}`);
  if (temperature_text) cond.push(`気温=${temperature_text}`);
  if (wind_direction) cond.push(`風向=${wind_direction}`);
  if (wind_speed_text) cond.push(`風速=${wind_speed_text}`);
  if (precipitation_mm !== null && precipitation_mm !== undefined && precipitation_mm !== "")
    cond.push(`降水量=${precipitation_mm}`);
  if (subcontractor_id) cond.push(`下請会社ID=${subcontractor_id}`);

  if (cond.length) parts.push(`条件: ${cond.join(" / ")}`);

  // クエリは長すぎない方が安定。長文は先頭のみ。
  const q = parts.join("\n");
  return q.length > 6000 ? q.slice(0, 6000) : q;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const work_detail = toText(body?.work_detail).trim();
    const title = toText(body?.title).trim();
    const notes = toText(body?.notes).trim();

    if (!work_detail) {
      return NextResponse.json(
        { ok: false, error: "作業内容（work_detail）が空です" },
        { status: 400 }
      );
    }

    // ===== OpenAI =====
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY が未設定です（.env.local を確認）" },
        { status: 500 }
      );
    }
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const client = new OpenAI({ apiKey });

    // ===== Supabase (server-side) =====
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceRole =
      process.env.SUPABASE_SERVICE_ROLE_KEY || "";

    if (!supabaseUrl || !serviceRole) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Supabaseの接続情報が不足です（SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を .env.local に設定）",
        },
        { status: 500 }
      );
    }

    const sb = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false },
    });

    // 1) クエリEmbedding
    const queryText = buildQuery(body);

    const emb = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: queryText.slice(0, 12000),
    });
    const queryEmbedding = emb.data[0].embedding;

    // 2) ベクトル検索（RPC）
    // ※ 事前に match_safety_cases 関数が必要（下にSQLを用意）
    const matchCount = Number(process.env.SAFETY_MATCH_COUNT ?? "5");
    const matchThreshold = Number(process.env.SAFETY_MATCH_THRESHOLD ?? "0.55"); // 低めにしてヒットを確保

    let cases: SafetyCaseRow[] = [];

    const { data: rpcData, error: rpcError } = await sb.rpc("match_safety_cases", {
      query_embedding: queryEmbedding,
      match_count: matchCount,
      match_threshold: matchThreshold,
    });

    if (!rpcError && Array.isArray(rpcData)) {
      cases = rpcData as SafetyCaseRow[];
    } else {
      // RPC未作成などの場合：最低限のフォールバック（最新の一部だけ）
      // ※ ここは「動かないよりマシ」用。精度はRPCより落ちます。
      const { data: fallback, error: fbErr } = await sb
        .from("safety_cases")
        .select("url,title,content_summary")
        .eq("source", "mhlw_anzen")
        .order("fetched_at", { ascending: false })
        .limit(matchCount);

      if (!fbErr && Array.isArray(fallback)) {
        cases = fallback as SafetyCaseRow[];
      } else {
        cases = [];
      }
    }

    // 3) 参照事例をプロンプト用に整形（短く）
    const caseBlocks = cases
      .filter((c) => c?.url)
      .map((c, i) => {
        const t = (c.title ?? "").trim();
        const s = (c.content_summary ?? "").trim();
        const titleLine = t ? `タイトル: ${t}` : "タイトル: （不明）";
        const sumLine = s ? `要約: ${s}` : "要約: （なし）";
        return `【事例${i + 1}】\nURL: ${c.url}\n${titleLine}\n${sumLine}`;
      })
      .join("\n\n");

    const system = `
あなたは建設現場の危険予知（KY）支援AIです。
与えられた「入力」と「参考事例（厚労省の災害事例）」を根拠に、KYの危険要因と対策を具体化してください。
必ず「JSONのみ」を返してください。JSON以外の文章は一切出力しないでください。
`.trim();

    const user = `
以下の入力をもとに、危険予知（KY）を補完してください。

入力:
- タイトル: ${title || "（空）"}
- 作業内容: ${work_detail}
- 備考: ${notes || "（空）"}

参考事例（該当があれば活用。無ければ一般的KYで補完）:
${caseBlocks || "（該当事例なし）"}

出力JSONの形式（このキーだけ。未変更なら省略可）:
{
  "hazards": "危険要因（具体・箇条書き可）",
  "countermeasures": "対策（具体・箇条書き可）",
  "notes": "備考に追記する短文（任意）",
  "sources": [
    { "title": "参照した事例タイトル", "url": "参照URL" }
  ]
}

ルール:
- sources は「参考事例」にURLがある場合だけ入れてよい（最大${matchCount}件）。
- hazards/countermeasures は、入力の作業内容に即した具体性を優先（例：墜落/転落、挟まれ、飛来落下、重機接触、感電、熱中症、滑倒など）。
- notes は短く（1〜3文程度）。見出し（備考案: 等）は付けない。
`.trim();

    const resp = await client.chat.completions.create({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    const text = resp.choices?.[0]?.message?.content ?? "";
    const json = extractJsonObject(text);

    if (!json || typeof json !== "object") {
      // JSONが取れない場合でも落とさない（デバッグ用にnotesへ）
      return NextResponse.json({ notes: cleanAiText(text) });
    }

    const out: Record<string, any> = {};

    if (typeof json.hazards === "string") out.hazards = json.hazards;
    if (typeof json.countermeasures === "string") out.countermeasures = json.countermeasures;
    if (typeof json.notes === "string") out.notes = cleanAiText(json.notes);

    // sources は任意
    if (Array.isArray(json.sources)) {
      out.sources = json.sources
        .filter((x: any) => x && typeof x === "object" && typeof x.url === "string")
        .slice(0, matchCount)
        .map((x: any) => ({
          title: typeof x.title === "string" ? x.title : "",
          url: x.url,
        }));
    } else if (cases.length) {
      // AIが返さない場合は、検索結果をそのまま返す（最低限）
      out.sources = cases.slice(0, matchCount).map((c) => ({
        title: c.title ?? "",
        url: c.url,
      }));
    }

    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "AI API でエラーが発生しました" },
      { status: 500 }
    );
  }
}
