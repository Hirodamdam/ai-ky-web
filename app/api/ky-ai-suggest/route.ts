// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = Record<string, any>;

type RiskItem = {
  rank: number;
  hazard: string;
  countermeasure: string;
  score?: number;
  tags?: string[];
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}
function nf(v: any): number | null {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(x) ? x : null;
}
function ni(v: any): number {
  const x = nf(v);
  return x == null ? 0 : x;
}
function firstNonEmpty(body: Body, keys: string[]) {
  for (const k of keys) {
    const v = body?.[k];
    const t = s(v).trim();
    if (t) return t;
  }
  return "";
}

type Flags = {
  height: boolean;
  lifting: boolean;
  excavation: boolean;
  confined: boolean;
  traffic: boolean;
  heavyMachine: boolean;
  demolition: boolean;
  concrete: boolean;
  welding: boolean;
  electrical: boolean;
  water: boolean;
};

function inferFlags(work_detail: string, note: string): Flags {
  const t = (work_detail + " " + note).toLowerCase();
  const hasAny = (words: string[]) => words.some((w) => t.includes(w));
  return {
    height: hasAny(["足場", "高所", "屋根", "はしご", "脚立", "昇降", "作業床", "法肩", "のり面", "法面", "斜面"]),
    lifting: hasAny(["クレーン", "吊", "玉掛", "ワイヤ", "チェーン", "揚重", "ユニック", "リフト", "ホイスト"]),
    excavation: hasAny(["掘削", "溝", "開削", "床掘", "山留", "土留", "埋戻", "埋め戻", "切土", "盛土"]),
    confined: hasAny(["マンホール", "ピット", "槽", "タンク", "暗渠", "狭所", "密閉", "地下", "酸欠", "換気"]),
    traffic: hasAny(["道路", "交通", "車両", "通行", "片側交互", "交通規制", "保安員", "ガードマン", "誘導", "規制", "ガードレール"]),
    heavyMachine: hasAny(["重機", "バックホウ", "ユンボ", "ブル", "ローラ", "ローラー", "ダンプ", "フォークリフト", "フィニッシャ"]),
    demolition: hasAny(["解体", "撤去", "はつり", "斫り", "破砕", "取り壊"]),
    concrete: hasAny(["型枠", "打設", "生コン", "コンクリート", "圧送", "ポンプ", "バイブレータ", "養生"]),
    welding: hasAny(["溶接", "溶断", "ガス", "火気", "切断", "グラインダ", "サンダ", "バーナ"]),
    electrical: hasAny(["電気", "活線", "配線", "ケーブル", "分電盤", "感電", "照明"]),
    water: hasAny(["河川", "水中", "排水", "ポンプ", "湧水", "止水", "冠水", "水替"]),
  };
}

function fallbackRiskItems(work_detail: string, third_party_level: string, flags: Flags): RiskItem[] {
  const base: Array<{ h: string; m: string }> = [];

  // ガードレール設置工で頻出（交通・資材取回し）
  base.push({
    h: "車両の通行がある環境だから、作業員が車道側へ出て接触事故が起こる",
    m: "規制帯（コーン・バー）で作業域を確保し、誘導員を配置して接近車両を減速・停止誘導する",
  });
  base.push({
    h: "ガードレール・支柱を取回すから、落下・挟まれで手指を負傷する",
    m: "2人運搬・合図統一・手袋着用、仮置きは転倒しない向きで固定し、手指を挟む位置に置かない",
  });
  base.push({
    h: "足元が不整地・段差になりやすいから、つまずき転倒して捻挫・打撲が起こる",
    m: "作業前に足元整地、通路確保、資材置き場を決めて散乱させない（5S）",
  });

  if (flags.heavyMachine) {
    base.push({
      h: "重機の旋回・バック動作があるから、死角で接触・巻き込まれが起こる",
      m: "合図者を専任し、旋回範囲を区画、接近禁止ラインを設定して退避位置を周知する",
    });
  } else {
    base.push({
      h: "作業員が複数で同時に動くから、無意識に接近して接触・転倒が起こる",
      m: "役割分担と立位置を決め、声掛け・合図で同時動作を避ける（合図者1名）",
    });
  }

  base.push({
    h: "工具・資材の取扱いがあるから、飛来・落下で頭部を負傷する",
    m: "ヘルメット着用、工具は落下防止（置き方・手渡し徹底）、上部作業の有無を確認して立入規制する",
  });

  if (third_party_level === "多い") {
    base.unshift({
      h: "第三者（墓参者）が頻繁に接近するから、誘導不足で接触・転倒事故が起こる",
      m: "通行時は作業停止→誘導で通すルールを徹底し、出入口に監視・声掛けを配置する",
    });
  } else if (third_party_level === "少ない") {
    base.unshift({
      h: "第三者（墓参者）が不定期に接近するから、気付かず接触・つまずき事故が起こる",
      m: "出入口に注意表示、接近時は作業一時停止、通路側に資材を置かない運用にする",
    });
  }

  const items: RiskItem[] = [];
  for (let i = 0; i < base.length && items.length < 5; i++) {
    items.push({ rank: items.length + 1, hazard: base[i].h, countermeasure: base[i].m });
  }
  return items;
}

function pickBody(body: Body) {
  const work_detail = firstNonEmpty(body, [
    "work_detail","workDetail","work","work_content","workContent","work_text","workText",
    "task","task_text","taskText","description","content","title",
  ]);

  const photo_slope_url = firstNonEmpty(body, [
    "photo_slope_url","slope_photo_url","slopePhotoUrl","slope_camera_snapshot_url",
    "slopeCameraSnapshotUrl","photo_url","photoUrl","photo",
  ]);

  const photo_path_url = firstNonEmpty(body, [
    "photo_path_url","path_photo_url","pathPhotoUrl","path_camera_snapshot_url","pathCameraSnapshotUrl",
  ]);

  const weather_text = firstNonEmpty(body, [
    "weather_text","weatherText","weather",
    "applied_weather_text","appliedWeatherText","weather_applied_text","weatherAppliedText",
    "applied_weather_label","appliedWeatherLabel",
  ]);

  const wbgt = nf(body?.wbgt ?? body?.wbgt_c ?? body?.WBGT);
  const temperature_c = nf(body?.temperature_c ?? body?.temp_c ?? body?.temperature);
  const wind_speed_ms = nf(body?.wind_speed_ms ?? body?.wind_ms ?? body?.wind_speed);
  const precipitation_mm = nf(body?.precipitation_mm ?? body?.rain_mm ?? body?.precipitation);

  const worker_count = ni(body?.worker_count ?? body?.workerCount ?? body?.workers ?? body?.worker);
  const third_party_level = firstNonEmpty(body, ["third_party_level","thirdPartyLevel","third_party","thirdParty"]);

  const project_name = firstNonEmpty(body, ["project_name","projectName","project","site_name","siteName"]);
  const note = firstNonEmpty(body, ["note","memo","remarks"]);

  return {
    work_detail,
    photo_slope_url,
    photo_path_url,
    weather_text,
    wbgt,
    temperature_c,
    wind_speed_ms,
    precipitation_mm,
    worker_count,
    third_party_level,
    project_name,
    note,
  };
}

function bulletsHaz(items: RiskItem[]) {
  return items.map((x) => `・${x.hazard}`).join("\n");
}
function bulletsMea(items: RiskItem[]) {
  return items.map((x) => `・（${x.rank}）${x.countermeasure}`).join("\n");
}

function buildUserPrompt(input: ReturnType<typeof pickBody>) {
  const {
    work_detail, photo_slope_url, photo_path_url, weather_text,
    worker_count, third_party_level, project_name, note,
    wbgt, temperature_c, wind_speed_ms, precipitation_mm,
  } = input;

  const flags = inferFlags(work_detail, note);
  const flagText = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(", ") || "none";

  return [
    "あなたは建設現場の安全管理（KY）の専門家です。出力は必ず日本語。",
    "甘い内容は禁止。根拠のない断定は禁止。推測は『推測』と明記。",
    "",
    "【熱中症ルール（厳守）】",
    "WBGT < 21 の場合、熱中症に関する危険予知・対策を一切出力しない。",
    "",
    "【入力】",
    project_name ? `現場: ${project_name}` : undefined,
    `作業内容: ${work_detail || "（未入力）"}`,
    `作業員数: ${worker_count || 0}`,
    `第三者状況: ${third_party_level || "（未選択）"}`,
    `気象: ${weather_text || "（なし）"}`,
    `WBGT: ${wbgt == null ? "（不明）" : wbgt}`,
    `気温: ${temperature_c == null ? "（不明）" : temperature_c}`,
    `風速: ${wind_speed_ms == null ? "（不明）" : wind_speed_ms}`,
    `降雨: ${precipitation_mm == null ? "（不明）" : precipitation_mm}`,
    `写真URL（法面）: ${photo_slope_url || "（なし）"}`,
    `写真URL（通路）: ${photo_path_url || "（なし）"}`,
    note ? `備考: ${note}` : undefined,
    "",
    "【推定フラグ（内部）】",
    `flags: ${flagText}`,
    "",
    "【出力仕様（最重要）】",
    "必ず JSON のみで返す。",
    "ai_risk_items は配列で必ず5件。",
    "各 hazard は必ず『〇〇だから、〇〇が起こる』形式（1行）。",
    "countermeasure は具体策のみ（抽象語だけ禁止）。",
    "ガードレール設置工なら「交通規制・車両接触・資材取回し・工具・足元」を必ず含める。",
    "ai_third_party は空欄禁止（第三者が少ない/多いに応じて誘導・停止・区画を具体化）。",
  ].filter(Boolean).join("\n");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Missing request body" }, { status: 400 });
    }

    const input = pickBody(body);

    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim();

    const system = [
      "あなたは建設現場の安全管理（KY）支援AIです。",
      "JSON以外の出力は禁止。コードブロック禁止。",
      "危険予知は因果（『〇〇だから、〇〇が起こる』）を厳守。",
      "WBGT<21 は熱中症を一切出力しない。",
    ].join("\n");

    const userPrompt = buildUserPrompt(input);

    const imageParts: any[] = [];
    if (input.photo_slope_url) imageParts.push({ type: "image_url", image_url: { url: input.photo_slope_url } });
    if (input.photo_path_url) imageParts.push({ type: "image_url", image_url: { url: input.photo_path_url } });

    const userContent: any = imageParts.length
      ? [{ type: "text", text: userPrompt }, ...imageParts]
      : userPrompt;

    // ✅ ここがポイント：ChatGPTに ai_risk_items を直接作らせる（復元しない）
    const response_format = {
      type: "json_schema",
      json_schema: {
        name: "ky_ai_suggest_v2",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ai_work_detail", "ai_risk_items", "ai_third_party"],
          properties: {
            ai_work_detail: { type: "string" },
            ai_third_party: { type: "string" },
            ai_risk_items: {
              type: "array",
              minItems: 5,
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["rank", "hazard", "countermeasure"],
                properties: {
                  rank: { type: "integer", minimum: 1, maximum: 5 },
                  hazard: { type: "string" },
                  countermeasure: { type: "string" },
                  score: { type: "number" },
                  tags: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        response_format,
        temperature: 0.2,
      }),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json({ error: "openai_error", status: r.status, detail: t.slice(0, 2000) }, { status: 502 });
    }

    const data = (await r.json()) as any;
    const content = s(data?.choices?.[0]?.message?.content).trim();
    if (!content) return NextResponse.json({ error: "Empty model content" }, { status: 502 });

    let obj: any;
    try {
      obj = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "Non-JSON response", raw: content.slice(0, 2000) }, { status: 502 });
    }

    let items: RiskItem[] = Array.isArray(obj?.ai_risk_items) ? (obj.ai_risk_items as RiskItem[]) : [];
    items = items
      .map((x, i) => ({
        rank: Number(x?.rank) || (i + 1),
        hazard: s(x?.hazard).trim(),
        countermeasure: s(x?.countermeasure).trim(),
        score: x?.score,
        tags: Array.isArray(x?.tags) ? x.tags : undefined,
      }))
      .filter((x) => x.hazard);

    // 万一崩れたらフォールバック（ただし通常は通らない）
    if (items.length < 5) {
      const flags = inferFlags(input.work_detail, input.note);
      items = fallbackRiskItems(input.work_detail || "（作業内容未入力）", input.third_party_level || "", flags);
    } else {
      items = items.slice(0, 5).map((x, i) => ({ ...x, rank: i + 1 }));
    }

    const ai_work_detail = s(obj?.ai_work_detail).trim() || "";
    const ai_third_party = s(obj?.ai_third_party).trim() || s(obj?.ai_third_party).trim() || "";

    const out = {
      ai_work_detail,
      ai_risk_items: items,
      ai_hazards: bulletsHaz(items),
      ai_countermeasures: bulletsMea(items),
      ai_third_party: ai_third_party || "・区画（コーン・バー）を維持し、接近時は作業を一時停止して安全通行を確保すること",
      // 確認用（画面には出なくてもOK）：生成元
      meta_source: "openai_or_fallback",
      meta_model: model,
    };

    return NextResponse.json({
      ...out,
      // 互換キー
      hazards: out.ai_hazards,
      countermeasures: out.ai_countermeasures,
      third_party: out.ai_third_party,
      hazards_text: out.ai_hazards,
      countermeasures_text: out.ai_countermeasures,
      third_party_text: out.ai_third_party,
      aiHazards: out.ai_hazards,
      aiCountermeasures: out.ai_countermeasures,
      aiThirdParty: out.ai_third_party,
    });
  } catch (e: any) {
    return NextResponse.json({ error: "server_error", detail: s(e?.message).slice(0, 1000) }, { status: 500 });
  }
}
