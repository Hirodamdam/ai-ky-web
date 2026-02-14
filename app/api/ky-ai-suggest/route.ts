// app/api/ky-ai-suggest/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  // KyNew側は変えない前提：どのキーでも拾う
  work_detail?: string;
  workDetail?: string;
  work?: string;

  photo_url?: string;
  photoUrl?: string;
  photo?: string;

  weather_text?: string;
  weatherText?: string;
  weather?: string;

  // 数値がある場合もある（将来用）
  wbgt?: number | string;
  wbgt_c?: number | string;
  temperature_c?: number | string;
  wind_speed_ms?: number | string;
  precipitation_mm?: number | string;

  worker_count?: number | string;
  workerCount?: number | string;

  third_party_level?: string;
  thirdPartyLevel?: string;

  project_name?: string;
  projectName?: string;

  note?: string;
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

function pickBody(body: Body) {
  const work_detail = s(body.work_detail || body.workDetail || body.work).trim();
  const photo_url = s(body.photo_url || body.photoUrl || body.photo).trim();
  const weather_text = s(body.weather_text || body.weatherText || body.weather).trim();

  const worker_count = ni(body.worker_count ?? body.workerCount);
  const third_party_level = s(body.third_party_level || body.thirdPartyLevel).trim();

  const project_name = s(body.project_name || body.projectName).trim();
  const note = s(body.note).trim();

  const wbgt = nf(body.wbgt ?? body.wbgt_c);
  const temperature_c = nf(body.temperature_c);
  const wind_speed_ms = nf(body.wind_speed_ms);
  const precipitation_mm = nf(body.precipitation_mm);

  return {
    work_detail,
    photo_url,
    weather_text,
    worker_count,
    third_party_level,
    project_name,
    note,
    wbgt,
    temperature_c,
    wind_speed_ms,
    precipitation_mm,
  };
}

/** 作業内容から “工種フラグ” を推定（ルールベース補助）
 * 目的：LLMの抜けやすい「必須安全項目」を強制的に検討させる
 * UIは触らず、中身だけ強化する
 */
type Flags = {
  height: boolean; // 高所/足場/屋根/昇降
  lifting: boolean; // クレーン/玉掛け/吊荷
  excavation: boolean; // 掘削/溝/土留め
  confined: boolean; // マンホール/ピット/槽/狭所/酸欠
  traffic: boolean; // 道路/交通規制/車両通行
  heavyMachine: boolean; // 重機/バックホウ/ローラー
  demolition: boolean; // 解体/撤去
  concrete: boolean; // 型枠/打設/圧送
  welding: boolean; // 溶接/溶断/火気
  electrical: boolean; // 電気/活線/ケーブル
  water: boolean; // 水中/河川/排水/ポンプ
};

function inferFlags(work_detail: string, note: string) : Flags {
  const t = (work_detail + " " + note).toLowerCase();

  const hasAny = (words: string[]) => words.some((w) => t.includes(w));

  const f: Flags = {
    height: hasAny(["足場", "高所", "屋根", "はしご", "脚立", "昇降", "作業床", "墜落", "転落", "法肩", "のり面", "法面", "斜面"]),
    lifting: hasAny(["クレーン", "吊", "玉掛", "ワイヤ", "チェーン", "荷", "揚重", "ユニック", "リフト", "ホイスト"]),
    excavation: hasAny(["掘削", "掘り", "溝", "開削", "床掘", "山留", "土留", "埋戻", "埋め戻", "切土", "盛土"]),
    confined: hasAny(["マンホール", "ピット", "槽", "タンク", "ボックス", "函", "暗渠", "狭所", "密閉", "地下", "酸欠", "換気"]),
    traffic: hasAny(["道路", "交通", "車両", "通行", "片側交互", "交通規制", "保安員", "ガードマン", "誘導", "規制"]),
    heavyMachine: hasAny(["重機", "バックホウ", "ユンボ", "ブル", "ローラ", "ローラー", "ダンプ", "フォークリフト", "舗装機", "フィニッシャ"]),
    demolition: hasAny(["解体", "撤去", "はつり", "斫り", "破砕", "取り壊", "撤去"]),
    concrete: hasAny(["型枠", "打設", "生コン", "コンクリート", "圧送", "ポンプ", "バイブレータ", "養生"]),
    welding: hasAny(["溶接", "溶断", "ガス", "火気", "切断", "グラインダ", "サンダ", "バーナ"]),
    electrical: hasAny(["電気", "活線", "配線", "ケーブル", "分電盤", "感電", "照明"]),
    water: hasAny(["河川", "水中", "排水", "ポンプ", "湧水", "止水", "冠水", "水替"]),
  };

  return f;
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
    photo_url,
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

  // 情報不足は「表示する」ため、ここで不足項目を列挙
  const missing: string[] = [];
  if (!work_detail) missing.push("作業内容（内容の具体：高所有無/重機有無/掘削深さ/交通規制有無 など）");
  if (!weather_text && wbgt == null && temperature_c == null) missing.push("気象（WBGT/気温/要約）");
  if (!photo_url) missing.push("写真（危険箇所の推定精度が下がる）");
  if (!third_party_level) missing.push("第三者状況（多い/少ない/なし）");

  const missingText = missing.length ? missing.join("、") : "なし";

  // 工種フラグ推定（ルールベース）
  const flags = inferFlags(work_detail, note);
  const flagsText = flagsToText(flags);

  // 熱中症を“出してよいか”の判定を明確化してモデルに渡す（禁止条件を強く）
  // - WBGT<21: 絶対出さない
  // - WBGT>=25: 出す
  // - 不明: 気温>=30で出す、<=24で出さない、25-29は負荷次第（推測）
  const heatRule = [
    "【熱中症の判断（厳守）】",
    "・WBGT < 21 → 熱中症（危険予知/対策）を一切出力しない（例外なし）",
    "・WBGT 21〜24 → 重労働/防護具/直射日光などで熱負荷が高い場合のみ出力（推測なら推測と明記）",
    "・WBGT >= 25 → 熱中症を出力する",
    "・WBGT不明時：気温が30℃以上なら出力、25℃未満なら出力しない。25〜29℃は作業負荷次第（推測明記）。",
  ].join("\n");

  // 不足時の“質問候補”は ai_work_detail に1行だけ入れてもらう（表示形式は維持）
  const askHint =
    !work_detail
      ? "（入力補足の例：重機の有無／高所作業の有無／掘削深さ／交通規制の有無／吊荷の有無／狭所作業の有無）"
      : "";

  return [
    "あなたは建設現場の安全管理（KY）の専門家です。出力は必ず日本語で、現場でそのまま使える実務文にしてください。",
    "甘い評価は禁止（厳しめ）。ただし、根拠のない決めつけは禁止。推測は『推測』と明記する。",
    "",
    "【今回の狙い（中身の強化）】",
    "・工種が変わっても抜けが出ないように、作業内容から“推定フラグ”を立て、該当する必須安全項目を必ず盛り込む。",
    "・書式や表示を簡素化しない（実務で使える粒度）。",
    "・情報不足は隠さず表示する（不足を明示し、見落としを抑える）。",
    "",
    heatRule,
    "",
    "【入力】",
    project_name ? `工事名/現場名: ${project_name}` : undefined,
    `作業内容: ${work_detail || "（未入力）"}`,
    `写真URL: ${photo_url || "（なし）"}`,
    `気象要約: ${weather_text || "（なし）"}`,
    `WBGT(任意): ${wbgt == null ? "（不明）" : wbgt}`,
    `気温(任意): ${temperature_c == null ? "（不明）" : temperature_c}`,
    `風速(任意): ${wind_speed_ms == null ? "（不明）" : wind_speed_ms}`,
    `降雨(任意): ${precipitation_mm == null ? "（不明）" : precipitation_mm}`,
    `作業員数: ${worker_count || 0}`,
    `第三者状況: ${third_party_level || "（未選択）"}（多い/少ない/なし）`,
    note ? `備考: ${note}` : undefined,
    `情報不足（自動判定）: ${missingText} ${askHint}`.trim(),
    "",
    "【推定フラグ（作業内容から機械的に推定）】",
    `推定: ${flagsText}`,
    "※ 推定フラグが立っている項目は、危険予知と対策に必ず入れること（抜け禁止）。",
    "",
    "【推定フラグ別：必須で検討して入れる安全項目】",
    "・高所/足場/斜面 → 墜落・転落（親綱/フルハーネス/足場点検/立入区画/離隔）",
    "・揚重/吊荷 → 玉掛け/合図者/吊荷下立入禁止/使用器具点検/旋回範囲区画",
    "・掘削/溝 → 崩壊（法勾配/土留め/立入禁止/重機と縁端離隔/湧水対策）",
    "・狭所/マンホール → 酸欠（測定/換気/監視員/救出手順/保護具）",
    "・道路/交通規制 → 車両接触（規制材/誘導員/徐行/第三者動線分離/夜間は反射材）",
    "・重機使用 → 接触/巻き込まれ（死角/合図/動線分離/旋回範囲/退避場所）",
    "・解体/撤去 → 倒壊/飛来落下（手順/養生/立入禁止/上部確認/散水粉じん）",
    "・コンクリート/圧送 → ホース暴れ/転倒（固定/合図/圧送停止手順/足元整理）",
    "・火気 → 火災/火傷（火気監視/消火器/可燃物除去/火花養生）",
    "・電気 → 感電（停電確認/活線禁止/検電/絶縁/漏電遮断）",
    "・水/排水 → 冠水/転倒（排水計画/ポンプ監視/滑り止め/退避経路）",
    "",
    "【第三者に関する必須ルール】",
    "・第三者が『多い』なら：通行時は作業停止→誘導で通す、誘導員専任、区画強化、見回り頻度増を必ず入れる。",
    "・第三者が『少ない』でも：動線分離とサイン、接近時の停止ルールは入れる。",
    "・第三者が『なし』でも：第三者欄を空にしない。通常保安（バリケード/サイン/見回り）を1〜3項目で出す。",
    "",
    "【出力仕様（厳守）】",
    "1) JSONのみを出力（前後に文章を付けない、コードブロックにしない）",
    "2) JSONは次のキーを必ず含める（他のキーは禁止）:",
    "- ai_work_detail: string（先頭に『情報不足: …』を表示し、その後に作業内容を安全観点で補足。1〜5行。簡素化しない）",
    "- ai_hazards: string（『・』箇条書き。各行は必ず『〇〇だから、〇〇が起こる』形式。5〜10項目目安）",
    "- ai_countermeasures: string（『・』箇条書き。hazardsに対応。具体策のみ。抽象語だけは禁止）",
    "- ai_third_party: string（『・』箇条書き。第三者状況に応じ、誘導/停止/区画/見回りを具体化。空欄禁止）",
    "",
    "【品質条件】",
    "・危険予知は『現場で本当に起こり得るもの』を優先し、一般論の羅列は禁止。",
    "・不足情報がある場合は、不足に起因する見落としリスクを1〜2項目、推測として追加してよい（推測明記）。",
    "・写真URLがある場合は、写真から読み取れる可能性がある危険を1〜2項目だけ追加してよい（推測明記）。",
    "",
    "【出力例の形（参考）】",
    '{"ai_work_detail":"...","ai_hazards":"・...","ai_countermeasures":"・...","ai_third_party":"・..."}',
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
    const input = pickBody(body);

    // 何も無いは弾く（ただし不足表示はモデル側で行う）
    if (
      !input.work_detail &&
      !input.photo_url &&
      !input.weather_text &&
      input.wbgt == null &&
      input.temperature_c == null
    ) {
      return NextResponse.json(
        { error: "Missing input: work_detail/photo_url/weather_text/wbgt/temperature_c" },
        { status: 400 }
      );
    }

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

    // 画像URLがある場合はマルチモーダル（対応モデル前提）
    const userContent: any = input.photo_url
      ? [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: input.photo_url } },
        ]
      : userPrompt;

    // ✅ Structured Outputs（JSON Schema）で崩れ防止
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
        temperature: 0.2, // 実務安定重視
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

    // ✅ 4枠を必ずstringで返す（KyNew初期UIを壊さない）
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
