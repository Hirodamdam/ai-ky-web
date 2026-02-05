// app/api/ky-unapprove/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Body = {
  projectId: string;
  kyId: string;
  accessToken?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = body?.projectId?.trim();
    const kyId = body?.kyId?.trim();
    const accessToken = body?.accessToken ?? null;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const adminUserId =
      process.env.KY_ADMIN_USER_ID ||
      process.env.NEXT_PUBLIC_KY_ADMIN_USER_ID ||
      null;

    if (!projectId || !kyId) {
      return NextResponse.json({ error: "projectId / kyId required" }, { status: 400 });
    }
    if (!adminUserId) {
      return NextResponse.json(
        { error: "Missing env: KY_ADMIN_USER_ID (or NEXT_PUBLIC_KY_ADMIN_USER_ID)" },
        { status: 500 }
      );
    }
    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    // ▼ accessToken があれば管理者確認
    if (accessToken) {
      const authClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });

      const { data, error } = await authClient.auth.getUser();

      if (error || !data?.user?.id) {
        return NextResponse.json({ error: "Invalid session" }, { status: 401 });
      }

      if (data.user.id !== adminUserId) {
        return NextResponse.json({ error: "Admin only" }, { status: 403 });
      }
    }

    // ▼ service_role で承認解除
    const admin = createClient(url, serviceKey);

    const { error: updErr } = await admin
      .from("ky_entries")
      .update({
        is_approved: false,
        approved_at: null,
        approved_by: null,
      })
      .eq("id", kyId)
      .eq("project_id", projectId);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unhandled error" }, { status: 500 });
  }
}
