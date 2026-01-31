"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type Subcontractor = {
  id: string;
  name: string | null;
  name_kana?: string | null;
};

type ProjectSubcontractorRow = {
  id: string;
  project_id: string;
  subcontractor_id: string;
  created_at?: string | null;
};

function showTemp(setStatus: (s: Status) => void, s: Status) {
  setStatus(s);
  if (s.type) window.setTimeout(() => setStatus({ type: null, text: "" }), 3500);
}

export default function ProjectSubcontractorsClient({
  projectId,
}: {
  projectId: string;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });

  const [allSubs, setAllSubs] = useState<Subcontractor[]>([]);
  const [links, setLinks] = useState<ProjectSubcontractorRow[]>([]);

  const [search, setSearch] = useState("");
  const [selectedSubId, setSelectedSubId] = useState<string>("");

  async function load() {
    setLoading(true);
    try {
      // 1) 現場の紐づけ一覧
      const { data: linkData, error: linkErr } = await supabase
        .from("project_subcontractors")
        .select("id, project_id, subcontractor_id, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (linkErr) throw linkErr;

      const linkRows = (linkData ?? []) as ProjectSubcontractorRow[];
      setLinks(linkRows);

      // 2) 下請会社マスタ
      const { data: subData, error: subErr } = await supabase
        .from("subcontractors")
        .select("id, name, name_kana")
        .order("name", { ascending: true });

      if (subErr) throw subErr;

      setAllSubs((subData ?? []) as Subcontractor[]);
    } catch {
      showTemp(setStatus, { type: "error", text: "読み込みに失敗しました。" });
      setAllSubs([]);
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const linkedIds = useMemo(
    () => new Set(links.map((l) => l.subcontractor_id)),
    [links]
  );

  const linkedList = useMemo(() => {
    return links
      .map((l) => {
        const sc = allSubs.find((s) => s.id === l.subcontractor_id);
        return { ...l, name: sc?.name ?? "(名称未設定)" };
      })
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "", "ja"));
  }, [links, allSubs]);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allSubs
      .filter((s) => {
        if (!q) return true;
        const n = (s.name ?? "").toLowerCase();
        const k = (s.name_kana ?? "").toLowerCase();
        return n.includes(q) || k.includes(q);
      })
      .filter((s) => !linkedIds.has(s.id));
  }, [allSubs, linkedIds, search]);

  async function onAdd() {
    const subId = selectedSubId;
    if (!subId) {
      showTemp(setStatus, { type: "error", text: "追加する下請会社を選択してください。" });
      return;
    }
    if (linkedIds.has(subId)) {
      showTemp(setStatus, { type: "error", text: "すでに紐づけ済みです。" });
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.from("project_subcontractors").insert({
        project_id: projectId,
        subcontractor_id: subId,
      });

      if (error) throw error;

      showTemp(setStatus, { type: "success", text: "紐づけを追加しました。" });
      setSelectedSubId("");
      await load();
    } catch {
      showTemp(setStatus, { type: "error", text: "追加に失敗しました。" });
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(linkId: string) {
    const ok = window.confirm("この紐づけを解除します。よろしいですか？");
    if (!ok) return;

    setBusy(true);
    try {
      const { error } = await supabase
        .from("project_subcontractors")
        .delete()
        .eq("id", linkId)
        .eq("project_id", projectId);

      if (error) throw error;

      showTemp(setStatus, { type: "success", text: "紐づけを解除しました。" });
      await load();
    } catch {
      showTemp(setStatus, { type: "error", text: "解除に失敗しました。" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-sm text-gray-600">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">下請会社の紐づけ（現場ごと）</h1>
          <div className="text-xs text-gray-600">
            <Link className="underline" href={`/projects/${projectId}/ky`}>
              KY一覧へ戻る
            </Link>
            <span className="mx-2">/</span>
            <Link className="underline" href={`/projects/${projectId}/subcontractors`}>
              下請会社マスタへ
            </Link>
          </div>
        </div>

        <div className="text-xs text-gray-600">
          現場ID: <span className="font-mono">{projectId}</span>
        </div>
      </div>

      {status.type && (
        <div
          className={`rounded border p-3 text-sm ${
            status.type === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {status.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded border border-gray-200 p-4 space-y-3">
          <div className="text-sm font-semibold">追加（この現場で使う下請会社）</div>

          <div className="space-y-1">
            <label className="text-xs text-gray-600">候補検索（社名 / カナ）</label>
            <input
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="例：日特 / にっとく"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-600">追加する会社</label>
            <select
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={selectedSubId}
              onChange={(e) => setSelectedSubId(e.target.value)}
            >
              <option value="">選択してください</option>
              {filteredCandidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? "(名称未設定)"}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-gray-600">
              候補: {filteredCandidates.length}件（※すでに紐づけ済みは除外）
            </div>
          </div>

          <button
            onClick={onAdd}
            disabled={busy}
            className="px-3 py-2 rounded bg-black text-white text-sm hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "処理中..." : "この現場に追加"}
          </button>
        </div>

        <div className="rounded border border-gray-200 p-4 space-y-3">
          <div className="text-sm font-semibold">現在の紐づけ</div>

          {linkedList.length === 0 ? (
            <div className="text-sm text-gray-600">
              まだ紐づけがありません。左で追加してください。
            </div>
          ) : (
            <div className="space-y-2">
              {linkedList.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{l.name}</div>
                    <div className="text-[11px] text-gray-600 font-mono truncate">
                      subcontractor_id: {l.subcontractor_id}
                    </div>
                  </div>

                  <button
                    onClick={() => onRemove(l.id)}
                    disabled={busy}
                    className="px-2 py-1 rounded border border-red-300 text-red-700 text-xs hover:bg-red-50 disabled:opacity-60"
                  >
                    解除
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="text-[11px] text-gray-600">
            ここで登録した会社だけが、KY編集/新規の「下請会社」プルダウンに表示されます。
          </div>
        </div>
      </div>

      <div className="rounded border border-gray-200 p-4 space-y-2">
        <div className="text-sm font-semibold">確認手順</div>
        <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-1">
          <li>この画面で、下請会社を1社「この現場に追加」</li>
          <li>KY編集へ戻り、下請会社プルダウンに表示されることを確認</li>
        </ol>
      </div>
    </div>
  );
}
