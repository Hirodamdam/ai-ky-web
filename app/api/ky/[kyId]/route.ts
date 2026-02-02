// app/api/ky/[kyId]/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!url || !serviceKey) {
    throw new Error("Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// ✅ Next.js が期待する Route Handler の第2引数の型はこれ
type Ctx = { params: { kyId: string } };

export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const kyId = params.kyId;
    if (!kyId) {
      return NextResponse.json({ ok: false, error: "kyId required" }, { status: 400 });
    }

    const supabaseAdmin = getAdminClient();

    // ky_entries を削除（あなたのテーブル名に合わせている）
    const { error } = await supabaseAdmin.from("ky_entries").delete().eq("id", kyId);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
