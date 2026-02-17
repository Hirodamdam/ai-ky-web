// app/projects/[id]/delta/KyDeltaClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";

type Mode = "daily" | "monthly";

type DeltaRow = {
  id: string;
  project_id: string;
  ky_id: string;
  human_score: number;
  ai_score: number;
  delta: number;
  computed_at: string; // timestamptz
};

type DailyAgg = {
  d: string; // YYYY-MM-DD
  delta_avg: number;
  delta_max: number;
  human_avg: number;
  ai_avg: number;
  n: number;
};

type MonthlyAgg = {
  m: string; // YYYY-MM
  delta_avg: number;
  delta_max: number;
  human_avg: number;
  ai_avg: number;
  n: number;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function isoDate(iso: string) {
  const m = s(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function isoMonth(iso: string) {
  const m = s(iso).match(/^(\d{4})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function labelDelta(d: number) {
  if (d >= 30) return { text: "要再確認（強）", cls: "bg-rose-100 text-rose-800 border-rose-200" };
  if (d >= 20) return { text: "要再確認", cls: "bg-orange-100 text-orange-800 border-orange-200" };
  if (d >= 10) return { text: "やや厳しめ", cls: "bg-amber-100 text-amber-800 border-amber-200" };
  if (d <= -10) return { text: "人が厳しめ", cls: "bg-sky-100 text-sky-800 border-sky-200" };
  return { text: "概ね一致", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
}

function toCsv(rows: Array<Record<string, any>>) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (x: any) => {
    const t = s(x);
    if (t.includes('"') || t.includes(",") || t.includes("\n")) return `"${t.replace(/"/g, '""')}"`;
    return t;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ];
  return lines.join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function KyDeltaClient() {
  const params = useParams() as { id?: string };
  const projectId = useMemo(() => s(params?.id).trim(), [params?.id]);

  const [days, setDays] = useState<30 | 60 | 90 | 180>(30);
  const [mode, setMode] = useState<Mode>("daily");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [raw, setRaw] = useState<DeltaRow[]>([]);

  const sinceIso = useMemo(() => {
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return since.toISOString();
  }, [days]);

  const fetchRows = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setErr("");

    try {
      // ✅ ここは Supabase の型生成に ky_delta_stats が入ってない環境があるので as any で吸収
      const q = (supabase as any)
        .from("ky_delta_stats")
        .select("id,project_id,ky_id,human_score,ai_score,delta,computed_at")
        .eq("project_id", projectId)
        .gte("computed_at", sinceIso)
        .order("computed_at", { ascending: true })
        .limit(5000);

      const { data, error } = await q;
      if (error) throw error;

      const rows: DeltaRow[] = Array.isArray(data)
        ? data.map((r: any) => ({
            id: s(r.id),
            project_id: s(r.project_id),
            ky_id: s(r.ky_id),
            human_score: Number(r.human_score ?? 0),
            ai_score: Number(r.ai_score ?? 0),
            delta: Number(r.delta ?? 0),
            computed_at: s(r.computed_at),
          }))
        : [];

      setRaw(rows);
    } catch (e: any) {
      setRaw([]);
      setErr(e?.message ?? "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [projectId, sinceIso]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const dailyRows: DailyAgg[] = useMemo(() => {
    // group by day
    const map = new Map<string, DeltaRow[]>();
    for (const r of raw) {
      const d = isoDate(r.computed_at);
      if (!d) continue;
      const a = map.get(d) ?? [];
      a.push(r);
      map.set(d, a);
    }

    const out: DailyAgg[] = [];
    const keys = Array.from(map.keys()).sort();
    for (const d of keys) {
      const arr = map.get(d) ?? [];
      if (!arr.length) continue;

      const n = arr.length;
      const delta_avg = arr.reduce((p, c) => p + c.delta, 0) / n;
      const delta_max = Math.max(...arr.map((x) => x.delta));
      const human_avg = arr.reduce((p, c) => p + c.human_score, 0) / n;
      const ai_avg = arr.reduce((p, c) => p + c.ai_score, 0) / n;

      out.push({
        d,
        delta_avg: round1(delta_avg),
        delta_max: round1(delta_max),
        human_avg: round1(human_avg),
        ai_avg: round1(ai_avg),
        n,
      });
    }
    return out;
  }, [raw]);

  const monthlyRows: MonthlyAgg[] = useMemo(() => {
    // group by month
    const map = new Map<string, DeltaRow[]>();
    for (const r of raw) {
      const m = isoMonth(r.computed_at);
      if (!m) continue;
      const a = map.get(m) ?? [];
      a.push(r);
      map.set(m, a);
    }

    const out: MonthlyAgg[] = [];
    const keys = Array.from(map.keys()).sort();
    for (const m of keys) {
      const arr = map.get(m) ?? [];
      if (!arr.length) continue;

      const n = arr.length;
      const delta_avg = arr.reduce((p, c) => p + c.delta, 0) / n;
      const delta_max = Math.max(...arr.map((x) => x.delta));
      const human_avg = arr.reduce((p, c) => p + c.human_score, 0) / n;
      const ai_avg = arr.reduce((p, c) => p + c.ai_score, 0) / n;

      out.push({
        m,
        delta_avg: round1(delta_avg),
        delta_max: round1(delta_max),
        human_avg: round1(human_avg),
        ai_avg: round1(ai_avg),
        n,
      });
    }
    return out;
  }, [raw]);

  const viewRows = useMemo(() => {
    return mode === "daily" ? dailyRows : monthlyRows;
  }, [mode, dailyRows, monthlyRows]);

  const latest = useMemo(() => {
    if (!raw.length) return null;
    const last = raw[raw.length - 1];
    return {
      delta: last.delta,
      ai: last.ai_score,
      human: last.human_score,
    };
  }, [raw]);

  const summary = useMemo(() => {
    if (!viewRows.length) {
      return {
        latestDeltaAvg: 0,
        periodDeltaAvg: 0,
        periodDeltaMax: 0,
        humanAvg: 0,
        aiAvg: 0,
        n: 0,
      };
    }

    const last: any = viewRows[viewRows.length - 1];
    const latestDeltaAvg = Number(last.delta_avg ?? 0);

    const n = viewRows.reduce((p: number, c: any) => p + Number(c.n ?? 0), 0);
    const periodDeltaAvg =
      n > 0
        ? viewRows.reduce((p: number, c: any) => p + Number(c.delta_avg ?? 0) * Number(c.n ?? 0), 0) / n
        : 0;

    const periodDeltaMax = Math.max(...viewRows.map((x: any) => Number(x.delta_max ?? 0)));
    const humanAvg =
      n > 0
        ? viewRows.reduce((p: number, c: any) => p + Number(c.human_avg ?? 0) * Number(c.n ?? 0), 0) / n
        : 0;
    const aiAvg =
      n > 0
        ? viewRows.reduce((p: number, c: any) => p + Number(c.ai_avg ?? 0) * Number(c.n ?? 0), 0) / n
        : 0;

    return {
      latestDeltaAvg: round1(latestDeltaAvg),
      periodDeltaAvg: round1(periodDeltaAvg),
      periodDeltaMax: round1(periodDeltaMax),
      humanAvg: round1(humanAvg),
      aiAvg: round1(aiAvg),
      n,
    };
  }, [viewRows]);

  const badge = useMemo(() => labelDelta(summary.latestDeltaAvg), [summary.latestDeltaAvg]);

  const chartData = useMemo(() => {
    if (mode === "daily") {
      return (dailyRows as any[]).map((r) => ({
        x: r.d,
        delta: r.delta_avg,
        ai: r.ai_avg,
        human: r.human_avg,
      }));
    }
    return (monthlyRows as any[]).map((r) => ({
      x: r.m,
      delta: r.delta_avg,
      ai: r.ai_avg,
      human: r.human_avg,
    }));
  }, [mode, dailyRows, monthlyRows]);

  const onDownloadCsv = useCallback(() => {
    const rows =
      mode === "daily"
        ? dailyRows.map((r) => ({
            date: r.d,
            delta_avg: r.delta_avg,
            delta_max: r.delta_max,
            human_avg: r.human_avg,
            ai_avg: r.ai_avg,
            count: r.n,
          }))
        : monthlyRows.map((r) => ({
            month: r.m,
            delta_avg: r.delta_avg,
            delta_max: r.delta_max,
            human_avg: r.human_avg,
            ai_avg: r.ai_avg,
            count: r.n,
          }));

    const csv = toCsv(rows as any);
    const name = mode === "daily" ? `delta_daily_${projectId}.csv` : `delta_monthly_${projectId}.csv`;
    downloadText(name, csv);
  }, [mode, dailyRows, monthlyRows, projectId]);

  const periodButtons: Array<{ d: 30 | 60 | 90 | 180; label: string }> = [
    { d: 30, label: "30日" },
    { d: 60, label: "60日" },
    { d: 90, label: "90日" },
    { d: 180, label: "180日" },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">Δ推移（AI − 人）</div>
          <div className="mt-1 text-sm text-slate-600 break-all">プロジェクト：{projectId || "（不明）"}</div>
        </div>
        <div className="flex items-center gap-3">
          <Link className="text-sm text-blue-600 underline" href={`/projects/${projectId}/ky`}>
            KY一覧へ
          </Link>
        </div>
      </div>

      {!!err && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {err}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("daily")}
              className={`rounded-lg border px-3 py-2 text-sm ${
                mode === "daily" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              日次
            </button>
            <button
              type="button"
              onClick={() => setMode("monthly")}
              className={`rounded-lg border px-3 py-2 text-sm ${
                mode === "monthly" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              月次
            </button>

            <button
              type="button"
              onClick={onDownloadCsv}
              disabled={!viewRows.length}
              className={`rounded-lg border px-3 py-2 text-sm ${
                viewRows.length ? "border-slate-300 bg-white hover:bg-slate-50" : "border-slate-300 bg-slate-100 text-slate-400"
              }`}
            >
              CSV
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {periodButtons.map((b) => (
              <button
                key={b.d}
                type="button"
                onClick={() => setDays(b.d)}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  days === b.d ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
              >
                {b.label}
              </button>
            ))}

            <button
              type="button"
              onClick={fetchRows}
              disabled={loading}
              className={`rounded-lg border px-3 py-2 text-sm ${
                loading ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              {loading ? "更新中..." : "更新"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-600 mb-1">最新Δ（平均）</div>
            <div className="text-2xl font-bold text-slate-900">{viewRows.length ? summary.latestDeltaAvg : "—"}</div>
            <div className={`inline-flex mt-2 text-xs px-2 py-1 rounded-full border ${badge.cls}`}>{badge.text}</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-600 mb-1">期間平均Δ</div>
            <div className="text-2xl font-bold text-slate-900">{viewRows.length ? summary.periodDeltaAvg : "—"}</div>
            <div className="text-xs text-slate-600 mt-2">
              {mode === "daily" ? "日数" : "月数"}：{viewRows.length} / 件数：{summary.n}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-600 mb-1">最大Δ（Max）</div>
            <div className="text-2xl font-bold text-slate-900">{viewRows.length ? summary.periodDeltaMax : "—"}</div>
            <div className="text-xs text-slate-600 mt-2">期間内で最も差が出た{mode === "daily" ? "日" : "月"}</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-600 mb-1">最新：AI / 人</div>
            <div className="text-2xl font-bold text-slate-900">
              {latest ? `${latest.ai} / ${latest.human}` : "—"}
            </div>
            <div className="text-xs text-slate-600 mt-2">
              AI平均 / 人平均：{viewRows.length ? `${summary.aiAvg} / ${summary.humanAvg}` : "—"}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="x" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="delta" name="Δ（平均）" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="ai" name="AI（平均）" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="human" name="人（平均）" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="grid grid-cols-12 gap-0 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
            <div className="col-span-3 px-3 py-2">{mode === "daily" ? "日付" : "月"}</div>
            <div className="col-span-2 px-3 py-2">Δ平均</div>
            <div className="col-span-2 px-3 py-2">Δ最大</div>
            <div className="col-span-2 px-3 py-2">人平均</div>
            <div className="col-span-2 px-3 py-2">AI平均</div>
            <div className="col-span-1 px-3 py-2 text-right">件数</div>
          </div>

          {viewRows.length ? (
            (viewRows as any[]).map((r) => (
              <div key={mode === "daily" ? r.d : r.m} className="grid grid-cols-12 gap-0 border-b border-slate-100 text-sm">
                <div className="col-span-3 px-3 py-2 text-slate-800">{mode === "daily" ? r.d : r.m}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{r.delta_avg}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{r.delta_max}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{r.human_avg}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{r.ai_avg}</div>
                <div className="col-span-1 px-3 py-2 text-slate-800 text-right">{r.n}</div>
              </div>
            ))
          ) : (
            <div className="px-3 py-6 text-sm text-slate-600">（データがありません）</div>
          )}
        </div>

        <div className="text-xs text-slate-500">
          ※ 集計は <span className="font-semibold">承認時に確定保存した ky_delta_stats</span> を使用します（編集で数値がズレない設計）。
        </div>
      </div>
    </div>
  );
}
