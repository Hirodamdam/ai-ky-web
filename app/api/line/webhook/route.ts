// app/api/line/webhook/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, route: "/api/line/webhook" }, { status: 200 });
}

export async function POST() {
  return NextResponse.json({ ok: true, method: "POST" }, { status: 200 });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
