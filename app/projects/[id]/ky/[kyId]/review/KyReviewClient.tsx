// app/projects/[id]/ky/[kyId]/review/KyReviewClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso?: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm?: number | null;
  weather_code?: number | null;
};

type KyEntryRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;

  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  third_party_level?: string | null;

  partner_company_name: string | null;

  weather_slots?: WeatherSlot[] | null;

  ai_work_detail?: string | null;
  ai_hazards?: string | null;
  ai_countermeasures?: string | null;
  ai_third_party?: string | null;
  ai_supplement?: string | null;

  is_approved?: boolean | null;

  approved_at?: string | null;
  approved_by?: string | null;

  // ✅ 公開リンク用
  public_id?: string | null;
  public_token?: string | null;
  public_enabled?: boolean | null;
  public_enabled_at?: string | null;

  created_at?: string | null;
};

type ProjectRow = {
  id: string;
  name: string | null;
  contractor_name: string | null;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function fmtDateJp(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function fmtDateTimeJp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP");
}

function degToDirJp(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "—";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}

// ky_photos の列名差を吸収
function pickKind(row: any): string {
  return s(row?.photo_kind).trim() || s(row?.kind).trim() || s(row?.type).trim() || s(row?.category).trim() || "";
}
function pickUrl(row: any): string {
  return s(row?.image_url).trim() || s(row?.photo_url).trim() || s(row?.url).trim() || s(row?.photo_path).trim() || s(row?.path).trim() || "";
}
function canonicalKind(kindRaw: string): "slope" | "path" | "" {
  const k = s(kindRaw).trim();
  if (!k) return "";
  if (k === "slope" || k === "slope_photo" || k === "法面") return "slope";
  if (k === "path" || k === "path_photo" || k === "通路") return "path";
  if (k.includes("slope") || k.includes("法面")) return "slope";
  if (k.includes("path") || k.includes("通路")) return "path";
  return "";
}

function safeParseJson(text: string | null | undefined): any | null {
  const t = s(text).trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function pickAiFromSupplement(obj: any): { work: string; hazards: string; measures: string; third: string } {
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "";
  };

  return {
    work: get(["work_detail", "workDetail", "ai_work_detail"]),
    hazards: get(["hazards", "hazard", "ai_hazards"]),
    measures: get(["countermeasures", "measures", "counterMeasures", "ai_countermeasures"]),
    third: get(["third_party", "thirdParty", "ai_third_party"]),
  };
}

// ✅ ai_supplement（文字列：見出し付き）を分解して ai_* を保険で埋める
function splitAiHeadedText(text: string): { work: string; hazards: string; counter: string; third: string } {
  const src = s(text).replace(/\r\n/g, "\n").trim();
  if (!src) return { work: "", hazards: "", counter: "", third: "" };

  const normalizeLabel = (x: string) => x.replace(/[｜|]/g, "|");
  const src2 = normalizeLabel(src);

  const marks: Array<{ idx: number; key: "work" | "hazards" | "counter" | "third"; len: number }> = [];
  const patterns: Array<{ key: "work" | "hazards" | "counter" | "third"; re: RegExp }> = [
    { key: "work", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*作業内容\s*[】\]]\s*/g },
    { key: "hazards", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*危険予知\s*[】\]]\s*/g },
    { key: "counter", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*対策\s*[】\]]\s*/g },
    { key: "third", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*第三者\s*[】\]]\s*/g },
  ];

  for (const p of patterns) {
    let m: RegExpExecArray | null;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(src2))) {
      marks.push({ idx: m.index, key: p.key, len: m[0].length });
    }
  }
  marks.sort((a, b) => a.idx - b.idx);

  if (!marks.length) return { work: src, hazards: "", counter: "", third: "" };

  const out = { work: "", hazards: "", counter: "", third: "" };
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const next = marks[i + 1];
    const start = cur.idx + cur.len;
    const end = next ? next.idx : src2.length;
    const chunk = src2.slice(start, end).trim();
    if (!chunk) continue;
    (out as any)[cur.key] = (out as any)[cur.key] ? `${(out as any)[cur.key]}\n${chunk}` : chunk;
  }
  return out;
}

async function postJsonTry(urls: string[], body: any): Promise<any> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
      return j;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("API呼び出しに失敗しました");
}

export default function KyReviewClient() {
  const params = useParams() as { id?: string; kyId?: string };
  const router = useRouter();

  const projectId = useMemo(() => String(params?.id ?? ""), [params?.id]);
  const kyId = useMemo(() => String(params?.kyId ?? ""), [params?.kyId]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [ky, setKy] = useState<KyEntryRow | null>(null);

  const [slopeNowUrl, setSlopeNowUrl] = useState<string>("");
  const [slopePrevUrl, setSlopePrevUrl] = useState<string>("");
  const [pathNowUrl, setPathNowUrl] = useState<string>("");
  const [pathPrevUrl, setPathPrevUrl] = useState<string>("");

  const [acting, setActing] = useState(false);

  const statusClass = useMemo(() => {
    if (status.type === "success") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    if (status.type === "error") return "border border-rose-200 bg-rose-50 text-rose-800";
    return "border border-slate-200 bg-slate-50 text-slate-700";
  }, [status.type]);

  const load = useCallback(async () => {
    if (!projectId || !kyId) return;

    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      // ✅ 1）取得：public_token等を必ず含める
      const { data: kyRow, error: kyErr } = await supabase
        .from("ky_entries")
        .select(
          [
            "id",
            "project_id",
            "work_date",
            "work_detail",
            "hazards",
            "countermeasures",
            "third_party_level",
            "partner_company_name",
            "weather_slots",
            "ai_work_detail",
            "ai_hazards",
            "ai_countermeasures",
            "ai_third_party",
            "ai_supplement",
            "is_approved",
            "approved_at",
            "approved_by",

            "public_id",
            "public_token",
            "public_enabled",
            "public_enabled_at",

            "created_at",
          ].join(",")
        )
        .eq("id", kyId)
        .maybeSingle();

      if (kyErr) throw kyErr;

      const kyData: KyEntryRow | null = (kyRow as any) ?? null;
      if (kyData) {
        const sup = safeParseJson(kyData.ai_supplement);
        if (sup) {
          const parsed = pickAiFromSupplement(sup);
          if (!s(kyData.ai_work_detail).trim() && parsed.work) kyData.ai_work_detail = parsed.work;
          if (!s(kyData.ai_hazards).trim() && parsed.hazards) kyData.ai_hazards = parsed.hazards;
          if (!s(kyData.ai_countermeasures).trim() && parsed.measures) kyData.ai_countermeasures = parsed.measures;
          if (!s(kyData.ai_third_party).trim() && parsed.third) kyData.ai_third_party = parsed.third;
        } else {
          const parts = splitAiHeadedText(kyData.ai_supplement || "");
          if (!s(kyData.ai_work_detail).trim() && parts.work) kyData.ai_work_detail = parts.work;
          if (!s(kyData.ai_hazards).trim() && parts.hazards) kyData.ai_hazards = parts.hazards;
          if (!s(kyData.ai_countermeasures).trim() && parts.counter) kyData.ai_countermeasures = parts.counter;
          if (!s(kyData.ai_third_party).trim() && parts.third) kyData.ai_third_party = parts.third;
        }
      }
      setKy(kyData);

      const projectTargetId = kyData?.project_id || projectId;
      const { data: pRow, error: pErr } = await supabase.from("projects").select("id,name,contractor_name").eq("id", projectTargetId).maybeSingle();
      if (pErr) throw pErr;
      setProject((pRow as any) ?? null);

      const photoProjectId = kyData?.project_id || projectId;

      const { data: photos, error: phErr } = await supabase
        .from("ky_photos")
        .select("*")
        .eq("project_id", photoProjectId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (phErr) throw phErr;

      let slopeNow = "";
      let slopePrev = "";
      let pathNow = "";
      let pathPrev = "";

      const curKyKey = s(kyId).trim();

      if (Array.isArray(photos)) {
        for (const row of photos as any[]) {
          const url = pickUrl(row);
          if (!url) continue;

          const k = canonicalKind(pickKind(row));
          if (!k) continue;

          const rowKy = s(row?.ky_id).trim() || s(row?.ky_entry_id).trim();
          const isCurrent = rowKy === curKyKey;

          if (k === "slope") {
            if (!slopeNow && isCurrent) {
              slopeNow = url;
              continue;
            }
            if (!slopePrev && !isCurrent) {
              slopePrev = url;
              continue;
            }
          }

          if (k === "path") {
            if (!pathNow && isCurrent) {
              pathNow = url;
              continue;
            }
            if (!pathPrev && !isCurrent) {
              pathPrev = url;
              continue;
            }
          }

          if (slopeNow && slopePrev && pathNow && pathPrev) break;
        }

        if (!slopePrev) {
          const firstSlope = (photos as any[])
            .map((r) => ({ k: canonicalKind(pickKind(r)), url: pickUrl(r), rowKy: s(r?.ky_id).trim() || s(r?.ky_entry_id).trim() }))
            .find((x) => x.k === "slope" && x.url && x.rowKy !== curKyKey);
          if (firstSlope) slopePrev = firstSlope.url;
        }
        if (!pathPrev) {
          const firstPath = (photos as any[])
            .map((r) => ({ k: canonicalKind(pickKind(r)), url: pickUrl(r), rowKy: s(r?.ky_id).trim() || s(r?.ky_entry_id).trim() }))
            .find((x) => x.k === "path" && x.url && x.rowKy !== curKyKey);
          if (firstPath) pathPrev = firstPath.url;
        }
      }

      setSlopeNowUrl(slopeNow);
      setSlopePrevUrl(slopePrev);
      setPathNowUrl(pathNow);
      setPathPrevUrl(pathPrev);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  }, [projectId, kyId]);

  useEffect(() => {
    load();
  }, [load]);

  const weatherSlots = useMemo(() => {
    const raw = ky?.weather_slots ?? null;
    const arr = Array.isArray(raw) ? (raw as WeatherSlot[]) : [];
    const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
    filtered.sort((a, b) => a.hour - b.hour);
    return filtered;
  }, [ky?.weather_slots]);

  const onPrint = useCallback(() => {
    window.print();
  }, []);

  const onApprove = useCallback(async () => {
    setStatus({ type: null, text: "" });
    setActing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("セッションがありません。ログインしてください。");

      await postJsonTry(["/api/ky-approve"], { projectId, kyId, accessToken });

      setStatus({ type: "success", text: "承認しました（公開リンクを発行しました）" });
      await load();
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "承認に失敗しました" });
    } finally {
      setActing(false);
    }
  }, [projectId, kyId, load]);

  const onUnapprove = useCallback(async () => {
    setStatus({ type: null, text: "" });
    setActing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("セッションがありません。ログインしてください。");

      // 既存のエンドポイントを尊重（あなたの環境に合わせる）
      await postJsonTry(["/api/ky-unapprove", "/api/ky-approve"], { projectId, kyId, accessToken, action: "unapprove" });

      setStatus({ type: "success", text: "承認解除しました（公開停止）" });
      await load();
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "承認解除に失敗しました" });
    } finally {
      setActing(false);
    }
  }, [projectId, kyId, load]);

  // ✅ 2）公開URL：public_enabled に依存させず、承認済み＋tokenで表示（“消えた”を確実に解消）
  const publicUrl = useMemo(() => {
    const token = s(ky?.public_token).trim();
    const approved = !!ky?.is_approved;
    if (!approved || !token) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin) return "";
    return `${origin}/ky/public/${token}`;
  }, [ky?.public_token, ky?.is_approved]);

  const onCopyPublicUrl = useCallback(async () => {
    const url = publicUrl;
    if (!url) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setStatus({ type: "success", text: "公開リンクをコピーしました" });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "コピーに失敗しました" });
    }
  }, [publicUrl]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">KY レビュー</div>
          <div className="mt-1 text-sm text-slate-600">日付：{ky?.work_date ? fmtDateJp(ky.work_date) : "（不明）"}</div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Link className="text-sm text-blue-600 underline text-right" href="/login">
            ログイン
          </Link>
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky`}>
            KY一覧へ
          </Link>
        </div>
      </div>

      {!!status.text && <div className={`rounded-lg px-3 py-2 text-sm ${statusClass}`}>{status.text}</div>}

      {ky?.is_approved ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          承認済み{ky.approved_at ? `（${fmtDateTimeJp(ky.approved_at)}）` : ""}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">未承認</div>
      )}

      {/* ✅ 公開リンク（作業員閲覧用） */}
      {publicUrl ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="text-sm font-semibold text-slate-800">公開リンク（作業員閲覧用）</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm break-all">{publicUrl}</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopyPublicUrl}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
            >
              コピー
            </button>
            <a className="text-sm text-blue-600 underline" href={publicUrl} target="_blank" rel="noreferrer">
              別タブで開く
            </a>
          </div>
          <div className="text-xs text-slate-500">※承認済みのKYのみ公開されます（編集不可）。</div>
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">施工会社（固定）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{project?.contractor_name ?? "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">
          協力会社 <span className="text-rose-600">（必須）</span>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{ky?.partner_company_name ?? "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>

        {weatherSlots.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlots.map((slot) => (
              <div key={slot.hour} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
                <div className="mt-1 text-sm text-slate-700">{slot.weather_text || "（不明）"}</div>
                <div className="mt-2 text-xs text-slate-600 space-y-1">
                  <div>気温：{slot.temperature_c ?? "—"} ℃</div>
                  <div>
                    風：{degToDirJp(slot.wind_direction_deg)} {slot.wind_speed_ms != null ? `${slot.wind_speed_ms} m/s` : "—"}
                  </div>
                  <div>降水：{slot.precipitation_mm ?? "—"} mm</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">（気象データがありません）</div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">写真（今回／前回）</div>

        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">法面（定点）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">今回写真</div>
                {slopeNowUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slopeNowUrl} alt="法面（今回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">前回写真</div>
                {slopePrevUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slopePrevUrl} alt="法面（前回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
            </div>
          </div>

          <div className="print-page-break" />

          <div>
            <div className="text-sm font-semibold text-slate-800">通路（定点）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">今回写真</div>
                {pathNowUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pathNowUrl} alt="通路（今回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">前回写真</div>
                {pathPrevUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pathPrevUrl} alt="通路（前回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">AI補足（項目別）</div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">作業内容の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky?.ai_work_detail).trim() || "（なし）"}</div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky?.ai_hazards).trim() || "（なし）"}</div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky?.ai_countermeasures).trim() || "（なし）"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky?.ai_third_party).trim() || "（なし）"}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/ky`)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          戻る
        </button>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onPrint} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            印刷
          </button>

          {ky?.is_approved ? (
            <button
              type="button"
              disabled={acting}
              onClick={onUnapprove}
              className={`rounded-lg border px-4 py-2 text-sm ${
                acting ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              承認解除
            </button>
          ) : (
            <button
              type="button"
              disabled={acting}
              onClick={onApprove}
              className={`rounded-lg px-4 py-2 text-sm text-white ${acting ? "bg-slate-400" : "bg-black hover:bg-slate-900"}`}
            >
              承認
            </button>
          )}

          <button
            type="button"
            onClick={() => load()}
            disabled={acting}
            className={`rounded-lg border px-4 py-2 text-sm ${
              acting ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
            }`}
          >
            再読み込み
          </button>
        </div>
      </div>
    </div>
  );
}
