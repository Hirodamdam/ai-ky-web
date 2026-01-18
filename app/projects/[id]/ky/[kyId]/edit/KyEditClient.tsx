"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type KyEntry = {
  id: string;
  project_id: string;

  title: string | null;
  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  weather: string | null;
  workers: number | null;
  notes: string | null;

  wind_speed_text: string | null;
  precipitation_mm: number | null;

  // ✅ 承認フラグ
  is_approved: boolean | null;

  created_at?: string | null;
  updated_at?: string | null;
};

const TABLE = "ky_entries";

function fmtDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

export default function KyEditClient({
  projectId,
  kyId,
}: {
  projectId: string;
  kyId: string;
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });

  const [form, setForm] = useState<KyEntry>({
    id: kyId,
    project_id: projectId,

    title: "",
    work_detail: "",
    hazards: "",
    countermeasures: "",

    weather: "",
    workers: null,
    notes: "",

    wind_speed_text: "",
    precipitation_mm: null,

    is_approved: false,

    created_at: null,
    updated_at: null,
  });

  const canSave = useMemo(() => !saving && !deleting, [saving, deleting]);

  // 初期取得
  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setStatus({ type: null, text: "" });

      const { data, error } = await supabase
        .from(TABLE)
        .select(
          `
          id,
          project_id,
          title,
          work_detail,
          hazards,
          countermeasures,
          weather,
          workers,
          notes,
          wind_speed_text,
          precipitation_mm,
          is_approved,
          created_at,
          updated_at
        `
        )
        .eq("id", kyId)
        .eq("project_id", projectId)
        .maybeSingle();

      if (!alive) return;

      if (error) {
        setStatus({ type: "error", text: `読み込みに失敗しました: ${error.message}` });
        setLoading(false);
        return;
      }

      if (!data) {
        setStatus({
          type: "error",
          text: "データが見つかりませんでした（権限/RLS/ID不一致の可能性）",
        });
        setLoading(false);
        return;
      }

      setForm((prev) => ({
        ...prev,
        ...data,

        // null補正
        title: data.title ?? "",
        work_detail: data.work_detail ?? "",
        hazards: data.hazards ?? "",
        countermeasures: data.countermeasures ?? "",
        weather: data.weather ?? "",
        notes: data.notes ?? "",
        wind_speed_text: data.wind_speed_text ?? "",
        workers: data.workers ?? null,
        precipitation_mm: data.precipitation_mm ?? null,

        // ✅ 承認フラグ補正
        is_approved: data.is_approved ?? false,
      }));

      setLoading(false);
    }

    load();

    return () => {
      alive = false;
    };
  }, [projectId, kyId]);

  async function onSave() {
    if (!canSave) return;

    setSaving(true);
    setStatus({ type: null, text: "" });

    const payload = {
      title: form.title?.trim() || null,
      work_detail: form.work_detail?.trim() || null,
      hazards: form.hazards?.trim() || null,
      countermeasures: form.countermeasures?.trim() || null,

      weather: form.weather?.trim() || null,
      workers: form.workers ?? null,
      notes: form.notes?.trim() || null,

      wind_speed_text: form.wind_speed_text?.trim() || null,
      precipitation_mm: form.precipitation_mm ?? null,

      // ✅ 承認フラグも保存
      is_approved: form.is_approved ?? false,

      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq("id", kyId)
      .eq("project_id", projectId);

    if (error) {
      setStatus({ type: "error", text: `保存に失敗しました: ${error.message}` });
      setSaving(false);
      return;
    }

    setStatus({ type: "success", text: "保存しました" });
    setSaving(false);

    // ✅ 保存後はKY一覧へ戻る
    router.push(`/projects/${projectId}/ky`);
    router.refresh();
  }

  async function onDelete() {
    if (deleting || saving) return;

    const ok = window.confirm("このKYを削除します。よろしいですか？");
    if (!ok) return;

    setDeleting(true);
    setStatus({ type: null, text: "" });

    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq("id", kyId)
      .eq("project_id", projectId);

    if (error) {
      setStatus({ type: "error", text: `削除に失敗しました: ${error.message}` });
      setDeleting(false);
      return;
    }

    setDeleting(false);
    router.push(`/projects/${projectId}/ky`);
    router.refresh();
  }

  if (loading) {
    return (
      <main style={{ padding: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>KY編集</h1>
        <p>読み込み中…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 16, maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>KY編集</h1>

      {status.type && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            border: "1px solid #ddd",
          }}
        >
          <strong style={{ marginRight: 8 }}>
            {status.type === "success" ? "OK" : "ERROR"}
          </strong>
          <span>{status.text}</span>
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {/* ✅ 承認チェック */}
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={!!form.is_approved}
            onChange={(e) => setForm({ ...form, is_approved: e.target.checked })}
          />
          承認済み
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          タイトル
          <input
            type="text"
            value={form.title ?? ""}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          作業内容
          <textarea
            value={form.work_detail ?? ""}
            onChange={(e) => setForm({ ...form, work_detail: e.target.value })}
            rows={3}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          危険ポイント（K）
          <textarea
            value={form.hazards ?? ""}
            onChange={(e) => setForm({ ...form, hazards: e.target.value })}
            rows={3}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          対策（Y）
          <textarea
            value={form.countermeasures ?? ""}
            onChange={(e) => setForm({ ...form, countermeasures: e.target.value })}
            rows={3}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          天候（例：晴れ / 曇り / 雨）
          <input
            type="text"
            value={form.weather ?? ""}
            onChange={(e) => setForm({ ...form, weather: e.target.value })}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          作業人数
          <input
            type="number"
            value={form.workers ?? ""}
            onChange={(e) =>
              setForm({
                ...form,
                workers: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            style={{
              padding: 8,
              border: "1px solid #ccc",
              borderRadius: 6,
              width: 160,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          備考
          <textarea
            value={form.notes ?? ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            style={{ padding: 8, border: "1px solid #ccc", borderRadius: 6 }}
          />
        </label>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "grid", gap: 6 }}>
            風速（m/s）
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                style={{
                  width: 120,
                  padding: 8,
                  border: "1px solid #ccc",
                  borderRadius: 6,
                }}
                value={
                  form.wind_speed_text === null || form.wind_speed_text === undefined
                    ? ""
                    : String(form.wind_speed_text).replace(/m\/s\s*$/i, "")
                }
                onChange={(e) => setForm({ ...form, wind_speed_text: e.target.value })}
              />
              <span>m/s</span>
            </div>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            降水量（mm）
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                style={{
                  width: 120,
                  padding: 8,
                  border: "1px solid #ccc",
                  borderRadius: 6,
                }}
                value={form.precipitation_mm ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    precipitation_mm: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <span>mm</span>
            </div>
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button
            onClick={onSave}
            disabled={!canSave}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #222",
              background: canSave ? "#222" : "#999",
              color: "#fff",
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "保存中…" : "保存"}
          </button>

          <button
            onClick={onDelete}
            disabled={deleting || saving}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: deleting || saving ? "not-allowed" : "pointer",
            }}
          >
            {deleting ? "削除中…" : "削除"}
          </button>

          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            disabled={saving || deleting}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: saving || deleting ? "not-allowed" : "pointer",
            }}
          >
            プロジェクトへ戻る
          </button>
        </div>

        <div style={{ marginTop: 8, color: "#555", fontSize: 12 }}>
          作成日時: {fmtDateTime(form.created_at)} / 更新日時: {fmtDateTime(form.updated_at)}
        </div>
      </div>
    </main>
  );
}
