"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type KyEntry = {
  id: string;
  project_id: string | null;

  work_date: string | null;
  work_detail: string | null;

  hazards: string | null;
  countermeasures: string | null;

  partner_company_name: string | null;
  third_party_situation: string | null;

  weather: string | null;
  temperature_text: string | null;
  wind_direction: string | null;
  wind_speed_text: string | null;
  precipitation_mm: number | null;

  workers: number | null;
  notes: string | null;

  is_approved: boolean | null;

  ai_supplement_work: string | null;
  ai_supplement_hazards: string | null;
  ai_supplement_measures: string | null;
  ai_supplement_third_party: string | null;

  created_at: string | null;
};

type Project = { id: string; name: string | null };

export default function KyReviewClient() {
  const params = useParams<{ id: string; kyId: string }>();
  const projectId = params?.id;
  const kyId = params?.kyId;
  const router = useRouter();

  const [row, setRow] = useState<KyEntry | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus({ type: null, text: "" });

    const p = await supabase.from("projects").select("id,name").eq("id", projectId).maybeSingle();
    if (!p.error && p.data) setProject(p.data as Project);

    const { data, error } = await supabase.from("ky_entries").select("*").eq("id", kyId).maybeSingle();
    if (error || !data) {
      setStatus({ type: "error", text: "KYデータを取得できません。" });
      setRow(null);
      setLoading(false);
      return;
    }
    setRow(data as KyEntry);
    setLoading(false);
  }, [projectId, kyId]);

  useEffect(() => {
    load();
  }, [load]);

  const doPrint = useCallback(() => {
    window.print();
  }, []);

  const approve = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;
    if (!accessToken) {
      setStatus({ type: "error", text: "ログイン状態を確認できません。/login から再ログインしてください。" });
      return;
    }

    const res = await fetch("/api/ky-approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, kyId, accessToken }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      setStatus({ type: "error", text: `承認に失敗しました。${t ? `(${t})` : ""}` });
      return;
    }

    setStatus({ type: "success", text: "承認しました。" });
    await load();
  }, [projectId, kyId, load]);

  const unapprove = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const { data: sess } = await supabase.auth.getSession();
    const accessToken = sess.session?.access_token;
    if (!accessToken) {
      setStatus({ type: "error", text: "ログイン状態を確認できません。/login から再ログインしてください。" });
      return;
    }

    // 解除APIが無い場合もあるので、まずは直接UPDATE（RLS次第）
    const { error } = await supabase.from("ky_entries").update({ is_approved: false }).eq("id", kyId);
    if (error) {
      setStatus({ type: "error", text: `承認解除に失敗しました：${error.message}` });
      return;
    }

    setStatus({ type: "success", text: "承認解除しました。" });
    await load();
  }, [kyId, load]);

  const title = useMemo(() => {
    if (!row) return "KYレビュー";
    return row.work_detail || "KYレビュー";
  }, [row]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <div>
          <div className="text-sm text-gray-600">{project?.name ?? "工事"}</div>
          <h1 className="text-xl font-bold">{title}</h1>
        </div>

        <div className="flex items-center gap-2">
          <button className="border rounded px-3 py-2 text-sm" onClick={() => router.back()}>
            戻る
          </button>
          <button className="border rounded px-3 py-2 text-sm" onClick={doPrint}>
            印刷
          </button>
          {row?.is_approved ? (
            <button className="border rounded px-3 py-2 text-sm" onClick={unapprove}>
              承認解除
            </button>
          ) : (
            <button className="bg-black text-white rounded px-4 py-2 text-sm" onClick={approve}>
              承認
            </button>
          )}
        </div>
      </div>

      {status.type && (
        <div
          className={`rounded border p-3 text-sm print:hidden ${
            status.type === "success" ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"
          }`}
        >
          {status.text}
          {status.type === "error" && status.text.includes("/login") && (
            <div className="mt-2">
              <Link className="underline" href="/login">
                /login へ
              </Link>
            </div>
          )}
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">読み込み中…</div>}

      {!loading && row && (
        <div className="border rounded p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">作業日</div>
              <div>{row.work_date || "—"}</div>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">協力会社</div>
              <div>{row.partner_company_name || "—"}</div>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">第三者</div>
              <div>{row.third_party_situation || "—"}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">天候</div>
              <div>{row.weather || "—"}</div>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">気温</div>
              <div>{row.temperature_text || "—"}</div>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">風</div>
              <div>
                {row.wind_direction || "—"} / {row.wind_speed_text || "—"}
              </div>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">降水</div>
              <div>{row.precipitation_mm ?? "—"}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">本日の作業内容</div>
              <pre className="text-sm whitespace-pre-wrap">{row.work_detail || "—"}</pre>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">備考</div>
              <pre className="text-sm whitespace-pre-wrap">{row.notes || "—"}</pre>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">危険ポイント（K）</div>
              <pre className="text-sm whitespace-pre-wrap">{row.hazards || "—"}</pre>
            </div>
            <div className="border rounded p-3">
              <div className="font-semibold mb-1">対策（Y）</div>
              <pre className="text-sm whitespace-pre-wrap">{row.countermeasures || "—"}</pre>
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">AI補足（項目別）</div>
            <div className="grid grid-cols-1 gap-3">
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">作業内容の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{row.ai_supplement_work || "—"}</pre>
              </div>
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">危険予知の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{row.ai_supplement_hazards || "—"}</pre>
              </div>
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">対策の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{row.ai_supplement_measures || "—"}</pre>
              </div>
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">第三者（参考者）の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{row.ai_supplement_third_party || "—"}</pre>
              </div>
            </div>
          </div>

          <div className="print:hidden">
            <Link className="underline text-sm" href={`/projects/${projectId}/ky`}>
              一覧へ戻る
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
