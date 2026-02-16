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
  const r1 = await adminClient.from("ky_entries").update(payload).eq("id", kyId);
  if (!r1?.error) return { ok: true as const, usedFallback: false as const };

  const msg = s(r1.error?.message);
  if (allowFallback && looksLikeMissingColumnError(msg, "is_approved")) {
    const { is_approved, ...rest } = payload;
    const r2 = await adminClient.from("ky_entries").update(rest).eq("id", kyId);
    if (!r2?.error) return { ok: true as const, usedFallback: true as const };
    return { ok: false as const, error: r2.error, usedFallback: true as const };
  }

  return { ok: false as const, error: r1.error, usedFallback: false as const };
}

/**
 * ky-risk-score の返り値（現在の実装想定）:
 * {
 *   total_human: number,
 *   total_ai: number,
 *   delta: number,
 *   breakdown: {...}
 * }
 * ただし揺れに強く拾う
 */
function pickRiskNumbers(j: any): { human: number | null; ai: number | null; delta: number | null } {
  const candidatesHuman = [
    j?.total_human,
    j?.human_total,
    j?.humanScore,
    j?.human_score,
    j?.human?.total,
    j?.human?.score,
    j?.scores?.human,
  ];
  const candidatesAi = [
    j?.total_ai,
    j?.ai_total,
    j?.aiScore,
    j?.ai_score,
    j?.ai?.total,
    j?.ai?.score,
    j?.scores?.ai,
  ];
  const candidatesDelta = [j?.delta, j?.diff, j?.scores?.delta];

  const toIntOrNull = (v: any) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  const human = toIntOrNull(candidatesHuman.find((v: any) => v != null));
  const ai = toIntOrNull(candidatesAi.find((v: any) => v != null));
  let delta = toIntOrNull(candidatesDelta.find((v: any) => v != null));
  if (delta == null && human != null && ai != null) delta = ai - human;

  return { human, ai, delta };
}

function buildWeatherAppliedFromSlots(weatherSlots: any): any | null {
  if (!Array.isArray(weatherSlots) || weatherSlots.length === 0) return null;
  const slot = weatherSlots[0];
  if (!slot) return null;
  return {
    hour: slot.hour,
    weather_text: s(slot.weather_text).trim(),
    temperature_c: slot.temperature_c ?? null,
    wind_direction_deg: slot.wind_direction_deg ?? null,
    wind_speed_ms: slot.wind_speed_ms ?? null,
    precipitation_mm: slot.precipitation_mm ?? null,
  };
}

/**
 * 承認時にΔを確定保存（失敗しても承認は成功）
 * - ky-risk-score を内部呼び出し
 * - ky_delta_stats に delete→insert（UNIQUE無しでも確実）
 */
async function trySaveDeltaStats(params: {
  adminClient: any;
  baseUrl: string;
  projectId: string;
  kyId: string;
  current: any;
}) {
  const { adminClient, baseUrl, projectId, kyId, current } = params;

  const weatherApplied = buildWeatherAppliedFromSlots(current?.weather_slots);

  const body: any = {
    human: {
      work_detail: s(current?.work_detail).trim() || null,
      hazards: s(current?.hazards).trim() || null,
      countermeasures: s(current?.countermeasures).trim() || null,
      third_party_level: s(current?.third_party_level).trim() || null,
      worker_count: current?.worker_count == null ? null : Number(current?.worker_count),
    },
    ai: {
      ai_hazards: s(current?.ai_hazards).trim() || null,
      ai_countermeasures: s(current?.ai_countermeasures).trim() || null,
      ai_third_party: s(current?.ai_third_party).trim() || null,
    },
    weather_applied: weatherApplied,
    photos: {
      // ky-approve 側では写真URLを持っていないので null にする（risk側が許容の前提）
      slope_now_url: null,
      slope_prev_url: null,
      path_now_url: null,
      path_prev_url: null,
    },
  };

  const endpoint = new URL("/api/ky-risk-score", baseUrl).toString();

  let riskJson: any = null;
  let riskError: string | null = null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      riskError = `ky-risk-score failed: ${res.status} ${txt}`;
      return { saved: false, risk_ok: false, risk_error: riskError };
    }
    riskJson = txt ? JSON.parse(txt) : {};
  } catch (e: any) {
    riskError = String(e?.message ?? e);
    return { saved: false, risk_ok: false, risk_error: riskError };
  }

  const { human, ai, delta } = pickRiskNumbers(riskJson);
  if (human == null || ai == null || delta == null) {
    return { saved: false, risk_ok: true, risk_error: "risk-score response missing numeric fields" };
  }

  const computedAt = new Date().toISOString();

  // breakdown は riskJson.breakdown が本命。無ければ全体を薄く保存
  const breakdown = riskJson?.breakdown ?? null;

  try {
    // ✅ 同一ky_id を一旦消してから入れる（UNIQUEなしでもOK）
    await adminClient.from("ky_delta_stats").delete().eq("ky_id", kyId);

    const ins = await adminClient.from("ky_delta_stats").insert({
      id: crypto.randomUUID(),
      project_id: projectId,
      ky_id: kyId,
      human_score: human,
      ai_score: ai,
      delta,
      human_breakdown: breakdown,
      ai_breakdown: breakdown,
      computed_at: computedAt,
    });

    if (ins?.error) {
      return { saved: false, risk_ok: true, risk_error: `insert ky_delta_stats failed: ${ins.error.message}` };
    }

    return { saved: true, risk_ok: true, risk_error: null, human, ai, delta };
  } catch (e: any) {
    return { saved: false, risk_ok: true, risk_error: String(e?.message ?? e) };
  }
}

/**
 * ky_entries から追加列を安全に拾う（列が無い環境でも落とさない）
 */
async function enrichCurrentSafely(adminClient: any, kyId: string, baseSelect: string[]) {
  const optionalCols = ["hazards", "countermeasures"];

  const tryCols = async (cols: string[]) => {
    return await adminClient.from("ky_entries").select(cols.join(",")).eq("id", kyId).maybeSingle();
  };

  let cols = [...baseSelect, ...optionalCols];
  let lastErr: any = null;

  for (let i = 0; i < optionalCols.length + 1; i++) {
    const r = await tryCols(cols);
    if (!r?.error) return { data: r.data, usedCols: cols };
    lastErr = r.error;

    const msg = s(r.error?.message);
    const hit = optionalCols.find((c) => looksLikeMissingColumnError(msg, c));
    if (!hit) break;
    cols = cols.filter((c) => c !== hit);
  }

  console.warn("[ky-approve] enrichCurrentSafely failed:", s(lastErr?.message));
  return { data: null, usedCols: baseSelect };
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

    const baseSelect = [
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
    ];

    const { data: current0, error: curErr } = await adminClient
      .from("ky_entries")
      .select(baseSelect.join(","))
      .eq("id", kyId)
      .maybeSingle();

    if (curErr) return NextResponse.json({ error: `Fetch ky failed: ${curErr.message}` }, { status: 500 });
    if (!current0) return NextResponse.json({ error: "KY not found" }, { status: 404 });
    if (s((current0 as any).project_id).trim() !== projectId) {
      return NextResponse.json({ error: "Project mismatch" }, { status: 400 });
    }

    const enrich = await enrichCurrentSafely(adminClient, kyId, baseSelect);
    const current = { ...(current0 as any), ...(enrich.data as any) };

    // 工事名（通知タイトル用）
    const { data: proj } = await adminClient.from("projects").select("name").eq("id", projectId).maybeSingle();
    const projectName = s(proj?.name).trim();
    const workDate = s((current as any)?.work_date).trim();
    const partnerName = s((current as any)?.partner_company_name).trim();

    const baseUrl = getBaseUrl(req) || new URL(req.url).origin;

    if (action === "unapprove") {
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

      // ✅ 承認解除時はΔ統計も削除
      try {
        await adminClient.from("ky_delta_stats").delete().eq("ky_id", kyId);
      } catch {
        // noop
      }

      return NextResponse.json({ ok: true, action: "unapprove", used_fallback: upd.usedFallback });
    }

    // approve
    const token = s((current as any)?.public_token).trim() || crypto.randomUUID();
    const nowIso = new Date().toISOString();

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

    // ✅ 承認成功後にΔ統計を保存（失敗しても承認は成功）
    const deltaSave = await trySaveDeltaStats({
      adminClient,
      baseUrl,
      projectId,
      kyId,
      current,
    });

    // 3) ★承認成功後にLINE通知（失敗しても承認は成功扱い）
    let lineOk: boolean | null = null;
    let lineError: string | null = null;

    let partnerTo: string | null = null;

    try {
      const pushSecret = (process.env.LINE_PUSH_SECRET || "").trim();
      if (!pushSecret) {
        lineOk = null;
        lineError = "LINE_PUSH_SECRET missing (skip)";
      } else {
        if (partnerName) {
          const key = partnerKeyOf(partnerName);
          let tgt: any = null;

          const q1 = await adminClient
            .from("partner_line_targets")
            .select("line_to, notify_enabled")
            .eq("project_id", projectId)
            .eq("partner_company_key", key)
            .maybeSingle();

          if (q1.error) {
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

            to: partnerTo && isNonEmptyString(partnerTo) ? partnerTo : undefined,

            idempotency: {
              project_id: projectId,
              ky_id: kyId,
              event: "ky_approved",
              rev: nowIso,
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

      partner_line_to: partnerTo,

      line_ok: lineOk,
      line_error: lineError,

      // テスト確認用
      delta_saved: (deltaSave as any)?.saved ?? false,
      delta_human: (deltaSave as any)?.human ?? null,
      delta_ai: (deltaSave as any)?.ai ?? null,
      delta_value: (deltaSave as any)?.delta ?? null,
      delta_error: (deltaSave as any)?.risk_error ?? null,

      used_fallback: upd.usedFallback,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
