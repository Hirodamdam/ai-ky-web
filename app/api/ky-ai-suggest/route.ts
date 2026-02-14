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

function parseBulletLines(text: string): string[] {
  return s(text)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[-•・\s]+/, "").trim())
    .filter(Boolean);
}

function rebuildRiskItemsFromTexts(aiHazardsText: string, aiCounterText: string): RiskItem[] {
  const hs = parseBulletLines(aiHazardsText);
  const csRaw = parseBulletLines(aiCounterText);
  const cs = csRaw.map((x) => x.replace(/^\(?\d+\)?\s*[）)]?\s*/, "").trim());

  const n = Math.min(Math.max(hs.length, 0), 10);
  const items: RiskItem[] = [];
  for (let i = 0; i < n; i++) {
    items.push({
      rank: i + 1,
      hazard: hs[i] || "",
      countermeasure: cs[i] || "",
    });
  }
  // hazardsだけある/対策だけあるケースの補正
  // 対策が少ない場合は空で入れる（UIは表示できる）
  return items.slice(0, 5).filter((x) => x.hazard);
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
  // 最低5件を必ず返す。因果形式＆具体対策（雑になりすぎない範囲）
  const base: Array<{ h: string; m: string }> = [];

  // 交通・第三者が絡む系（ガードレール設置などに強い）
  base.push({
    h: "車両通行がある環境だから、作業員が車道側へ出て接触事故が起こる",
    m: "規制帯（コーン・バー）で作業域を確保し、誘導員を配置して接近車両を減速・停止誘導する",
  });
  base.push({
    h: "資材（ガードレール・支柱）を手運び/取回すから、落下・挟まれで手指を負傷する",
    m: "搬入経路を確保し、2人運搬・合図統一・手袋着用、仮置きは転倒しない向きで固定する",
  });
  base.push({
    h: "足元が不整地・段差になりやすいから、つまずき転倒して捻挫・打撲が起こる",
    m: "作業前に足元整地、通路確保、資材の置き場を決めて散乱させない（5S）",
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

  if (flags.lifting) {
    base.push({
      h: "吊荷作業があるから、吊荷下に入って落下・転倒災害が起こる",
      m: "吊荷下立入禁止を徹底し、玉掛け点検・合図者統一・旋回範囲区画を行う",
    });
  } else if (flags.height) {
    base.push({
      h: "法面/段差に近い作業だから、足を滑らせて転落が起こる",
      m: "法肩から離隔し、必要時は親綱・フルハーネス、立入規制で作業域を明確化する",
    });
  } else {
    base.push({
      h: "工具・資材を扱うから、飛来・落下で頭部を負傷する",
      m: "ヘルメット着用、上部作業の有無確認、資材は安定した場所へ仮置きして転倒防止する",
    });
  }

  // 第三者補正（墓参者）
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

  // 5件に整形
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

function buildUserPrompt(input: ReturnType<typeof pickBody>) {
  const {
    work_detail, photo_slope_url, photo_path_url, weather_text,
    worker_count, third_party_level, project_name, note,
    wbgt, temperature_c, wind_speed_ms, precipitation_mm,
  } = input;

  const missing: string[] = [];
  if (!work_detail) missing.push("作業内容");
  if (!weather_text && wbgt == null && temperature_c == null) missing.push("気象");
  if (!photo_slope_url && !photo_path_url) missing.push("写真");
  if (!third_party_level) missing.push("第三者状況");
  const missingText = missing.length ? missing.join("、") : "なし";

  const heatRule = [
    "【熱中症の判断（厳守）】",
    "・WBGT < 21 → 熱中症（危険予知/対策）を一切出力しない（例外なし）",
    "・WBGT 21〜24 → 熱負荷が高い場合のみ出力（推測なら推測と明記）",
    "・WBGT >= 25 → 熱中症を出力する",
    "・WBGT不明時：気温30℃以上なら出力、25℃未満なら出力しない。25〜29℃は作業負荷次第（推測明記）。",
  ].join("\n");

  return [
    "あなたは建設現場の安全管理（KY）の専門家です。出力は必ず日本語、現場でそのまま使える実務文。",
    "甘い評価は禁止（厳しめ）。根拠のない断定は禁止。推測は『推測』と明記。",
    "",
    heatRule,
    "",
    "【入力】",
    project_name ? `工事名/現場名: ${project_name}` : undefined,
    `作業内容: ${work_detail || "（未入力）"}`,
    `作業員数: ${worker_count || 0}`,
    `第三者状況: ${third_party_level || "（未選択）"}`,
    `気象要約: ${weather_text || "（なし）"}`,
    `WBGT: ${wbgt == null ? "（不明）" : wbgt}`,
    `気温: ${temperature_c == null ? "（不明）" : temperature_c}`,
    `風速: ${wind_speed_ms == null ? "（不明）" : wind_speed_ms}`,
    `降雨: ${precipitation_mm == null ? "（不明）" : precipitation_mm}`,
    `写真URL（法面）: ${photo_slope_url || "（なし）"}`,
    `写真URL（通路）: ${photo_path_url || "（なし）"}`,
    note ? `備考: ${note}` : undefined,
    `情報不足: ${missingText}`,
    "",
    "【出力仕様（厳守）】",
    "JSONのみ。キーは4つ固定：ai_work_detail, ai_hazards, ai_countermeasures, ai_third_party",
    "ai_hazards：『・』箇条書き。各行は必ず『〇〇だから、〇〇が起こる』形式（5〜10項目）",
    "ai_countermeasures：hazardsに対応（同数）、具体策のみ",
    "ai_third_party：空欄禁止",
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
      "JSON以外の出力は禁止。余計な文章・注釈・コードブロック禁止。",
      "危険予知は因果（『〇〇だから、〇〇が起こる』）を厳守。対策は具体策のみ。",
      "WBGT<21 は熱中症を一切出力しない。",
    ].join("\n");

    const userPrompt = buildUserPrompt(input);

    const imageParts: any[] = [];
    if (input.photo_slope_url) imageParts.push({ type: "image_url", image_url: { url: input.photo_slope_url } });
    if (input.photo_path_url) imageParts.push({ type: "image_url", image_url: { url: input.photo_path_url } });

    const userContent: any = imageParts.length
      ? [{ type: "text", text: userPrompt }, ...imageParts]
      : userPrompt;

    // JSON崩れ防止（strict schema）
    const response_format = {
      type: "json_schema",
      json_schema: {
        name: "ky_ai_suggest",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ai_work_detail", "ai_hazards", "ai_countermeasures", "ai_third_party"],
          properties: {
            ai_work_detail: { type: "string" },
            ai_hazards: { type: "string" },
            ai_countermeasures: { type: "string" },
            ai_third_party: { type: "string" },
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

    const out = {
      ai_work_detail: s(obj?.ai_work_detail),
      ai_hazards: s(obj?.ai_hazards),
      ai_countermeasures: s(obj?.ai_countermeasures),
      ai_third_party: s(obj?.ai_third_party),
    };

    // ✅ ここが本修正：必ず ai_risk_items を作る
    let items = rebuildRiskItemsFromTexts(out.ai_hazards, out.ai_countermeasures);

    // モデルが空を返した/薄い場合のフォールバック（抜け防止）
    if (!items.length) {
      const flags = inferFlags(input.work_detail, input.note);
      items = fallbackRiskItems(input.work_detail || "（作業内容未入力）", input.third_party_level || "", flags);
      // 文字列も合わせて作る（保存互換も維持）
      out.ai_hazards = items.map((x) => `・${x.hazard}`).join("\n");
      out.ai_countermeasures = items.map((x) => `・（${x.rank}）${x.countermeasure}`).join("\n");
    }

    // ✅ 互換キーも返す（KyNew/Reviewがどれを参照してもOK）
    return NextResponse.json({
      ...out,
      ai_risk_items: items.slice(0, 5),
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
