// app/projects/[id]/ProjectDetailClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

// ✅ 実DBの列に合わせる（company_name は存在しない）
type PartnerEntry = {
  id: string;
  project_id: string;
  partner_company_name: string;
  created_at: string;
};

export default function ProjectDetailClient() {
  const params = useParams<{ id: string }>();
  const projectId = useMemo(() => String(params?.id ?? ""), [params]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });

  const [project, setProject] = useState<any>(null);
  const [projectLoading, setProjectLoading] = useState<boolean>(true);

  const [enteredPartners, setEnteredPartners] = useState<PartnerEntry[]>([]);
  const [partnersLoading, setPartnersLoading] = useState<boolean>(true);

  const [companyName, setCompanyName] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);

  // ✅ Supabase の型定義(Database)に project_partner_entries が未反映なため TS が落ちている
  //    → ここだけ any で逃がして、実行時は正しく動かす
  const sb = supabase as any;

  const clearStatusSoon = useCallback(() => {
    window.setTimeout(() => setStatus({ type: null, text: "" }), 3500);
  }, []);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setProjectLoading(true);
    try {
      const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).single();
      if (error) throw error;
      setProject(data ?? null);
    } catch (e: any) {
      console.error(e);
      setStatus({ type: "error", text: `工事情報の取得に失敗しました：${e?.message ?? "unknown error"}` });
      clearStatusSoon();
    } finally {
      setProjectLoading(false);
    }
  }, [projectId, clearStatusSoon]);

  const loadEnteredPartners = useCallback(async () => {
    if (!projectId) return;
    setPartnersLoading(true);
    try {
      const { data, error } = await sb
        .from("project_partner_entries")
        .select("id, project_id, partner_company_name, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setEnteredPartners((data ?? []) as PartnerEntry[]);
    } catch (e: any) {
      console.error(e);
      setStatus({
        type: "error",
        text: `入場済み協力会社の取得に失敗しました：${e?.message ?? "unknown error"}`,
      });
      clearStatusSoon();
    } finally {
      setPartnersLoading(false);
    }
  }, [projectId, clearStatusSoon, sb]);

  useEffect(() => {
    if (!projectId) return;
    loadProject();
    loadEnteredPartners();
  }, [projectId, loadProject, loadEnteredPartners]);

  const canSubmit = useMemo(() => {
    return !saving && companyName.trim().length > 0 && !!projectId;
  }, [saving, companyName, projectId]);

  const handleRegister = useCallback(async () => {
    if (!canSubmit) return;

    const name = companyName.trim();
    setSaving(true);
    setStatus({ type: null, text: "" });

    try {
      // ✅ insert → 戻り値1行を返す（即時反映）
      const { data: inserted, error } = await sb
        .from("project_partner_entries")
        .insert({
          project_id: projectId,
          partner_company_name: name,
        })
        .select("id, project_id, partner_company_name, created_at")
        .single();

      if (error) throw error;

      if (inserted) {
        setEnteredPartners((prev) => {
          if (prev.some((x) => x.id === inserted.id)) return prev;
          return [inserted as PartnerEntry, ...prev];
        });
      }

      setCompanyName("");
      setStatus({ type: "success", text: "入場登録しました。" });
      clearStatusSoon();
    } catch (e: any) {
      console.error(e);
      setStatus({ type: "error", text: `入場登録に失敗しました：${e?.message ?? "unknown error"}` });
      clearStatusSoon();
    } finally {
      setSaving(false);
    }
  }, [canSubmit, companyName, projectId, clearStatusSoon, sb]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>工事詳細</h1>
        <Link href="/projects" style={{ textDecoration: "none" }}>
          ← プロジェクト一覧へ
        </Link>
      </div>

      {status.type && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #ddd",
            background: status.type === "success" ? "#f0fff4" : "#fff5f5",
          }}
        >
          {status.text}
        </div>
      )}

      <section style={{ marginTop: 16, padding: 14, border: "1px solid #e5e5e5", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>工事情報</h2>

        {projectLoading ? (
          <p style={{ margin: 0 }}>読み込み中…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", rowGap: 8, columnGap: 12 }}>
            <div>工事名</div>
            <div style={{ fontWeight: 600 }}>{project?.name ?? "（未設定）"}</div>

            <div>プロジェクトID</div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{projectId}</div>

            {"contractor_name" in (project ?? {}) && (
              <>
                <div>施工会社</div>
                <div>{project?.contractor_name ?? "（未設定）"}</div>
              </>
            )}

            {"address" in (project ?? {}) && (
              <>
                <div>場所</div>
                <div>{project?.address ?? "（未設定）"}</div>
              </>
            )}
          </div>
        )}
      </section>

      <section style={{ marginTop: 16, padding: 14, border: "1px solid #e5e5e5", borderRadius: 10 }}>
        <h2 style={{ marginTop: 0 }}>入場済み協力会社</h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="協力会社名を入力（例：○○建設）"
            style={{
              flex: "1 1 320px",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #ccc",
            }}
          />
          <button
            onClick={handleRegister}
            disabled={!canSubmit}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #333",
              background: canSubmit ? "#111" : "#999",
              color: "#fff",
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "登録中…" : "入場登録"}
          </button>
          <button
            onClick={loadEnteredPartners}
            disabled={partnersLoading}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #ccc",
              background: "#fff",
              cursor: partnersLoading ? "not-allowed" : "pointer",
            }}
          >
            {partnersLoading ? "更新中…" : "再読込"}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {partnersLoading ? (
            <p style={{ margin: 0 }}>読み込み中…</p>
          ) : enteredPartners.length === 0 ? (
            <p style={{ margin: 0, opacity: 0.8 }}>まだ入場登録がありません。</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>協力会社</th>
                    <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>登録日時</th>
                  </tr>
                </thead>
                <tbody>
                  {enteredPartners.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0", fontWeight: 600 }}>
                        {row.partner_company_name}
                      </td>
                      <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                        {row.created_at ? new Date(row.created_at).toLocaleString("ja-JP") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p style={{ marginTop: 10, marginBottom: 0, fontSize: 12, opacity: 0.75 }}>
          ※ DBの列は <code>partner_company_name</code> です（<code>company_name</code> は存在しません）。
        </p>
      </section>

      <section style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link
          href={`/projects/${projectId}/ky`}
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #333",
            textDecoration: "none",
            color: "#111",
            background: "#fff",
          }}
        >
          KY一覧へ
        </Link>

        <Link
          href={`/projects/${projectId}/ky/new`}
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #333",
            textDecoration: "none",
            color: "#fff",
            background: "#111",
          }}
        >
          KY新規作成
        </Link>
      </section>
    </div>
  );
}
