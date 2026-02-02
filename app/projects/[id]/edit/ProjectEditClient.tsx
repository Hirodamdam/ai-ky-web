"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type ProjectRow = {
  id: string;
  name: string | null;
  contractor_name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
};

function toNumberOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function ProjectEditClient() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const router = useRouter();

  // ✅ Supabase Database型が古い前提で、この画面だけ any で扱う
  const sb = supabase as any;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });

  const [project, setProject] = useState<ProjectRow | null>(null);

  const [name, setName] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");

  const targetHref = useMemo(() => (id ? `/projects/${id}` : "/projects"), [id]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!id) return;
      setLoading(true);
      setStatus({ type: null, text: "" });

      // ✅ updated_at を select しない（列が無い環境で 400 になるため）
      const { data, error } = await sb
        .from("projects")
        .select("id,name,contractor_name,address,lat,lon")
        .eq("id", id)
        .single();

      if (!alive) return;

      if (error) {
        setStatus({ type: "error", text: `読み込みに失敗しました：${error.message}` });
        setProject(null);
        setLoading(false);
        return;
      }

      const row = data as ProjectRow;
      setProject(row);
      setName(row.name ?? "");
      setContractorName(row.contractor_name ?? "");
      setAddress(row.address ?? "");
      setLat(row.lat == null ? "" : String(row.lat));
      setLon(row.lon == null ? "" : String(row.lon));
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, [id, sb]);

  function hardNavigate(href: string) {
    try {
      router.push(href);
      setTimeout(() => {
        try {
          if (typeof window !== "undefined") window.location.href = href;
        } catch {}
      }, 250);
    } catch {
      if (typeof window !== "undefined") window.location.href = href;
    }
  }

  async function onSave() {
    if (!id) return;

    setSaving(true);
    setStatus({ type: null, text: "" });

    // ✅ updated_at を更新しない（列が無い環境で 400 になるため）
    const payload = {
      name: name.trim() || null,
      contractor_name: contractorName.trim() || null,
      address: address.trim() || null,
      lat: toNumberOrNull(lat),
      lon: toNumberOrNull(lon),
    };

    const { error } = await sb.from("projects").update(payload).eq("id", id);

    if (error) {
      setStatus({ type: "error", text: `保存に失敗しました：${error.message}` });
      setSaving(false);
      return;
    }

    setStatus({ type: "success", text: "保存しました" });
    setSaving(false);

    // ✅ 保存成功後に必ず工事詳細へ
    hardNavigate(targetHref);
  }

  return (
    // ✅ 枠を少し広げる（720 → 860）
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>工事情報</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0" }}>工事情報編集</h1>
        </div>
        <Link
          href={targetHref}
          style={{ border: "1px solid #d1d5db", padding: "6px 10px", borderRadius: 8, textDecoration: "none" }}
        >
          戻る
        </Link>
      </div>

      {status.type && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid",
            borderColor: status.type === "success" ? "#86efac" : "#fca5a5",
            background: status.type === "success" ? "#ecfdf5" : "#fef2f2",
            color: status.type === "success" ? "#065f46" : "#991b1b",
          }}
        >
          {status.text}
        </div>
      )}

      <div style={{ marginTop: 12, padding: 16, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
        {loading ? (
          <div>読み込み中...</div>
        ) : !project ? (
          <div style={{ color: "#991b1b" }}>データが見つかりません。</div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#374151" }}>工事件名（必須）</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例）草牟田墓地法面整備工事"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#374151" }}>施工会社</span>
              <input
                value={contractorName}
                onChange={(e) => setContractorName(e.target.value)}
                placeholder="例）株式会社三竹工業"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#374151" }}>住所</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="例）鹿児島市草牟田一丁目"
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
              />
            </label>

            <div style={{ padding: 12, border: "1px solid #e5e7eb", borderRadius: 10, background: "#f9fafb" }}>
              <div style={{ fontSize: 12, color: "#374151", marginBottom: 8 }}>緯度 / 経度（任意）</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>緯度</span>
                  <input
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    inputMode="decimal"
                    placeholder="例）31.6"
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#6b7280" }}>経度</span>
                  <input
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                    inputMode="decimal"
                    placeholder="例）130.5"
                    style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db" }}
                  />
                </label>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>保存先カラム：lat / lon</div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={onSave}
                disabled={saving}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #111827",
                  background: "#111827",
                  color: "#fff",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "保存中..." : "保存"}
              </button>

              <button
                type="button"
                onClick={() => hardNavigate(targetHref)}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#111827",
                  cursor: "pointer",
                }}
              >
                工事詳細へ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
