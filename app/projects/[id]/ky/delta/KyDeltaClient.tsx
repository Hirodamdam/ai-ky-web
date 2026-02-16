"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Row = {
  d: string; // YYYY-MM-DD
  delta_avg: number;
  delta_max: number;
  human_avg: number;
  ai_avg: number;
  n: number;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function fmtDateJp(d: string) {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function round1(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function clampDelta(d: number) {
  if (!Number.isFinite(d)) return 0;
  return Math.max(-100, Math.min(100, Math.round(d)));
}

/** ============ SVG チャート（依存ゼロ） ============ */

type SeriesKey = "delta" | "ai" | "human";

function buildPoints(args: {
  rows: Row[];
  key: SeriesKey;
  w: number;
  h: number;
  pad: number;
  yMin: number;
  yMax: number;
}) {
  const { rows, key, w, h, pad, yMin, yMax } = args;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const xOf = (i: number) => pad + (rows.length <= 1 ? innerW / 2 : (innerW * i) / (rows.length - 1));
  const yOf = (v: number) => {
    const t = yMax === yMin ? 0.5 : (v - yMin) / (yMax - yMin);
    const yy = pad + (1 - t) * innerH;
    return Math.max(pad, Math.min(h - pad, yy));
  };

  const valOf = (r: Row) => {
    if (key === "delta") return r.delta_avg;
    if (key === "ai") return r.ai_avg;
    return r.human_avg;
  };

  const pts = rows.map((r, i) => `${xOf(i)},${yOf(valOf(r))}`).join(" ");
  return pts;
}

function yRange(rows: Row[]) {
  if (!rows.length) return { min: 0, max: 1 };
  const vals = rows.flatMap((r) => [r.delta_avg, r.ai_avg, r.human_avg]);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    min -= 1;
    max += 1;
  } else {
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
  }
  return { min, max };
}

export default function KyDeltaClient() {
  const params = useParams() as { id?: string };
  const projectId = useMemo(() => String(params?.id ?? ""), [params?.id]);

  const [days, setDays] = useState<number>(60);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!projectId) return;
    setErr("");
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("セッションがありません。ログインしてください。");

      const res = await fetch("/api/ky-delta-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ projectId, accessToken, days }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      const r = Array.isArray(j?.rows) ? (j.rows as Row[]) : [];
      setRows(
        r.map((x) => ({
          d: s(x.d).slice(0, 10),
          delta_avg: Number(x.delta_avg) || 0,
          delta_max: Number(x.delta_max) || 0,
          human_avg: Number(x.human_avg) || 0,
          ai_avg: Number(x.ai_avg) || 0,
          n: Number(x.n) || 0,
        }))
      );
    } catch (e: any) {
      setErr(e?.message ?? "読み込みに失敗しました");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, days]);

  useEffect(() => {
    load();
  }, [load]);

  const kpi = useMemo(() => {
    if (!rows.length) return null;
    const n = rows.reduce((a, b) => a + (b.n || 0), 0);
    const avgDelta = rows.reduce((a, b) => a + b.delta_avg, 0) / rows.length;
    const maxDelta = Math.max(...rows.map((r) => r.delta_max));
    const last = rows[rows.length - 1];
    return {
      days: rows.length,
      n,
      avgDelta,
      maxDelta,
      lastDelta: last.delta_avg,
      lastHuman: last.human_avg,
      lastAi: last.ai_avg,
    };
  }, [rows]);

  const { min: yMin, max: yMax } = useMemo(() => yRange(rows), [rows]);

  // SVG サイズ
  const W = 980;
  const H = 280;
  const PAD = 28;

  const ptsDelta = useMemo(() => buildPoints({ rows, key: "delta", w: W, h: H, pad: PAD, yMin, yMax }), [rows, yMin, yMax]);
  const ptsAi = useMemo(() => buildPoints({ rows, key: "ai", w: W, h: H, pad: PAD, yMin, yMax }), [rows, yMin, yMax]);
  const ptsHuman = useMemo(() => buildPoints({ rows, key: "human", w: W, h: H, pad: PAD, yMin, yMax }), [rows, yMin, yMax]);

  const deltaBadge = useMemo(() => {
    const d = clampDelta(kpi?.lastDelta ?? 0);
    if (d >= 30) return { text: "KY再確認推奨", cls: "bg-rose-100 text-rose-800 border-rose-200" };
    if (d >= 20) return { text: "要再確認", cls: "bg-orange-100 text-orange-800 border-orange-200" };
    if (d >= 10) return { text: "やや厳しめ", cls: "bg-amber-100 text-amber-800 border-amber-200" };
    if (d <= -10) return { text: "人が厳しめ", cls: "bg-sky-100 text-sky-800 border-sky-200" };
    return { text: "概ね一致", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
  }, [kpi?.lastDelta]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">Δ推移（AI − 人）</div>
          <div className="mt-1 text-sm text-slate-600">プロジェクト：{projectId}</div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky`}>
            KY一覧へ
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-slate-800">期間</div>
          <div className="flex items-center gap-2 flex-wrap">
            {[30, 60, 90, 180].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
                  days === d ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
              >
                {d}日
              </button>
            ))}
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                loading ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              {loading ? "更新中..." : "更新"}
            </button>
          </div>
        </div>

        {err ? <div className="text-sm text-rose-700">{err}</div> : null}

        {kpi ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600 mb-1">最新Δ（平均）</div>
              <div className="text-2xl font-bold text-slate-900">{round1(kpi.lastDelta)}</div>
              <div className={`mt-2 inline-flex items-center rounded-full border px-2 py-1 text-xs ${deltaBadge.cls}`}>{deltaBadge.text}</div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600 mb-1">期間平均Δ</div>
              <div className="text-2xl font-bold text-slate-900">{round1(kpi.avgDelta)}</div>
              <div className="text-xs text-slate-600 mt-1">日数：{kpi.days} / 件数：{kpi.n}</div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600 mb-1">最大Δ（Max）</div>
              <div className="text-2xl font-bold text-slate-900">{round1(kpi.maxDelta)}</div>
              <div className="text-xs text-slate-600 mt-1">期間内で最も差が出た日</div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600 mb-1">最新：AI / 人</div>
              <div className="text-xl font-bold text-slate-900">
                {round1(kpi.lastAi)} / {round1(kpi.lastHuman)}
              </div>
              <div className="text-xs text-slate-600 mt-1">AI平均 / 人平均</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-600">（データがありません。承認でΔが保存されると表示されます）</div>
        )}

        {/* チャート */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 overflow-x-auto">
          <div className="min-w-[980px]">
            <svg width={W} height={H} className="block">
              {/* 背景 */}
              <rect x="0" y="0" width={W} height={H} fill="white" />

              {/* ガイド（水平線 4本） */}
              {Array.from({ length: 5 }).map((_, i) => {
                const y = PAD + ((H - PAD * 2) * i) / 4;
                const v = yMax - ((yMax - yMin) * i) / 4;
                return (
                  <g key={i}>
                    <line x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#e5e7eb" strokeWidth="1" />
                    <text x={6} y={y + 4} fontSize="10" fill="#64748b">
                      {round1(v)}
                    </text>
                  </g>
                );
              })}

              {/* 系列：Human / AI / Delta（色は固定で見分けやすく） */}
              {rows.length ? (
                <>
                  <polyline points={ptsHuman} fill="none" stroke="#0ea5e9" strokeWidth="2" />
                  <polyline points={ptsAi} fill="none" stroke="#22c55e" strokeWidth="2" />
                  <polyline points={ptsDelta} fill="none" stroke="#ef4444" strokeWidth="2.2" />

                  {/* 最終点マーカー */}
                  <circle cx={W - PAD} cy={Number(ptsDelta.split(" ").slice(-1)[0]?.split(",")[1] || PAD)} r="3.5" fill="#ef4444" />
                </>
              ) : null}

              {/* X軸（日付：先頭/中央/末尾） */}
              {rows.length ? (
                <>
                  <text x={PAD} y={H - 8} fontSize="10" fill="#64748b">
                    {rows[0]?.d}
                  </text>
                  <text x={W / 2 - 36} y={H - 8} fontSize="10" fill="#64748b">
                    {rows[Math.floor(rows.length / 2)]?.d}
                  </text>
                  <text x={W - PAD - 80} y={H - 8} fontSize="10" fill="#64748b">
                    {rows[rows.length - 1]?.d}
                  </text>
                </>
              ) : null}
            </svg>

            <div className="mt-2 flex items-center gap-4 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-0.5" style={{ background: "#ef4444" }} />
                Δ（平均）
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-0.5" style={{ background: "#22c55e" }} />
                AI（平均）
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-0.5" style={{ background: "#0ea5e9" }} />
                人（平均）
              </div>
            </div>
          </div>
        </div>

        {/* 表（最後に確認できるように） */}
        {rows.length ? (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="grid grid-cols-12 gap-0 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
              <div className="col-span-3 px-3 py-2">日付</div>
              <div className="col-span-2 px-3 py-2">Δ平均</div>
              <div className="col-span-2 px-3 py-2">Δ最大</div>
              <div className="col-span-2 px-3 py-2">人平均</div>
              <div className="col-span-2 px-3 py-2">AI平均</div>
              <div className="col-span-1 px-3 py-2 text-right">件数</div>
            </div>

            {rows.map((r) => (
              <div key={r.d} className="grid grid-cols-12 gap-0 border-b border-slate-100 text-sm">
                <div className="col-span-3 px-3 py-2 text-slate-800">{fmtDateJp(r.d)}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{round1(r.delta_avg)}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{round1(r.delta_max)}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{round1(r.human_avg)}</div>
                <div className="col-span-2 px-3 py-2 text-slate-800">{round1(r.ai_avg)}</div>
                <div className="col-span-1 px-3 py-2 text-right text-slate-700">{r.n}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
