"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type Sub = {
  id: string;
  name: string | null;
};

type ProjectSub = {
  id: string;
  project_id: string;
  subcontractor_id: string;
  is_active: boolean | null;
  created_at: string | null;
  subcontractors: Sub | Sub[] | null;
};

function nameOf(v: Sub | Sub[] | null | undefined) {
  if (!v) return "";
  if (Array.isArray(v)) return (v[0]?.name ?? "").trim();
  return (v.name ?? "").trim();
}

// ✅ UUID形式っぽいか最低限チェック（undefined / 空文字 / 変な値を止める）
function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default function SubcontractorsClient({ projectId }: { projectId: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [allSubs, setAllSubs] = useState<Sub[]>([]);
  const [projectSubs, setProjectSubs] = useState<ProjectSub[]>([]);

  const [newName, setNewName] = useState("");

  async function reload(validProjectId: string) {
    setLoading(true);
    setStatus({ type: null, text: "" });

    // 全下請（マスタ）
    const a = await supabase
      .from("subcontractors")
      .select("id,name")
      .order("name", { ascending: true });

    if (a.error) {
      setAllSubs([]);
      setProjectSubs([]);
      setStatus({ type: "error", text: `下請マスタ取得に失敗: ${a.error.message}` });
      setLoading(false);
      return;
    }

    // 現場紐付け（JOINして名前取得）
    const p = await supabase
      .from("project_subcontractors")
      .select("id,project_id,subcontractor_id,is_active,created_at, subcontractors ( id, name )")
      .eq("project_id", validProjectId)
      .order("created_at", { ascending: true });

    if (p.error) {
      setAllSubs((a.data ?? []) as Sub[]);
      setProjectSubs([]);
      setStatus({ type: "error", text: `現場紐付け取得に失敗: ${p.error.message}` });
      setLoading(false);
      return;
    }

    setAllSubs((a.data ?? []) as Sub[]);
    setProjectSubs((p.data ?? []) as unknown as ProjectSub[]);
    setLoading(false);
  }

  useEffect(() => {
    let alive = true;

    async function boot() {
      // ✅ mounted前は何もしない
      if (!mounted) return;

      // ✅ projectId が未設定/変なら Supabase を叩かない
      if (!projectId || projectId === "undefined" || !isUuidLike(projectId)) {
        setAllSubs([]);
        setProjectSubs([]);
        setLoading(false);
        setStatus({
          type: "error",
          text: `現場IDが不正です: "${String(projectId)}"（URLの /projects/{id}/subcontractors を確認）`,
        });
        return;
      }

      if (!alive) return;
      await reload(projectId);
    }

    boot();

    return () => {
      alive = false;
    };
  }, [mounted, projectId]);

  const activeIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of projectSubs) {
      if (r.is_active) s.add(r.subcontractor_id);
    }
    return s;
  }, [projectSubs]);

  const selectable = useMemo(() => {
    const linked = new Set(projectSubs.map((r) => r.subcontractor_id));
    return allSubs.filter((s) => !linked.has(s.id));
  }, [allSubs, projectSubs]);

  async function addLink(subcontractorId: string) {
    if (!projectId || projectId === "undefined" || !isUuidLike(projectId)) return;

    setSaving(true);
    setStatus({ type: null, text: "" });

    const { error } = await supabase.from("project_subcontractors").insert({
      project_id: projectId,
      subcontractor_id: subcontractorId,
      is_active: true,
    });

    if (error) {
      setStatus({ type: "error", text: `紐付け追加に失敗: ${error.message}` });
      setSaving(false);
      return;
    }

    setStatus({ type: "success", text: "紐付けを追加しました。" });
    await reload(projectId);
    setSaving(false);
  }

  async function toggleActive(rowId: string, next: boolean) {
    if (!projectId || projectId === "undefined" || !isUuidLike(projectId)) return;

    setSaving(true);
    setStatus({ type: null, text: "" });

    const { error } = await supabase.from("project_subcontractors").update({ is_active: next }).eq("id", rowId);

    if (error) {
      setStatus({ type: "error", text: `有効/無効の更新に失敗: ${error.message}` });
      setSaving(false);
      return;
    }

    setStatus({ type: "success", text: next ? "有効にしました。" : "無効にしました。" });
    await reload(projectId);
    setSaving(false);
  }

  async function createSubcontractor() {
    if (!projectId || projectId === "undefined" || !isUuidLike(projectId)) {
      setStatus({ type: "error", text: "現場IDが不正のため作成できません。" });
      return;
    }

    const name = newName.trim();
    if (!name) {
      setStatus({ type: "error", text: "会社名を入力してください。" });
      return;
    }

    setSaving(true);
    setStatus({ type: null, text: "" });

    const exists = allSubs.some((s) => (s.name ?? "").trim() === name);
    if (exists) {
      setStatus({ type: "error", text: "同名の下請会社が既にあります。" });
      setSaving(false);
      return;
    }

    const { data, error } = await supabase.from("subcontractors").insert({ name }).select("id,name").single();

    if (error) {
      setStatus({ type: "error", text: `下請会社の作成に失敗: ${error.message}` });
      setSaving(false);
      return;
    }

    setNewName("");

    const id = (data as any)?.id as string | undefined;
    if (id) {
      const { error: linkErr } = await supabase.from("project_subcontractors").insert({
        project_id: projectId,
        subcontractor_id: id,
        is_active: true,
      });

      if (linkErr) {
        setStatus({ type: "error", text: `作成は成功しましたが紐付けに失敗: ${linkErr.message}` });
        await reload(projectId);
        setSaving(false);
        return;
      }
    }

    setStatus({ type: "success", text: "下請会社を作成し、この現場に追加しました。" });
    await reload(projectId);
    setSaving(false);
  }

  if (!mounted) return null;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">現場の下請会社 管理</h1>
          <div className="text-xs text-gray-600">現場ID: {projectId}</div>
        </div>

        <div className="flex items-center gap-2">
          <Link href={`/projects/${projectId}`} className="rounded border px-3 py-2 text-sm">
            プロジェクトへ戻る
          </Link>
          <Link href={`/projects/${projectId}/ky`} className="rounded border px-3 py-2 text-sm">
            KY一覧へ
          </Link>
        </div>
      </div>

      {status.type && (
        <div
          className={`rounded border px-3 py-2 text-sm ${
            status.type === "success" ? "border-green-300" : "border-red-300"
          }`}
        >
          {status.text}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-600">読込中...</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* 左：紐付け一覧 */}
          <div className="space-y-3 rounded-lg border bg-white p-4 shadow-sm">
            <div className="text-base font-semibold">紐付け済み（この現場）</div>

            {projectSubs.length === 0 ? (
              <div className="text-sm text-gray-600">まだ紐付けがありません。</div>
            ) : (
              <div className="space-y-2">
                {projectSubs.map((r) => {
                  const nm = nameOf(r.subcontractors) || "(名称未設定)";
                  const active = !!r.is_active;
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-3 rounded border p-3">
                      <div className="min-w-0">
                        <div className="font-medium">{nm}</div>
                        <div className="text-xs text-gray-600">状態: {active ? "有効" : "無効"}</div>
                      </div>

                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => toggleActive(r.id, !active)}
                        className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                      >
                        {active ? "無効にする" : "有効にする"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="text-xs text-gray-600">
              ※ 無効にした会社はKYのプルダウン候補から外れます（過去KYの表示は保持）。
            </div>
          </div>

          {/* 右：追加 */}
          <div className="space-y-4 rounded-lg border bg-white p-4 shadow-sm">
            <div className="text-base font-semibold">追加（マスタ → この現場へ紐付け）</div>

            <div className="space-y-2 rounded border p-3">
              <div className="text-sm font-medium">新しい下請会社を作成して、この現場に追加</div>
              <div className="flex gap-2">
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  placeholder="会社名（例：株式会社〇〇）"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={saving}
                />
                <button
                  className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  type="button"
                  disabled={saving}
                  onClick={createSubcontractor}
                >
                  作成
                </button>
              </div>
              <div className="text-xs text-gray-600">※ 作成後、この現場に「有効」で自動紐付けします。</div>
            </div>

            <div className="space-y-2 rounded border p-3">
              <div className="text-sm font-medium">既存マスタから追加</div>

              {selectable.length === 0 ? (
                <div className="text-sm text-gray-600">追加できる会社がありません（全て紐付け済みです）。</div>
              ) : (
                <div className="space-y-2">
                  {selectable.map((s) => {
                    const nm = (s.name ?? "").trim() || "(名称未設定)";
                    return (
                      <div key={s.id} className="flex items-center justify-between gap-3 rounded border p-3">
                        <div className="min-w-0 text-sm">{nm}</div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => addLink(s.id)}
                          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                        >
                          追加
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="text-xs text-gray-600">有効な会社のみがKY新規/編集のプルダウンに出ます。</div>
          </div>
        </div>
      )}
    </div>
  );
}
