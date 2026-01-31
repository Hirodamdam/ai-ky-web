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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // ✅ DB保存に必要
    const project_id = (body?.project_id ?? "").toString().trim();
    const ky_entry_id = (body?.ky_entry_id ?? "").toString().trim(); // = kyId

    // ✅ 入力
    const work_detail = (body?.work_detail ?? "").toString().trim();
    const title = (body?.title ?? "無題").toString().trim();
    const weather = (body?.weather ?? "").toString().trim();
    const wind_direction = (body?.wind_direction ?? "").toString().trim();
    const wind_speed_text = (body?.wind_speed_text ?? "").toString().trim();
    const precipitation_mm = body?.precipitation_mm ?? null;
    const temperature_text = (body?.temperature_text ?? "").toString().trim();
    const template_text = (body?.template_text ?? "").toString().trim();

    if (!project_id || !ky_entry_id) {
      return NextResponse.json(
        { ok: false, error: "project_id / ky_entry_id が必要です" },
        { status: 400 }
      );
    }
    if (!work_detail) {
      return NextResponse.json(
        { ok: false, error: "作業内容（work_detail）が空です" },
        { status: 400 }
      );
    }

    // OpenAI
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY が設定されていません" },
        { status: 500 }
      );
    }
    const client = new OpenAI({ apiKey });

    // Supabase (service role)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Supabase env 不足（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）",
        },
        { status: 500 }
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ✅ ここが「ky_ai_generations.input（NOT NULL）」に入れるべき内容
    // 画面と同じ形で保存しておくと、後で再生成・監査・比較に使えます。
    const input = {
      project_id,
      ky_entry_id,
      title,
      work_detail,
      weather,
      temperature_text,
      wind_direction,
      wind_speed_text,
      precipitation_mm,
      template_text: template_text || null,
    };

    const prompt = `
あなたは建設現場の安全管理担当です。
以下の入力からKY（危険予知活動）を作成してください。

【入力】
タイトル: ${title}
作業内容: ${work_detail}

気象:
- 天気: ${weather}
- 気温: ${temperature_text}℃
- 風向: ${wind_direction}
- 風速: ${wind_speed_text} m/s
- 降水量: ${precipitation_mm ?? ""} mm

${
  template_text
    ? `【テンプレ（この現場の標準・注意事項）】
${template_text}
`
    : ""
}

【出力条件】
以下のJSONのみを返してください（余計な文章は禁止）。
{
  "title": "...",
  "work_detail": "...",
  "hazards": "...",
  "countermeasures": "...",
  "notes": "..."
}
危険要因と対策は箇条書き風に、現場でそのまま使える表現にしてください。
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    });

    const text = completion.choices?.[0]?.message?.content ?? "";

    // パース
    let json = safeJsonParse(text);
    if (!json) {
      const match = text.match(/\{[\s\S]*\}/);
      json = match ? safeJsonParse(match[0]) : null;
    }
    if (!json) {
      return NextResponse.json(
        { ok: false, error: "AIの返答がJSON形式ではありません" },
        { status: 500 }
      );
    }

    // ✅ output（フラットJSON）
    const result = {
      title: (json.title ?? title) as string,
      work_detail: (json.work_detail ?? work_detail) as string,
      hazards: (json.hazards ?? "") as string,
      countermeasures: (json.countermeasures ?? "") as string,
      notes: (json.notes ?? "") as string,
    };

    // ✅ DBへ保存（input は NOT NULL 対応）
    console.log("[AI GEN] insert start", {
      project_id,
      ky_entry_id,
      hasInput: !!input,
      outputKeys: Object.keys(result),
    });

    const { data: insData, error: insErr } = await admin
      .from("ky_ai_generations")
      .insert([
        {
          project_id,
          ky_entry_id,
          input, // ✅ これが必須
          output: result,
        },
      ])
      .select("id, project_id, ky_entry_id, created_at")
      .single();

    console.log("[AI GEN] insert result", { insData, insErr });

    if (insErr) {
      return NextResponse.json(
        { ok: false, error: `ky_ai_generations insert failed: ${insErr.message}` },
        { status: 500 }
      );
    }

    // 返却（互換維持）
    return NextResponse.json({
      ok: true,
      data: result,
      generation: insData,
      ...result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "サーバーエラー" },
      { status: 500 }
    );
  }
}
