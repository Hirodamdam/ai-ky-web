"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

export default function ResetPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const onUpdatePassword = async () => {
    setStatus("");

    if (!password.trim()) {
      setStatus("ERROR: 新しいパスワードを入力してください。");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus(`ERROR: ${error.message}`);
      return;
    }

    setStatus("パスワードを更新しました。ログイン画面へ戻ります。");
    router.push("/login");
    router.refresh();
  };

  return (
    <div style={{ padding: 24, maxWidth: 420 }}>
      <h1>パスワード再設定</h1>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>New Password</span>
          <input
            suppressHydrationWarning
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="new password"
            type="password"
            style={{ padding: 10 }}
          />
        </label>

        <button
          onClick={onUpdatePassword}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          更新
        </button>

        <div style={{ color: "crimson" }}>{status}</div>
      </div>
    </div>
  );
}
