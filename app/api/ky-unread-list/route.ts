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

function pickFirst(row: any, keys: string[]): string {
  for (const k of keys) {
    const v = s(row?.[k]).trim();
    if (v) return v;
  }
  return "";
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.map((x) => s(x).trim()).filter(Boolean)));
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
        { error: "Missing env: KY_ADMIN_USER_ID / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }
    if (!projectId || !kyId || !accessToken) {
      return NextResponse.json({ error: "projectId/kyId/accessToken required" }, { status: 400 });
    }

    // admin確認（tokenからuser取得）
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (userData.user.id !== adminUserId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 整合確認（ky.project_id と projectId）
    const { data: ky, error: kyErr } = await adminClient.from("ky_entries").select("id, project_id").eq("id", kyId).maybeSingle();
    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "KY not found" }, { status: 404 });
    if (s(ky.project_id) !== projectId) return NextResponse.json({ error: "Project mismatch" }, { status: 400 });

    // 既読ログ（氏名/会社が列名違いでも拾う）
    const { data: logs, error: logErr } = await adminClient
      .from("ky_read_logs")
      .select("*")
      .eq("ky_id", kyId)
      .order("created_at", { ascending: false });

    if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

    const readPersons = uniq(
      (logs ?? []).map((r: any) => pickFirst(r, ["reader_name", "name", "person_name", "worker_name"])).filter(Boolean)
    );
    const readCompanies = uniq(
      (logs ?? []).map((r: any) => pickFirst(r, ["reader_company_name", "company_name", "partner_company_name"])).filter(Boolean)
    );

    // 入場登録（project_partner_entries）から “読むべき対象” を取る
    // ※ テーブルが無い/列が違う場合でも落とさず empty を返す
    const { data: entrants, error: entErr } = await adminClient
      .from("project_partner_entries")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (entErr) {
      return NextResponse.json({
        ok: true,
        mode: "none",
        expected_persons: [],
        expected_companies: [],
        read_persons: readPersons,
        read_companies: readCompanies,
        unread: [],
        note: "project_partner_entries not available or query failed",
      });
    }

    const expectedPersons = uniq(
      (entrants ?? [])
        .map((e: any) => pickFirst(e, ["worker_name", "person_name", "entrant_name", "contact_name", "user_name", "name"]))
        .filter(Boolean)
    );

    const expectedCompanies = uniq(
      (entrants ?? []).map((e: any) => pickFirst(e, ["partner_company_name", "company_name", "partner_name"])).filter(Boolean)
    );

    // ルール：
    // - 個人名が取れる現場 → 個人名で未読を出す（最優先）
    // - 個人名が取れない現場 → 会社名で未読を出す（会社単位）
    if (expectedPersons.length) {
      const readSet = new Set(readPersons);
      const unread = expectedPersons.filter((x) => !readSet.has(x));
      return NextResponse.json({
        ok: true,
        mode: "person",
        expected_persons: expectedPersons,
        expected_companies: expectedCompanies,
        read_persons: readPersons,
        read_companies: readCompanies,
        unread,
      });
    } else {
      const readSet = new Set(readCompanies);
      const unread = expectedCompanies.filter((x) => !readSet.has(x));
      return NextResponse.json({
        ok: true,
        mode: "company",
        expected_persons: expectedPersons,
        expected_companies: expectedCompanies,
        read_persons: readPersons,
        read_companies: readCompanies,
        unread,
      });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
