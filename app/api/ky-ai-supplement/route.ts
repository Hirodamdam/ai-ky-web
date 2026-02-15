// app/api/ky-ai-supplement/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type WeatherSlot = {
  hour: 9 | 12 | 15;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
};

type Body = {
  work_detail: string;

  hazards?: string | null;
  countermeasures?: string | null;

  third_party_level?: string | null; // "多い" | "少ない" | ""

  weather_slots?: WeatherSlot[] | null;

  slope_photo_url?: string | null; // 今回
  slope_prev_photo_url?: string | null; // 前回
  path_photo_url?: string | null; // 今回
  path_prev_photo_url?: string | null; // 前回
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function normalizeText(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").replace(/\u3000/g, " ").trim();
}

function stripBulletLead(x: string): string {
  return x.replace(/^\s*(?:[•・\-*]\s*)/, "").trim();
}

function safeUrl(u: any): string | null {
  const t = s(u).trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t)) return null;
  return t;
}

/** 先頭タグを外す（【作業】など） */
function peelTag(line: string): { tag: string; body: string } {
  const t = stripBulletLead(normalizeText(line));
  const m = t.match(/^(【(作業|気象|写真)】)\s*(.*)$/);
  if (!m) return { tag: "", body: t };
  return { tag: m[1], body: (m[3] || "").trim() };
}

/** 因果形式を保証（タグがあれば維持） */
function ensureCausal(line: string): string {
  const { tag, body } = peelTag(line);
  const t = stripBulletLead(normalizeText(body));
  if (!t) return "";

  if (/(だから|ため|恐れ|起こる|発生|転倒|転落|接触|巻き込まれ|飛来|墜落|滑落|挟まれ|火傷|やけど)/.test(t)) {
    return tag ? `${tag} ${t}` : t;
  }

  const base = t;
  const risk =
    /(足元|段差|滑り|ぬかるみ|凍結)/.test(base)
      ? "つまずき・転倒が起こる"
      : /(法面|斜面|崩壊|土砂|滑落|落石)/.test(base)
      ? "転落・崩壊が起こる"
      : /(舗装|アスファルト|合材|フィニッシャ|ローラ|転圧)/.test(base)
      ? "接触・巻き込まれ・火傷が起こる"
      : /(吹付|ノズル|ホース|圧送|ポンプ|跳ね返り)/.test(base)
      ? "飛散・高圧噴射による受傷が起こる"
      : /(回転|巻き込|攪拌|ミキサ|ベルト|チェーン)/.test(base)
      ? "巻き込まれが起こる"
      : /(重機|バックホウ|ユンボ|車両|ダンプ|死角)/.test(base)
      ? "接触・巻き込まれが起こる"
      : "事故が起こる";

  const out = `${base}だから、${risk}`;
  return tag ? `${tag} ${out}` : out;
}

function joinLines(arr: string[]): string {
  return arr
    .map((x) => normalizeText(x))
    .map((x) => stripBulletLead(x))
    .filter((x) => x.length >= 1)
    .join("\n");
}

/** =========================
 *  OpenAI Responses API（タイムアウト/リトライ）
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
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
          (typeof (x as any).text === "string" ? (x as any).text : "") ||
          (typeof (x as any).content === "string" ? (x as any).content : "") ||
          (typeof (x as any).value === "string" ? (x as any).value : "") ||
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
    .filter((x) => x.length >= 1);
}

function weatherSummary(slots: WeatherSlot[] | null | undefined): {
  text: string;
  isFineDry: boolean;
  isWindy: boolean;
  isHot: boolean;
} {
  const arr = Array.isArray(slots) ? slots : [];
  if (!arr.length) return { text: "（気象データなし）", isFineDry: false, isWindy: false, isHot: false };

  const srt = arr
    .filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15))
    .sort((a, b) => a.hour - b.hour);

  let maxWind = 0;
  let maxTemp = -999;
  let maxPrec = 0;
  let fineLike = 0;

  const lines = srt.map((x) => {
    const w = s(x.weather_text) || "不明";
    const t = x.temperature_c == null ? null : Number(x.temperature_c);
    const ws = x.wind_speed_ms == null ? null : Number(x.wind_speed_ms);
    const p = x.precipitation_mm == null ? null : Number(x.precipitation_mm);

    if (ws != null && !Number.isNaN(ws)) maxWind = Math.max(maxWind, ws);
    if (t != null && !Number.isNaN(t)) maxTemp = Math.max(maxTemp, t);
    if (p != null && !Number.isNaN(p)) maxPrec = Math.max(maxPrec, p);

    if (/晴|快晴|日差し/.test(w)) fineLike++;

    return `${x.hour}時: ${w} / 気温${t == null ? "—" : `${t}℃`} / 風速${ws == null ? "—" : `${ws}m/s`} / 降水${p == null ? "—" : `${p}mm`}`;
  });

  const isWindy = maxWind >= 6;
  const isHot = maxTemp >= 28;
  const isFineDry = maxPrec === 0 && fineLike >= 1;

  return { text: lines.join("\n"), isFineDry, isWindy, isHot };
}

/** ---------- タグカウント/補強（削除なし：足りなければ追記） ---------- */
function countTag(lines: string[], tag: "【作業】" | "【気象】" | "【写真】"): number {
  return (lines || []).filter((x) => stripBulletLead(normalizeText(x)).startsWith(tag)).length;
}

function hasAnyWorkHint(workDetail: string): boolean {
  const t = normalizeText(workDetail);
  if (!t) return false;
  // “舗装工”のように短い場合も拾う
  return /(舗装|表層|基層|切削|乳剤|合材|アスファルト|転圧|ローラ|フィニッシャ|ダンプ|敷均し|締固め)/.test(t);
}

function buildWorkExtras(workDetail: string): { hazards: string[]; measures: string[] } {
  const t = normalizeText(workDetail);
  const isPaving = /(舗装|表層|基層|合材|アスファルト|転圧|ローラ|フィニッシャ|ダンプ|敷均し|締固め)/.test(t) || /舗装工/.test(t);

  if (isPaving) {
    return {
      hazards: [
        "【作業】ダンプが後退して合材を投入するから、接触・巻き込まれが起こる",
        "【作業】フィニッシャ周辺で合材が移動するから、巻き込まれが起こる",
        "【作業】ローラ転圧中に死角が大きいから、接触が起こる",
        "【作業】敷均し作業で後退動作が多いから、つまずき・転倒が起こる",
        "【作業】合材が高温だから、火傷が起こる",
        "【作業】路面端部や段差部で足元が不安定だから、転倒が起こる",
        "【作業】施工区画が狭く第三者動線が近いから、接触事故が起こる",
        "【作業】手元作業が機械近接になるから、挟まれが起こる",
      ].map(ensureCausal),
      measures: [
        "【作業】ダンプ後退は誘導員を必ず配置し、合図を一本化（無線or手旗）して合図者以外は指示しない",
        "【作業】フィニッシャ周辺は立入禁止帯を設定し、手元作業員の立ち位置（左右/後方）を事前に固定する",
        "【作業】ローラ運転手と作業員の接近禁止距離を決め、旋回・後退時は一時停止→安全確認→再開とする",
        "【作業】敷均しは進行方向を統一し、後退が必要な場面は声掛け＋指差呼称で足元確認を徹底する",
        "【作業】高温合材の取扱いは耐熱手袋・長袖・保護眼鏡を使用し、飛散が出る作業は顔面保護を追加する",
        "【作業】段差・路肩側はカラーコーンで縁を明示し、立ち入りを制限して転倒リスクを下げる",
        "【作業】第三者動線側はバリケード・ロープ・看板で区画し、接近時は作業停止→誘導→再開の手順を徹底する",
        "【作業】機械近接の手元作業は最小人数・短時間にし、開始前に『合図・停止基準・退避方向』を再確認する",
      ].map((x) => stripBulletLead(normalizeText(x))),
    };
  }

  // 汎用（作業詳細が薄いときの最低限）
  return {
    hazards: [
      "【作業】資機材の運搬・仮置きがあるから、転倒・落下が起こる",
      "【作業】作業員の動線が交錯するから、接触・転倒が起こる",
      "【作業】足元の不陸・段差があるから、つまずき・転倒が起こる",
      "【作業】車両や重機が出入りするから、接触・巻き込まれが起こる",
      "【作業】手元作業が多いから、挟まれ・切創が起こる",
      "【作業】作業区画が狭いから、第三者侵入で事故が起こる",
      "【作業】片付け・清掃が後回しになるから、転倒が起こる",
      "【作業】合図系統が曖昧だと、誤動作で接触が起こる",
    ].map(ensureCausal),
    measures: [
      "【作業】資機材は仮置き禁止帯を設定し、転倒防止（楔止め/固定/端部養生）を徹底する",
      "【作業】動線を一方通行にし、交錯点は誘導員または停止合図で管理する",
      "【作業】段差・不陸は事前にマーキングし、危険箇所は立入規制して踏まない動線にする",
      "【作業】車両・重機の作業半径を明示し、接近禁止距離と停止基準を全員で共有する",
      "【作業】手元作業は保護具（手袋/保護眼鏡）を使用し、挟まれ箇所に手を入れない手順にする",
      "【作業】第三者動線側は区画（ロープ/柵/看板)し、接近時は作業停止→誘導→再開の手順を徹底する",
      "【作業】片付けは工程内に組み込み、通路は常に確保してつまずき要因を残さない",
      "【作業】合図は一本化（合図者固定）し、無線/手旗のどちらかに統一して誤認を防ぐ",
    ].map((x) => stripBulletLead(normalizeText(x))),
  };
}

function padWorkIfNeeded(hazards: string[], measures: string[], workDetail: string) {
  const minWork = 8;

  const hWork = countTag(hazards, "【作業】");
  const mWork = countTag(measures, "【作業】");

  if (hWork >= minWork && mWork >= minWork) return { hazards, measures };

  const extras = buildWorkExtras(workDetail);

  const nextHaz = [...hazards];
  const nextMea = [...measures];

  // ✅ 削除なし：足りない分だけ追加
  if (hWork < minWork) {
    const need = minWork - hWork;
    nextHaz.push(...extras.hazards.slice(0, Math.min(need, extras.hazards.length)));
  }
  if (mWork < minWork) {
    const need = minWork - mWork;
    nextMea.push(...extras.measures.slice(0, Math.min(need, extras.measures.length)));
  }

  return { hazards: nextHaz, measures: nextMea };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const workDetail = normalizeText(s(body?.work_detail));
    if (!workDetail) return NextResponse.json({ error: "work_detail is required" }, { status: 400 });

    const apiKey = (process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim();

    const thirdLevel = normalizeText(s(body?.third_party_level));

    const wx = weatherSummary(Array.isArray(body?.weather_slots) ? (body.weather_slots as WeatherSlot[]) : []);
    const slopeNow = safeUrl(body?.slope_photo_url);
    const slopePrev = safeUrl(body?.slope_prev_photo_url);
    const pathNow = safeUrl(body?.path_photo_url);
    const pathPrev = safeUrl(body?.path_prev_photo_url);

    const systemText = [
      "あなたは日本の建設現場の安全管理（所長補佐）。",
      "出力は必ずJSONのみ。前置き/解説/挨拶は禁止。JSON以外を出力しない。",
      "",
      "入力は「作業内容」「気象要約」「写真（今回/前回）」「第三者（墓参者）の多寡」のみ。",
      "",
      "【超重要：本システム仕様】",
      "・要約/短縮/上位抽出は禁止。省略しない。",
      "・必ず“最低行数”と“タグ配分”を満たす。足りない場合は作業内容を工程分解して埋める。",
      "",
      "【出力ルール】",
      "1) hazards は必ず『〇〇だから、〇〇が起こる』形式。1行=1項目（配列要素）。",
      "2) measures は具体策（誰が/配置/手順/合図/停止基準/点検/保護具/立入規制）。『注意する』だけは禁止。1行=1項目。",
      "3) タグ必須：hazards/measures の各行の先頭に必ず【作業】【気象】【写真】のいずれかを付ける。",
      "",
      "【最低行数（絶対）】",
      "・hazards: 12行以上",
      "・measures: 12行以上",
      "・third: 8行以上（第三者が多い場合は10行以上推奨）",
      "",
      "【タグ配分（絶対）】",
      "・hazards の【作業】は必ず8行以上（先頭から優先的に配置）。",
      "・measures の【作業】は必ず8行以上（hazardsの【作業】と概ね対応する順）。",
      "・【気象】は2〜6行、【写真】は2〜6行を目安にする。",
      "",
      "【作り方】",
      "・作業内容を工程分解（準備→運搬→施工→片付け）し、工程ごとの危険を具体化。",
      "・写真は今回/前回の差分を拾い、危険と対策に反映。",
      "・作業内容が短い（例：舗装工）場合は一般的な工程（合材運搬→敷均し→転圧→切返し→清掃/片付け）で補完して作る。",
    ].join("\n");

    const userText = [
      "【作業内容】",
      workDetail,
      "",
      "【第三者（墓参者）の多寡】",
      thirdLevel ? thirdLevel : "（未指定）",
      "",
      "【気象要約】",
      wx.text,
      "",
      `【気象フラグ】快晴乾燥=${wx.isFineDry ? "Yes" : "No"} / 強風=${wx.isWindy ? "Yes" : "No"} / 高温=${wx.isHot ? "Yes" : "No"}`,
      "",
      "【写真】",
      "以下の画像（今回/前回）を比較し、危険予知と対策に反映してください。",
      "※ 画像が無い場合は、その項目は想定リスクで補完してください。",
    ].join("\n");

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        hazards: { type: "array", items: { type: "string" } },
        measures: { type: "array", items: { type: "string" } },
        third: { type: "array", items: { type: "string" } },
      },
      required: ["hazards", "measures", "third"],
    } as const;

    const userContent: any[] = [{ type: "input_text", text: userText }];
    if (slopeNow) userContent.push({ type: "input_image", image_url: slopeNow });
    if (slopePrev) userContent.push({ type: "input_image", image_url: slopePrev });
    if (pathNow) userContent.push({ type: "input_image", image_url: pathNow });
    if (pathPrev) userContent.push({ type: "input_image", image_url: pathPrev });

    const buildPayload = (maxTokens: number) => ({
      model,
      input: [
        { role: "system", content: [{ type: "input_text", text: systemText }] },
        { role: "user", content: userContent },
      ],
      text: { format: { type: "json_schema", name: "ky_ai_supplement", strict: true, schema } },
      temperature: 0.4,
      max_output_tokens: maxTokens,
    });

    const timeout1 = Number(process.env.OPENAI_TIMEOUT_MS || "60000");
    const timeout2 = Number(process.env.OPENAI_TIMEOUT_MS_RETRY || "60000");

    let resp: any = null;
    try {
      resp = await callOpenAIResponses(buildPayload(3000), apiKey, timeout1);
    } catch (e: any) {
      if (!isAbortError(e)) {
        return NextResponse.json({ error: e?.message ?? "OpenAI API error", detail: e?.detail ?? null }, { status: 500 });
      }
      resp = await callOpenAIResponses(buildPayload(2400), apiKey, timeout2);
    }

    const anyText = extractAnyTextFromResponses(resp);
    const parsed = parseJsonLoosely(anyText) ?? {};

    // ✅ 削除なし（そのまま取り出し）
    const hazardsRaw = normalizeArrayToStrings(parsed?.hazards);
    const measuresRaw = normalizeArrayToStrings(parsed?.measures);
    const thirdRaw = normalizeArrayToStrings(parsed?.third);

    const hazards0 = hazardsRaw.map(ensureCausal).filter((x) => x.length >= 1);
    const measures0 = measuresRaw.map((x) => stripBulletLead(normalizeText(x))).filter((x) => x.length >= 1);
    const third = thirdRaw.map((x) => stripBulletLead(normalizeText(x))).filter((x) => x.length >= 1);

    // ✅ 【作業】が出ない事故を潰す（削除なし＝不足分を追記）
    const padded = padWorkIfNeeded(hazards0, measures0, workDetail);

    return NextResponse.json({
      ai_hazards: joinLines(padded.hazards),
      ai_countermeasures: joinLines(padded.measures),
      ai_third_party: joinLines(third),

      ai_hazards_items: padded.hazards,
      ai_countermeasures_items: padded.measures,
      ai_third_party_items: third,

      model_used: model,
      meta: {
        work_detail_has_hint: hasAnyWorkHint(workDetail),
        counts: {
          hazards_work: countTag(padded.hazards, "【作業】"),
          measures_work: countTag(padded.measures, "【作業】"),
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
