"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type KyEntryRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;
  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  partner_company_name: string | null;
  third_party_situation: string | null;

  weather: string | null;
  temperature_text: string | null;
  wind_direction: string | null;
  wind_speed_text: string | null;
  precipitation_mm: number | null;

  workers: number | null;
  notes: string | null;

  is_approved: boolean | null;

  ai_supplement_raw: string | null;
  ai_supplement_work: string | null;
  ai_supplement_hazards: string | null;
  ai_supplement_measures: string | null;
  ai_supplement_third_party: string | null;

  created_at: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso;
}

export default function KyListClient() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;

  const [rows, setRows] = useState<KyEntryRow[]>([]);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setStatus({ type: null, text: "" });

    const { data, error } = await supabase
      .from("ky_entries")
      .select("*")
      .eq("project_id", projectId)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setStatus({ type: "error", text: `取得に失敗しました：${error.message}` });
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data ?? []) as KyEntryRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const removeRow = useCallback(async (id: string) => {
    setStatus({ type: null, text: "" });

    const ok = window.confirm("このKYを削除しますか？（復元できません）");
    if (!ok) return;

    const { error } = await supabase.from("ky_entries").delete().eq("id", id);
    if (error) {
      setStatus({ type: "error", text: `削除に失敗しました：${error.message}` });
      return;
    }

    // 画面から即反映
    setRows((prev) => prev.filter((r) => r.id !== id));
    setStatus({ type: "success", text: "削除しました。" });
  }, []);

  const hasAi = useCallback((r: KyEntryRow) => {
    return !!(r.ai_supplement_work || r.ai_supplement_hazards || r.ai_supplement_measures || r.ai_supplement_third_party || r.ai_supplement_raw);
  }, []);

  const approvedFirst = useMemo(() => {
    const unapproved = rows.filter((r) => !r.is_approved);
    const approved = rows.filter((r) => r.is_approved);
    // 運用：未承認が上／承認済みは下へ
    return [...unapproved, ...approved];
  }, [rows]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">KY一覧</h1>
        <div className="flex items-center gap-3">
          <Link className="underline text-sm" href={`/projects/${projectId}`}>
            工事詳細へ
          </Link>
          <Link className="bg-black text-white rounded px-4 py-2 text-sm" href={`/projects/${projectId}/ky/new`}>
            ＋KY登録
          </Link>
        </div>
      </div>

      {status.type && (
        <div
          className={`rounded border p-3 text-sm ${
            status.type === "success" ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"
          }`}
        >
          {status.text}
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">読み込み中…</div>}

      {!loading && approvedFirst.length === 0 && <div className="text-sm text-gray-500">まだKYがありません。</div>}

      <div className="space-y-3">
        {approvedFirst.map((r) => (
          <div key={r.id} className="border rounded p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm text-gray-600">{fmtDate(r.work_date)}</div>
                <div className="font-semibold">{r.work_detail || "（作業内容 未入力）"}</div>

                <div className="flex flex-wrap gap-2 text-xs mt-2">
                  <span className="px-2 py-1 rounded bg-gray-100">協力会社：{r.partner_company_name || "—"}</span>
                  <span className="px-2 py-1 rounded bg-yellow-100">第三者：{r.third_party_situation || "—"}</span>
                  <span className="px-2 py-1 rounded bg-gray-100">天候：{r.weather || "—"}</span>
                  <span className="px-2 py-1 rounded bg-gray-100">気温：{r.temperature_text || "—"}</span>
                  <span className="px-2 py-1 rounded bg-gray-100">風：{r.wind_direction || "—"} / {r.wind_speed_text || "—"}</span>
                  <span className="px-2 py-1 rounded bg-gray-100">降水：{r.precipitation_mm ?? "—"}</span>
                  {hasAi(r) && <span className="px-2 py-1 rounded bg-green-100">AI補足あり</span>}
                  {r.is_approved ? (
                    <span className="px-2 py-1 rounded bg-blue-100">承認済み</span>
                  ) : (
                    <span className="px-2 py-1 rounded bg-red-100">未承認</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Link className="border rounded px-3 py-2 text-sm" href={`/projects/${projectId}/ky/${r.id}/review`}>
                  レビュー
                </Link>
                <Link className="border rounded px-3 py-2 text-sm" href={`/projects/${projectId}/ky/${r.id}/edit`}>
                  編集
                </Link>
                <button className="border rounded px-3 py-2 text-sm" onClick={() => removeRow(r.id)}>
                  削除
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4 text-sm">
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">危険ポイント（K）</div>
                <pre className="whitespace-pre-wrap">{r.hazards || "—"}</pre>
              </div>
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">対策（Y）</div>
                <pre className="whitespace-pre-wrap">{r.countermeasures || "—"}</pre>
              </div>
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">備考</div>
                <pre className="whitespace-pre-wrap">{r.notes || "—"}</pre>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
