// app/AuthNav.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

export default function AuthNav() {
  const [checked, setChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    let sub: any;

    (async () => {
      const { data } = await supabase.auth.getSession();
      setLoggedIn(!!data?.session?.user);
      setChecked(true);

      const { data: s } = supabase.auth.onAuthStateChange((_event, session) => {
        setLoggedIn(!!session?.user);
        setChecked(true);
      });
      sub = s?.subscription;
    })();

    return () => {
      try {
        sub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  if (!checked) return null;

  // ✅ ログイン済：右上に「ログイン」を出さない
  if (loggedIn) {
    return (
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        ログイン中
      </span>
    );
  }

  // ✅ 未ログイン：右上に「ログイン」リンク
  return (
    <Link href="/login" style={{ textDecoration: "underline" }}>
      ログイン
    </Link>
  );
}
