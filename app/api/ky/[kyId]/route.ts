import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getBearer(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

type Ctx = {
  params: Promise<{ kyId: string }>; // ✅ Next 16 正式仕様
};

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    // ✅ Promise を await する
    const { kyId } = await params;

    const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const accessToken = getBearer(req);
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing Authorization Bearer token" },
        { status: 401 }
      );
    }

    // セッション妥当性チェック（ログイン必須）
    const authed = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });

    const userRes = await authed.auth.getUser();
    if (userRes.error || !userRes.data.user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

    // service role（RLS影響なし）
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    const { data: ky, error: readErr } = await admin
      .from("ky_entries")
      .select("id,is_approved")
      .eq("id", kyId)
      .maybeSingle();

    if (readErr)
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    if (!ky)
      return NextResponse.json({ error: "KY not found" }, { status: 404 });

    if ((ky as any).is_approved === true) {
      return NextResponse.json(
        { error: "Approved KY cannot be deleted" },
        { status: 400 }
      );
    }

    const { error: delErr } = await admin
      .from("ky_entries")
      .delete()
      .eq("id", kyId);

    if (delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Delete failed" },
      { status: 500 }
    );
  }
}
