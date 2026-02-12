"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        if (data?.session?.user) {
          router.replace("/projects");
        } else {
          router.replace("/login");
        }
      } catch {
        router.replace("/login");
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div style={{ padding: 24 }}>
      <h1>AI-KY-WEB</h1>
      <p style={{ marginTop: 12 }}>
        {checking ? "読み込み中..." : "リダイレクト中..."}
      </p>
    </div>
  );
}
