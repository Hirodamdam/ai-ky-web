import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type Body = {
  // 表示用（任意）
  project_name?: string | null;
  site_name?: string | null;
  contractor_name?: string | null; // 施工会社（固定で渡してOK）
  partner_company_name?: string | null;

  // KY
  work_date?: string | null;
  work_detail?: string | null; // 作業内容（複数可）
  hazards?: string | null; // 人入力
  countermeasures?: string | null; // 人入力

  // 気象
  weather?: string | null;
  temperature_text?: string | null;
  wind_direction?: string | null;
  wind_speed_text?: string | null;
  precipitation_mm?: number | null;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const contractor = s(body.contractor_name || "株式会社三竹工業").trim();
    const partner = s(body.partner_company_name).trim();

    const workDate = s(body.work_date).trim();
    const workDetail = s(body.work_detail).trim();

    if (!workDetail) {
      return NextResponse.json(
        { error: "作業内容（work_detail）が空です。" },
        { status: 400 }
      );
    }

    const weather = s(body.weather).trim();
    const temp = s(body.temperature_text).trim();
    const windDir = s(body.wind_direction).trim();
    const windSpd = s(body.wind_speed_text).trim();
    const precip = n(body.precipitation_mm);

    const hazardsHuman = s(body.hazards).trim();
    const measuresHuman = s(body.countermeasures).trim();

    const projectName = s(body.project_name).trim();
    const siteName = s(body.site_name).trim();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = `
あなたは日本の建設現場向けの安全衛生（KY：危険予知活動）の専門家。
ユーザーが入力した「作業内容」「危険」「対策」と、気象条件を踏まえて、
「危険予知活動（KY）」の文章を“現場でそのまま印刷して使える体裁”で生成する。

制約（必須）:
- 出力は日本語。
- 厚労省やWebの事例・リンク・引用は一切出さない（参照しない）。
- 見出し・構成は指定テンプレを厳守。
- 作業内容が複数行/複数項目の場合は、作業の塊を維持しつつ全体として「リスクが高い順」に危険(K)を並べ替える。
- 想定される主な危険（K）は 3〜6 件。各Kは具体的に。
- 対策（Y）は K と対応する形で、実行可能なレベルまで具体化（現場で言える文）。
- 最後に「本日の重点KY（指差呼称）」を短く強く1フレーズ。
- 最後に「作業前確認（朝礼で共有）」を4〜6項目。
- 余計な前置き・謝罪・注釈は禁止。テンプレ以外の段落を増やさない。
`;

    const user = `
次の入力を前提に、テンプレどおりに「危険予知活動（KY）」を作成してください。

【基本情報（表示用）】
- 工事名: ${projectName || "（未指定）"}
- 現場名: ${siteName || "（未指定）"}
- 施工会社: ${contractor || "株式会社三竹工業"}
- 協力会社: ${partner || "（未指定）"}
- 作業日: ${workDate || "（未指定）"}

【人の入力】
- 作業内容:
${workDetail}

- 危険（人が入力）:
${hazardsHuman || "（未入力）"}

- 対策（人が入力）:
${measuresHuman || "（未入力）"}

【気象条件】
- 天気: ${weather || "（未指定）"}
- 気温: ${temp || "（未指定）"}
- 風向: ${windDir || "（未指定）"}
- 風速: ${windSpd || "（未指定）"}
- 降水量(mm): ${precip == null ? "（未指定）" : String(precip)}

【出力テンプレ（この順序・見出し固定）】
## 危険予知活動（KY）

### 作業内容
（作業内容を短く整理）

### 作業条件の特徴（本日のポイント）
（気象＋作業から、箇条書き4〜6）

## 想定される主な危険（K）
### ① ...
- ...
### ② ...
- ...
（③以降も同様）

## 危険に対する対策（Y）
### ◆ ...
- ...
（カテゴリ分け。Kに対応）

## 本日の重点KY（指差呼称）
**「...」**

## 作業前確認（朝礼で共有）
- ...
- ...
`;

    const r = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: system.trim() },
        { role: "user", content: user.trim() },
      ],
    });

    const text = (r.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "AI出力が空でした。" }, { status: 500 });
    }

    return NextResponse.json({ ai_supplement: text });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "AI補足生成に失敗しました。" },
      { status: 500 }
    );
  }
}
