// app/api/ky-create/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const accessToken = m?.[1];
    if (!accessToken) {
      return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // ✅ ユーザーセッションの検証（なりすまし防止）
    const authed = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const userRes = await authed.auth.getUser();
    if (userRes.error || !userRes.data.user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    const body = await req.json();

    // ✅ Service Role で保存（RLS/401を回避）
    const admin = createClient(url, serviceKey);
    const { error } = await admin.from("ky_entries").insert(body);

    if (error) {
      return NextResponse.json({ error: error.message, details: error.details, hint: error.hint, code: error.code }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "ky create failed" }, { status: 500 });
  }
}
