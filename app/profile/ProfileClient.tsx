"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type Profile = {
  id: string;
  display_name: string | null;
  role?: string | null; // 既にある列に合わせて optional
  created_at?: string | null;
  updated_at?: string | null;
};

function norm(s: string | null | undefined) {
  return (s ?? "").trim();
}

export default function ProfileClient() {
  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [userId, setUserId] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);

  const [displayName, setDisplayName] = useState<string>("");

  const canSave = useMemo(() => {
    if (!userId) return false;
    if (!norm(displayName)) return false;
    return true;
  }, [userId, displayName]);

  async function load() {
    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data: userRes, error: uerr } = await supabase.auth.getUser();
      if (uerr) throw uerr;

      const uid = userRes?.user?.id ?? "";
      setUserId(uid);

      if (!uid) {
        setProfile(null);
        setDisplayName("");
        setStatus({ type: "error", text: "ログインしていません。先にログインしてください。" });
        return;
      }

      // profiles は1行のはず
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", uid)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // 念のため：無ければ作る（RLS: insert が無い場合は失敗するので update に寄せる）
        setProfile({ id: uid, display_name: null });
        setDisplayName("");
        return;
      }

      const p = data as any;
      const normalized: Profile = {
        id: String(p.id),
        display_name: p.display_name ?? null,
        role: p.role ?? null,
        created_at: p.created_at ?? null,
        updated_at: p.updated_at ?? null,
      };

      setProfile(normalized);
      setDisplayName(norm(normalized.display_name) || "");
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!userId) return;

    const name = norm(displayName);
    if (!name) {
      setStatus({ type: "error", text: "表示名を入力してください" });
      return;
    }

    setSaving(true);
    setStatus({ type: null, text: "" });

    try {
      // RLS: update は本人のみ許可済み
      const db: any = supabase;
      const { error } = await db
        .from("profiles")
        .update({ display_name: name })
        .eq("id", userId);

      if (error) throw error;

      setStatus({ type: "success", text: "表示名を保存しました" });
      await load();
      setTimeout(() => setStatus({ type: null, text: "" }), 1200);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link href="/projects" className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">
          プロジェクト一覧へ
        </Link>

        <Link href="/" className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50">
          トップへ
        </Link>
      </div>

      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">プロフィール</div>
            <div className="text-xs text-gray-500">
              承認者表示などに使う「氏名（表示名）」を設定できます
            </div>
          </div>

          {profile?.role && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
              role: {profile.role}
            </span>
          )}
        </div>

        {status.type && (
          <div
            className={`mt-3 rounded-md border px-3 py-2 text-sm ${
              status.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {status.text}
          </div>
        )}

        {loading ? (
          <div className="mt-4 text-sm text-gray-500">読み込み中...</div>
        ) : (
          <>
            <div className="mt-4 rounded-lg border p-3">
              <div className="text-xs text-gray-500">ユーザーID</div>
              <div className="mt-1 break-all text-sm">{userId || "—"}</div>
            </div>

            <div className="mt-4 rounded-lg border p-3">
              <div className="text-xs text-gray-500">表示名（氏名）</div>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="例：大津 弘文"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
              <div className="mt-2 text-xs text-gray-500">
                ※ ここで設定した名前が、KY一覧/レビューの「承認者」に表示されます
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={save}
                disabled={!canSave || saving}
                className={`rounded-md px-4 py-2 text-sm text-white ${
                  !canSave || saving ? "bg-gray-300" : "bg-slate-900 hover:opacity-90"
                }`}
              >
                {saving ? "保存中..." : "保存"}
              </button>

              <button
                onClick={load}
                disabled={saving}
                className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
              >
                再読み込み
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
