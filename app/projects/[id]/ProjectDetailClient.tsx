"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type Project = {
  id: string;
  name: string | null;
  contractor_name?: string | null;
  address?: string | null;
  lat?: number | null;
  lon?: number | null;
};

type KyEntryRow = {
  id: string;
  project_id: string | null;
  work_date: string | null;
  work_detail: string | null;
  partner_company_name: string | null;
  third_party_situation: string | null;
  is_approved: boolean | null;
  created_at: string | null;
};

function fmt(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

export default function ProjectDetailClient() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [kyRows, setKyRows] = useState<KyEntryRow[]>([]);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus({ type: null, text: "" });

    const sess = await supabase.auth.getSession();
    setLoggedIn(!!sess.data.session);

    const p = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
    if (p.error || !p.data) {
      setProject(null);
      setKyRows([]);
      setStatus({ type: "error", text: "工事情報を取得できません。" });
      setLoading(false);
      return;
    }
    setProject(p.data as Project);

    const k = await supabase
      .from("ky_entries")
      .select("id,project_id,work_date,work_detail,partner_company_name,third_party_situation,is_approved,created_at")
      .eq("project_id", projectId)
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10);

    if (k.error) {
      setKyRows([]);
      setStatus({ type: "error", text: `KY一覧の取得に失敗しました：${k.error.message}` });
      setLoading(false);
      return;
    }

    setKyRows((k.data ?? []) as KyEntryRow[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const kySummary = useMemo(() => {
    const total = kyRows.length;
    const approved = kyRows.filter((r) => r.is_approved).length;
    const unapproved = total - approved;
    return { total, approved, unapproved };
  }, [kyRows]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-gray-600">工事詳細</div>
          <h1 className="text-xl font-bold">{project?.name ?? "—"}</h1>
        </div>

        <div className="flex items-center gap-2">
          <Link className="border rounded px-3 py-2 text-sm" href="/projects">
            一覧へ
          </Link>
          <Link className="border rounded px-3 py-2 text-sm" href={`/projects/${projectId}/edit`}>
            工事情報を編集
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
          {status.type === "error" && status.text.includes("/login") && (
            <div className="mt-2">
              <Link className="underline" href="/login">
                /login へ
              </Link>
            </div>
          )}
        </div>
      )}

      {loggedIn === false && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">
          ログイン状態を確認できません。操作（保存/承認等）を行うには{" "}
          <Link className="underline" href="/login">
            /login
          </Link>{" "}
          から再ログインしてください。
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">読み込み中…</div>}

      {!loading && project && (
        <>
          <div className="border rounded p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">工事件名</div>
                <div>{fmt(project.name)}</div>
              </div>
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">施工会社</div>
                <div>{fmt(project.contractor_name ?? "株式会社三竹工業")}</div>
              </div>
              <div className="border rounded p-3">
                <div className="font-semibold mb-1">緯度 / 経度</div>
                <div>
                  {fmt(project.lat)} / {fmt(project.lon)}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link className="bg-black text-white rounded px-4 py-2 text-sm" href={`/projects/${projectId}/ky`}>
                KY一覧へ
              </Link>
              <Link className="border rounded px-4 py-2 text-sm" href={`/projects/${projectId}/ky/new`}>
                ＋KY登録（新規）
              </Link>
              <Link className="border rounded px-4 py-2 text-sm" href={`/projects/${projectId}/project-subcontractors`}>
                協力会社管理
              </Link>
            </div>
          </div>

          <div className="border rounded p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">直近のKY（最大10件）</div>
              <div className="text-sm text-gray-600">
                合計 {kySummary.total} / 未承認 {kySummary.unapproved} / 承認済 {kySummary.approved}
              </div>
            </div>

            {kyRows.length === 0 ? (
              <div className="text-sm text-gray-500">KYがまだありません。「＋KY登録」から作成してください。</div>
            ) : (
              <div className="space-y-2">
                {kyRows.map((r) => (
                  <div key={r.id} className="border rounded p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm text-gray-600">{r.work_date ?? "—"}</div>
                        <div className="font-semibold">{r.work_detail ?? "（作業内容 未入力）"}</div>

                        <div className="flex flex-wrap gap-2 text-xs mt-2">
                          <span className="px-2 py-1 rounded bg-gray-100">協力会社：{r.partner_company_name ?? "—"}</span>
                          <span className="px-2 py-1 rounded bg-yellow-100">第三者：{r.third_party_situation ?? "—"}</span>
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
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
