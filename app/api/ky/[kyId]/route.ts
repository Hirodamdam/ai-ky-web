import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function DELETE(req: Request, { params }: { params: { kyId: string } }) {
  try {
    const kyId = params.kyId;

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const auth = req.headers.get("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const accessToken = m?.[1];
    if (!accessToken) return NextResponse.json({ error: "Missing Authorization Bearer token" }, { status: 401 });

    const authed = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const userRes = await authed.auth.getUser();
    if (userRes.error || !userRes.data.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const admin = createClient(url, serviceKey);

    const { data: ky, error: readErr } = await admin.from("ky_entries").select("id,is_approved").eq("id", kyId).maybeSingle();
    if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "KY not found" }, { status: 404 });

    if ((ky as any).is_approved === true) {
      return NextResponse.json({ error: "Approved KY cannot be deleted" }, { status: 400 });
    }

    const { error: delErr } = await admin.from("ky_entries").delete().eq("id", kyId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Delete failed" }, { status: 500 });
  }
}
