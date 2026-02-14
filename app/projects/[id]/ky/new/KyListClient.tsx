// app/projects/[id]/ky/KyListClient.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

// localStorage（全プロジェクト横断 協力会社候補）
const LS_GLOBAL_PARTNER_HISTORY = "ky_partner_history_v1";
const MAX_HISTORY = 30;

function norm(s: string | null | undefined) {
  return (s ?? "").trim();
}

function isoDateTodayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function loadPartnerHistoryFromLS(): string[] {
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

function savePartnerHistoryToLS(next: string[]) {
  try {
    localStorage.setItem(
      LS_GLOBAL_PARTNER_HISTORY,
      JSON.stringify(next.slice(0, MAX_HISTORY))
    );
  } catch {
    // noop
  }
}

function upsertHistory(current: string[], value: string): string[] {
  const v = norm(value);
  if (!v) return current;

  // 先頭に入れる（最近使った順）
  const dedup = [v, ...current.filter((x) => norm(x) && norm(x) !== v)];
  return dedup.slice(0, MAX_HISTORY);
}

export default function KyListClient() {
  const params = useParams();
  const router = useRouter();
  const projectId = String((params as any)?.id ?? "");

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [saving, setSaving] = useState(false);

  // 入力
  const [workDate, setWorkDate] = useState<string>(isoDateTodayJst());
  const [partnerCompanyName, setPartnerCompanyName] = useState<string>("");

  // 候補（横断履歴）
  const [partnerHistory, setPartnerHistory] = useState<string[]>([]);
  const [selectedPartner, setSelectedPartner] = useState<string>("");

  // バリデーション
  const partnerMissing = useMemo(() => norm(partnerCompanyName) === "", [partnerCompanyName]);

  useEffect(() => {
    setPartnerHistory(loadPartnerHistoryFromLS());
  }, []);

  // 候補を選んだら入力欄に反映
  useEffect(() => {
    const sel = norm(selectedPartner);
    if (sel) setPartnerCompanyName(sel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPartner]);

  async function createKy() {
    if (!projectId) {
      setStatus({ type: "error", text: "projectId が不明です" });
      return;
    }

    const partner = norm(partnerCompanyName);
    if (!partner) {
      setStatus({ type: "error", text: "協力会社が未入力です（必須）" });
      return;
    }

    setSaving(true);
    setStatus({ type: null, text: "" });

    try {
      // ✅ Supabase型の列チェック回避のため insert は any で構築
      const payload: any = {
        project_id: projectId,
        work_date: workDate || isoDateTodayJst(),
        partner_company_name: partner, // ✅ ここが必須
        is_approved: false,
      };

      const { data, error } = await supabase
        .from("ky_entries")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;

      // ✅ 横断履歴へ追加
      const nextHistory = upsertHistory(loadPartnerHistoryFromLS(), partner);
      savePartnerHistoryToLS(nextHistory);
      setPartnerHistory(nextHistory);

      const newId = (data as any)?.id as string | undefined;
      if (!newId) throw new Error("作成に失敗しました（id不明）");

      setStatus({ type: "success", text: "作成しました（新規作成へ移動します）" });

      // ✅ 新規作成（詳細入力）へ移動（一覧へ戻さない）
      router.push(`/projects/${projectId}/ky/${newId}/new`);
      router.refresh();
      return;
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "作成に失敗しました" });
    } finally {
      setSaving(false);
      setTimeout(() => setStatus({ type: null, text: "" }), 1500);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={`/projects/${projectId}/ky`}
          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
        >
          KY一覧へ戻る
        </Link>

        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-gray-50"
        >
          再読込
        </button>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="text-lg font-semibold">KY新規作成</div>
        <div className="mt-1 text-xs text-gray-500">Project: {projectId}</div>

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

        <div className="mt-4 space-y-4">
          {/* 作業日 */}
          <div className="rounded-lg border p-3">
            <div className="text-xs text-gray-500">作業日</div>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
            />
          </div>

          {/* 協力会社（必須） */}
          <div className={`rounded-lg border p-3 ${partnerMissing ? "border-pink-200" : ""}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-gray-500">協力会社（必須）</div>
                <div className="mt-1 text-sm text-gray-600">
                  候補から選ぶか、直接入力してください
                </div>
              </div>
              {partnerMissing ? (
                <span className="rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-xs text-pink-700">
                  未入力（保存不可）
                </span>
              ) : (
                <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs text-green-700">
                  OK
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs text-gray-600">候補（横断履歴）</div>
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
                <div className="mb-1 text-xs text-gray-600">直接入力</div>
                <input
                  value={partnerCompanyName}
                  onChange={(e) => setPartnerCompanyName(e.target.value)}
                  placeholder="例：株式会社〇〇"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* 作成 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={createKy}
              disabled={saving || partnerMissing}
              className={`rounded-md px-4 py-2 text-sm text-white ${
                saving || partnerMissing ? "bg-gray-300" : "bg-black hover:opacity-90"
              }`}
              title={partnerMissing ? "協力会社が未入力です" : "作成"}
            >
              {saving ? "作成中..." : "作成"}
            </button>

            <div className="text-sm text-gray-600">
              {partnerMissing ? "協力会社は必須です（未登録のKYは作れません）" : "入力OKです"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
