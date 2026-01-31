import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE)"
    );
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const kyEntryId = String(body?.ky_entry_id ?? "");
    const projectId = String(body?.project_id ?? "");
    const action = String(body?.action ?? ""); // approve | unapprove
    const actorUserId = body?.actor_user_id ? String(body.actor_user_id) : null;
    const note = body?.note ? String(body.note) : null;

    if (!kyEntryId || !projectId) {
      return NextResponse.json({ error: "ky_entry_id / project_id required" }, { status: 400 });
    }
    if (action !== "approve" && action !== "unapprove") {
      return NextResponse.json({ error: "action must be approve|unapprove" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // 1) ky_entries 更新
    const nextApproved = action === "approve";

    const { error: uerr } = await admin
      .from("ky_entries")
      .update({ is_approved: nextApproved })
      .eq("id", kyEntryId);

    if (uerr) throw uerr;

    // 2) ログ追記
    const { error: lerr } = await admin.from("ky_approval_logs").insert({
      ky_entry_id: kyEntryId,
      project_id: projectId,
      actor_user_id: actorUserId,
      action,
      note,
    });

    if (lerr) throw lerr;

    return NextResponse.json({ ok: true, is_approved: nextApproved });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "server error" }, { status: 500 });
  }
}
