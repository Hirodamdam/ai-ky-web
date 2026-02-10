// app/projects/[id]/ProjectDetailClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type Project = {
  id: string;
  name: string | null;
  contractor_name: string | null;
  address: string | null;

  lat?: number | null;
  lon?: number | null;

  slope_camera_snapshot_url?: string | null;
  path_camera_snapshot_url?: string | null;
};

type PartnerRow = {
  id: string;
  project_id: string | null;
  partner_company_name: string | null;
  created_at: string | null;
};

type EntrantRow = {
  id: string;
  project_id: string | null;
  partner_entry_id: string | null;
  entrant_no: string | null;
  entrant_name: string | null;
  created_at?: string | null;
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const hh = d.getHours();
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${y}/${m}/${day} ${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

export default function ProjectDetailClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const projectId = useMemo(() => String((params as any)?.id ?? ""), [params]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [partnerInput, setPartnerInput] = useState("");

  // ✅ 個人入場者（会社別）
  const [selectedPartnerEntryId, setSelectedPartnerEntryId] = useState<string>("");
  const [entrants, setEntrants] = useState<EntrantRow[]>([]);
  const [entrantName, setEntrantName] = useState("");
  const [entrantNo, setEntrantNo] = useState("");
  const [entrantLoading, setEntrantLoading] = useState(false);

  const selectedPartner = useMemo(() => {
    return partners.find((p) => p.id === selectedPartnerEntryId) ?? null;
  }, [partners, selectedPartnerEntryId]);

  const refetch = useCallback(async () => {
    if (!projectId) {
      if (mountedRef.current) setLoading(false);
      return;
    }

    if (mountedRef.current) {
      setStatus({ type: null, text: "" });
      setLoading(true);
    }

    try {
      // ✅ projects
      const { data: proj, error: projErr } = await (supabase as any)
        .from("projects")
        .select("id,name,contractor_name,address,lat,lon,slope_camera_snapshot_url,path_camera_snapshot_url")
        .eq("id", projectId)
        .maybeSingle();
      if (projErr) throw projErr;

      // ✅ project_partner_entries
      const { data: rows, error: rowsErr } = await (supabase as any)
        .from("project_partner_entries")
        .select("id,project_id,partner_company_name,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      const safeRows = rowsErr ? [] : Array.isArray(rows) ? rows : [];

      if (mountedRef.current) {
        setProject((proj as Project) ?? null);
        setPartners(safeRows as PartnerRow[]);
      }
    } catch (e: any) {
      if (mountedRef.current) setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  const fetchEntrants = useCallback(
    async (partnerEntryId: string) => {
      if (!projectId || !partnerEntryId) {
        if (mountedRef.current) setEntrants([]);
        return;
      }
      if (mountedRef.current) setEntrantLoading(true);
      try {
        const { data, error } = await (supabase as any)
          .from("project_entrant_entries")
          .select("id,project_id,partner_entry_id,entrant_no,entrant_name,created_at")
          .eq("project_id", projectId)
          .eq("partner_entry_id", partnerEntryId)
          .order("created_at", { ascending: false });

        if (error) throw error;

        const safe = Array.isArray(data) ? (data as EntrantRow[]) : [];
        if (mountedRef.current) setEntrants(safe);
      } catch (e: any) {
        if (mountedRef.current) {
          setEntrants([]);
          setStatus({ type: "error", text: e?.message ?? "入場者の読み込みに失敗しました" });
        }
      } finally {
        if (mountedRef.current) setEntrantLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  // ✅ 会社一覧が変わったら、選択会社を自動セット（未選択時のみ）
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!partners.length) {
      setSelectedPartnerEntryId("");
      setEntrants([]);
      return;
    }
    if (!selectedPartnerEntryId) {
      const firstId = partners[0]?.id ?? "";
      setSelectedPartnerEntryId(firstId);
      if (firstId) fetchEntrants(firstId);
      return;
    }
    // 選択中の会社が消えた場合
    const exists = partners.some((p) => p.id === selectedPartnerEntryId);
    if (!exists) {
      const firstId = partners[0]?.id ?? "";
      setSelectedPartnerEntryId(firstId);
      if (firstId) fetchEntrants(firstId);
    }
  }, [partners, selectedPartnerEntryId, fetchEntrants]);

  const onRegisterPartner = useCallback(async () => {
    setStatus({ type: null, text: "" });
    const name = partnerInput.trim();
    if (!name) {
      setStatus({ type: "error", text: "協力会社名を入力してください" });
      return;
    }

    try {
      const { data, error } = await (supabase as any)
        .from("project_partner_entries")
        .insert({
          project_id: projectId,
          partner_company_name: name,
        })
        .select("id")
        .maybeSingle();

      if (error) throw error;

      setPartnerInput("");
      setStatus({ type: "success", text: "協力会社を入場登録しました" });
      await refetch();

      // ✅ 追加した会社を選択状態に（取れた場合）
      const newId = s((data as any)?.id).trim();
      if (newId) {
        setSelectedPartnerEntryId(newId);
        await fetchEntrants(newId);
      }
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "入場登録に失敗しました" });
    }
  }, [partnerInput, projectId, refetch, fetchEntrants]);

  const onReload = useCallback(async () => {
    await refetch();
    if (selectedPartnerEntryId) await fetchEntrants(selectedPartnerEntryId);
  }, [refetch, selectedPartnerEntryId, fetchEntrants]);

  const onChangeSelectedPartner = useCallback(
    async (nextId: string) => {
      setSelectedPartnerEntryId(nextId);
      setStatus({ type: null, text: "" });
      await fetchEntrants(nextId);
    },
    [fetchEntrants]
  );

  const onAddEntrant = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const pid = selectedPartnerEntryId;
    if (!pid) {
      setStatus({ type: "error", text: "協力会社を選択してください" });
      return;
    }

    const name = entrantName.trim();
    const no = entrantNo.trim();

    if (!name) {
      setStatus({ type: "error", text: "入場者氏名を入力してください" });
      return;
    }

    try {
      const { error } = await (supabase as any).from("project_entrant_entries").insert({
        project_id: projectId,
        partner_entry_id: pid,
        entrant_name: name,
        entrant_no: no || null,
      });
      if (error) throw error;

      setEntrantName("");
      setEntrantNo("");
      setStatus({ type: "success", text: "入場者を登録しました" });
      await fetchEntrants(pid);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "入場者登録に失敗しました" });
    }
  }, [projectId, selectedPartnerEntryId, entrantName, entrantNo, fetchEntrants]);

  const onDeleteEntrant = useCallback(
    async (entrantId: string) => {
      setStatus({ type: null, text: "" });
      const pid = selectedPartnerEntryId;
      if (!pid) return;

      const ok = window.confirm("この入場者を削除しますか？");
      if (!ok) return;

      try {
        const { error } = await (supabase as any)
          .from("project_entrant_entries")
          .delete()
          .eq("id", entrantId)
          .eq("project_id", projectId);

        if (error) throw error;

        setStatus({ type: "success", text: "入場者を削除しました" });
        await fetchEntrants(pid);
      } catch (e: any) {
        setStatus({ type: "error", text: e?.message ?? "削除に失敗しました" });
      }
    },
    [projectId, selectedPartnerEntryId, fetchEntrants]
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
        <div className="text-lg font-bold text-slate-900">工事詳細</div>

        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${projectId}/edit`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            工事情報編集
          </Link>

          <Link className="text-sm text-slate-700 hover:underline" href="/projects">
            ← プロジェクト一覧へ
          </Link>
        </div>
      </div>

      {status.type && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            status.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {status.text}
        </div>
      )}

      {/* 工事情報 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">工事情報</div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-[140px_1fr] gap-y-2 gap-x-4 text-sm">
          <div className="text-slate-600">工事名</div>
          <div className="text-slate-900 font-semibold">{project?.name ?? "（不明）"}</div>

          <div className="text-slate-600">プロジェクトID</div>
          <div className="text-slate-700 break-all">{projectId}</div>

          <div className="text-slate-600">施工会社</div>
          <div className="text-slate-700">{project?.contractor_name ?? "（未入力）"}</div>

          <div className="text-slate-600">場所</div>
          <div className="text-slate-700">{project?.address ?? "（未入力）"}</div>

          <div className="text-slate-600">緯度 / 経度</div>
          <div className="text-slate-700">
            {project?.lat != null && project?.lon != null ? `${project.lat} / ${project.lon}` : "（未入力）"}
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-500">
          ※ 気象の自動取得は「工事情報編集」で緯度・経度を入れると動きます。
        </div>
      </div>

      {/* 定点写真（工事情報編集で登録したものをここで確認できる） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">定点写真（通路／法面）</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-semibold text-slate-800">法面（定点）</div>
            <div className="mt-2">
              {s(project?.slope_camera_snapshot_url).trim() ? (
                <a href={s(project?.slope_camera_snapshot_url).trim()} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s(project?.slope_camera_snapshot_url).trim()}
                    alt="法面（定点）"
                    className="w-full rounded-md border border-slate-200"
                    loading="lazy"
                  />
                </a>
              ) : (
                <div className="text-sm text-slate-500">（未登録・任意）</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-semibold text-slate-800">通路（定点）</div>
            <div className="mt-2">
              {s(project?.path_camera_snapshot_url).trim() ? (
                <a href={s(project?.path_camera_snapshot_url).trim()} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s(project?.path_camera_snapshot_url).trim()}
                    alt="通路（定点）"
                    className="w-full rounded-md border border-slate-200"
                    loading="lazy"
                  />
                </a>
              ) : (
                <div className="text-sm text-slate-500">（未登録・任意）</div>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500">※ 写真の登録は「工事情報編集」で行います（ここは表示のみ）。</div>
      </div>

      {/* 入場済み協力会社 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">入場済み協力会社</div>

        <div className="mt-3 flex flex-col md:flex-row gap-2">
          <input
            value={partnerInput}
            onChange={(e) => setPartnerInput(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="協力会社名を入力（例：○○建設）"
          />
          <div className="flex gap-2">
            <button
              onClick={onRegisterPartner}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            >
              入場登録
            </button>
            <button onClick={onReload} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
              再読込
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-2 text-left text-slate-600 font-semibold">協力会社</th>
                <th className="py-2 text-left text-slate-600 font-semibold">登録日時</th>
              </tr>
            </thead>
            <tbody>
              {partners.length ? (
                partners.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 text-slate-900">{r.partner_company_name ?? "（不明）"}</td>
                    <td className="py-2 text-slate-700">{fmtDateTime(r.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="py-3 text-slate-500" colSpan={2}>
                    （入場済み協力会社がありません）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-2 text-xs text-slate-500">※ DBの列は partner_company_name です（company_name は存在しません）。</div>
      </div>

      {/* ✅ 会社別：入場者（個人）登録 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">入場者（作業員）登録（会社別）</div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-3 items-start">
          <div className="space-y-2">
            <div className="text-xs text-slate-600 font-semibold">協力会社を選択</div>
            <select
              value={selectedPartnerEntryId}
              onChange={(e) => onChangeSelectedPartner(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              disabled={!partners.length}
            >
              {!partners.length ? (
                <option value="">（先に協力会社を入場登録してください）</option>
              ) : (
                partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partner_company_name ?? "（不明）"}
                  </option>
                ))
              )}
            </select>

            <div className="text-xs text-slate-500">
              選択中：{selectedPartner?.partner_company_name ?? "（未選択）"}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-600 font-semibold">入場者を追加</div>

            <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_120px] gap-2">
              <input
                value={entrantName}
                onChange={(e) => setEntrantName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="氏名（例：山田 太郎）"
                disabled={!selectedPartnerEntryId}
              />
              <input
                value={entrantNo}
                onChange={(e) => setEntrantNo(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="番号（任意）"
                disabled={!selectedPartnerEntryId}
              />
              <button
                onClick={onAddEntrant}
                className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-900 disabled:opacity-50"
                disabled={!selectedPartnerEntryId}
              >
                追加
              </button>
            </div>

            <div className="text-xs text-slate-500">
              ※ 会社を選んだ状態で、氏名を入れて「追加」。会社別に一覧管理します。
            </div>
          </div>
        </div>

        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-800">
              入場者一覧（{selectedPartner?.partner_company_name ?? "未選択"}）
            </div>
            <button
              onClick={() => selectedPartnerEntryId && fetchEntrants(selectedPartnerEntryId)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
              disabled={!selectedPartnerEntryId}
            >
              一覧を再読込
            </button>
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="py-2 text-left text-slate-600 font-semibold">氏名</th>
                  <th className="py-2 text-left text-slate-600 font-semibold">番号</th>
                  <th className="py-2 text-left text-slate-600 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {!selectedPartnerEntryId ? (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={3}>
                      （協力会社を選択してください）
                    </td>
                  </tr>
                ) : entrantLoading ? (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={3}>
                      （読み込み中…）
                    </td>
                  </tr>
                ) : entrants.length ? (
                  entrants.map((r) => (
                    <tr key={r.id} className="border-b border-slate-200/60">
                      <td className="py-2 text-slate-900">{r.entrant_name ?? "（不明）"}</td>
                      <td className="py-2 text-slate-700">{r.entrant_no ?? "—"}</td>
                      <td className="py-2">
                        <button
                          onClick={() => onDeleteEntrant(r.id)}
                          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50"
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="py-3 text-slate-500" colSpan={3}>
                      （この会社の入場者がまだいません）
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-2 text-xs text-slate-500">
            ※ DB: project_entrant_entries（partner_entry_idで会社別に紐付け）
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => router.push(`/projects/${projectId}/ky`)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
        >
          KY一覧へ
        </button>
        <button
          onClick={() => router.push(`/projects/${projectId}/ky/new`)}
          className="rounded-lg bg-black px-3 py-2 text-sm text-white hover:bg-slate-900"
        >
          KY新規作成
        </button>
      </div>
    </div>
  );
}
