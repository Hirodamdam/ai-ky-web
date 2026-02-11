// app/api/ky-read/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  token?: string;

  // ✅ どちらかあればOK（eno優先運用）
  entrantNo?: string | null;
  readerName?: string | null;

  readerRole?: string | null;
  readerDevice?: string | null;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function isValidEntrantNo(v: string): boolean {
  const x = s(v).trim();
  if (!x) return false;
  return /^[0-9A-Za-z_-]{1,32}$/.test(x);
}

function normEntrantNo(v: any): string {
  return s(v).trim().toUpperCase();
}

function normNameLoose(v: any): string {
  return s(v).replace(/[ 　\t]/g, "").trim();
}

// entrant_no 列が無い環境で落ちるのを吸収（PostgRESTのエラー文言差もあるので広めに）
function isMissingColumnErr(err: any, col: string): boolean {
  const msg = s(err?.message || err?.details || err?.hint);
  const code = s(err?.code);
  // よくある：Postgres 42703 undefined_column / postgrest の列エラー
  if (code === "42703") return true;
  if (msg.includes(col) && (msg.includes("does not exist") || msg.includes("not exist") || msg.includes("Unknown column"))) return true;
  if (msg.includes(col) && msg.includes("column")) return true;
  return false;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const token = s(body.token).trim();
    if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json(
        { error: "Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 1) token -> ky を取得（project_id と ky_id を確実に得る）
    const { data: ky, error: kyErr } = await admin
      .from("ky_entries")
      .select("id, project_id, is_approved, public_enabled")
      .eq("public_token", token)
      .maybeSingle();

    if (kyErr) return NextResponse.json({ error: kyErr.message }, { status: 500 });
    if (!ky) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    if (!ky.is_approved) return NextResponse.json({ error: "Not approved" }, { status: 403 });
    if (ky.public_enabled === false) return NextResponse.json({ error: "Public disabled" }, { status: 403 });

    const projectId = s(ky.project_id).trim();
    const kyId = s(ky.id).trim();
    if (!projectId) return NextResponse.json({ error: "ky.project_id is empty" }, { status: 500 });
    if (!kyId) return NextResponse.json({ error: "ky.id is empty" }, { status: 500 });

    // 2) 入力の解釈（eno優先）
    const enoRaw = s(body.entrantNo).trim();
    const enoOk = isValidEntrantNo(enoRaw);
    const entrantNo = enoOk ? normEntrantNo(enoRaw) : "";

    const nameRaw = s(body.readerName).trim();
    const role = s(body.readerRole).trim() || null;
    const device = s(body.readerDevice).trim() || null;

    // 3) reader_name を「氏名＞会社＞No」で確定（未読一覧と一致させる）
    // entrantNo があるなら、project_entrant_entries から氏名/会社名を引いて補完（取れたら使う）
    let entrantName = "";
    let partnerCompany = "";

    if (entrantNo) {
      const { data: ent, error: entErr } = await admin
        .from("project_entrant_entries")
        .select("entrant_name, partner_company_name")
        .eq("project_id", projectId)
        .eq("entrant_no", entrantNo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!entErr && ent) {
        entrantName = s((ent as any)?.entrant_name).trim();
        partnerCompany = s((ent as any)?.partner_company_name).trim();
      }
      // entErr は「補完に失敗しただけ」なので致命扱いしない
    }

    const readerName =
      nameRaw ||
      entrantName ||
      partnerCompany ||
      (entrantNo ? `No:${entrantNo}` : "");

    if (!normNameLoose(readerName)) {
      return NextResponse.json({ error: "readerName required (or valid entrantNo)" }, { status: 400 });
    }

    // 4) ky_read_logs へ保存
    const baseRow: any = {
      project_id: projectId,
      ky_id: kyId,
      reader_name: readerName,
      reader_role: role,
      reader_device: device,
    };

    // entrant_no があるなら「まず入れてみる」→列が無ければ外して再試行
    if (entrantNo) {
      const { error: ins1 } = await admin.from("ky_read_logs").insert({ ...baseRow, entrant_no: entrantNo });
      if (!ins1) {
        return NextResponse.json(
          { ok: true, saved: { ky_id: kyId, project_id: projectId, reader_name: readerName, entrant_no: entrantNo } },
          { status: 200 }
        );
      }

      // 列が無いだけなら再試行
      if (isMissingColumnErr(ins1, "entrant_no")) {
        const { error: ins2 } = await admin.from("ky_read_logs").insert(baseRow);
        if (ins2) return NextResponse.json({ error: ins2.message }, { status: 500 });

        return NextResponse.json(
          { ok: true, saved: { ky_id: kyId, project_id: projectId, reader_name: readerName, entrant_no: null } },
          { status: 200 }
        );
      }

      // それ以外のエラーはそのまま返す
      return NextResponse.json({ error: ins1.message }, { status: 500 });
    }

    // entrantNo が無い場合は通常insert
    const { error: ins } = await admin.from("ky_read_logs").insert(baseRow);
    if (ins) return NextResponse.json({ error: ins.message }, { status: 500 });

    return NextResponse.json(
      { ok: true, saved: { ky_id: kyId, project_id: projectId, reader_name: readerName, entrant_no: null } },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
