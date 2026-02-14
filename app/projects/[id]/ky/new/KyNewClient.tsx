// app/projects/[id]/ky/new/KyNewClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
};

type Project = {
  id: string | null;
  name: string | null;
  contractor_name: string | null;
  lat: number | null;
  lon: number | null;
  slope_camera_snapshot_url?: string | null;
  path_camera_snapshot_url?: string | null;
};

type PartnerOption = { value: string; name: string };

type RiskItem = {
  rank: number;
  hazard: string;
  countermeasure: string;
  score?: number;
  tags?: string[];
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function ymdJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "jpg";
}

function slotSummary(slot: WeatherSlot | null | undefined): string {
  if (!slot) return "";
  const w = slot.weather_text || "（不明）";
  const t = slot.temperature_c == null ? "—" : `${slot.temperature_c}℃`;
  const wd = degToDirJp(slot.wind_direction_deg) || "—";
  const ws = slot.wind_speed_ms == null ? "—" : `${slot.wind_speed_ms}m/s`;
  const p = slot.precipitation_mm == null ? "—" : `${slot.precipitation_mm}mm`;
  return `${slot.hour}時：${w} / ${t} / 風:${wd}${ws} / 降水:${p}`;
}

function splitBullets(text: string): string[] {
  const t = s(text).replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  const lines = t
    .split("\n")
    .map((x) => x.replace(/^\s*[・\-\*]\s*/, "").trim())
    .filter(Boolean);
  // 文章が1行で長い場合はそのまま1項目扱い
  return lines.length ? lines : [t];
}

function buildRiskItemsFromTexts(hazardsText: string, measuresText: string): RiskItem[] {
  const hazardLines = splitBullets(hazardsText);
  const measureLines = splitBullets(measuresText);

  const items: RiskItem[] = [];
  const n = Math.max(hazardLines.length, measureLines.length);

  for (let i = 0; i < n; i++) {
    const hz = s(hazardLines[i] || "").replace(/^・\s*/, "").trim();
    const msRaw = s(measureLines[i] || "").replace(/^・\s*/, "").trim();
    // 「（1）」などの番号を落として内容だけに
    const ms = msRaw.replace(/^\（?\(?\d+\)?\）?\s*/, "").trim();
    if (!hz && !ms) continue;
    items.push({
      rank: i + 1,
      hazard: hz || "（危険予知が取得できませんでした）",
      countermeasure: ms || "（対策が取得できませんでした）",
    });
  }

  return items;
}

export default function KyNewClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = useMemo(() => String((params as any)?.id ?? ""), [params]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [project, setProject] = useState<Project | null>(null);

  const [workDate, setWorkDate] = useState<string>(() => ymdJst(new Date()));

  const [partnerCompanyName, setPartnerCompanyName] = useState<string>("");
  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>([]);

  const [workerCount, setWorkerCount] = useState<string>("");

  const [workDetail, setWorkDetail] = useState("");
  const [hazards, setHazards] = useState("");
  const [countermeasures, setCountermeasures] = useState("");

  const [thirdPartyLevel, setThirdPartyLevel] = useState<string>("");

  const [weatherSlots, setWeatherSlots] = useState<WeatherSlot[]>([]);
  const [selectedSlotHour, setSelectedSlotHour] = useState<9 | 12 | 15 | null>(null);
  const [appliedSlotHour, setAppliedSlotHour] = useState<9 | 12 | 15 | null>(null);

  // 写真（任意）
  const slopeFileRef = useRef<HTMLInputElement | null>(null);
  const pathFileRef = useRef<HTMLInputElement | null>(null);
  const [slopeMode, setSlopeMode] = useState<"url" | "file" | "none">("none");
  const [pathMode, setPathMode] = useState<"url" | "file" | "none">("none");
  const [slopeFile, setSlopeFile] = useState<File | null>(null);
  const [pathFile, setPathFile] = useState<File | null>(null);
  const [slopeFileName, setSlopeFileName] = useState("");
  const [pathFileName, setPathFileName] = useState("");
  const [slopeNowUrlCached, setSlopeNowUrlCached] = useState<string>("");
  const [pathNowUrlCached, setPathNowUrlCached] = useState<string>("");

  // 前回写真（代表・通路）
  const [prevRepresentativeUrl, setPrevRepresentativeUrl] = useState<string>("");
  const [prevPathUrl, setPrevPathUrl] = useState<string>("");

  // プロジェクト由来（URL選択時の候補）
  const representativeUrlFromProject = useMemo(
    () => s(project?.slope_camera_snapshot_url).trim(),
    [project?.slope_camera_snapshot_url]
  );
  const pathUrlFromProject = useMemo(
    () => s(project?.path_camera_snapshot_url).trim(),
    [project?.path_camera_snapshot_url]
  );

  // AI補足（4項目）
  const [aiWork, setAiWork] = useState<string>("");
  const [aiHazards, setAiHazards] = useState<string>("");
  const [aiCounter, setAiCounter] = useState<string>("");
  const [aiThird, setAiThird] = useState<string>("");

  // AIリスク項目（レビューで使う前提：新規でも見せたい場合はここで表示）
  const [aiRiskItems, setAiRiskItems] = useState<RiskItem[]>([]);

  // 初期読み込み：project / partner options / 前回写真
  const fetchInitial = useCallback(async () => {
    try {
      setLoading(true);

      const { data: proj, error: projErr } = await (supabase as any)
        .from("projects")
        .select("id,name,contractor_name,lat,lon,slope_camera_snapshot_url,path_camera_snapshot_url")
        .eq("id", projectId)
        .maybeSingle();
      if (projErr) throw projErr;

      const { data: partners, error: partnersErr } = await (supabase as any)
        .from("project_partner_entries")
        .select("partner_company_name")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });

      const opts: PartnerOption[] = [];
      const seen = new Set<string>();
      if (!partnersErr && Array.isArray(partners)) {
        for (const r of partners) {
          const name = s(r?.partner_company_name).trim();
          if (!name) continue;
          if (seen.has(name)) continue;
          seen.add(name);
          opts.push({ value: name, name });
        }
      }

      // ✅ 前回写真（代表=kind:slope / 通路=kind:path）を復活
      const { data: photos, error: photoErr } = await (supabase as any)
        .from("ky_photos")
        .select("kind,image_url,created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (photoErr) {
        // 失敗しても画面は動かす
        console.warn("[KyNew] ky_photos load failed", photoErr);
      }

      let prevRep = "";
      let prevPath = "";
      if (Array.isArray(photos)) {
        const rep = photos.find((p: any) => s(p?.kind) === "slope" && s(p?.image_url).trim());
        const pth = photos.find((p: any) => s(p?.kind) === "path" && s(p?.image_url).trim());
        prevRep = s(rep?.image_url).trim();
        prevPath = s(pth?.image_url).trim();
      }

      if (mountedRef.current) {
        setProject((proj as any) ?? null);
        setPartnerOptions(opts);
        setPrevRepresentativeUrl(prevRep);
        setPrevPathUrl(prevPath);
      }
    } catch (e: any) {
      if (mountedRef.current) setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // weather
  const fetchWeather = useCallback(async () => {
    const lat = project?.lat ?? null;
    const lon = project?.lon ?? null;
    if (lat == null || lon == null) {
      setWeatherSlots([]);
      setSelectedSlotHour(null);
      setAppliedSlotHour(null);
      return;
    }

    try {
      let res = await fetch("/api/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ lat, lon, date: workDate }),
      });

      if (res.status === 405) {
        const qs = new URLSearchParams({ lat: String(lat), lon: String(lon), date: workDate });
        res = await fetch(`/api/weather?${qs.toString()}`, { method: "GET", cache: "no-store" });
      }

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "weather error");

      const arr = Array.isArray(j?.slots) ? j.slots : [];
      const slots: WeatherSlot[] = arr
        .filter((x: any) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15))
        .map((x: any) => ({
          hour: x.hour,
          time_iso: s(x.time_iso),
          weather_text: s(x.weather_text),
          temperature_c: x.temperature_c == null ? null : Number(x.temperature_c),
          wind_direction_deg: x.wind_direction_deg == null ? null : Number(x.wind_direction_deg),
          wind_speed_ms: x.wind_speed_ms == null ? null : Number(x.wind_speed_ms),
          precipitation_mm: x.precipitation_mm == null ? null : Number(x.precipitation_mm),
          weather_code: x.weather_code == null ? null : Number(x.weather_code),
        }));

      if (mountedRef.current) {
        setWeatherSlots(slots);
        // 初回：選択を9時に寄せる（存在すれば）
        const has9 = slots.some((x) => x.hour === 9);
        setSelectedSlotHour(has9 ? 9 : (slots[0]?.hour ?? null));
      }
    } catch (e: any) {
      if (mountedRef.current) {
        setWeatherSlots([]);
        setSelectedSlotHour(null);
        setAppliedSlotHour(null);
        console.warn("[KyNew] weather load failed", e);
      }
    }
  }, [project?.lat, project?.lon, workDate]);

  useEffect(() => {
    if (!project) return;
    fetchWeather();
  }, [project, fetchWeather]);

  const appliedSlots = useMemo(() => {
    if (!appliedSlotHour) return [];
    const slot = weatherSlots.find((x) => x.hour === appliedSlotHour);
    return slot ? [slot] : [];
  }, [appliedSlotHour, weatherSlots]);

  const onApplyWeather = useCallback(() => {
    if (!selectedSlotHour) return;
    setAppliedSlotHour(selectedSlotHour);
    setStatus({ type: "success", text: `気象を適用しました：${selectedSlotHour}時` });
  }, [selectedSlotHour]);

  const uploadToStorage = useCallback(async (file: File, kind: "slope" | "path"): Promise<string> => {
    const { data: sess } = await supabase.auth.getSession();
    const accessToken = s(sess?.session?.access_token).trim();
    if (!accessToken) throw new Error("ログインが必要です");

    const ext = extFromName(file.name);
    const fileName = `${projectId}/${Date.now()}_${kind}.${ext}`;

    const { data, error } = await (supabase as any).storage.from("ky-photos").upload(fileName, file, {
      cacheControl: "3600",
      upsert: true,
    });
    if (error) throw error;

    const { data: pub } = (supabase as any).storage.from("ky-photos").getPublicUrl(data?.path);
    const url = s(pub?.publicUrl).trim();
    if (!url) throw new Error("写真URLが取得できませんでした");
    return url;
  }, [projectId]);

  const onPickSlopeFile = useCallback(() => {
    slopeFileRef.current?.click();
  }, []);
  const onPickPathFile = useCallback(() => {
    pathFileRef.current?.click();
  }, []);

  const onSlopeFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setSlopeFile(f);
    setSlopeFileName(f?.name || "");
    if (f) setSlopeNowUrlCached("");
  }, []);
  const onPathFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setPathFile(f);
    setPathFileName(f?.name || "");
    if (f) setPathNowUrlCached("");
  }, []);

  const onGenerateAi = useCallback(async () => {
    setStatus({ type: null, text: "" });

    if (!workDetail.trim()) {
      setStatus({ type: "error", text: "作業内容（必須）を入力してください" });
      return;
    }

    try {
      // 写真URL（今回）
      const slopeNow =
        slopeMode === "file" && slopeFile
          ? "(upload)"
          : slopeMode === "url"
          ? (representativeUrlFromProject || "")
          : "";
      const pathNow =
        pathMode === "file" && pathFile
          ? "(upload)"
          : pathMode === "url"
          ? (pathUrlFromProject || "")
          : "";

      let slopeNowUrl = slopeNow;
      let pathNowUrl = pathNow;

      // 生成時点でアップロードしてURL化（補足の精度を上げるため）
      if (slopeMode === "file" && slopeFile) {
        setStatus({ type: null, text: "写真アップロード中（法面）..." });
        slopeNowUrl = await uploadToStorage(slopeFile, "slope");
        setSlopeNowUrlCached(slopeNowUrl);
      }
      if (pathMode === "file" && pathFile) {
        setStatus({ type: null, text: "写真アップロード中（通路）..." });
        pathNowUrl = await uploadToStorage(pathFile, "path");
        setPathNowUrlCached(pathNowUrl);
      }

      setStatus({ type: null, text: "AI補足を生成中..." });

      const resp = await fetch("/api/ky-ai-supplement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          work_detail: workDetail,
          hazards: hazards,
          countermeasures: countermeasures,
          third_party_level: thirdPartyLevel,
          worker_count: workerCount.trim() ? Number(workerCount.trim()) : null,
          weather_slots: appliedSlots && appliedSlots.length ? appliedSlots : null,

          slope_photo_url: slopeNowUrl || null,
          slope_prev_photo_url: prevRepresentativeUrl || null,
          path_photo_url: pathNowUrl || null,
          path_prev_photo_url: prevPathUrl || null,

          profile: "strict",
        }),
      });

      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error || j?.detail || "AI生成に失敗しました");

      const ai_work_detail = s(j?.ai_work_detail);
      const ai_hazards = s(j?.ai_hazards);
      const ai_countermeasures = s(j?.ai_countermeasures);
      const ai_third_party = s(j?.ai_third_party);

      setAiWork(ai_work_detail);
      setAiHazards(ai_hazards);
      setAiCounter(ai_countermeasures);
      setAiThird(ai_third_party);

      // ai_risk_items が来れば優先、無ければhazards/countermeasuresから簡易生成
      const items = Array.isArray(j?.ai_risk_items) ? j.ai_risk_items : buildRiskItemsFromTexts(ai_hazards, ai_countermeasures);
      setAiRiskItems(items);

      setStatus({ type: "success", text: "AI補足を生成しました（厳しめ）" });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "AI生成に失敗しました" });
    }
  }, [
    workDetail,
    hazards,
    countermeasures,
    thirdPartyLevel,
    workerCount,
    appliedSlots,
    slopeMode,
    pathMode,
    slopeFile,
    pathFile,
    representativeUrlFromProject,
    pathUrlFromProject,
    prevRepresentativeUrl,
    prevPathUrl,
    uploadToStorage,
  ]);

  const renderPhotoBox = useCallback((label: string, nowUrl: string, prevUrl: string) => {
    const now = s(nowUrl).trim();
    const prev = s(prevUrl).trim();
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">{label}</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-xs text-slate-600">今回</div>
            {now ? (
              <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={now} alt={`${label}-now`} className="w-full h-56 object-cover" />
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 h-56 flex items-center justify-center text-sm text-slate-500">
                （未設定）
              </div>
            )}
            <div className="text-xs text-slate-500 break-all">{now || ""}</div>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-600">前回</div>
            {prev ? (
              <div className="rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={prev} alt={`${label}-prev`} className="w-full h-56 object-cover" />
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 h-56 flex items-center justify-center text-sm text-slate-500">
                （前回なし）
              </div>
            )}
            <div className="text-xs text-slate-500 break-all">{prev || ""}</div>
          </div>
        </div>
      </div>
    );
  }, []);

  const renderWeatherBox = useCallback(() => {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>
          <button
            type="button"
            className={`rounded-lg px-3 py-1 text-sm border ${
              !selectedSlotHour
                ? "bg-slate-100 text-slate-400 border-slate-200"
                : "bg-white text-slate-800 border-slate-300 hover:bg-slate-50"
            }`}
            onClick={onApplyWeather}
            disabled={!selectedSlotHour}
          >
            気象を適用
          </button>
        </div>

        {weatherSlots.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlots.map((slot) => {
              const isSelected = selectedSlotHour === slot.hour;
              const isApplied = appliedSlotHour === slot.hour;
              const cls = isApplied
                ? "border-emerald-300 bg-emerald-50"
                : isSelected
                ? "border-blue-300 bg-blue-50"
                : "border-slate-200 bg-slate-50";

              return (
                <button
                  type="button"
                  key={slot.hour}
                  className={`text-left rounded-lg border p-3 ${cls} hover:opacity-95`}
                  onClick={() => setSelectedSlotHour(slot.hour)}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
                    {isApplied ? (
                      <div className="text-xs font-semibold text-emerald-700">適用</div>
                    ) : isSelected ? (
                      <div className="text-xs font-semibold text-blue-700">選択</div>
                    ) : null}
                  </div>
                  <div className="mt-2 text-sm text-slate-800">{slot.weather_text || "—"}</div>
                  <div className="mt-2 text-xs text-slate-600 space-y-1">
                    <div>気温：{slot.temperature_c ?? "—"} ℃</div>
                    <div>
                      風：{degToDirJp(slot.wind_direction_deg) || "—"}{" "}
                      {slot.wind_speed_ms != null ? `${slot.wind_speed_ms} m/s` : "—"}
                    </div>
                    <div>降水：{slot.precipitation_mm ?? "—"} mm</div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-slate-600">（気象データなし）</div>
        )}

        {appliedSlotHour ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            適用中：{slotSummary(weatherSlots.find((x) => x.hour === appliedSlotHour))}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            ※「気象を適用」で確定します（保存対象）
          </div>
        )}
      </div>
    );
  }, [weatherSlots, selectedSlotHour, appliedSlotHour, onApplyWeather]);

  // ✅ 保存（既存運用そのまま：ky-createへ送るwork_contentは後で修正が必要）
  const onSave = useCallback(async () => {
    setStatus({ type: null, text: "" });

    if (!partnerCompanyName.trim()) {
      setStatus({ type: "error", text: "協力会社（必須）を選択してください" });
      return;
    }
    if (!workDetail.trim()) {
      setStatus({ type: "error", text: "作業内容（必須）を入力してください" });
      return;
    }

    setSaving(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = s(sess?.session?.access_token).trim();
      if (!accessToken) throw new Error("ログインが必要です（access tokenなし）");

      let slopeSavedUrl: string | null = null;
      let pathSavedUrl: string | null = null;

      if (slopeNowUrlCached) slopeSavedUrl = slopeNowUrlCached;
      else {
        if (slopeMode === "file" && slopeFile) slopeSavedUrl = await uploadToStorage(slopeFile, "slope");
        else if (slopeMode === "url") slopeSavedUrl = representativeUrlFromProject || null;
      }

      if (pathNowUrlCached) pathSavedUrl = pathNowUrlCached;
      else {
        if (pathMode === "file" && pathFile) pathSavedUrl = await uploadToStorage(pathFile, "path");
        else if (pathMode === "url") pathSavedUrl = pathUrlFromProject || null;
      }

      const createPayload: any = {
        project_id: projectId,
        work_date: workDate,
        partner_company_name: partnerCompanyName.trim(),
        worker_count: workerCount.trim() ? Number(workerCount.trim()) : null,

        // ⚠️ ky-create / DB側のカラム差分は次ステップで直す（work_content vs work_detail）
        work_content: workDetail.trim(),

        hazards: hazards.trim() ? hazards.trim() : null,
        countermeasures: countermeasures.trim() ? countermeasures.trim() : null,
        third_party_level: thirdPartyLevel.trim() ? thirdPartyLevel.trim() : null,

        weather_slots: appliedSlots && appliedSlots.length ? appliedSlots : null,

        ai_work_detail: null,
        ai_hazards: aiHazards.trim() ? aiHazards.trim() : null,
        ai_countermeasures: aiCounter.trim() ? aiCounter.trim() : null,
        ai_third_party: aiThird.trim() ? aiThird.trim() : null,

        ai_risk_items: aiRiskItems.length ? aiRiskItems : null,
        ai_profile: "strict",
      };

      const resp = await fetch("/api/ky-create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(createPayload),
      });

      const jr = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(jr?.error || jr?.detail || "保存に失敗しました");

      const kyId = s(jr?.ky?.id || jr?.id).trim();
      if (!kyId) throw new Error("kyIdが取得できませんでした");

      setStatus({ type: "success", text: "保存しました。レビューへ移動します..." });
      router.push(`/projects/${projectId}/ky/${kyId}/review`);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  }, [
    partnerCompanyName,
    workDetail,
    projectId,
    workDate,
    workerCount,
    hazards,
    countermeasures,
    thirdPartyLevel,
    appliedSlots,
    aiHazards,
    aiCounter,
    aiThird,
    aiRiskItems,
    router,
    slopeMode,
    pathMode,
    slopeFile,
    pathFile,
    representativeUrlFromProject,
    pathUrlFromProject,
    slopeNowUrlCached,
    pathNowUrlCached,
    uploadToStorage,
  ]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-4 space-y-3">
        <div className="text-sm text-slate-600">読み込み中...</div>
      </div>
    );
  }

  const contractorName = s(project?.contractor_name).trim();
  const projectName = s(project?.name).trim();

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-slate-900">KY新規作成</div>
          <div className="text-sm text-slate-600">
            {projectName ? `現場：${projectName}` : ""}
            {contractorName ? ` / 元請：${contractorName}` : ""}
          </div>
        </div>

        <Link
          href={`/projects/${projectId}/ky`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
        >
          一覧へ
        </Link>
      </div>

      {/* 基本情報 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="text-sm font-semibold text-slate-800">基本情報</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-xs text-slate-600">作業日</div>
            <input
              type="date"
              value={workDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="text-xs text-slate-500">{fmtDateJp(workDate)}</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-600">協力会社（必須）</div>

            <div className="flex gap-2">
              <select
                value={partnerCompanyName}
                onChange={(e) => setPartnerCompanyName(e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">選択してください</option>
                {partnerOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.name}
                  </option>
                ))}
              </select>

              <input
                value={partnerCompanyName}
                onChange={(e) => setPartnerCompanyName(e.target.value)}
                placeholder="手入力も可"
                className="w-40 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="text-xs text-slate-500">※協力会社が未登録でも手入力できます</div>
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-600">本日の作業員数</div>
            <input
              inputMode="numeric"
              value={workerCount}
              onChange={(e) => setWorkerCount(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="例）8"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-slate-600">第三者（墓参者）</div>
            <select
              value={thirdPartyLevel}
              onChange={(e) => setThirdPartyLevel(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">選択してください</option>
              <option value="少ない">少ない</option>
              <option value="多い">多い</option>
            </select>
            <div className="text-xs text-slate-500">※厳しめ評価に影響します</div>
          </div>
        </div>
      </div>

      {/* 気象 */}
      {renderWeatherBox()}

      {/* 写真：前回/今回 */}
      {renderPhotoBox("法面写真", slopeNowUrlCached || (slopeMode === "url" ? representativeUrlFromProject : ""), prevRepresentativeUrl)}
      {renderPhotoBox("通路写真", pathNowUrlCached || (pathMode === "url" ? pathUrlFromProject : ""), prevPathUrl)}

      {/* 写真入力 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="text-sm font-semibold text-slate-800">写真入力（任意）</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-800">法面</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  slopeMode === "url" ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
                onClick={() => setSlopeMode("url")}
                disabled={!representativeUrlFromProject}
                title={!representativeUrlFromProject ? "プロジェクトにURLがありません" : ""}
              >
                URL（現場カメラ）
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  slopeMode === "file" ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
                onClick={() => setSlopeMode("file")}
              >
                ファイル
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  slopeMode === "none" ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
                onClick={() => setSlopeMode("none")}
              >
                なし
              </button>
            </div>

            {slopeMode === "file" ? (
              <div className="space-y-2">
                <input ref={slopeFileRef} type="file" accept="image/*" className="hidden" onChange={onSlopeFileChange} />
                <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={onPickSlopeFile}>
                  写真を選択
                </button>
                <div className="text-xs text-slate-600 break-all">{slopeFileName || "（未選択）"}</div>
              </div>
            ) : slopeMode === "url" ? (
              <div className="text-xs text-slate-600 break-all">{representativeUrlFromProject || "（URLなし）"}</div>
            ) : (
              <div className="text-xs text-slate-600">（設定しません）</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-800">通路</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  pathMode === "url" ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
                onClick={() => setPathMode("url")}
                disabled={!pathUrlFromProject}
                title={!pathUrlFromProject ? "プロジェクトにURLがありません" : ""}
              >
                URL（現場カメラ）
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  pathMode === "file" ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
                onClick={() => setPathMode("file")}
              >
                ファイル
              </button>
              <button
                type="button"
                className={`rounded-lg border px-3 py-2 text-sm ${
                  pathMode === "none" ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:bg-slate-50"
                }`}
                onClick={() => setPathMode("none")}
              >
                なし
              </button>
            </div>

            {pathMode === "file" ? (
              <div className="space-y-2">
                <input ref={pathFileRef} type="file" accept="image/*" className="hidden" onChange={onPathFileChange} />
                <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50" onClick={onPickPathFile}>
                  写真を選択
                </button>
                <div className="text-xs text-slate-600 break-all">{pathFileName || "（未選択）"}</div>
              </div>
            ) : pathMode === "url" ? (
              <div className="text-xs text-slate-600 break-all">{pathUrlFromProject || "（URLなし）"}</div>
            ) : (
              <div className="text-xs text-slate-600">（設定しません）</div>
            )}
          </div>
        </div>
      </div>

      {/* 入力 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="text-sm font-semibold text-slate-800">入力</div>

        <div className="space-y-1">
          <div className="text-xs text-slate-600">作業内容（必須）</div>
          <textarea
            value={workDetail}
            onChange={(e) => setWorkDetail(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="例）法面整形、モルタル吹付、資材搬入、交通誘導など"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-600">危険予知（任意）</div>
          <textarea
            value={hazards}
            onChange={(e) => setHazards(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="現場の気付き（任意）。AI補足で補完されます。"
          />
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-600">対策（任意）</div>
          <textarea
            value={countermeasures}
            onChange={(e) => setCountermeasures(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="現場の対策（任意）。AI補足で補完されます。"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onGenerateAi}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-slate-900"
          >
            AI補足を生成
          </button>

          <div className="text-xs text-slate-500">
            ※ 気象は「適用」した内容がAI補足に反映されます
          </div>
        </div>
      </div>

      {/* AI補足（4枠） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="text-sm font-semibold text-slate-800">AI補足（厳しめ）</div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">作業内容の補足</div>
          {aiWork.trim() ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{aiWork}</pre>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足</div>
          {aiHazards.trim() ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{aiHazards}</pre>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足</div>
          {aiCounter.trim() ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{aiCounter}</pre>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足</div>
          {aiThird.trim() ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <pre className="whitespace-pre-wrap text-sm text-slate-800">{aiThird}</pre>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
        </div>

        {/* 生成できていれば「対策」の箇条書きプレビュー（任意・書式変更しない範囲） */}
        {aiRiskItems.length ? (
          <div className="space-y-2">
            <div className="text-xs text-slate-600">（参考）AI対策 箇条書き</div>
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                {aiRiskItems.map((x) => (
                  <li key={`m-${x.rank}`}>{x.countermeasure}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
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

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => router.push(`/projects/${projectId}/ky`)}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          戻る
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`rounded-lg px-4 py-2 text-sm text-white ${saving ? "bg-slate-400" : "bg-black hover:bg-slate-900"}`}
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
