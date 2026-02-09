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

function makeLabel(company: string, person: string, role: string) {
  const c = s(company).trim();
  const p = s(person).trim();
  const r = s(role).trim();
  if (c && p) return r ? `${c} ${p}（${r}）` : `${c} ${p}`;
  if (c) return c;
  if (p) return r ? `${p}（${r}）` : p;
  return "";
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

    // admin確認
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (userData.user.id !== adminUserId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 整合確認
    const { data: ky, error: kyErr } = await adminClient.from("ky_entries").select("id, project_id").eq("id", kyId).maybeSingle();
    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "KY not found" }, { status: 404 });
    if (s(ky.project_id) !== projectId) return NextResponse.json({ error: "Project mismatch" }, { status: 400 });

    // 1) 既読ログ（誰が読んだか）
    const { data: logs, error: logErr } = await adminClient
      .from("ky_read_logs")
      .select("*")
      .eq("ky_id", kyId)
      .order("created_at", { ascending: false });

    if (logErr) return NextResponse.json({ error: logErr.message }, { status: 500 });

    const readLabels: string[] = [];
    for (const r of (logs ?? []) as any[]) {
      const name = pickFirst(r, ["reader_name", "name", "person_name", "worker_name"]);
      const role = pickFirst(r, ["reader_role", "role"]);
      const company = pickFirst(r, ["reader_company_name", "company_name", "partner_company_name"]);
      const label = makeLabel(company, name, role);
      if (label) readLabels.push(label);
      else if (name) readLabels.push(name);
    }

    // 2) 「読むべき人/会社」候補：入場登録（協力会社・入場者）
    // ※ テーブル列名差を吸収：会社名/氏名がどこにあっても拾う
    const { data: entrants, error: entErr } = await adminClient
      .from("project_partner_entries")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (entErr) {
      // project_partner_entries が無い/使ってない現場でも落とさない
      return NextResponse.json({
        ok: true,
        expected: [],
        read: readLabels,
        unread: [],
        note: "project_partner_entries not available or query failed",
      });
    }

    const expectedLabels: string[] = [];
    for (const e of (entrants ?? []) as any[]) {
      const company = pickFirst(e, ["partner_company_name", "company_name", "partner_name", "name"]);
      const person = pickFirst(e, ["worker_name", "person_name", "entrant_name", "contact_name", "user_name", "name"]);
      const role = pickFirst(e, ["role", "worker_role", "reader_role"]);
      const label = makeLabel(company, person, role) || company || person;
      if (label) expectedLabels.push(label);
    }

    // uniq
    const uniq = (arr: string[]) => Array.from(new Set(arr.map((x) => s(x).trim()).filter(Boolean)));

    const expected = uniq(expectedLabels);
    const read = uniq(readLabels);

    // 未読 = expected - read（完全一致）
    const readSet = new Set(read);
    const unread = expected.filter((x) => !readSet.has(x));

    return NextResponse.json({ ok: true, expected, read, unread });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
