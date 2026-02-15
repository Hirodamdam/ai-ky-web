// app/api/ky-risk-score/route.ts
import { NextResponse } from "next/server";
import { calcRisk, type RiskBody } from "@/app/lib/risk/calcRisk";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as RiskBody;
    const out = calcRisk(body);
    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ? String(e.message) : "unknown error" },
      { status: 500 }
    );
  }
}
