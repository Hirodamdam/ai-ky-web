// app/api/ky-ai-risks/route.ts
import { NextResponse } from "next/server";
import { calcRisk, type RiskBody } from "@/app/lib/risk/calcRisk";

export const runtime = "nodejs";

function flattenReasons(label: string, score: number, reasons: string[]) {
  const top = (reasons || []).slice(0, 3);
  return {
    label,
    score,
    reasons: top.length ? top : ["（理由なし）"],
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RiskBody;

    const out = calcRisk(body);

    // 旧 "calcRiskItems" 相当の簡易items（レビュー表示/テスト用）
    const items = [
      flattenReasons("気象", out.breakdown.weather.score, out.breakdown.weather.reasons),
      flattenReasons("写真", out.breakdown.photo.score, out.breakdown.photo.reasons),
      flattenReasons("第三者", out.breakdown.third_party.score, out.breakdown.third_party.reasons),
      flattenReasons("作業員数", out.breakdown.workers.score, out.breakdown.workers.reasons),
      flattenReasons("キーワード", out.breakdown.keyword.score, out.breakdown.keyword.reasons),
      flattenReasons("文章（人）", out.breakdown.text_quality_human.score, out.breakdown.text_quality_human.reasons),
      flattenReasons("文章（AI）", out.breakdown.text_quality_ai.score, out.breakdown.text_quality_ai.reasons),
    ].sort((a, b) => b.score - a.score);

    return NextResponse.json({
      total_human: out.total_human,
      total_ai: out.total_ai,
      delta: out.delta,
      ai_top5: out.ai_top5,
      items,
      meta: out.meta,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ? String(e.message) : "unknown error" }, { status: 500 });
  }
}
