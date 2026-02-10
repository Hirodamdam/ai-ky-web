// app/HeaderLinksClient.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

export default function HeaderLinksClient() {
  const pathname = usePathname();

  // ✅ /ky/public/* は非表示
  const hide = useMemo(() => {
    const p = String(pathname || "");
    return p.startsWith("/ky/public");
  }, [pathname]);

  const [checked, setChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userLabel, setUserLabel] = useState("");

  useEffect(() => {
    let unsub: any = null;
    let cancelled = false;

    async function init() {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        const user = data?.session?.user ?? null;
        setIsLoggedIn(!!user);
        setUserLabel(user?.email || user?.id || "");
        setChecked(true);
      } catch {
        if (cancelled) return;
        setIsLoggedIn(false);
        setUserLabel("");
        setChecked(true);
      }

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user ?? null;
        setIsLoggedIn(!!user);
        setUserLabel(user?.email || user?.id || "");
        setChecked(true);
      });

      unsub = sub?.subscription;
    }

    init();

    return () => {
      cancelled = true;
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  if (hide) return null;

  return (
    <div className="flex items-center justify-end gap-3">
      {!checked ? (
        <div className="text-xs text-slate-500">ログイン状態：確認中...</div>
      ) : isLoggedIn ? (
        <>
          <div className="text-xs text-slate-600">
            ログイン中{userLabel ? `（${userLabel}）` : ""}
          </div>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              // UIの取り残し防止（PWA/SPAでも確実に反映）
              location.reload();
            }}
            className="text-xs font-semibold text-rose-700 underline"
          >
            ログアウト
          </button>
        </>
      ) : (
        <Link href="/login" className="text-sm font-semibold text-blue-700 underline">
          ログイン
        </Link>
      )}
    </div>
  );
}
