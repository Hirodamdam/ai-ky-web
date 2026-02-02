// app/projects/[id]/ky/KyListClient.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type Project = {
  id: string;
  name: string | null;
};

type KyRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;

  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  // 第三者（多い/少ない）
  third_party_level?: string | boolean | null;
  third_party?: string | boolean | null;

  // AI補足（列名揺れ）
  ai_work_detail?: string | null;
  ai_hazards?: string | null;
  ai_countermeasures?: string | null;
  ai_third_party?: string | null;

  work_detail_ai?: string | null;
  hazards_ai?: string | null;
  countermeasures_ai?: string | null;
  third_party_ai?: string | null;

  ai_supplement?: string | null;
  ai_supplement_json?: any | null;

  partner_company_name?: string | null;
  is_approved?: boolean | null;

  created_at?: string | null;
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function thirdPartyDisplay(v: string | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "多い" : "少ない";
  return String(v).trim();
}

function pickFirstNonEmpty(row: any, keys: string[]): string {
  for (const k of keys) {
    const v = row?.[k];
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
}

function hasAi(row: KyRow): boolean {
  const s =
    pickFirstNonEmpty(row, ["ai_work_detail", "work_detail_ai"]) ||
    pickFirstNonEmpty(row, ["ai_hazards", "hazards_ai"]) ||
    pickFirstNonEmpty(row, ["ai_countermeasures", "countermeasures_ai"]) ||
    pickFirstNonEmpty(row, ["ai_third_party", "third_party_ai"]) ||
    (typeof row.ai_supplement === "string" ? row.ai_supplement.trim() : "") ||
    (row.ai_supplement_json ? "x" : "");
  return !!s;
}

function clipOneLine(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 40 ? t.slice(0, 40) + "…" : t;
}

export default function KyListClient() {
  const params = useParams<{ id: string }>();
  const projectId = useMemo(() => String((params as any)?.id ?? ""), [params]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [rows, setRows] = useState<KyRow[]>([]);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("id,name")
        .eq("id", projectId)
        .maybeSingle();
      if (projErr) throw projErr;

      const { data, error } = await supabase
        .from("ky_entries")
        .select("*")
        .eq("project_id", projectId)
        .order("work_date", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (error) throw error;

      setProject((proj as Project) ?? null);
      setRows((data as KyRow[]) ?? []);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const onDelete = useCallback(
    async (kyId: string) => {
      if (!confirm("このKYを削除します。よろしいですか？")) return;

      setStatus({ type: null, text: "" });
      try {
        const { error } = await supabase.from("ky_entries").delete().eq("id", kyId).eq("project_id", projectId);
        if (error) throw error;

        setStatus({ type: "success", text: "削除しました" });
        await refetch();
      } catch (e: any) {
        setStatus({ type: "error", text: e?.message ?? "削除に失敗しました" });
      }
    },
    [projectId, refetch]
  );

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mx-auto max-w-4xl">
        {/* ヘッダー（完成形に寄せてシンプル） */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-bold text-slate-900">KY一覧</div>
            <div className="mt-1 text-sm text-slate-600">{project?.name ?? "（工事名不明）"}</div>
          </div>

          <Link
            href={`/projects/${projectId}/ky/new`}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            KY新規作成
          </Link>
        </div>

        {status.type && (
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              status.type === "success"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {status.text}
          </div>
        )}

        {/* 一覧 */}
        <div className="mt-4 space-y-3">
          {rows.length === 0 ? (
            <div className="text-sm text-slate-600">KYがまだありません。</div>
          ) : (
            rows.map((r) => {
              const approved = !!r.is_approved;
              const third = thirdPartyDisplay(r.third_party_level ?? r.third_party);
              const ai = hasAi(r);

              return (
                <div key={r.id} className="rounded-lg border border-slate-300 bg-white p-4">
                  {/* 上段：日付 + バッジ */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">{fmtDate(r.work_date) || "（日付未設定）"}</div>

                    <div className="flex flex-wrap gap-2 justify-end">
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          approved ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {approved ? "承認済" : "未承認"}
                      </span>

                      <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                        第三者:{third || "—"}
                      </span>

                      <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                        AI補足{ai ? "あり" : "なし"}
                      </span>
                    </div>
                  </div>

                  {/* 本文（完成形の並び：協力会社 → 作業内容） */}
                  <div className="mt-3 text-sm text-slate-800">
                    <div>協力会社：{r.partner_company_name?.trim() || "（未入力）"}</div>
                    <div className="mt-1">作業内容：{clipOneLine(r.work_detail) || "（未入力）"}</div>
                  </div>

                  {/* ボタン（完成形：編集 / レビュー / 削除） */}
                  <div className="mt-3 flex gap-2">
                    <Link
                      href={`/projects/${projectId}/ky/${r.id}/edit`}
                      className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      編集
                    </Link>

                    <Link
                      href={`/projects/${projectId}/ky/${r.id}/review`}
                      className="rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      レビュー
                    </Link>

                    <button
                      onClick={() => onDelete(r.id)}
                      className="rounded border border-rose-400 bg-white px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                    >
                      削除
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 下部に戻る（必要なら） */}
        <div className="mt-6">
          <Link href={`/projects/${projectId}`} className="text-sm text-blue-600 underline">
            工事詳細へ
          </Link>
        </div>
      </div>
    </div>
  );
}
