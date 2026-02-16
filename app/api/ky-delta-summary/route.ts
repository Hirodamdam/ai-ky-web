// app/api/ky-delta-summary/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Body = {
  projectId: string;
  accessToken: string; // supabase session access_token（管理者確認用）
  days?: number; // 例: 30/60/90/180
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function clampDays(n: any) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 60;
  return Math.max(7, Math.min(365, Math.floor(x)));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    const projectId = s(body.projectId).trim();
    const accessToken = s(body.accessToken).trim();
    const days = clampDays(body.days);

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
    if (!projectId || !accessToken) {
      return NextResponse.json({ error: "Missing body: projectId / accessToken" }, { status: 400 });
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

    // 2) 管理クライアント（service role）
    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });

    // 3) SQL（RPC無しで実行）：日次集計
    const sql = `
      select
        e.work_date::date as d,
        avg(s.delta)::float as delta_avg,
        max(s.delta)::int as delta_max,
        avg(s.human_score)::float as human_avg,
        avg(s.ai_score)::float as ai_avg,
        count(*)::int as n
      from public.ky_delta_stats s
      join public.ky_entries e on e.id = s.ky_id
      where s.project_id = $1
        and e.work_date >= (now()::date - ($2 || ' days')::interval)
      group by 1
      order by 1;
    `;

    // Supabase JS で raw SQL は `rpc` か `supabase.sql()` が必要だが、
    // 環境差があるので「VIEWを作らない」代わりに `adminClient.rpc('...')` を使わず、
    // ここでは PostgREST の制約回避のため "ky_entries を先に引いてJS集計" を採用する（確実に動く）。
    // ＝まず該当期間のky_entries(id,work_date)を取得 → ky_delta_stats を ky_id IN で取得 → JSで日次集計。

    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const fromIso = fromDate.toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: entries, error: eErr } = await adminClient
      .from("ky_entries")
      .select("id, work_date")
      .eq("project_id", projectId)
      .gte("work_date", fromIso);

    if (eErr) return NextResponse.json({ error: `Fetch ky_entries failed: ${eErr.message}` }, { status: 500 });

    const ids = (entries || []).map((x: any) => x.id).filter(Boolean);
    if (!ids.length) {
      return NextResponse.json({ ok: true, days, rows: [] });
    }

    const { data: stats, error: sErr } = await adminClient
      .from("ky_delta_stats")
      .select("ky_id, human_score, ai_score, delta, computed_at")
      .eq("project_id", projectId)
      .in("ky_id", ids);

    if (sErr) return NextResponse.json({ error: `Fetch ky_delta_stats failed: ${sErr.message}` }, { status: 500 });

    const dateByKy = new Map<string, string>();
    for (const r of entries as any[]) {
      const d = s(r.work_date).slice(0, 10);
      if (r?.id && d) dateByKy.set(String(r.id), d);
    }

    type Agg = {
      d: string;
      sum_delta: number;
      sum_human: number;
      sum_ai: number;
      max_delta: number;
      n: number;
    };

    const agg = new Map<string, Agg>();

    for (const r of (stats as any[]) || []) {
      const kyId = String(r.ky_id || "");
      const d = dateByKy.get(kyId);
      if (!d) continue;

      const delta = Number(r.delta);
      const human = Number(r.human_score);
      const ai = Number(r.ai_score);
      if (!Number.isFinite(delta) || !Number.isFinite(human) || !Number.isFinite(ai)) continue;

      const cur = agg.get(d) || {
        d,
        sum_delta: 0,
        sum_human: 0,
        sum_ai: 0,
        max_delta: -999999,
        n: 0,
      };

      cur.sum_delta += delta;
      cur.sum_human += human;
      cur.sum_ai += ai;
      cur.max_delta = Math.max(cur.max_delta, delta);
      cur.n += 1;

      agg.set(d, cur);
    }

    const rows = Array.from(agg.values())
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
      .map((x) => ({
        d: x.d,
        delta_avg: x.n ? x.sum_delta / x.n : 0,
        delta_max: x.n ? x.max_delta : 0,
        human_avg: x.n ? x.sum_human / x.n : 0,
        ai_avg: x.n ? x.sum_ai / x.n : 0,
        n: x.n,
      }));

    return NextResponse.json({ ok: true, days, rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
