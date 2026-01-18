"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

const TABLE = "ky_entries";

type KyRow = {
  id: string;
  project_id: string;
  title: string | null;
  is_approved: boolean | null;
  updated_at: string | null;
  created_at: string | null;
};

function fmtDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

export default function KyListClient({
  projectId,
  approvedOnly,
}: {
  projectId: string;
  approvedOnly: boolean;
}) {
  const [rows, setRows] = useState<KyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const filterLabel = useMemo(() => (approvedOnly ? "承認済みのみ" : "全件"), [approvedOnly]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");

      // ✅ is_approved を必ず取得
      let q = supabase
        .from(TABLE)
        .select("id, project_id, title, is_approved, created_at, updated_at")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });

      // ✅ 承認済みのみ
      if (approvedOnly) q = q.eq("is_approved", true);

      const { data, error } = await q;

      if (!alive) return;

      if (error) {
        setErr(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as KyRow[]);
      }

      setLoading(false);
    }

    load();

    return () => {
      alive = false;
    };
  }, [projectId, approvedOnly]);

  return (
    <main style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>KY一覧</h1>
        <span style={{ fontSize: 12, color: "#555" }}>表示: {filterLabel}</span>

        <Link href={`/projects/${projectId}`} style={{ marginLeft: "auto" }}>
          プロジェクトへ戻る
        </Link>
      </div>

      {/* フィルタ・新規作成 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        {approvedOnly ? (
          <Link
            href={`/projects/${projectId}/ky`}
            style={{ padding: "8px 12px", border: "1px solid #222", borderRadius: 8 }}
          >
            全件表示に戻す
          </Link>
        ) : (
          <Link
            href={`/projects/${projectId}/ky?approved=1`}
            style={{ padding: "8px 12px", border: "1px solid #222", borderRadius: 8 }}
          >
            承認済みのみ
          </Link>
        )}

        <Link
          href={`/projects/${projectId}/ky/new`}
          style={{ padding: "8px 12px", border: "1px solid #222", borderRadius: 8 }}
        >
          ＋ 新規作成
        </Link>
      </div>

      {loading && <p>読み込み中…</p>}

      {err && (
        <div style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
          <p style={{ color: "crimson", margin: 0 }}>ERROR: {err}</p>
        </div>
      )}

      {!loading && !err && rows.length === 0 && <p>該当するKYがありません。</p>}

      <ul style={{ display: "grid", gap: 10, listStyle: "none", padding: 0 }}>
        {rows.map((r) => {
          // ✅ 表示判定は厳密に
          const approved = r.is_approved === true;

          return (
            <li key={r.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <strong>{r.title ?? "(無題)"}</strong>
                <span style={{ fontSize: 12, color: "#555" }}>
                  {approved ? "承認済み" : "未承認"}
                </span>
              </div>

              <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                更新: {fmtDateTime(r.updated_at)} / 作成: {fmtDateTime(r.created_at)}
              </div>

              <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
                <Link href={`/projects/${projectId}/ky/${r.id}/edit`}>編集</Link>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
