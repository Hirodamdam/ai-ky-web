// app/projects/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

type Project = {
  id: string;
  name: string | null;
  site_name: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type Status = { type: "success" | "error" | null; text: string };

function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (!v || v === "undefined") return false;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(v);
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function ProjectsPage() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Project[]>([]);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userLabel, setUserLabel] = useState<string>("");

  // -----------------------------
  // 🔐 Auth監視
  // -----------------------------
  useEffect(() => {
    let cancelled = false;
    let unsub: any = null;

    async function initAuth() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      const user = data?.session?.user ?? null;
      setIsLoggedIn(!!user);
      setUserLabel(user?.email || user?.id || "");

      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        const user = session?.user ?? null;
        setIsLoggedIn(!!user);
        setUserLabel(user?.email || user?.id || "");
      });

      unsub = sub?.subscription;
    }

    initAuth();
    return () => {
      cancelled = true;
      unsub?.unsubscribe?.();
    };
  }, []);

  // -----------------------------
  // 📦 読込
  // -----------------------------
  async function loadProjects() {
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, site_name, is_active, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setStatus({ type: "error", text: error.message });
      setRows([]);
    } else {
      setRows((data ?? []) as Project[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadProjects();
  }, []);

  // -----------------------------
  // 🗑 削除
  // -----------------------------
  async function handleDelete(id: string) {
    if (!confirm("このプロジェクトを削除しますか？\n（元に戻せません）")) return;

    const { error } = await supabase
      .from("projects")
      .delete()
      .eq("id", id);

    if (error) {
      alert("削除失敗: " + error.message);
      return;
    }

    // 一覧を即時更新
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  const activeCount = useMemo(
    () => rows.filter((r) => r.is_active !== false).length,
    [rows]
  );

  const createHref = isLoggedIn ? "/projects/create" : "/login";

  return (
    <main style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          プロジェクト一覧
        </h1>

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <Link
            href={createHref}
            style={{
              padding: "8px 10px",
              borderRadius: 12,
              border: "1px solid #111",
              textDecoration: "none",
              background: isLoggedIn ? "#111" : "#f3f4f6",
              color: isLoggedIn ? "#fff" : "#111",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            ＋ プロジェクト作成
          </Link>

          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {loading
              ? "読み込み中..."
              : `${rows.length}件（稼働 ${activeCount}件）`}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {rows.map((p) => {
          const ok = isValidUuid(p.id);
          const href = ok ? `/projects/${p.id}` : "#";

          return (
            <div
              key={p.id}
              style={{
                padding: 14,
                border: "1px solid #ddd",
                borderRadius: 16,
                background: "#fff",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 700 }}>
                  {p.name ?? "（名称未設定）"}
                </div>

                {p.is_active === false && (
                  <span
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "1px solid #ddd",
                      fontSize: 12,
                    }}
                  >
                    非アクティブ
                  </span>
                )}

                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <Link
                    href={href}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      textDecoration: "none",
                      background: "#fff",
                    }}
                  >
                    工事詳細
                  </Link>

                  {isLoggedIn && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid #dc2626",
                        background: "#dc2626",
                        color: "#fff",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      削除
                    </button>
                  )}
                </div>
              </div>

              <div style={{ fontSize: 13, opacity: 0.85 }}>
                現場名：{p.site_name ?? "—"}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  fontSize: 12,
                  opacity: 0.7,
                }}
              >
                <div>作成：{fmtDateTime(p.created_at) || "—"}</div>
                <div
                  style={{
                    marginLeft: "auto",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {p.id}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
