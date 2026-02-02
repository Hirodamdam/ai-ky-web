// app/api/projects-update/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  projectId: string;
  accessToken: string; // supabase session access_token（ログイン確認用）
  patch: Record<string, any>;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    if (!body?.projectId || !body?.accessToken || !body?.patch) {
      return NextResponse.json({ error: "projectId / accessToken / patch required" }, { status: 400 });
    }

    // ① まず anon で accessToken が有効かだけ確認
    const anon = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${body.accessToken}` } },
    });
    const { data: userData, error: userErr } = await anon.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ② Service Role で更新（RLS回避）
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { error: upErr } = await admin
      .from("projects")
      .update(body.patch)
      .eq("id", body.projectId);

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
