// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = Record<string, any>;

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

// ✅ いろんなキー名を確実に拾う（KyNew側を変えない）
function firstNonEmpty(body: Body, keys: string[]) {
  for (const k of keys) {
    const v = body?.[k];
    const t = s(v).trim();
    if (t) return t;
  }
  return "";
}

function pickBody(body: Body) {
  // 作業内容（必須欄だが、キー名が環境でズレやすいので広く拾う）
  const work_detail = firstNonEmpty(body, [
    "work_detail",
    "workDetail",
    "work",
    "work_content",
    "workContent",
    "work_text",
    "workText",
    "task",
    "task_text",
    "taskText",
    "description",
    "content",
    "title", // まれにここに入っている実装がある
  ]);

  // 写真URL（法面/通路の複数を想定して拾う）
  const photo_slope_url = firstNonEmpty(body, [
    "photo_slope_url",
    "slope_photo_url",
    "slopePhotoUrl",
    "slope_camera_snapshot_url",
    "slopeCameraSnapshotUrl",
    "photo_url",
    "photoUrl",
    "photo",
  ]);

  const photo_path_url = firstNonEmpty(body, [
    "photo_path_url",
    "path_photo_url",
    "pathPhotoUrl",
    "path_camera_snapshot_url",
    "pathCameraSnapshotUrl",
  ]);

  // 後方互換：単一photo_urlとしても扱う（どちらかあればOK）
  const photo_url = photo_slope_url || photo_path_url;

  // 気象（適用枠のテキストが別キーで来ることがある）
  const weather_text = firstNonEmpty(body, [
    "weather_text",
    "weatherText",
    "weather",
    "applied_weather_text",
    "appliedWeatherText",
    "weather_applied_text",
    "weatherAppliedText",
    "applied_weather_label",
    "appliedWeatherLabel",
  ]);

  // 数値系（任意）
  const wbgt = nf(body?.wbgt ?? body?.wbgt_c ?? body?.WBGT);
  const temperature_c = nf(body?.temperature_c ?? body?.temp_c ?? body?.temperature);
  const wind_speed_ms = nf(body?.wind_speed_ms ?? body?.wind_ms ?? body?.wind_speed);
  const precipitation_mm = nf(body?.precipitation_mm ?? body?.rain_mm ?? body?.precipitation);

  const worker_count = ni(body?.worker_count ?? body?.workerCount ?? body?.workers ?? body?.worker);
  const third_party_level = firstNonEmpty(body, ["third_party_level", "thirdPartyLevel", "third_party", "thirdParty"]);

  const project_name = firstNonEmpty(body, ["project_name", "projectName", "project", "site_name", "siteName"]);
  const note = firstNonEmpty(body, ["note", "memo", "remarks"]);

  return {
    work_detail,
    photo_url,
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

/** 作業内容から “工種フラグ” を推定（ルールベース補助） */
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

function flagsToText(f: Flags) {
  const items: string[] = [];
  if (f.height) items.push("高所/足場/斜面（墜落・転落）");
  if (f.lifting) items.push("揚重/吊荷（玉掛け・吊荷下立入禁止）");
  if (f.excavation) items.push("掘削/溝（崩壊・土留め）");
  if (f.confined) items.push("狭所/マンホール等（酸欠・換気・測定）");
  if (f.traffic) items.push("道路/交通規制（車両接触・誘導）");
  if (f.heavyMachine) items.push("重機使用（接触・死角・合図者）");
  if (f.demolition) items.push("解体/撤去（倒壊・飛来落下）");
  if (f.concrete) items.push("コンクリート（圧送・打設関連）");
  if (f.welding) items.push("火気（火災・火傷）");
  if (f.electrical) items.push("電気（感電）");
  if (f.water) items.push("水（冠水・転倒・流され）");
  return items.length ? items.join(" / ") : "（推定フラグなし）";
}

function buildUserPrompt(input: ReturnType<typeof pickBody>) {
  const {
    work_detail,
    photo_slope_url,
    photo_path_url,
    weather_text,
    worker_count,
    third_party_level,
    project_name,
    note,
    wbgt,
    temperature_c,
    wind_speed_ms,
    precipitation_mm,
  } = input;

  const missing: string[] = [];
  if (!work_detail) missing.push("作業内容（高所有無/重機有無/交通規制有無/吊荷有無/狭所作業有無 など）");
  if (!weather_text && wbgt == null && temperature_c == null) missing.push("気象（WBGT/気温/要約）");
  if (!photo_slope_url && !photo_path_url) missing.push("写真（危険箇所の推定精度が下がる）");
  if (!third_party_level) missing.push("第三者状況（多い/少ない/なし）");

  const missingText = missing.length ? missing.join("、") : "なし";
  const flags = inferFlags(work_detail, note);
  const flagsText = flagsToText(flags);

  const heatRule = [
    "【熱中症の判断（厳守）】",
    "・WBGT < 21 → 熱中症（危険予知/対策）を一切出力しない（例外なし）",
    "・WBGT 21〜24 → 重労働/防護具/直射日光などで熱負荷が高い場合のみ出力（推測なら推測と明記）",
    "・WBGT >= 25 → 熱中症を出力する",
    "・WBGT不明時：気温が30℃以上なら出力、25℃未満なら出力しない。25〜29℃は作業負荷次第（推測明記）。",
  ].join("\n");

  return [
    "あなたは建設現場の安全管理（KY）の専門家です。出力は必ず日本語で、現場でそのまま使える実務文にしてください。",
    "甘い評価は禁止（厳しめ）。ただし、根拠のない決めつけは禁止。推測は『推測』と明記する。",
    "",
    "【今回の狙い】",
    "・工種が変わっても抜けが出ないように、作業内容から“推定フラグ”を立て、該当する必須安全項目を必ず盛り込む。",
    "・表示や書式は簡素化しない（実務で使える粒度）。",
    "・入力不足は隠さず表示する（不足を明示）。",
    "",
    heatRule,
    "",
    "【入力】",
    project_name ? `工事名/現場名: ${project_name}` : undefined,
    `作業内容: ${work_detail || "（未入力）"}`,
    `写真URL（法面）: ${photo_slope_url || "（なし）"}`,
    `写真URL（通路）: ${photo_path_url || "（なし）"}`,
    `気象要約: ${weather_text || "（なし）"}`,
    `WBGT(任意): ${wbgt == null ? "（不明）" : wbgt}`,
    `気温(任意): ${temperature_c == null ? "（不明）" : temperature_c}`,
    `風速(任意): ${wind_speed_ms == null ? "（不明）" : wind_speed_ms}`,
    `降雨(任意): ${precipitation_mm == null ? "（不明）" : precipitation_mm}`,
    `作業員数: ${worker_count || 0}`,
    `第三者状況: ${third_party_level || "（未選択）"}（多い/少ない/なし）`,
    note ? `備考: ${note}` : undefined,
    `情報不足（自動判定）: ${missingText}`,
    "",
    "【推定フラグ（作業内容から推定）】",
    `推定: ${flagsText}`,
    "※ 推定フラグが立っている項目は、危険予知と対策に必ず入れる（抜け禁止）。",
    "",
    "【第三者ルール】",
    "・第三者『多い』：通行時は作業停止→誘導で通す、誘導員専任、区画強化、見回り頻度増を必ず入れる。",
    "・第三者『少ない』：動線分離とサイン、接近時の停止ルールを入れる。",
    "・第三者『なし』：第三者欄は空にしない。通常保安（サイン/区画/見回り）を1〜3項目で出す。",
    "",
    "【出力仕様（厳守）】",
    "JSONのみ（コードブロック禁止）。キーは必ず次の4つのみ：",
    "- ai_work_detail",
    "- ai_hazards（各行『〇〇だから、〇〇が起こる』形式、5〜10項目目安）",
    "- ai_countermeasures（hazardsに対応、具体策のみ）",
    "- ai_third_party（空欄禁止）",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(req: Request) {
  try {
    // ✅ 簡易認証（ヘッダが付いていて一致しない場合のみ弾く：初期を壊さない）
    const pushSecret = process.env.LINE_PUSH_SECRET || "";
    if (pushSecret) {
      const header = req.headers.get("x-line-push-secret") || "";
      if (header && header !== pushSecret) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    // ✅ ここが重要：空ボディ以外は 400 にしない（不足はAIが表示）
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Missing request body" }, { status: 400 });
    }

    const input = pickBody(body);

    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) {
      return NextResponse.json({ error: "Missing env: OPENAI_API_KEY" }, { status: 500 });
    }

    const model = (process.env.OPENAI_MODEL || "gpt-5.2").trim();

    const system = [
      "あなたは建設現場の安全管理（KY）支援AIです。",
      "出力は必ず日本語。JSON Schemaに厳密準拠。余計な文章・注釈・コードブロックは禁止。",
      "危険予知は因果（『〇〇だから、〇〇が起こる』）を厳守し、対策は具体策のみ。",
      "WBGTが低いとき（WBGT<21）は熱中症を一切出力しない。",
      "不足情報は隠さず ai_work_detail に表示する。",
      "推定フラグが立った必須項目は、危険予知と対策に必ず入れる（抜け禁止）。",
    ].join("\n");

    const userPrompt = buildUserPrompt(input);

    // 画像：法面/通路 どちらもあれば両方渡す
    const imageParts: any[] = [];
    if (input.photo_slope_url) imageParts.push({ type: "image_url", image_url: { url: input.photo_slope_url } });
    if (input.photo_path_url) imageParts.push({ type: "image_url", image_url: { url: input.photo_path_url } });

    const userContent: any = imageParts.length
      ? [{ type: "text", text: userPrompt }, ...imageParts]
      : userPrompt;

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
      return NextResponse.json(
        { error: "openai_error", status: r.status, detail: t.slice(0, 2000) },
        { status: 502 }
      );
    }

    const data = (await r.json()) as any;
    const content = s(data?.choices?.[0]?.message?.content).trim();
    if (!content) {
      return NextResponse.json({ error: "Empty model content" }, { status: 502 });
    }

    let obj: any;
    try {
      obj = JSON.parse(content);
    } catch {
      return NextResponse.json({ error: "Non-JSON response", raw: content.slice(0, 2000) }, { status: 502 });
    }

    return NextResponse.json({
      ai_work_detail: s(obj?.ai_work_detail),
      ai_hazards: s(obj?.ai_hazards),
      ai_countermeasures: s(obj?.ai_countermeasures),
      ai_third_party: s(obj?.ai_third_party),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "server_error", detail: s(e?.message).slice(0, 1000) },
      { status: 500 }
    );
  }
}
