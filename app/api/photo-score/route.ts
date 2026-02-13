// app/api/photo-score/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  projectId?: string;
  workDate?: string;
  imageUrls?: string[];
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function safeArray(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => s(x).trim()).filter(Boolean);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * ✅ 最小のIスコア（0〜1）
 * 後でここを本物の画像AIに差し替えるだけでOK。
 */
function pseudoScore(imageUrls: string[]): { score: number; meta: any } {
  const n = imageUrls.length;
  let score = n >= 2 ? 0.75 : 0.55;

  const joined = imageUrls.join(" ").toLowerCase();
  if (joined.includes("supabase")) score += 0.05;
  if (joined.includes("storage")) score += 0.05;

  score = clamp(score, 0, 1);

  return {
    score,
    meta: {
      engine: "pseudo-v1",
      count: n,
      urls: imageUrls.slice(0, 5),
    },
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const projectId = s(body.projectId).trim();
    const workDate = s(body.workDate).trim();
    const imageUrls = safeArray(body.imageUrls);

    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    if (!workDate) return NextResponse.json({ error: "workDate required" }, { status: 400 });

    if (!imageUrls.length) {
      return NextResponse.json({ score: null, meta: { reason: "no_images" } });
    }

    const out = pseudoScore(imageUrls);
    return NextResponse.json({ score: out.score, meta: out.meta });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "photo-score error" }, { status: 500 });
  }
}
