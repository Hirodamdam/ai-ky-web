"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type KyEntryRow = {
  id: string;
  project_id: string | null;

  title: string | null;
  work_date: string | null;

  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  weather: string | null;
  temperature_text: string | null;
  wind_direction: string | null;
  wind_speed_text: string | null;
  precipitation_mm: number | null;

  workers: number | null;
  notes: string | null;

  is_approved: boolean | null;

  // ✅ 追加：協力会社（表示のみ）
  partner_company_name: string | null;

  created_at: string | null;
  updated_at: string | null;
};

function fmtDate(v: string | null): string {
  if (!v) return "";
  return v.slice(0, 10);
}

function isUuidLike(v: string) {
  // “undefined” を確実に弾くことが目的。UUID形式を広めに許容。
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function labelValue(label: string, value: React.ReactNode) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 13, opacity: 0.85 }}>{label}</div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{value}</div>
    </div>
  );
}

export default function KyPageClient() {
  const router = useRouter();
  const params = useParams<{ id: string; kyId: string }>();

  const projectId = params?.id ?? "";
  const kyId = params?.kyId ?? "";

  const invalidParams = useMemo(() => {
    if (!projectId || !kyId) return true;
    if (projectId === "undefined" || kyId === "undefined") return true;
    if (!isUuidLike(projectId) || !isUuidLike(kyId)) return true;
    return false;
  }, [projectId, kyId]);

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [row, setRow] = useState<KyEntryRow | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setStatus({ type: null, text: "" });

      if (invalidParams) {
        setRow(null);
        setLoading(false);
        setStatus({
          type: "error",
          text:
            "URLパラメータ（id / kyId）が不正です。直前の画面の導線でID未確定のまま遷移しています。",
        });
        return;
      }

      const { data, error } = await supabase
        .from("ky_entries")
        .select("*") // ✅ partner_company_name があれば自動で取れる
        .eq("id", kyId)
        .maybeSingle<KyEntryRow>();

      if (!mounted) return;

      if (error) {
        setRow(null);
        setLoading(false);
        setStatus({ type: "error", text: `読み込みに失敗しました: ${error.message}` });
        return;
      }

      if (!data) {
        setRow(null);
        setLoading(false);
        setStatus({ type: "error", text: "対象のKYが見つかりませんでした。" });
        return;
      }

      if (data.project_id && data.project_id !== projectId) {
        setStatus({
          type: "error",
          text: "注意: KYのproject_idとURLのidが一致しません。URLを確認してください。",
        });
      }

      setRow(data);
      setLoading(false);
    }

    load();

    return () => {
      mounted = false;
    };
  }, [projectId, kyId, invalidParams]);

  async function onDelete() {
    if (loading || deleting) return;

    if (invalidParams) {
      setStatus({ type: "error", text: "URLパラメータ（id / kyId）が不正です。" });
      return;
    }
    if (!row) return;

    const ok = window.confirm("このKYを削除します。よろしいですか？");
    if (!ok) return;

    setDeleting(true);
    setStatus({ type: null, text: "" });

    try {
      const { error } = await supabase.from("ky_entries").delete().eq("id", kyId);

      if (error) {
        setStatus({ type: "error", text: `削除に失敗しました: ${error.message}` });
        return;
      }

      setStatus({ type: "success", text: "削除しました。一覧へ戻ります。" });

      router.push(`/projects/${projectId}/ky`);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  if (invalidParams) {
    return (
      <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>KY 詳細</div>

        {status.type && (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#fff5f5",
              color: "#b00020",
              fontWeight: 600,
            }}
          >
            {status.text}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/projects" style={{ textDecoration: "underline" }}>
            プロジェクト一覧へ
          </Link>
          <button
            onClick={() => router.back()}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            戻る
          </button>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75 }}>
          project: {String(projectId)} / ky: {String(kyId)}
        </div>
      </div>
    );
  }

  const listHref = `/projects/${projectId}/ky`;
  const editHref = `/projects/${projectId}/ky/${kyId}/edit`;

  const partner = row?.partner_company_name?.trim() ? row.partner_company_name.trim() : "";

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <Link href={listHref} style={{ textDecoration: "underline" }}>
          一覧へ戻る
        </Link>

        <div style={{ flex: 1 }} />

        <Link
          href={editHref}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            textDecoration: "none",
            background: "#fff",
            fontWeight: 700,
          }}
        >
          編集（/edit）
        </Link>

        <button
          onClick={onDelete}
          disabled={loading || deleting || !row}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: deleting ? "#f2f2f2" : "#fff",
            cursor: loading || deleting || !row ? "not-allowed" : "pointer",
            fontWeight: 700,
          }}
        >
          {deleting ? "削除中..." : "削除"}
        </button>
      </div>

      {status.type && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #ddd",
            background: status.type === "error" ? "#fff5f5" : "#f5fff7",
            color: status.type === "error" ? "#b00020" : "#0b6b2b",
            fontWeight: 600,
          }}
        >
          {status.text}
        </div>
      )}

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 14, padding: 16 }}>
        <h2 style={{ margin: "0 0 12px 0" }}>KY 詳細</h2>

        {loading ? (
          <div style={{ padding: 12 }}>読み込み中...</div>
        ) : !row ? (
          <div style={{ padding: 12 }}>表示できるデータがありません。</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gap: 8 }}>
              {labelValue("タイトル", row.title?.trim() ? row.title : "無題")}
              {labelValue("作業日", fmtDate(row.work_date) || "—")}

              {/* ✅ 協力会社：詳細に表示 */}
              {labelValue("協力会社", partner ? partner : "（未登録）")}

              {labelValue("採用（承認）", row.is_approved ? "採用" : "未採用")}
            </div>

            <div style={{ height: 1, background: "#eee" }} />

            <div style={{ display: "grid", gap: 10 }}>
              {labelValue("作業内容", row.work_detail?.trim() ? row.work_detail : "—")}
              {labelValue("危険ポイント", row.hazards?.trim() ? row.hazards : "—")}
              {labelValue("対策", row.countermeasures?.trim() ? row.countermeasures : "—")}
            </div>

            <div style={{ height: 1, background: "#eee" }} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                gap: 10,
              }}
            >
              <div style={{ gridColumn: "span 2" }}>
                {labelValue("天気", row.weather?.trim() ? row.weather : "—")}
              </div>
              {labelValue("気温", row.temperature_text?.trim() ? row.temperature_text : "—")}
              {labelValue("人数", row.workers ?? "—")}

              {labelValue("風向", row.wind_direction?.trim() ? row.wind_direction : "—")}
              {labelValue("風速", row.wind_speed_text?.trim() ? row.wind_speed_text : "—")}
              {labelValue("降水量(mm)", row.precipitation_mm ?? "—")}
              <div style={{ gridColumn: "span 4" }}>
                {labelValue("備考", row.notes?.trim() ? row.notes : "—")}
              </div>
            </div>

            <div style={{ height: 1, background: "#eee" }} />

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Link
                href={listHref}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  textDecoration: "none",
                  background: "#fff",
                }}
              >
                一覧へ戻る
              </Link>
              <Link
                href={editHref}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  textDecoration: "none",
                  background: "#fff",
                  fontWeight: 700,
                }}
              >
                編集（/edit）
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
