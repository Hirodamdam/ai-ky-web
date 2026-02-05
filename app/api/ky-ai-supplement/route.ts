// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

type Body = {
  work_detail?: string | null;
  hazards?: string | null;
  countermeasures?: string | null;
  third_party_level?: string | null;

  weather_slots?: Array<{
    hour: 9 | 12 | 15;
    weather_text: string;
    temperature_c: number | null;
    wind_direction_deg: number | null;
    wind_speed_ms: number | null;
    precipitation_mm: number | null;
  }> | null;

  slope_photo_url?: string | null;
  slope_prev_photo_url?: string | null;
  path_photo_url?: string | null;
  path_prev_photo_url?: string | null;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function fmtSlots(slots: any[] | null | undefined): string {
  const arr = Array.isArray(slots) ? slots : [];
  if (!arr.length) return "（未取得）";
  return arr
    .map((x) => {
      const h = x?.hour;
      const w = x?.weather_text ?? "";
      const t = x?.temperature_c == null ? "—" : `${x.temperature_c}℃`;
      const wd = x?.wind_direction_deg == null ? "—" : String(x.wind_direction_deg);
      const ws = x?.wind_speed_ms == null ? "—" : `${x.wind_speed_ms}m/s`;
      const p = x?.precipitation_mm == null ? "—" : `${x.precipitation_mm}mm`;
      return `${h}:00 ${w} / 気温${t} / 風向${wd} / 風速${ws} / 雨量${p}`;
    })
    .join("\n");
}

/** AI出力から4枠を抜き出す */
function extractSection(all: string, header: string, nextHeaders: string[]): string {
  const norm = all.replace(/\r\n/g, "\n");
  const idx = norm.indexOf(header);
  if (idx < 0) return "";
  const after = norm.slice(idx + header.length);
  let end = after.length;
  for (const nh of nextHeaders) {
    const j = after.indexOf(nh);
    if (j >= 0) end = Math.min(end, j);
  }
  return after.slice(0, end).trim();
}

/** URL画像をサーバーで取得し dataURL に変換（OpenAIが外部URLへ取りに行かないように） */
async function fetchAsDataUrl(url: string, timeoutMs = 8000): Promise<string | null> {
  const u = s(url).trim();
  if (!u) return null;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(u, { method: "GET", cache: "no-store", signal: controller.signal });
    if (!res.ok) return null;

    const ct = res.headers.get("content-type") || "image/jpeg";
    const ab = await res.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** OpenAI呼び出し（失敗時に画像なしへフォールバック） */
async function callOpenAIWithFallback(args: {
  openai: OpenAI;
  model: string;
  system: string;
  userText: string;
  images: Array<{ label: string; dataUrl: string }>;
}) {
  const { openai, model, system, userText, images } = args;

  const buildMessages = (useImages: boolean) => {
    if (!useImages || images.length === 0) {
      return [
        { role: "system", content: system },
        { role: "user", content: userText },
      ] as any;
    }

    const content: any[] = [{ type: "text", text: userText }];
    for (const img of images) {
      content.push({ type: "text", text: `\n${img.label}\n` });
      content.push({ type: "image_url", image_url: { url: img.dataUrl } });
    }

    return [
      { role: "system", content: system },
      { role: "user", content },
    ] as any;
  };

  // ① 画像ありで試す
  try {
    return await openai.chat.completions.create({
      model,
      temperature: 0.3,
      messages: buildMessages(true),
    } as any);
  } catch (e: any) {
    const msg = (e?.message ?? "").toLowerCase();

    // 画像ダウンロード系は text-only で再試行して必ず返す
    const looksLikeImageFetchFail =
      msg.includes("timeout while downloading") ||
      msg.includes("failed to download") ||
      msg.includes("could not download") ||
      msg.includes("image") ||
      msg.includes("400");

    if (!looksLikeImageFetchFail) throw e;

    return await openai.chat.completions.create({
      model,
      temperature: 0.3,
      messages: buildMessages(false),
    } as any);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const workDetail = s(body.work_detail).trim();
    if (!workDetail) {
      return NextResponse.json({ error: "作業内容（work_detail）が空です。" }, { status: 400 });
    }

    const hazardsHuman = s(body.hazards).trim();
    const measuresHuman = s(body.countermeasures).trim();
    const third = s(body.third_party_level).trim();

    const slopeNowUrl = s(body.slope_photo_url).trim();
    const slopePrevUrl = s(body.slope_prev_photo_url).trim();
    const pathNowUrl = s(body.path_photo_url).trim();
    const pathPrevUrl = s(body.path_prev_photo_url).trim();

    const slotsText = fmtSlots(body.weather_slots ?? null);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const hasSlopePair = !!(slopeNowUrl && slopePrevUrl);
    const hasPathPair = !!(pathNowUrl && pathPrevUrl);

    const system = `
あなたは日本の建設現場向けの安全衛生（KY：危険予知活動）の専門家。
入力（作業内容/危険/対策/第三者）と気象（9/12/15）を踏まえ、
「AI補足」を4枠（作業内容/危険予知/対策/第三者）に分けて、現場でそのまま貼り付けられる文章を生成する。

【最重要ルール（必須）】
- 出力は日本語。
- 余計な前置き・謝罪・注釈は禁止。指定フォーマット以外の段落を増やさない。
- 各枠は箇条書き（「- 」開始）で統一。
- 各枠は最大5点まで。1点は短文（1行）で、具体行動にする。
- 曖昧語（例：注意する、気をつける、徹底する、十分に）は禁止。必ず「何を／どこで／誰が／どうする／停止基準」まで書く。
- Webリンク・引用・出典・URLの列挙は禁止。

【画像の扱い（任意）】
- 画像がある場合：画像から見える事実に基づき、短く補足する（想像で断定しない。見えないことは書かない）。
- 画像が無い場合でも必ず生成し、気象と作業内容を軸にする。
- （重要）前回と今回が両方ある場合は、差分（変化点）を必ず3点以内で抽出し、その差分が生む危険と対策を「危険予知」「対策」に落とし込む。
  - 差分が読み取れない場合は「変化点（判別困難）」とし、気象と作業条件に基づくリスクへ切り替える。

【出力フォーマット（固定・厳守）】
【AI補足｜作業内容】
- ...
【AI補足｜危険予知】
- ...
【AI補足｜対策】
- ...
【AI補足｜第三者】
- ...
`.trim();

    const userText = `
【人の入力】
- 作業内容:
${workDetail}

- 危険（人が入力）:
${hazardsHuman || "（未入力）"}

- 対策（人が入力）:
${measuresHuman || "（未入力）"}

- 第三者（墓参者）の状況:
${third || "（未指定）"}

【気象（9/12/15）】
${slotsText}

【画像（任意）】
- 法面（今回）: ${slopeNowUrl ? "あり" : "なし"}
- 法面（前回）: ${slopePrevUrl ? "あり" : "なし"}
- 通路（今回）: ${pathNowUrl ? "あり" : "なし"}
- 通路（前回）: ${pathPrevUrl ? "あり" : "なし"}

【差分指示（写真が揃う場合のみ必須）】
- 法面：${hasSlopePair ? "前回と今回の差分を3点以内で抽出し、危険予知/対策に反映する" : "（差分なし：写真が揃っていない）"}
- 通路：${hasPathPair ? "前回と今回の差分を3点以内で抽出し、危険予知/対策に反映する" : "（差分なし：写真が揃っていない）"}
`.trim();

    // ✅ サーバーで画像を dataURL 化（失敗した画像は無視）
    const images: Array<{ label: string; dataUrl: string }> = [];

    const slopeNowData = await fetchAsDataUrl(slopeNowUrl);
    if (slopeNowData) images.push({ label: "【法面（今回）】", dataUrl: slopeNowData });

    const slopePrevData = await fetchAsDataUrl(slopePrevUrl);
    if (slopePrevData) images.push({ label: "【法面（前回）】", dataUrl: slopePrevData });

    const pathNowData = await fetchAsDataUrl(pathNowUrl);
    if (pathNowData) images.push({ label: "【通路（今回）】", dataUrl: pathNowData });

    const pathPrevData = await fetchAsDataUrl(pathPrevUrl);
    if (pathPrevData) images.push({ label: "【通路（前回）】", dataUrl: pathPrevData });

    const r = await callOpenAIWithFallback({
      openai,
      model,
      system,
      userText,
      images,
    });

    const text = (r.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "AI出力が空でした。" }, { status: 500 });
    }

    const H_WORK = "【AI補足｜作業内容】";
    const H_HAZ = "【AI補足｜危険予知】";
    const H_MEA = "【AI補足｜対策】";
    const H_THI = "【AI補足｜第三者】";

    const ai_work_detail = extractSection(text, H_WORK, [H_HAZ, H_MEA, H_THI]);
    const ai_hazards = extractSection(text, H_HAZ, [H_WORK, H_MEA, H_THI]);
    const ai_countermeasures = extractSection(text, H_MEA, [H_WORK, H_HAZ, H_THI]);
    const ai_third_party = extractSection(text, H_THI, [H_WORK, H_HAZ, H_MEA]);

    return NextResponse.json({
      ai_supplement: text,
      ai_work_detail,
      ai_hazards,
      ai_countermeasures,
      ai_third_party,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "AI補足生成に失敗しました。" }, { status: 500 });
  }
}
