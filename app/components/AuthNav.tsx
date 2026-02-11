"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

export default function AuthNav() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });

    return () => sub?.subscription?.unsubscribe();
  }, []);

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-sm text-blue-600 hover:underline"
      >
        ログイン
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-600">
        {user.email ?? "ログイン中"}
      </span>

      <button
        onClick={async () => {
          await supabase.auth.signOut();
          location.reload();
        }}
        className="text-sm text-red-600 hover:underline"
      >
        ログアウト
      </button>
    </div>
  );
}
