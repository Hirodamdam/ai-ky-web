// app/api/ky-unread-list/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  projectId: string;
  kyId: string;
  accessToken: string;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function normEntrantNo(v: any): string {
  return s(v).trim();
}

type UnreadEntry = {
  entrant_no: string;
  entrant_name: string | null;
  partner_company_name: string | null;
};

function displayName(e: UnreadEntry): string {
  // ✅ 表示は「氏名」優先。無ければ会社名。最後に番号。
  return s(e.entrant_name).trim() || s(e.partner_company_name).trim() || s(e.entrant_no).trim() || "（不明）";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = s(body.projectId).trim();
    const kyId = s(body.kyId).trim();
    const accessToken = s(body.accessToken).trim();

    const adminUserId = process.env.KY_ADMIN_USER_ID;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!adminUserId || !url || !anonKey || !serviceKey) {
      return NextResponse.json(
        {
          error:
            "Missing env: KY_ADMIN_USER_ID / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY",
        },
        { status: 500 }
      );
    }
    if (!projectId || !kyId || !accessToken) {
      return NextResponse.json({ error: "projectId/kyId/accessToken required" }, { status: 400 });
    }

    // admin確認
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (userData.user.id !== adminUserId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // KY整合確認
    const { data: ky, error: kyErr } = await adminClient
      .from("ky_entries")
      .select("id, project_id")
      .eq("id", kyId)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "KY not found" }, { status: 404 });
    if (s(ky.project_id) !== projectId) return NextResponse.json({ error: "Project mismatch" }, { status: 400 });

    // ✅ 期待対象（入場登録：個人No）
    const { data: entrants, error: entErr } = await adminClient
      .from("project_entrant_entries")
      .select("entrant_no, entrant_name, partner_company_name, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (entErr) {
      return NextResponse.json({
        ok: true,
        mode: "none",
        unread: [],
        unread_entries: [],
        note: "project_entrant_entries not available",
      });
    }

    const expected: UnreadEntry[] = (Array.isArray(entrants) ? entrants : [])
      .map((e: any) => ({
        entrant_no: normEntrantNo(e?.entrant_no),
        entrant_name: s(e?.entrant_name).trim() || null,
        partner_company_name: s(e?.partner_company_name).trim() || null,
      }))
      .filter((x) => !!x.entrant_no);

    // ✅ 既読（entrant_no が入っているものだけ）
    const { data: logs, error: logErr } = await adminClient
      .from("ky_read_logs")
      .select("entrant_no, created_at")
      .eq("ky_id", kyId)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

    const readSet = new Set(
      (Array.isArray(logs) ? logs : [])
        .map((r: any) => normEntrantNo(r?.entrant_no))
        .filter(Boolean)
    );

    const unreadEntries = expected.filter((e) => !readSet.has(e.entrant_no));

    // ✅ 互換：従来の unread:string[] は「表示用」にする（番号だけ表示になるのを防ぐ）
    const unreadLegacy = unreadEntries.map(displayName);

    return NextResponse.json({
      ok: true,
      mode: "person", // 互換
      unread: unreadLegacy, // ✅ ここが「氏名」表示になる
      unread_entries: unreadEntries, // ✅ 本命（eno + 氏名 + 会社）
      counts: {
        expected: expected.length,
        read: readSet.size,
        unread: unreadEntries.length,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
