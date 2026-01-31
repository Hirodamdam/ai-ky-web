import { NextResponse } from "next/server";
import OpenAI from "openai";

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clampText(s: unknown, max = 4000): string {
  const t = (s ?? "").toString();
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * POST /api/ky/reflect
 * body: { project_id, ky_entry_id, title, work_detail, hazards, countermeasures, notes, weather, ... }
 * return: { ok: true, patch: { hazards, countermeasures, notes, title? } }
 *
 * - 採用状態（is_approved）は「変更しない」
 * - 既存の手入力を壊しにくいように、基本は hazards/countermeasures/notes を補完
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const project_id = clampText(body?.project_id, 200);
    const ky_entry_id = clampText(body?.ky_entry_id, 200);

    const title = clampText(body?.title, 200);
    const work_detail = clampText(body?.work_detail, 4000);

    const hazards = clampText(body?.hazards, 4000);
    const countermeasures = clampText(body?.countermeasures, 4000);
    const notes = clampText(body?.notes, 4000);

    const weather = clampText(body?.weather, 100);
    const temperature_text = clampText(body?.temperature_text, 30);
    const wind_direction = clampText(body?.wind_direction, 30);
    const wind_speed_text = clampText(body?.wind_speed_text, 30);
    const precipitation_mm =
      body?.precipitation_mm === null || body?.precipitation_mm === undefined
        ? null
        : Number(body?.precipitation_mm);
    const workers =
      body?.workers === null || body?.workers === undefined ? null : Number(body?.workers);

    if (!work_detail.trim()) {
      return NextResponse.json(
        { ok: false, error: "作業内容（work_detail）が空です" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY が未設定です" },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

    const system = `
あなたは日本の建設現場向けKY（危険予知）の補助AIです。
与えられた入力（作業内容・天候等）を読み、次のJSONだけを出力してください。

要件:
- 出力は必ずJSON（前後に文章を付けない）
- 既存の手入力（hazards/countermeasures/notes/title）を尊重し、必要なら追記・整形して改善する
- 記載は簡潔で、現場で使う言い回し
- is_approved など承認状態は扱わない（出力しない）
- 文章は日本語

JSONスキーマ:
{
  "patch": {
    "title": string | null,
    "hazards": string | null,
    "countermeasures": string | null,
    "notes": string | null
  }
}

方針:
- title は入力が空/短すぎる場合のみ改善案を返す（それ以外は null）
- hazards / countermeasures / notes は、入力が空なら生成、入力があれば「崩さずに」軽く整える・不足分を補う（過剰に長くしない）
`.trim();

    const user = {
      project_id,
      ky_entry_id,
      input: {
        title,
        work_detail,
        hazards,
        countermeasures,
        notes,
        weather,
        temperature_text,
        wind_direction,
        wind_speed_text,
        precipitation_mm,
        workers,
      },
    };

    // ※モデル名は環境により変えたければここだけ差し替え
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
    });

    const text = completion.choices?.[0]?.message?.content ?? "";
    const json = safeJsonParse(text);

    if (!json || typeof json !== "object") {
      return NextResponse.json(
        {
          ok: false,
          error: "AI応答がJSONとして解釈できませんでした",
          raw: text.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const patch = json.patch ?? null;
    if (!patch || typeof patch !== "object") {
      return NextResponse.json(
        { ok: false, error: "AI応答に patch がありません" },
        { status: 502 }
      );
    }

    // 余計なキーを削る（安全策）
    const safePatch: Record<string, any> = {
      title: patch.title ?? null,
      hazards: patch.hazards ?? null,
      countermeasures: patch.countermeasures ?? null,
      notes: patch.notes ?? null,
    };

    // 返すのは「変更したいキーだけ」に絞る（nullは除外）
    const filteredPatch: Record<string, any> = {};
    for (const k of Object.keys(safePatch)) {
      const v = safePatch[k];
      if (v === null || v === undefined) continue;
      if (typeof v !== "string") continue;
      filteredPatch[k] = v;
    }

    return NextResponse.json({ ok: true, patch: filteredPatch });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
