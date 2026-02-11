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

  // ✅ ログイン状態（null=確認中）
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userLabel, setUserLabel] = useState<string>("");

  // ✅ ログイン状態は「1回取得 + 変化追従」
  useEffect(() => {
    let cancelled = false;
    let unsub: any = null;

    async function initAuth() {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        const user = data?.session?.user ?? null;
        setIsLoggedIn(!!user);
        setUserLabel(user?.email || user?.id || "");
      } catch {
        if (cancelled) return;
        setIsLoggedIn(false);
        setUserLabel("");
      }

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user ?? null;
        setIsLoggedIn(!!user);
        setUserLabel(user?.email || user?.id || "");
      });

      unsub = sub?.subscription;
    }

    initAuth();

    return () => {
      cancelled = true;
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  // ✅ projects 読み込み（ログイン有無は関係なく表示はする）
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setStatus({ type: null, text: "" });

      const { data, error } = await supabase
        .from("projects")
        .select("id, name, site_name, is_active, created_at")
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setStatus({ type: "error", text: `読込エラー: ${error.message}` });
        setRows([]);
        setLoading(false);
        return;
      }

      setRows((data ?? []) as Project[]);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCount = useMemo(
    () => rows.filter((r) => r.is_active !== false).length,
    [rows]
  );

  return (
    <main style={{ padding: 16, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          プロジェクト一覧
        </h1>

        <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7, textAlign: "right" }}>
          <div>
            {loading ? "読み込み中..." : `${rows.length}件（稼働 ${activeCount}件）`}
          </div>
          <div style={{ marginTop: 4 }}>
            {isLoggedIn === null ? (
              "ログイン状態：確認中..."
            ) : isLoggedIn ? (
              <span>
                ログイン中{userLabel ? `（${userLabel}）` : ""}
                {" / "}
                <button
                  type="button"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    location.reload();
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    padding: 0,
                    cursor: "pointer",
                    color: "#b91c1c",
                    textDecoration: "underline",
                    fontSize: 12,
                  }}
                >
                  ログアウト
                </button>
              </span>
            ) : (
              <span>
                未ログイン{" / "}
                <Link href="/login" style={{ textDecoration: "underline" }}>
                  ログイン
                </Link>
              </span>
            )}
          </div>
        </div>
      </div>

      {isLoggedIn === false && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #ffeeba",
            borderRadius: 12,
            background: "#fff3cd",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <p style={{ margin: 0, color: "#856404", fontWeight: 700 }}>
              ⚠ ログインしていません。編集・保存はできません。
            </p>
            <div style={{ marginLeft: "auto" }}>
              <Link
                href="/login"
                style={{
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  textDecoration: "none",
                  background: "#fff",
                  color: "#111",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                ログインへ
              </Link>
            </div>
          </div>
          <p style={{ margin: "6px 0 0 0", color: "#856404", fontSize: 12, opacity: 0.9 }}>
            右上の「ログイン」表示が残る場合でも、このページ右上の「ログイン中/未ログイン」が真の状態です。
          </p>
        </div>
      )}

      {status.type && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          <p style={{ margin: 0 }}>{status.text}</p>
        </div>
      )}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {rows.map((p) => {
          const ok = isValidUuid(p.id);
          const href = ok ? `/projects/${p.id}` : "#"; // ✅ 方針A：KY直行はしない

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

                <div style={{ marginLeft: "auto" }}>
                  <Link
                    href={href}
                    aria-disabled={!ok}
                    onClick={(e) => {
                      if (!ok) e.preventDefault();
                    }}
                    style={{
                      pointerEvents: ok ? "auto" : "none",
                      opacity: ok ? 1 : 0.5,
                      padding: "8px 10px",
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      textDecoration: "none",
                      background: "#fff",
                    }}
                  >
                    工事詳細
                  </Link>
                </div>
              </div>

              <div style={{ fontSize: 13, opacity: 0.85 }}>
                現場名：{p.site_name ?? "—"}
              </div>

              <div style={{ display: "flex", gap: 12, fontSize: 12, opacity: 0.7 }}>
                <div>作成：{fmtDateTime(p.created_at) || "—"}</div>
                <div style={{ marginLeft: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                  {p.id}
                </div>
              </div>

              {!ok && (
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  IDが不正のため「工事詳細」リンクを無効化しています。
                </div>
              )}
            </div>
          );
        })}

        {!loading && rows.length === 0 && (
          <div
            style={{
              padding: 14,
              border: "1px solid #ddd",
              borderRadius: 16,
              background: "#fff",
            }}
          >
            <p style={{ margin: 0 }}>プロジェクトがありません。</p>
          </div>
        )}
      </div>
    </main>
  );
}
