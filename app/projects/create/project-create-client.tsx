// app/projects/create/ProjectCreateClient.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

export default function ProjectCreateClient() {
  const router = useRouter();

  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [userLabel, setUserLabel] = useState<string>("");

  const [name, setName] = useState<string>("");
  const [siteName, setSiteName] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });

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

  async function createProject() {
    setStatus({ type: null, text: "" });

    if (!isLoggedIn) {
      setStatus({ type: "error", text: "ログインが必要です。" });
      return;
    }

    const n = s(name).trim();
    const sn = s(siteName).trim();

    if (!n) {
      setStatus({ type: "error", text: "工事名（プロジェクト名）を入力してください。" });
      return;
    }

    setSaving(true);

    // ✅ projects テーブルに最低限の列だけ入れる（既存テーブル差異で壊さない）
    const { data, error } = await supabase
      .from("projects")
      .insert([{ name: n, site_name: sn || null, is_active: true }])
      .select("id")
      .single();

    if (error) {
      setSaving(false);
      setStatus({ type: "error", text: `作成エラー: ${error.message}` });
      return;
    }

    const id = data?.id;
    if (!id) {
      setSaving(false);
      setStatus({ type: "error", text: "作成できましたがID取得に失敗しました。" });
      return;
    }

    setSaving(false);
    setStatus({ type: "success", text: "作成しました。詳細へ移動します。" });
    router.push(`/projects/${id}`);
  }

  return (
    <main style={{ padding: 16, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>プロジェクト作成</h1>
        <div style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7, textAlign: "right" }}>
          {isLoggedIn === null ? (
            "ログイン状態：確認中..."
          ) : isLoggedIn ? (
            <>ログイン中{userLabel ? `（${userLabel}）` : ""}</>
          ) : (
            <>
              未ログイン /{" "}
              <Link href="/login" style={{ textDecoration: "underline" }}>
                ログイン
              </Link>
            </>
          )}
        </div>
      </div>

      {!isLoggedIn && isLoggedIn !== null && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #ffeeba",
            borderRadius: 12,
            background: "#fff3cd",
          }}
        >
          <p style={{ margin: 0, color: "#856404", fontWeight: 700 }}>
            ⚠ プロジェクト作成にはログインが必要です。
          </p>
          <div style={{ marginTop: 10 }}>
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

      <div
        style={{
          marginTop: 12,
          padding: 14,
          border: "1px solid #ddd",
          borderRadius: 16,
          background: "#fff",
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          最低限の情報で作成します（詳細は後で編集できます）。
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>工事名（プロジェクト名）*</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：草牟田墓地 法面処理工事"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>現場名（任意）</span>
          <input
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="例：草牟田墓地"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #ddd" }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6 }}>
          <button
            type="button"
            onClick={createProject}
            disabled={!isLoggedIn || saving}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #111",
              background: !isLoggedIn || saving ? "#f3f4f6" : "#111",
              color: !isLoggedIn || saving ? "#111" : "#fff",
              cursor: !isLoggedIn || saving ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {saving ? "作成中..." : "作成して開始"}
          </button>

          <Link
            href="/projects"
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #ddd",
              textDecoration: "none",
              background: "#fff",
              color: "#111",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            一覧へ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
