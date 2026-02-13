// app/projects/[id]/ky/[kyId]/review/KyReviewClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import QRCode from "qrcode";

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

type Project = {
  id: string;
  name: string | null;
  contractor_name: string | null;
  address: string | null;

  lat?: number | null;
  lon?: number | null;

  slope_camera_snapshot_url?: string | null;
  path_camera_snapshot_url?: string | null;
};

type KyEntry = {
  id: string;
  project_id: string;

  work_date: string | null;
  title?: string | null;

  partner_company_name: string | null;
  worker_count?: number | null;

  work_detail: string | null;
  hazards?: string | null;
  countermeasures?: string | null;
  third_party_level?: string | null;

  weather_slots?: WeatherSlot[] | null;

  ai_work_detail?: string | null;
  ai_hazards?: string | null;
  ai_countermeasures?: string | null;
  ai_third_party?: string | null;
  ai_supplement?: string | null;

  is_approved?: boolean | null;
  approved_at?: string | null;
  approved_by?: string | null;

  // リスク評価（DBに列があれば拾う / APIが返せば拾う）
  risk_total?: number | null;
  risk_level?: string | null;
  risk_breakdown?: any | null;
  risk_details?: any | null;

  weather_risk?: number | null;
  photo_risk?: number | null;
  third_party_risk?: number | null;

  // 写真スコア（あれば拾う）
  slope_photo_score?: number | null;
  path_photo_score?: number | null;
};

type KyPhotoRow = {
  id?: string;
  project_id?: string;
  ky_id?: string;
  ky_entry_id?: string;
  created_at?: string;
  photo_kind?: string | null;
  kind?: string | null;
  type?: string | null;
  category?: string | null;
  image_url?: string | null;
  photo_url?: string | null;
  url?: string | null;
  photo_path?: string | null;
  path?: string | null;
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

function degToDirJp(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}

function slotSummary(slot: WeatherSlot | null | undefined): string {
  if (!slot) return "";
  const w = slot.weather_text || "（不明）";
  const t = slot.temperature_c == null ? "—" : `${slot.temperature_c}℃`;
  const wd = degToDirJp(slot.wind_direction_deg) || "—";
  const ws = slot.wind_speed_ms == null ? "—" : `${slot.wind_speed_ms}m/s`;
  const p = slot.precipitation_mm == null ? "—" : `${slot.precipitation_mm}mm`;
  return `${w} / 気温${t} / 風${wd} ${ws} / 降水${p}`;
}

function normalizeText(text: string): string {
  return (text || "").replace(/\r\n/g, "\n").replace(/\u3000/g, " ").trim();
}

// 表示側：箇条書きっぽい整形（AIが雑でも読めるように）
function toBullets(text: string): string[] {
  const t = normalizeText(text);
  if (!t) return [];
  const lines = t
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[-*・•]\s*/, ""));
  // 1行しかない場合でも配列化
  return lines.length ? lines : [t];
}

function pickKind(row: any): string {
  return s(row?.photo_kind).trim() || s(row?.kind).trim() || s(row?.type).trim() || s(row?.category).trim() || "";
}
function pickUrl(row: any): string {
  return (
    s(row?.image_url).trim() ||
    s(row?.photo_url).trim() ||
    s(row?.url).trim() ||
    s(row?.photo_path).trim() ||
    s(row?.path).trim() ||
    ""
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">{children}</span>;
}

function ScorePill({ label, value }: { label: string; value: number | null | undefined }) {
  const v = value == null || Number.isNaN(Number(value)) ? null : Number(value);
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs text-slate-600">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{v == null ? "—" : v}</div>
    </div>
  );
}

export default function KyReviewClient() {
  const params = useParams<{ id: string; kyId: string }>();
  const router = useRouter();

  const projectId = useMemo(() => String((params as any)?.id ?? ""), [params]);
  const kyId = useMemo(() => String((params as any)?.kyId ?? ""), [params]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [ky, setKy] = useState<KyEntry | null>(null);

  // 写真（今回／前回）
  const [slopeNowUrl, setSlopeNowUrl] = useState<string>("");
  const [pathNowUrl, setPathNowUrl] = useState<string>("");
  const [slopePrevUrl, setSlopePrevUrl] = useState<string>("");
  const [pathPrevUrl, setPathPrevUrl] = useState<string>("");

  // 公開リンク（QR）
  const [publicToken, setPublicToken] = useState<string>("");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  // リスク評価（API結果を優先で格納）
  const [risk, setRisk] = useState<any | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);

  const slopeUrlFromProject = useMemo(() => s(project?.slope_camera_snapshot_url).trim(), [project?.slope_camera_snapshot_url]);
  const pathUrlFromProject = useMemo(() => s(project?.path_camera_snapshot_url).trim(), [project?.path_camera_snapshot_url]);

  const workDateJp = useMemo(() => (ky?.work_date ? fmtDateJp(ky.work_date) : ""), [ky?.work_date]);

  const weatherSlotsSorted = useMemo(() => {
    const slots = Array.isArray(ky?.weather_slots) ? (ky!.weather_slots as WeatherSlot[]) : [];
    // 保存仕様：先頭が「適用枠」。表示は 9/12/15 の並びにしたいのでソート
    return [...slots].filter(Boolean).sort((a, b) => a.hour - b.hour);
  }, [ky]);

  const appliedWeatherSlot = useMemo(() => {
    const slots = Array.isArray(ky?.weather_slots) ? (ky!.weather_slots as WeatherSlot[]) : [];
    const first = slots?.[0];
    if (first && (first.hour === 9 || first.hour === 12 || first.hour === 15)) return first;
    // フォールバック：9→12→15 の先頭
    return weatherSlotsSorted[0] ?? null;
  }, [ky, weatherSlotsSorted]);

  const titleForList = useMemo(() => {
    const t = normalizeText(s(ky?.title));
    if (t) return t;
    const wd = normalizeText(s(ky?.work_detail));
    return wd ? wd.split("\n")[0].slice(0, 60) : "KYレビュー";
  }, [ky?.title, ky?.work_detail]);

  const fetchPublicToken = useCallback(async () => {
    // ky_public_links 等の設計差を吸収：APIがあればそちら優先、無ければDBから探す
    try {
      // 1) APIがある場合
      const res = await fetch("/api/ky-public-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ projectId, kyId }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        const token = s(j?.token).trim();
        if (token) return token;
      }
    } catch {
      // ignore
    }

    // 2) DBから（存在するなら）
    try {
      const { data, error } = await (supabase as any)
        .from("ky_public_links")
        .select("token")
        .eq("project_id", projectId)
        .eq("ky_id", kyId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!error && Array.isArray(data) && data[0]?.token) return s(data[0].token).trim();
    } catch {
      // ignore
    }

    return "";
  }, [projectId, kyId]);

  const buildQr = useCallback(async (token: string) => {
    if (!token) {
      setQrDataUrl("");
      return;
    }
    const origin =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    const url = `${origin}/ky/public/${token}`;
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, scale: 6 });
    setQrDataUrl(dataUrl);
  }, []);

  const fetchPhotosNowPrev = useCallback(
    async (workDateIso: string | null) => {
      // 「今回」：このKYに紐づく最新（なければプロジェクト定点URL）
      // 「前回」：同プロジェクトの別KYのky_photosから、直近の1件を拾う（work_dateが取れればそれより前を優先）
      try {
        const { data: nowPhotos, error: nowErr } = await (supabase as any)
          .from("ky_photos")
          .select("*")
          .eq("project_id", projectId)
          .eq("ky_id", kyId)
          .order("created_at", { ascending: false })
          .limit(50);

        let slopeNow = "";
        let pathNow = "";
        if (!nowErr && Array.isArray(nowPhotos)) {
          for (const p of nowPhotos as KyPhotoRow[]) {
            const kind = pickKind(p);
            const url = pickUrl(p);
            if (!url) continue;
            if (!slopeNow && (kind === "slope" || kind === "法面" || kind === "slope_photo" || kind === "")) slopeNow = url;
            if (!pathNow && (kind === "path" || kind === "通路" || kind === "path_photo" || kind === "")) pathNow = url;
            if (slopeNow && pathNow) break;
          }
        }

        if (!slopeNow) slopeNow = slopeUrlFromProject || "";
        if (!pathNow) pathNow = pathUrlFromProject || "";

        // 「前回」候補：同プロジェクトで ky_id != 現KY の最新写真
        const { data: prevPhotos, error: prevErr } = await (supabase as any)
          .from("ky_photos")
          .select("*")
          .eq("project_id", projectId)
          .neq("ky_id", kyId)
          .order("created_at", { ascending: false })
          .limit(80);

        let slopePrev = "";
        let pathPrev = "";
        if (!prevErr && Array.isArray(prevPhotos)) {
          for (const p of prevPhotos as KyPhotoRow[]) {
            const kind = pickKind(p);
            const url = pickUrl(p);
            if (!url) continue;
            if (!slopePrev && (kind === "slope" || kind === "法面" || kind === "slope_photo" || kind === "")) slopePrev = url;
            if (!pathPrev && (kind === "path" || kind === "通路" || kind === "path_photo" || kind === "")) pathPrev = url;
            if (slopePrev && pathPrev) break;
          }
        }

        if (mountedRef.current) {
          setSlopeNowUrl(slopeNow);
          setPathNowUrl(pathNow);
          setSlopePrevUrl(slopePrev);
          setPathPrevUrl(pathPrev);
        }
      } catch {
        if (mountedRef.current) {
          setSlopeNowUrl(slopeUrlFromProject || "");
          setPathNowUrl(pathUrlFromProject || "");
          setSlopePrevUrl("");
          setPathPrevUrl("");
        }
      }
    },
    [projectId, kyId, slopeUrlFromProject, pathUrlFromProject]
  );

  const fetchRisk = useCallback(
    async (kyRow: KyEntry | null, force = false) => {
      if (!kyRow) return;

      // 1) 既に API/DB で埋まってるならそれを採用（force=false のとき）
      const embedded =
        kyRow.risk_breakdown ?? kyRow.risk_details ?? null;

      if (!force && (kyRow.risk_total != null || embedded != null || kyRow.weather_risk != null || kyRow.photo_risk != null || kyRow.third_party_risk != null)) {
        setRisk({
          total: kyRow.risk_total ?? null,
          level: kyRow.risk_level ?? null,
          breakdown: embedded ?? null,
          weather: kyRow.weather_risk ?? null,
          photo: kyRow.photo_risk ?? null,
          third_party: kyRow.third_party_risk ?? null,
        });
        return;
      }

      // 2) APIがあれば取得（無ければ未計算扱い）
      setRiskLoading(true);
      try {
        const res = await fetch("/api/ky-risk-evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ projectId, kyId }),
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || "リスク評価の取得に失敗しました（未実装の可能性）");
        }

        const j = await res.json().catch(() => ({}));
        setRisk(j ?? null);
      } catch (e: any) {
        // ここは「未計算」のままにしたいので、エラーはステータスにだけ出す
        setRisk(null);
        setStatus({ type: "error", text: e?.message ?? "リスク評価の取得に失敗しました" });
      } finally {
        setRiskLoading(false);
      }
    },
    [projectId, kyId]
  );

  const fetchInitial = useCallback(async () => {
    if (!projectId || !kyId) return;

    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data: proj, error: projErr } = await (supabase as any)
        .from("projects")
        .select("id,name,contractor_name,address,lat,lon,slope_camera_snapshot_url,path_camera_snapshot_url")
        .eq("id", projectId)
        .maybeSingle();
      if (projErr) throw projErr;

      const { data: kyRow, error: kyErr } = await (supabase as any)
        .from("ky_entries")
        // 存在差があっても壊れにくいよう、必要最低限＋オプションをまとめて指定
        .select(
          "id,project_id,work_date,title,partner_company_name,worker_count,work_detail,hazards,countermeasures,third_party_level,weather_slots,ai_work_detail,ai_hazards,ai_countermeasures,ai_third_party,ai_supplement,is_approved,approved_at,approved_by,risk_total,risk_level,risk_breakdown,risk_details,weather_risk,photo_risk,third_party_risk,slope_photo_score,path_photo_score"
        )
        .eq("id", kyId)
        .maybeSingle();
      if (kyErr) throw kyErr;
      if (!kyRow) throw new Error("KYが見つかりません");

      if (!mountedRef.current) return;

      setProject((proj as any) ?? null);
      setKy((kyRow as any) ?? null);

      // 写真
      await fetchPhotosNowPrev(s(kyRow.work_date) || null);

      // 公開リンク token
      const token = await fetchPublicToken();
      setPublicToken(token);
      await buildQr(token);

      // リスク評価
      await fetchRisk(kyRow as any, false);
    } catch (e: any) {
      if (mountedRef.current) setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId, kyId, fetchPhotosNowPrev, fetchPublicToken, buildQr, fetchRisk]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  const onApproveToggle = useCallback(async () => {
    setStatus({ type: null, text: "" });

    try {
      const {
        data: { session },
        error: sessErr,
      } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      const accessToken = session?.access_token || "";
      if (!accessToken) throw new Error("ログイン情報が取得できません（再ログインしてください）");

      const action = ky?.is_approved ? "unapprove" : "approve";

      const res = await fetch("/api/ky-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ projectId, kyId, accessToken, action }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "承認処理に失敗しました");

      setStatus({ type: "success", text: action === "approve" ? "承認しました" : "承認を取り消しました" });

      // 再読込
      await fetchInitial();
      router.refresh();
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "承認処理に失敗しました" });
    }
  }, [projectId, kyId, ky?.is_approved, fetchInitial, router]);

  const onRecalcRisk = useCallback(async () => {
    if (!ky) return;
    setStatus({ type: null, text: "リスク評価を再計算中..." });
    await fetchRisk(ky, true);
    setStatus({ type: "success", text: "リスク評価を更新しました（取得できた場合のみ反映）" });
  }, [ky, fetchRisk]);

  const aiWorkLines = useMemo(() => toBullets(ky?.ai_work_detail || ""), [ky?.ai_work_detail]);
  const aiHazardLines = useMemo(() => toBullets(ky?.ai_hazards || ""), [ky?.ai_hazards]);
  const aiCounterLines = useMemo(() => toBullets(ky?.ai_countermeasures || ""), [ky?.ai_countermeasures]);
  const aiThirdLines = useMemo(() => toBullets(ky?.ai_third_party || ""), [ky?.ai_third_party]);

  const riskTotal = useMemo(() => {
    const v = risk?.total ?? risk?.risk_total ?? risk?.score_total ?? ky?.risk_total ?? null;
    return v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }, [risk, ky?.risk_total]);

  const riskLevel = useMemo(() => {
    return s(risk?.level ?? risk?.risk_level ?? ky?.risk_level).trim() || "";
  }, [risk, ky?.risk_level]);

  const riskBreakdownObj = useMemo(() => {
    return risk?.breakdown ?? risk?.details ?? risk?.risk_breakdown ?? ky?.risk_breakdown ?? ky?.risk_details ?? null;
  }, [risk, ky]);

  const weatherRisk = useMemo(() => {
    const v = risk?.weather ?? risk?.weather_risk ?? ky?.weather_risk ?? null;
    return v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }, [risk, ky?.weather_risk]);

  const photoRisk = useMemo(() => {
    const v = risk?.photo ?? risk?.photo_risk ?? ky?.photo_risk ?? null;
    return v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }, [risk, ky?.photo_risk]);

  const thirdRisk = useMemo(() => {
    const v = risk?.third_party ?? risk?.third_party_risk ?? ky?.third_party_risk ?? null;
    return v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }, [risk, ky?.third_party_risk]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  if (!ky) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">KYが見つかりません</div>
        <div className="mt-3">
          <Link className="text-blue-600 underline" href={`/projects/${projectId}/ky`}>
            KY一覧へ戻る
          </Link>
        </div>
      </div>
    );
  }

  const approved = !!ky.is_approved;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">KY レビュー</div>
          <div className="mt-1 text-sm text-slate-600">工事件名：{project?.name ?? "（不明）"}</div>
          <div className="mt-1 text-sm text-slate-600">日付：{ky.work_date ? workDateJp : "（不明）"}</div>
          <div className="mt-1 text-xs text-slate-500">KY ID：{kyId}</div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky/${kyId}/edit`}>
            編集
          </Link>
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky`}>
            KY一覧
          </Link>
        </div>
      </div>

      {/* タイトル */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">タイトル</div>
          <Badge>{approved ? "承認済" : "未承認"}</Badge>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">{titleForList}</div>
        {approved && (
          <div className="text-xs text-slate-500">
            承認日時：{ky.approved_at ? s(ky.approved_at) : "—"} / 承認者：{ky.approved_by ? s(ky.approved_by) : "—"}
          </div>
        )}
      </div>

      {/* 基本情報 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">基本情報</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="text-xs text-slate-600">施工会社</div>
            <div className="text-sm text-slate-900">{project?.contractor_name ?? "（未入力）"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="text-xs text-slate-600">協力会社</div>
            <div className="text-sm text-slate-900">{ky.partner_company_name ?? "（未入力）"}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="text-xs text-slate-600">作業員数</div>
            <div className="text-sm text-slate-900">{ky.worker_count == null ? "—" : ky.worker_count}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="text-xs text-slate-600">第三者（墓参者）</div>
            <div className="text-sm text-slate-900">{ky.third_party_level ? ky.third_party_level : "—"}</div>
          </div>
        </div>

        {project?.address ? <div className="text-xs text-slate-500">現場住所：{project.address}</div> : null}
      </div>

      {/* 気象 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>
          <Badge>{appliedWeatherSlot ? `適用：${appliedWeatherSlot.hour}時` : "—"}</Badge>
        </div>

        {appliedWeatherSlot ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="font-semibold">適用気象：{appliedWeatherSlot.hour}時</div>
            <div className="mt-1">{slotSummary(appliedWeatherSlot)}</div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">（気象情報がありません）</div>
        )}

        {weatherSlotsSorted.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlotsSorted.map((slot) => {
              const isApplied = appliedWeatherSlot && slot.hour === appliedWeatherSlot.hour;
              return (
                <div
                  key={slot.hour}
                  className={`rounded-lg border p-3 ${isApplied ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
                    {isApplied ? <div className="text-xs font-semibold text-emerald-700">適用</div> : null}
                  </div>
                  <div className="mt-1 text-sm text-slate-700">{slot.weather_text || "（不明）"}</div>
                  <div className="mt-2 text-xs text-slate-600 space-y-1">
                    <div>気温：{slot.temperature_c ?? "—"} ℃</div>
                    <div>
                      風：{degToDirJp(slot.wind_direction_deg) || "—"}{" "}
                      {slot.wind_speed_ms !== null && slot.wind_speed_ms !== undefined ? `${slot.wind_speed_ms} m/s` : "—"}
                    </div>
                    <div>降水：{slot.precipitation_mm ?? "—"} mm</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* リスク評価（レビューにだけ表示） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">リスク評価（レビュー専用）</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRecalcRisk}
              disabled={riskLoading}
              className={`rounded-lg border px-3 py-2 text-sm ${riskLoading ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"}`}
            >
              {riskLoading ? "再計算中..." : "再計算（取得）"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <ScorePill label="総合" value={riskTotal} />
          <ScorePill label="気象" value={weatherRisk} />
          <ScorePill label="写真" value={photoRisk} />
          <ScorePill label="第三者" value={thirdRisk} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge>判定：{riskLevel || "—"}</Badge>
          {riskTotal == null && !riskBreakdownObj ? <Badge>未計算（または取得不可）</Badge> : null}
        </div>

        {riskBreakdownObj ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold text-slate-700">内訳（JSON）</div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-700">{JSON.stringify(riskBreakdownObj, null, 2)}</pre>
          </div>
        ) : (
          <div className="text-xs text-slate-500">
            ※ リスク評価の内訳は「演算部/API」が返す構造に依存します。現時点で未計算なら「再計算（取得）」を押してください。
          </div>
        )}
      </div>

      {/* 写真（今回/前回） + スコア */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">写真（今回／前回）</div>
          <div className="flex items-center gap-2">
            <Badge>法面スコア：{ky.slope_photo_score == null ? "—" : ky.slope_photo_score}</Badge>
            <Badge>通路スコア：{ky.path_photo_score == null ? "—" : ky.path_photo_score}</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 法面 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-sm font-semibold text-slate-800">法面</div>
            <div className="grid grid-cols-1 gap-2">
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="text-xs text-slate-600">今回</div>
                {slopeNowUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slopeNowUrl} alt="法面（今回）" className="mt-2 w-full rounded-md border border-slate-200 object-cover" />
                    <div className="mt-2 text-xs break-all text-slate-600">{slopeNowUrl}</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">（画像なし）</div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="text-xs text-slate-600">前回</div>
                {slopePrevUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={slopePrevUrl} alt="法面（前回）" className="mt-2 w-full rounded-md border border-slate-200 object-cover" />
                    <div className="mt-2 text-xs break-all text-slate-600">{slopePrevUrl}</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">（前回なし）</div>
                )}
              </div>
            </div>
          </div>

          {/* 通路 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-sm font-semibold text-slate-800">通路</div>
            <div className="grid grid-cols-1 gap-2">
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="text-xs text-slate-600">今回</div>
                {pathNowUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pathNowUrl} alt="通路（今回）" className="mt-2 w-full rounded-md border border-slate-200 object-cover" />
                    <div className="mt-2 text-xs break-all text-slate-600">{pathNowUrl}</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">（画像なし）</div>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <div className="text-xs text-slate-600">前回</div>
                {pathPrevUrl ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={pathPrevUrl} alt="通路（前回）" className="mt-2 w-full rounded-md border border-slate-200 object-cover" />
                    <div className="mt-2 text-xs break-all text-slate-600">{pathPrevUrl}</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">（前回なし）</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500">
          ※ 写真スコアは KyNew 側で pseudo 表示されている前提。演算部がスコアを保存する場合は上のスコア欄に反映されます。
        </div>
      </div>

      {/* 人の入力 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">人の入力</div>

        <div className="space-y-1">
          <div className="text-xs text-slate-600">作業内容</div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-900">
            {ky.work_detail ? ky.work_detail : "—"}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-600">危険予知</div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-900">
            {ky.hazards ? ky.hazards : "—"}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-600">対策</div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm whitespace-pre-wrap text-slate-900">
            {ky.countermeasures ? ky.countermeasures : "—"}
          </div>
        </div>
      </div>

      {/* AI補足（厳しめ運用を前提：レビューで確認） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">AI補足（レビュー専用表示）</div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">作業内容の補足</div>
          {aiWorkLines.length ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-900">
              {aiWorkLines.map((x, i) => (
                <li key={i} className="whitespace-pre-wrap">{x}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500">—</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">危険予知の補足（因果が分かる形が理想）</div>
          {aiHazardLines.length ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-900">
              {aiHazardLines.map((x, i) => (
                <li key={i} className="whitespace-pre-wrap">{x}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500">—</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">対策の補足（具体策の箇条書きが理想）</div>
          {aiCounterLines.length ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-900">
              {aiCounterLines.map((x, i) => (
                <li key={i} className="whitespace-pre-wrap">{x}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500">—</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">第三者（墓参者）の補足</div>
          {aiThirdLines.length ? (
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-900">
              {aiThirdLines.map((x, i) => (
                <li key={i} className="whitespace-pre-wrap">{x}</li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500">—</div>
          )}
        </div>
      </div>

      {/* 公開リンク（QR） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">公開リンク（現場閲覧用）</div>

        {publicToken ? (
          <div className="space-y-2">
            <div className="text-xs text-slate-600 break-all">
              URL：{typeof window !== "undefined" ? `${window.location.origin}/ky/public/${publicToken}` : `/ky/public/${publicToken}`}
            </div>

            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="KY公開QR" className="w-44 rounded-lg border border-slate-200 bg-white p-2" />
            ) : null}

            <div className="text-xs text-slate-500">※ QRは現場スマホ閲覧に使用</div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">
            （公開トークンが見つかりません。公開リンク生成API/テーブルが未設定の可能性があります）
          </div>
        )}
      </div>

      {/* 承認 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">承認</div>
        <div className="text-xs text-slate-600">
          ※ 承認すると LINE自動配信などのトリガー（設計済み）に使います。
        </div>

        <button
          type="button"
          onClick={onApproveToggle}
          className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-white ${approved ? "bg-slate-700 hover:bg-slate-800" : "bg-black hover:bg-slate-900"}`}
        >
          {approved ? "承認を取り消す" : "承認する"}
        </button>
      </div>

      {!!status.text && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            status.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : status.type === "error"
              ? "border border-rose-200 bg-rose-50 text-rose-800"
              : "border border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {status.text}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/ky`)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          一覧へ戻る
        </button>

        <Link
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
          href={`/projects/${projectId}/ky/${kyId}/edit`}
        >
          編集へ
        </Link>
      </div>
    </div>
  );
}
