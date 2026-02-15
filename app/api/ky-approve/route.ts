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

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Vercel/Proxy環境で正しいURLを組み立てる
function getBaseUrl(req: Request) {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host ? `${proto}://${host}` : "";
}

// 協力会社キー（空白除去）
function partnerKeyOf(name: string) {
  return s(name).replace(/[ 　\t]/g, "").trim();
}

function looksLikeMissingColumnError(msg: string, col: string) {
  const m = s(msg);
  return m.includes(col) && (m.includes("does not exist") || m.includes("column") || m.includes("schema cache"));
}

async function safeUpdateApprove(
  adminClient: any,
  kyId: string,
  payload: Record<string, any>,
  allowFallback: boolean
) {
  // まず is_approved を含むpayloadで更新を試す
  const r1 = await adminClient.from("ky_entries").update(payload).eq("id", kyId);
  if (!r1?.error) return { ok: true as const, usedFallback: false as const };

  // is_approved列が無い環境なら、is_approved を外して再試行
  const msg = s(r1.error?.message);
  if (allowFallback && looksLikeMissingColumnError(msg, "is_approved")) {
    const { is_approved, ...rest } = payload;
    const r2 = await adminClient.from("ky_entries").update(rest).eq("id", kyId);
    if (!r2?.error) return { ok: true as const, usedFallback: true as const };
    return { ok: false as const, error: r2.error, usedFallback: true as const };
  }

  return { ok: false as const, error: r1.error, usedFallback: false as const };
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
      return NextResponse.json({ error: "Missing body: projectId / kyId / accessToken" }, { status: 400 });
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
    // ✅ is_approved 列が無い環境があり得るので、selectには入れない（approved_atで判定可能）
    const { data: current, error: curErr } = await adminClient
      .from("ky_entries")
      .select(
        [
          "id",
          "project_id",
          "public_token",
          "public_enabled",
          "work_date",
          "partner_company_name",
          "approved_at",
          "work_detail",
          "worker_count",
          "third_party_level",
          "weather_slots",
          "ai_hazards",
          "ai_countermeasures",
          "ai_third_party",
        ].join(",")
      )
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
      const upd = await safeUpdateApprove(
        adminClient,
        kyId,
        {
          is_approved: false,
          approved_at: null,
          approved_by: null,
          public_enabled: false,
          public_enabled_at: null,
          public_token: null,
        },
        true
      );

      if (!upd.ok) {
        return NextResponse.json({ error: `Unapprove failed: ${upd.error?.message ?? "unknown"}` }, { status: 500 });
      }

      return NextResponse.json({ ok: true, action: "unapprove", used_fallback: upd.usedFallback });
    }

    // approve
    const token = s((current as any)?.public_token).trim() || crypto.randomUUID();
    const nowIso = new Date().toISOString();

    // ✅ 承認＝公開ON
    const upd = await safeUpdateApprove(
      adminClient,
      kyId,
      {
        is_approved: true,
        approved_at: nowIso,
        approved_by: adminUserId,
        public_token: token,
        public_enabled: true,
        public_enabled_at: nowIso,
      },
      true
    );

    if (!upd.ok) {
      return NextResponse.json({ error: `Approve failed: ${upd.error?.message ?? "unknown"}` }, { status: 500 });
    }

    const publicPath = `/ky/public/${token}`;
    const publicUrl = `${baseUrl}${publicPath}`;

    // 3) ★承認成功後にLINE通知（失敗しても承認は成功扱い）
    //    ルール：
    //    - 承認時に「協力会社 + 所長 + 社長」へ通知
    //      ※ 所長/社長は push-ky 側が env から必ず追加
    //    - 協力会社は完全分岐（ここでは協力会社宛先のみ渡す）
    let lineOk: boolean | null = null;
    let lineError: string | null = null;

    let partnerTo: string | null = null;

    try {
      const pushSecret = (process.env.LINE_PUSH_SECRET || "").trim();
      if (!pushSecret) {
        lineOk = null;
        lineError = "LINE_PUSH_SECRET missing (skip)";
      } else {
        // ✅ 協力会社宛先（DBから取得）
        if (partnerName) {
          const key = partnerKeyOf(partnerName);

          // まず partner_company_key で試す（存在しない環境はフォールバック）
          let tgt: any = null;

          const q1 = await adminClient
            .from("partner_line_targets")
            .select("line_to, notify_enabled")
            .eq("project_id", projectId)
            .eq("partner_company_key", key)
            .maybeSingle();

          if (q1.error) {
            // partner_company_key 列が無い/違う場合などは name でフォールバック
            if (looksLikeMissingColumnError(q1.error.message, "partner_company_key")) {
              const q2 = await adminClient
                .from("partner_line_targets")
                .select("line_to, notify_enabled")
                .eq("project_id", projectId)
                .eq("partner_company_name", partnerName)
                .maybeSingle();

              if (q2.error) {
                console.warn("[ky-approve] partner_line_targets fetch error (fallback):", q2.error.message);
              } else {
                tgt = q2.data;
              }
            } else {
              console.warn("[ky-approve] partner_line_targets fetch error:", q1.error.message);
            }
          } else {
            tgt = q1.data;
          }

          if (tgt?.notify_enabled && tgt?.line_to) {
            partnerTo = s(tgt.line_to).trim() || null;
          }
        }

        const titleParts: string[] = [];
        if (projectName) titleParts.push(projectName);
        if (workDate) titleParts.push(workDate);
        if (partnerName) titleParts.push(partnerName);
        const title = titleParts.length ? titleParts.join(" / ") : "KY承認";

        const endpoint = new URL("/api/line/push-ky", baseUrl).toString();

        // ✅ 送信テンプレ用の詳細も渡す（push-ky側は既存互換）
        const work_detail = s((current as any)?.work_detail).trim() || null;
        const workers = (current as any)?.worker_count == null ? null : Number((current as any)?.worker_count);
        const third_party_level = s((current as any)?.third_party_level).trim() || null;
        const weather_slots = Array.isArray((current as any)?.weather_slots) ? (current as any).weather_slots : null;

        const ai_hazards = s((current as any)?.ai_hazards).trim() || null;
        const ai_countermeasures = s((current as any)?.ai_countermeasures).trim() || null;
        const ai_third_party = s((current as any)?.ai_third_party).trim() || null;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-push-secret": pushSecret,
          },
          body: JSON.stringify({
            title,
            url: publicUrl,

            work_detail,
            workers: Number.isFinite(workers as any) ? workers : null,
            third_party_level,
            weather_slots,

            ai_hazards,
            ai_countermeasures,
            ai_third_party,

            // ✅ 協力会社は完全分岐：ここでは協力会社宛先のみ渡す
            // ✅ 所長/社長は push-ky 側で env から必ず追加される
            to: partnerTo && isNonEmptyString(partnerTo) ? partnerTo : undefined,

            // ✅ 二重送信防止（同一承認の重複だけ止める）
            idempotency: {
              project_id: projectId,
              ky_id: kyId,
              event: "ky_approved",
              rev: nowIso, // approved_at と同値
            },
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

      // ✅ 協力会社宛（完全分岐の結果）
      partner_line_to: partnerTo,

      // ✅ push-ky の結果
      line_ok: lineOk,
      line_error: lineError,

      // ✅ is_approved列が無い環境で fallback したか
      used_fallback: upd.usedFallback,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
