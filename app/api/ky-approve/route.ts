// app/api/ky-approve/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

type Body = {
  projectId: string;
  kyId: string;
  accessToken: string; // supabase session access_token
  action?: "approve" | "unapprove";
};

function s(v: any) {
  return v == null ? "" : String(v);
}

// ✅ 型ガード（string|unknown を string に確定させる）
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Vercel/Proxy環境で正しいURLを組み立てる
function getBaseUrl(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host ? `${proto}://${host}` : "";
}

// ✅ 管理者（全通知受信）宛先を環境変数から取得
// 例: LINE_ADMIN_RECIPIENT_IDS="Uxxxx,Cyyyy"
function parseAdminRecipientsFromEnv(): string[] {
  const raw = (process.env.LINE_ADMIN_RECIPIENT_IDS || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(isNonEmptyString);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = s(body.projectId).trim();
    const kyId = s(body.kyId).trim();
    const accessToken = s(body.accessToken).trim();
    const action: "approve" | "unapprove" = body.action ?? "approve";

    const adminUserId = (process.env.KY_ADMIN_USER_ID || "").trim();
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

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
      return NextResponse.json(
        { error: "Missing body: projectId / kyId / accessToken" },
        { status: 400 }
      );
    }

    // 1) ログインユーザー確認（accessTokenで認証）
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized (invalid session)" }, { status: 401 });
    }
    if (userData.user.id !== adminUserId) {
      return NextResponse.json({ error: "Forbidden (not admin)" }, { status: 403 });
    }

    // 2) 管理クライアント（service role）で更新
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 対象KYの現状取得（協力会社名も取る）
    const { data: current, error: curErr } = await adminClient
      .from("ky_entries")
      .select("id, project_id, is_approved, public_token, public_enabled, work_date, partner_company_name")
      .eq("id", kyId)
      .maybeSingle();

    if (curErr) return NextResponse.json({ error: `Fetch ky failed: ${curErr.message}` }, { status: 500 });
    if (!current) return NextResponse.json({ error: "KY not found" }, { status: 404 });
    if (s((current as any).project_id).trim() !== projectId) {
      return NextResponse.json({ error: "Project mismatch" }, { status: 400 });
    }

    // 工事名（通知タイトル用）
    const { data: proj } = await adminClient.from("projects").select("name").eq("id", projectId).maybeSingle();
    const projectName = s(proj?.name).trim();
    const workDate = s((current as any)?.work_date).trim();
    const partnerName = s((current as any)?.partner_company_name).trim();

    // baseUrl（内部API呼び出し用）
    const baseUrl = getBaseUrl(req) || new URL(req.url).origin;

    if (action === "unapprove") {
      // ✅ 承認解除＝公開停止
      const { error: updErr } = await adminClient
        .from("ky_entries")
        .update({
          is_approved: false,
          approved_at: null,
          approved_by: null,
          public_enabled: false,
          public_enabled_at: null,
          public_token: null,
        })
        .eq("id", kyId);

      if (updErr) return NextResponse.json({ error: `Unapprove failed: ${updErr.message}` }, { status: 500 });

      return NextResponse.json({ ok: true, action: "unapprove" });
    }

    // approve
    const token = s((current as any)?.public_token).trim() || crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // ✅ 承認＝公開ON
    const { error: updErr } = await adminClient
      .from("ky_entries")
      .update({
        is_approved: true,
        approved_at: nowIso,
        approved_by: adminUserId,
        public_token: token,
        public_enabled: true,
        public_enabled_at: nowIso,
      })
      .eq("id", kyId);

    if (updErr) return NextResponse.json({ error: `Approve failed: ${updErr.message}` }, { status: 500 });

    const publicPath = `/ky/public/${token}`;
    const publicUrl = `${baseUrl}${publicPath}`;

    // 3) ★承認成功後にLINE通知（失敗しても承認は成功扱い）
    let lineOk: boolean | null = null;
    let lineError: string | null = null;

    // ✅ 宛先（協力会社 + 管理者）
    let line_to_list: string[] = [];

    try {
      const pushSecret = (process.env.LINE_PUSH_SECRET || "").trim();
      if (!pushSecret) {
        lineOk = null;
        lineError = "LINE_PUSH_SECRET missing (skip)";
      } else {
        // ✅ 管理者（全通知受信）
        const adminTos = parseAdminRecipientsFromEnv();

        // ✅ 協力会社宛先（DBから取得：表記ゆれ対策で key で検索）
        let partnerTo: string | null = null;

        if (partnerName) {
          const partnerKey = partnerName.replace(/\s+/g, ""); // 全角/半角スペース等を除去

          const { data: tgt, error: tgtErr } = await adminClient
            .from("partner_line_targets")
            .select("line_to, notify_enabled")
            .eq("project_id", projectId)
            .eq("partner_company_key", partnerKey)
            .maybeSingle();

          if (tgtErr) {
            console.warn("[ky-approve] partner_line_targets fetch error:", tgtErr.message);
          } else if (tgt?.notify_enabled && tgt?.line_to) {
            partnerTo = s(tgt.line_to).trim() || null;
          }
        }

        // ✅ 宛先合成（重複排除）
        line_to_list = Array.from(new Set([partnerTo, ...adminTos].filter(isNonEmptyString)));

        const titleParts: string[] = [];
        if (projectName) titleParts.push(projectName);
        if (workDate) titleParts.push(workDate);
        if (partnerName) titleParts.push(partnerName);
        const title = titleParts.length ? titleParts.join(" / ") : "KY承認";

        const endpoint = new URL("/api/line/push-ky", baseUrl).toString();

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-push-secret": pushSecret,
          },
          body: JSON.stringify({
            title,
            url: publicUrl,
            to: line_to_list.length ? line_to_list : undefined, // 0件ならpush-ky側がbroadcastへ（互換）
          }),
        });

        const txt = await res.text().catch(() => "");
        lineOk = res.ok;
        if (!res.ok) lineError = `push-ky failed: ${res.status} ${txt}`;
      }
    } catch (e: any) {
      lineOk = false;
      lineError = String(e?.message ?? e);
    }

    return NextResponse.json({
      ok: true,
      action: "approve",
      public_token: token,
      public_path: publicPath,
      public_url: publicUrl,
      public_enabled: true,
      partner_company_name: partnerName || null,
      line_to: line_to_list.length ? line_to_list : null,
      line_ok: lineOk,
      line_error: lineError,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
