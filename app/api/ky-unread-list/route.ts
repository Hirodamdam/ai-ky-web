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
  return s(v).trim().toUpperCase();
}

// ✅ 既読/未読の表記ゆれ対策（半角/全角空白・タブ除去）
function normName(v: any): string {
  return s(v).replace(/[ 　\t]/g, "").trim();
}

// entrant_no 列が無い環境のエラーを吸収（PostgREST / PG の文言差があるので広め）
function isMissingColumnErr(err: any, col: string): boolean {
  const msg = s(err?.message || err?.details || err?.hint);
  const code = s(err?.code);
  if (code === "42703") return true; // PG undefined_column
  if (msg.includes(col) && (msg.includes("does not exist") || msg.includes("not exist") || msg.includes("Unknown column"))) return true;
  if (msg.includes(col) && msg.includes("column")) return true;
  return false;
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
    const body = (await req.json().catch(() => ({}))) as Body;

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

    // ✅ 既読ログ取得（entrant_no列があれば使う。無ければ reader_name だけで突合する）
    let logs: any[] = [];
    let hasEntrantNoColumn = true;

    const q1 = await adminClient
      .from("ky_read_logs")
      .select("entrant_no, reader_name, created_at")
      .eq("ky_id", kyId)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (q1.error) {
      if (isMissingColumnErr(q1.error, "entrant_no")) {
        hasEntrantNoColumn = false;

        const q2 = await adminClient
          .from("ky_read_logs")
          .select("reader_name, created_at")
          .eq("ky_id", kyId)
          .order("created_at", { ascending: false })
          .limit(5000);

        if (q2.error) return NextResponse.json({ error: q2.error.message }, { status: 500 });
        logs = Array.isArray(q2.data) ? (q2.data as any[]) : [];
      } else {
        return NextResponse.json({ error: q1.error.message }, { status: 500 });
      }
    } else {
      logs = Array.isArray(q1.data) ? (q1.data as any[]) : [];
    }

    // entrant_no 既読（列がある場合のみ）
    const readEntrantSet = new Set(
      hasEntrantNoColumn
        ? logs.map((r: any) => normEntrantNo(r?.entrant_no)).filter(Boolean)
        : []
    );

    // reader_name 既読（必ず使う）
    const readNameSet = new Set(logs.map((r: any) => normName(r?.reader_name)).filter(Boolean));

    // ✅ 未読判定
    // 1) entrant_no が既読なら除外（列がある場合）
    // 2) entrant_name が既読者名と一致（空白除去後）なら除外
    // 3) 会社名が既読者名と一致（空白除去後）なら除外（公開側が会社名保存のケース）
    // 4) 「No:XXXX」表記で保存されているケースも吸収
    const unreadEntries = expected.filter((e) => {
      if (hasEntrantNoColumn && readEntrantSet.has(e.entrant_no)) return false;

      const en = normName(e.entrant_name);
      if (en && readNameSet.has(en)) return false;

      const cn = normName(e.partner_company_name);
      if (cn && readNameSet.has(cn)) return false;

      const noLabel = normName(`No:${e.entrant_no}`);
      if (noLabel && readNameSet.has(noLabel)) return false;

      return true;
    });

    const unreadLegacy = unreadEntries.map(displayName);

    return NextResponse.json({
      ok: true,
      mode: "person",
      unread: unreadLegacy,
      unread_entries: unreadEntries,
      counts: {
        expected: expected.length,
        read_entrant: hasEntrantNoColumn ? readEntrantSet.size : null,
        read_name: readNameSet.size,
        unread: unreadEntries.length,
        has_entrant_no_column: hasEntrantNoColumn,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
