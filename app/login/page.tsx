"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  // ✅ すでにログイン済みなら /projects へ（商品導線）
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data?.session?.user) {
          router.replace("/projects");
          router.refresh();
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const onLogin = async () => {
    setStatus("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus(`ERROR: ${error.message}`);
      return;
    }

    setStatus("ログインしました。プロジェクト一覧へ移動します。");
    router.replace("/projects");
    router.refresh();
  };

  const onResetPassword = async () => {
    setStatus("");

    if (!email.trim()) {
      setStatus("ERROR: Email を入力してください。");
      return;
    }

    const redirectTo = `${window.location.origin}/reset`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      setStatus(`ERROR: ${error.message}`);
      return;
    }

    setStatus("パスワード再設定メールを送信しました。メールを確認してください。");
  };

  const onLogout = async () => {
    setStatus("");
    await supabase.auth.signOut();
    setStatus("ログアウトしました。");
  };

  return (
    <div style={{ padding: 24, maxWidth: 420 }}>
      <h1>ログイン</h1>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Email</span>
          <input
            suppressHydrationWarning
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            style={{ padding: 10 }}
            autoComplete="email"
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Password</span>
          <input
            suppressHydrationWarning
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="password"
            type="password"
            style={{ padding: 10 }}
            autoComplete="current-password"
          />
        </label>

        <button
          onClick={onLogin}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          ログイン
        </button>

        <button
          onClick={onResetPassword}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          パスワード再設定メールを送る
        </button>

        <button
          onClick={onLogout}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          ログアウト（セッション初期化）
        </button>

        <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{status}</div>
      </div>
    </div>
  );
}
