// app/projects/[id]/ky/KyListClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type KyRow = {
  id: string;
  project_id: string | null;
  work_date: string | null;
  partner_company_name: string | null;
  worker_count: number | null;
  third_party_level: string | null;

  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  approved_at: string | null;
  public_token: string | null;
  public_enabled: boolean | null;

  created_at: string | null;
};

type DeltaRow = {
  ky_id: string;
  human_score: number;
  ai_score: number;
  delta: number;
  computed_at: string;
};

function s(v: any) {
  return v == null ? "" : String(v);
}

function fmtDateJp(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function fmtDateTimeJp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP");
}

function deltaBadge(d: number) {
  // 既存の通知段階と整合（強/要再確認/やや/小）
  if (d >= 30) return { label: `Δ +${d}（強）`, cls: "bg-rose-100 text-rose-800 border-rose-200" };
  if (d >= 20) return { label: `Δ +${d}（要再確認）`, cls: "bg-orange-100 text-orange-800 border-orange-200" };
  if (d >= 10) return { label: `Δ +${d}（やや）`, cls: "bg-amber-100 text-amber-800 border-amber-200" };
  if (d <= -10) return { label: `Δ ${d}（人が厳しめ）`, cls: "bg-sky-100 text-sky-800 border-sky-200" };
  return { label: `Δ ${d >= 0 ? `+${d}` : `${d}`}（小）`, cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
}

export default function KyListClient() {
  const params = useParams() as { id?: string };
  const router = useRouter();
  const projectId = useMemo(() => s(params?.id).trim(), [params?.id]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [rows, setRows] = useState<KyRow[]>([]);
  const [deltaMap, setDeltaMap] = useState<Record<string, DeltaRow>>({});

  const statusClass = useMemo(() => {
    if (status.type === "success") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    if (status.type === "error") return "border border-rose-200 bg-rose-50 text-rose-800";
    return "border border-slate-200 bg-slate-50 text-slate-700";
  }, [status.type]);

  const load = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      // ky_entries
      const { data: kyData, error: kyErr } = await supabase
        .from("ky_entries")
        .select(
          [
            "id",
            "project_id",
            "work_date",
            "partner_company_name",
            "worker_count",
            "third_party_level",
            "work_detail",
            "hazards",
            "countermeasures",
            "approved_at",
            "public_token",
            "public_enabled",
            "created_at",
          ].join(",")
        )
        .eq("project_id", projectId)
        .order("work_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200);

      if (kyErr) throw kyErr;

      const list = (Array.isArray(kyData) ? kyData : []) as any[];
      const typed: KyRow[] = list.map((r) => ({
        id: s(r.id),
        project_id: r.project_id ?? null,
        work_date: r.work_date ?? null,
        partner_company_name: r.partner_company_name ?? null,
        worker_count: r.worker_count ?? null,
        third_party_level: r.third_party_level ?? null,
        work_detail: r.work_detail ?? null,
        hazards: r.hazards ?? null,
        countermeasures: r.countermeasures ?? null,
        approved_at: r.approved_at ?? null,
        public_token: r.public_token ?? null,
        public_enabled: r.public_enabled ?? null,
        created_at: r.created_at ?? null,
      }));

      setRows(typed);

      // ky_delta_stats（型定義未更新でも落とさない：as any で回避）
      const sbAny = supabase as any;
      const { data: dData, error: dErr } = await sbAny
        .from("ky_delta_stats")
        .select("ky_id,human_score,ai_score,delta,computed_at")
        .eq("project_id", projectId)
        .order("computed_at", { ascending: false })
        .limit(500);

      if (dErr) {
        // Δテーブル未生成/権限などでも一覧自体は生かす
        console.warn("[KyList] ky_delta_stats fetch error:", dErr?.message);
        setDeltaMap({});
      } else {
        const arr: any[] = Array.isArray(dData) ? dData : [];
        const map: Record<string, DeltaRow> = {};
        for (const r of arr) {
          const ky_id = s(r.ky_id).trim();
          if (!ky_id) continue;
          // 最新だけ残す（computed_at desc）
          if (!map[ky_id]) {
            map[ky_id] = {
              ky_id,
              human_score: Number(r.human_score) ?? 0,
              ai_score: Number(r.ai_score) ?? 0,
              delta: Number(r.delta) ?? 0,
              computed_at: s(r.computed_at),
            };
          }
        }
        setDeltaMap(map);
      }
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "KY一覧の取得に失敗しました" });
      setRows([]);
      setDeltaMap({});
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = useCallback(
    async (kyId: string) => {
      if (!projectId || !kyId) return;
      const ok = window.confirm("このKYを完全削除します。よろしいですか？（テスト用）");
      if (!ok) return;

      setStatus({ type: null, text: "" });
      try {
        // 先にΔを消す（FK cascade が効いていれば不要だが安全側）
        const sbAny = supabase as any;
        await sbAny.from("ky_delta_stats").delete().eq("ky_id", kyId);

        const { error } = await supabase.from("ky_entries").delete().eq("id", kyId).eq("project_id", projectId);
        if (error) throw error;

        setStatus({ type: "success", text: "削除しました" });
        await load();
      } catch (e: any) {
        setStatus({ type: "error", text: e?.message ?? "削除に失敗しました" });
      }
    },
    [projectId, load]
  );

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">KY 一覧</div>
          <div className="mt-1 text-sm text-slate-600">プロジェクト：{projectId}</div>
        </div>

        <div className="flex items-center gap-3">
          <Link className="text-sm text-blue-600 underline" href={`/projects/${projectId}/ky/new`}>
            新規作成
          </Link>
          <Link className="text-sm text-blue-600 underline" href={`/projects/${projectId}/delta`}>
            Δ推移（AI−人）
          </Link>
        </div>
      </div>

      {!!status.text && <div className={`rounded-lg px-3 py-2 text-sm ${statusClass}`}>{status.text}</div>}

      {rows.length ? (
        <div className="space-y-3">
          {rows.map((r) => {
            const approved = !!r.approved_at;
            const d = deltaMap[r.id];
            const hasDelta = !!d;

            const badge = hasDelta ? deltaBadge(Number(d.delta) || 0) : null;

            return (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-sm font-semibold text-slate-900">
                        {r.work_date ? fmtDateJp(r.work_date) : "（日付不明）"}
                      </div>

                      {approved ? (
                        <span className="text-xs px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800">
                          承認済み{r.approved_at ? `（${fmtDateTimeJp(r.approved_at)}）` : ""}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700">未承認</span>
                      )}

                      {badge ? (
                        <span className={`text-xs px-2 py-1 rounded-full border ${badge.cls}`}>{badge.label}</span>
                      ) : null}

                      {hasDelta ? (
                        <span className="text-xs text-slate-500">
                          AI/人：{d.ai_score}/{d.human_score}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-2 text-sm text-slate-700 break-words">
                      <span className="text-slate-500">協力会社：</span>
                      {r.partner_company_name || "（未入力）"}
                      <span className="mx-2 text-slate-300">|</span>
                      <span className="text-slate-500">作業員：</span>
                      {r.worker_count != null ? `${r.worker_count}人` : "（未入力）"}
                      <span className="mx-2 text-slate-300">|</span>
                      <span className="text-slate-500">第三者：</span>
                      {r.third_party_level || "（未入力）"}
                    </div>

                    <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap break-words">
                      {s(r.work_detail).trim() || "（作業内容 未入力）"}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 shrink-0">
                    <Link
                      className="text-sm text-blue-600 underline text-right"
                      href={`/projects/${projectId}/ky/${r.id}/review`}
                    >
                      レビュー
                    </Link>

                    <Link
                      className="text-sm text-blue-600 underline text-right"
                      href={`/projects/${projectId}/ky/${r.id}/edit`}
                    >
                      編集
                    </Link>

                    <button
                      type="button"
                      onClick={() => onDelete(r.id)}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 hover:bg-rose-100"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">（KYがありません）</div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => load()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          再読み込み
        </button>
      </div>
    </div>
  );
}
