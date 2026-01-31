"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type KyEntryRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;
  title: string | null;

  partner_company_name?: string | null;
  subcontractor_name?: string | null;

  is_approved: boolean | null;

  approved_at?: string | null;
  approved_by?: string | null;
  unapproved_at?: string | null;
  unapproved_by?: string | null;

  created_at: string | null;
  updated_at: string | null;
};

type ProfileMini = {
  id: string;
  display_name: string | null;
  role: string | null;
};

const LS_GLOBAL_PARTNER_HISTORY = "ky_partner_history_v1";
const MAX_HISTORY = 30;

function norm(s: string | null | undefined) {
  return (s ?? "").trim();
}
function getPartnerName(r: KyEntryRow): string {
  return norm(r.partner_company_name) || norm(r.subcontractor_name) || "";
}
function isMissingPartner(r: KyEntryRow) {
  return getPartnerName(r) === "";
}
function fmtDate(iso: string | null | undefined) {
  return iso ?? "";
}
function shortId(id: string | null | undefined) {
  const s = norm(id);
  if (!s) return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
function chipClass(base: string) {
  return `inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${base}`;
}

export default function KyPageClient() {
  const params = useParams();
  const projectId = String(params?.id ?? "");

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<KyEntryRow[]>([]);

  const [onlyUnapproved, setOnlyUnapproved] = useState(false);
  const [onlyMissingPartner, setOnlyMissingPartner] = useState(false);

  const [partnerHistory, setPartnerHistory] = useState<string[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<string>("");
  const [partnerContains, setPartnerContains] = useState<string>("");

  const [bulkFixing, setBulkFixing] = useState(false);

  // ✅ user_id -> {display_name, role}
  const [profileMap, setProfileMap] = useState<Record<string, { name: string; role: string }>>(
    {}
  );

  function displayUserName(id: string | null | undefined) {
    const uid = norm(id);
    if (!uid) return "—";
    const p = profileMap[uid];
    return p?.name || shortId(uid);
  }
  function userRole(id: string | null | undefined) {
    const uid = norm(id);
    if (!uid) return "";
    return profileMap[uid]?.role || "";
  }

  function loadPartnerHistoryFromLS() {
    try {
      const raw = localStorage.getItem(LS_GLOBAL_PARTNER_HISTORY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((x) => (typeof x === "string" ? norm(x) : ""))
        .filter((x) => x)
        .slice(0, MAX_HISTORY);
    } catch {
      return [];
    }
  }

  async function fetchProfilesByIds(ids: string[]) {
    const uniq = Array.from(new Set(ids.map(norm).filter(Boolean)));
    if (uniq.length === 0) return;

    const missing = uniq.filter((id) => !profileMap[id]);
    if (missing.length === 0) return;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, role")
        .in("id", missing);

      if (error) throw error;

      const next: Record<string, { name: string; role: string }> = {};
      (data ?? []).forEach((p: any) => {
        const id = String(p.id);
        const dn = norm(p.display_name);
        const role = norm(p.role) || "";
        if (dn) next[id] = { name: dn, role };
      });

      if (Object.keys(next).length > 0) {
        setProfileMap((prev) => ({ ...prev, ...next }));
      }
    } catch {
      // profiles未導入/権限不足でも一覧は落とさない
    }
  }

  const filtered = useMemo(() => {
    const sel = norm(selectedPartner);
    const kw = norm(partnerContains);

    return rows.filter((r) => {
      if (onlyUnapproved && r.is_approved) return false;

      const missing = isMissingPartner(r);
      if (onlyMissingPartner && !missing) return false;

      const p = getPartnerName(r);

      if (sel) {
        if (p !== sel) return false;
      }
      if (kw) {
        if (!p) return false;
        if (!p.includes(kw)) return false;
      }
      return true;
    });
  }, [rows, onlyUnapproved, onlyMissingPartner, selectedPartner, partnerContains]);

  const counts = useMemo(() => {
    const total = rows.length;
    const unapproved = rows.filter((r) => !r.is_approved).length;
    const missingPartner = rows.filter((r) => isMissingPartner(r)).length;
    return { total, unapproved, missingPartner };
  }, [rows]);

  async function fetchRows() {
    if (!projectId) return;
    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data, error } = await supabase
        .from("ky_entries")
        .select("*")
        .eq("project_id", projectId)
        .order("work_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;

      const list = (data ?? []) as any[];

      const normalized: KyEntryRow[] = list.map((x) => ({
        id: x.id,
        project_id: x.project_id ?? null,
        work_date: x.work_date ?? null,
        title: x.title ?? null,

        partner_company_name: x.partner_company_name ?? null,
        subcontractor_name: x.subcontractor_name ?? null,

        is_approved: x.is_approved ?? null,

        approved_at: x.approved_at ?? null,
        approved_by: x.approved_by ?? null,
        unapproved_at: x.unapproved_at ?? null,
        unapproved_by: x.unapproved_by ?? null,

        created_at: x.created_at ?? null,
        updated_at: x.updated_at ?? null,
      }));

      setRows(normalized);
      setPartnerHistory(loadPartnerHistoryFromLS());
      setStatus({ type: "success", text: "読み込み完了" });

      // ✅ 一覧に出る承認者/取消者をまとめて氏名/role取得
      const ids = normalized.flatMap((r) => [r.approved_by ?? "", r.unapproved_by ?? ""]);
      await fetchProfilesByIds(ids);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      setLoading(false);
      setTimeout(() => setStatus({ type: null, text: "" }), 1200);
    }
  }

  async function bulkBackfillMissingPartners() {
    if (!projectId) return;

    const targetCount = counts.missingPartner;
    if (targetCount <= 0) {
      setStatus({ type: "success", text: "未登録はありません" });
      setTimeout(() => setStatus({ type: null, text: "" }), 1200);
      return;
    }

    const ok = window.confirm(
      `協力会社が未登録のKYが ${targetCount} 件あります。\n` +
        "このプロジェクト内で一括補完します。\n\n" +
        "・subcontractor_name があればそれをセット\n" +
        '・無ければ "未登録" をセット\n\n' +
        "実行しますか？"
    );
    if (!ok) return;

    setBulkFixing(true);
    setStatus({ type: null, text: "" });

    try {
      const { data, error } = await supabase
        .from("ky_entries")
        .select("id, subcontractor_name, partner_company_name")
        .eq("project_id", projectId);

      if (error) throw error;

      const list = ((data ?? []) as any[]).filter((x) => norm(x.partner_company_name) === "");

      const db: any = supabase;
      let updated = 0;

      for (const x of list) {
        const id = x.id as string;
        const fallback = norm(x.subcontractor_name) || "未登録";
        const { error: uerr } = await db
          .from("ky_entries")
          .update({ partner_company_name: fallback })
          .eq("id", id);
        if (uerr) throw uerr;
        updated += 1;
      }

      setStatus({ type: "success", text: `一括補完しました：${updated} 件` });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "一括補完に失敗しました" });
    } finally {
      setBulkFixing(false);
      await fetchRows();
      setTimeout(() => setStatus({ type: null, text: "" }), 1500);
    }
  }

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={`/projects/${projectId}`}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          工事詳細へ戻る
        </Link>

        <div className="flex items-center gap-2">
          <Link href="/projects" className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">
            プロジェクト一覧へ
          </Link>
          <Link
            href={`/projects/${projectId}/ky/new`}
            className="rounded-md bg-black px-3 py-2 text-sm text-white hover:opacity-90"
          >
            KY新規作成へ
          </Link>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-lg font-semibold">KY一覧</div>
            <div className="text-xs text-gray-500">Project: {projectId}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm text-gray-600">
              表示件数：{filtered.length} / 全体：{counts.total}
            </div>

            <button
              type="button"
              onClick={bulkBackfillMissingPartners}
              disabled={bulkFixing || counts.missingPartner === 0}
              className={`rounded-md px-3 py-2 text-sm ${
                bulkFixing || counts.missingPartner === 0
                  ? "bg-gray-200 text-gray-500"
                  : "border bg-white hover:bg-gray-50"
              }`}
            >
              {bulkFixing ? "一括補完中..." : "未登録を一括補完"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={chipClass("bg-gray-50 text-gray-700")}>全体：{counts.total}</span>
          <span className={chipClass("bg-amber-50 text-amber-700 border-amber-200")}>
            未承認：{counts.unapproved}
          </span>
          <span className={chipClass("bg-pink-50 text-pink-700 border-pink-200")}>
            協力会社未登録：{counts.missingPartner}
          </span>
        </div>

        <div className="mt-4 rounded-lg border bg-gray-50 p-3">
          <div className="text-sm font-medium">絞り込み</div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-gray-600">協力会社候補（横断履歴）</div>
              <select
                value={selectedPartner}
                onChange={(e) => setSelectedPartner(e.target.value)}
                className="w-full rounded-md border bg-white px-3 py-2 text-sm"
              >
                <option value="">（候補から選択）</option>
                {partnerHistory.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1 text-xs text-gray-600">協力会社 部分一致</div>
              <input
                value={partnerContains}
                onChange={(e) => setPartnerContains(e.target.value)}
                placeholder="例：〇〇建設 / 株式会社 / 有限会社"
                className="w-full rounded-md border bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyUnapproved}
                onChange={(e) => setOnlyUnapproved(e.target.checked)}
              />
              未承認のみ
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyMissingPartner}
                onChange={(e) => setOnlyMissingPartner(e.target.checked)}
              />
              協力会社未登録のみ
            </label>

            <button
              onClick={() => {
                setSelectedPartner("");
                setPartnerContains("");
              }}
              className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-50"
            >
              クリア
            </button>
          </div>
        </div>

        {status.type && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              status.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {status.text}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {loading && <div className="text-sm text-gray-500">読み込み中...</div>}

          {!loading && filtered.length === 0 && (
            <div className="rounded-md border bg-gray-50 p-4 text-sm text-gray-600">
              該当するKYがありません
            </div>
          )}

          {filtered.map((r) => {
            const missing = isMissingPartner(r);
            const partner = getPartnerName(r);

            const actorId = r.is_approved ? r.approved_by : r.unapproved_by;
            const actorName = displayUserName(actorId);
            const actorRole = userRole(actorId);
            const actorIsAdmin = actorRole === "admin";

            const when = r.is_approved ? r.approved_at : r.unapproved_at;

            return (
              <div
                key={r.id}
                className={`rounded-xl border bg-white p-4 shadow-sm ${
                  missing ? "border-pink-200" : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-base font-semibold">
                        {r.title || "（工事件名未設定）"}
                      </div>

                      {r.is_approved ? (
                        <span className={chipClass("bg-slate-900 text-white border-slate-900")}>
                          承認済み
                        </span>
                      ) : (
                        <span className={chipClass("bg-amber-50 text-amber-700 border-amber-200")}>
                          未承認
                        </span>
                      )}

                      {missing && (
                        <span className={chipClass("bg-pink-50 text-pink-700 border-pink-200")}>
                          協力会社 未登録
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-sm text-gray-600">
                      作業日：{fmtDate(r.work_date)} / 協力会社：
                      {missing ? (
                        <span className="font-semibold text-pink-700">未登録</span>
                      ) : (
                        <span className="font-semibold">{partner}</span>
                      )}
                    </div>

                    {/* ✅ 視認性アップ：承認/取消情報 */}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`rounded-full border px-2 py-0.5 ${
                          r.is_approved
                            ? "border-slate-200 bg-slate-50 text-slate-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {r.is_approved ? "承認" : "取消"}
                      </span>

                      <span className="text-gray-600">{fmtDate(when) || "—"}</span>

                      <span className="text-gray-400">/</span>

                      <span className="font-semibold text-gray-900">{actorName}</span>

                      {actorIsAdmin && (
                        <span className="rounded-full border border-slate-900 bg-slate-900 px-2 py-0.5 text-xs text-white">
                          admin
                        </span>
                      )}
                    </div>

                    <div className="mt-1 text-xs text-gray-400">kyId: {r.id}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/projects/${projectId}/ky/${r.id}/edit`}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      編集
                    </Link>

                    <Link
                      href={`/projects/${projectId}/ky/${r.id}/review`}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:opacity-90"
                    >
                      レビュー
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
