"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type ProjectRow = {
  id: string;
  name: string | null;
  site_name: string | null;
  lat: number | null;
  lon: number | null;
  created_at: string | null;
};

function isUuidLike(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function normalizeText(v: any) {
  if (v == null) return "";
  return String(v);
}

function normalizeName(input: string) {
  let s = normalizeText(input);
  s = s.replace(/[\r\n\t]+/g, " ");
  s = s.replace(/\u3000/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function parseNullableNumber(input: string): number | null {
  const s = normalizeText(input).trim();
  if (!s) return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return n;
}

function checkLatLon(lat: number | null, lon: number | null) {
  if (lat != null && (lat < -90 || lat > 90)) return { ok: false, msg: "緯度は -90〜90 の範囲で入力してください。" };
  if (lon != null && (lon < -180 || lon > 180))
    return { ok: false, msg: "経度は -180〜180 の範囲で入力してください。" };
  return { ok: true, msg: "" };
}

// ✅ Supabaseの型定義が古いと SelectQueryError が出続けるケースの逃げ道
const selectAny = (s: string) => s as any;

export default function ProjectEditClient() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const projectId = (params?.id ?? "").trim();

  const invalidParams = useMemo(() => {
    if (!projectId) return true;
    if (projectId === "undefined") return true;
    if (!isUuidLike(projectId)) return true;
    return false;
  }, [projectId]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [project, setProject] = useState<ProjectRow | null>(null);

  const [name, setName] = useState<string>("");
  const [siteName, setSiteName] = useState<string>("");
  const [latText, setLatText] = useState<string>("");
  const [lonText, setLonText] = useState<string>("");

  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (invalidParams) {
      setLoading(false);
      setProject(null);
      setStatus({
        type: "error",
        text: "URLパラメータ（project id）が不正です。直前の導線でID未確定のまま遷移しています。",
      });
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setStatus({ type: null, text: "" });

      const { data, error } = await supabase
        .from("projects")
        .select(selectAny("id, name, site_name, lat, lon, created_at"))
        .eq("id", projectId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setStatus({ type: "error", text: `プロジェクト取得に失敗しました: ${error.message}` });
        setProject(null);
        setLoading(false);
        return;
      }

      if (!data) {
        setStatus({ type: "error", text: "プロジェクトが見つかりませんでした。" });
        setProject(null);
        setLoading(false);
        return;
      }

      const row = data as unknown as ProjectRow;
      setProject(row);

      setName(row.name ?? "");
      setSiteName(row.site_name ?? "");
      setLatText(row.lat == null ? "" : String(row.lat));
      setLonText(row.lon == null ? "" : String(row.lon));

      setDirty(false);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, invalidParams]);

  // 未保存ガード
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function guardBackToProject() {
    if (dirty && !confirm("未保存の変更があります。戻りますか？")) return;
    router.push(`/projects/${projectId}`);
  }

  async function save() {
    if (invalidParams) return;

    const finalName = normalizeName(name);
    const finalSite = normalizeName(siteName);

    if (!finalName) {
      setStatus({ type: "error", text: "工事件名（プロジェクト名）は必須です。" });
      return;
    }

    const lat = parseNullableNumber(latText);
    const lon = parseNullableNumber(lonText);

    // 入力されているのに数字として不正
    if (latText.trim() && lat == null) {
      setStatus({ type: "error", text: "緯度が数値として不正です。" });
      return;
    }
    if (lonText.trim() && lon == null) {
      setStatus({ type: "error", text: "経度が数値として不正です。" });
      return;
    }

    const range = checkLatLon(lat, lon);
    if (!range.ok) {
      setStatus({ type: "error", text: range.msg });
      return;
    }

    setSaving(true);
    setStatus({ type: null, text: "" });

    // ✅ updated_at 列が無い前提：payloadに入れない
    const payload: any = {
      name: finalName,
      site_name: finalSite || null,
      lat: lat,
      lon: lon,
    };

    const { data, error } = await supabase
      .from("projects")
      .update(payload)
      .eq("id", projectId)
      .select(selectAny("id, name, site_name, lat, lon, created_at"))
      .maybeSingle();

    if (error) {
      setStatus({ type: "error", text: `保存に失敗しました: ${error.message}` });
      setSaving(false);
      return;
    }

    if (!data) {
      setStatus({ type: "error", text: "保存に失敗しました（更新結果が取得できません）。" });
      setSaving(false);
      return;
    }

    const row = data as unknown as ProjectRow;
    setProject(row);

    setName(row.name ?? "");
    setSiteName(row.site_name ?? "");
    setLatText(row.lat == null ? "" : String(row.lat));
    setLonText(row.lon == null ? "" : String(row.lon));

    setDirty(false);
    setStatus({ type: "success", text: "保存しました。" });
    setSaving(false);
  }

  if (invalidParams) {
    return <div className="p-6 text-sm text-red-700">{status.text || "URLパラメータが不正です。"}</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="text-xl font-semibold">プロジェクト編集</div>
          <div className="text-sm text-gray-600 break-all">project: {projectId}</div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            className="px-3 py-2 rounded border hover:bg-gray-50"
            href={`/projects/${projectId}`}
            onClick={(e) => {
              e.preventDefault();
              guardBackToProject();
            }}
          >
            戻る
          </Link>
        </div>
      </div>

      {status.type ? (
        <div
          className={[
            "rounded border px-3 py-2 text-sm",
            status.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900",
          ].join(" ")}
        >
          {status.text}
        </div>
      ) : null}

      {loading ? (
        <div className="text-gray-600">読み込み中...</div>
      ) : (
        <div className="rounded-2xl border bg-white p-4 shadow-sm space-y-4">
          <div className="space-y-1">
            <div className="text-sm text-gray-700">
              工事件名（プロジェクト名） <span className="text-rose-700 font-semibold">（必須）</span>
            </div>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              onBlur={() => setName(normalizeName(name))}
              placeholder="例：草牟田墓地法面整備工事"
            />
          </div>

          <div className="space-y-1">
            <div className="text-sm text-gray-700">現場名（任意）</div>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={siteName}
              onChange={(e) => {
                setSiteName(e.target.value);
                setDirty(true);
              }}
              onBlur={() => setSiteName(normalizeName(siteName))}
              placeholder="例：鹿児島市 草牟田墓地"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-sm text-gray-700">緯度（任意）</div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={latText}
                onChange={(e) => {
                  setLatText(e.target.value);
                  setDirty(true);
                }}
                placeholder="例：31.5969"
                inputMode="decimal"
              />
              <div className="text-xs text-gray-500">-90 〜 90</div>
            </div>

            <div className="space-y-1">
              <div className="text-sm text-gray-700">経度（任意）</div>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={lonText}
                onChange={(e) => {
                  setLonText(e.target.value);
                  setDirty(true);
                }}
                placeholder="例：130.5571"
                inputMode="decimal"
              />
              <div className="text-xs text-gray-500">-180 〜 180</div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={save}
              disabled={saving || loading}
              className={[
                "px-5 py-2 rounded-xl text-sm border",
                saving || loading ? "opacity-60 cursor-not-allowed" : "hover:bg-gray-50",
              ].join(" ")}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>

          <div className="text-xs text-gray-500">
            ※ 工事件名・現場名・緯度経度は projects テーブルに保存されます。既存KYのタイトルは自動変更しません。
          </div>
        </div>
      )}
    </div>
  );
}
