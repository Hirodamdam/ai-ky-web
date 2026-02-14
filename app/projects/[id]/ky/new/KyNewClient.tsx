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
  id: string;
  name: string | null;
  contractor_name: string | null;
  lat: number | null;
  lon: number | null;
  slope_camera_snapshot_url?: string | null;
  path_camera_snapshot_url?: string | null;
};

type PartnerOption = { value: string; name: string };

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

// ky_photos の列名差を吸収
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

function slotSummary(slot: WeatherSlot | null | undefined): string {
  if (!slot) return "";
  const w = slot.weather_text || "（不明）";
  const t = slot.temperature_c == null ? "—" : `${slot.temperature_c}℃`;
  const wd = degToDirJp(slot.wind_direction_deg) || "—";
  const ws = slot.wind_speed_ms == null ? "—" : `${slot.wind_speed_ms}m/s`;
  const p = slot.precipitation_mm == null ? "—" : `${slot.precipitation_mm}mm`;
  return `${w} / 気温${t} / 風${wd} ${ws} / 降水${p}`;
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

  // ✅ 本日の作業員数
  const [workerCount, setWorkerCount] = useState<string>("");

  const [workDetail, setWorkDetail] = useState("");
  const [hazards, setHazards] = useState("");
  const [countermeasures, setCountermeasures] = useState("");

  const [thirdPartyLevel, setThirdPartyLevel] = useState<string>("");

  const [weatherSlots, setWeatherSlots] = useState<WeatherSlot[]>([]);
  const [selectedSlotHour, setSelectedSlotHour] = useState<9 | 12 | 15 | null>(null);
  const [appliedSlotHour, setAppliedSlotHour] = useState<9 | 12 | 15 | null>(null);

  const slopeFileRef = useRef<HTMLInputElement | null>(null);
  const pathFileRef = useRef<HTMLInputElement | null>(null);

  const [slopeMode, setSlopeMode] = useState<"url" | "file" | "none">("none");
  const [pathMode, setPathMode] = useState<"url" | "file" | "none">("none");

  const [slopeFile, setSlopeFile] = useState<File | null>(null);
  const [pathFile, setPathFile] = useState<File | null>(null);

  const [slopeFileName, setSlopeFileName] = useState("");
  const [pathFileName, setPathFileName] = useState("");

  const [slopePrevUrl, setSlopePrevUrl] = useState<string>("");
  const [pathPrevUrl, setPathPrevUrl] = useState<string>("");

  // ✅ 保存用（UIは今回削除）
  const [aiWork, setAiWork] = useState("");
  const [aiHazards, setAiHazards] = useState("");
  const [aiCounter, setAiCounter] = useState("");
  const [aiThird, setAiThird] = useState("");

  const KY_PHOTO_BUCKET = process.env.NEXT_PUBLIC_KY_PHOTO_BUCKET || "ky-photos";

  const slopeUrlFromProject = useMemo(() => s(project?.slope_camera_snapshot_url).trim(), [project?.slope_camera_snapshot_url]);
  const pathUrlFromProject = useMemo(() => s(project?.path_camera_snapshot_url).trim(), [project?.path_camera_snapshot_url]);

  const fetchInitial = useCallback(async () => {
    if (!projectId) return;
    if (mountedRef.current) {
      setLoading(true);
      setStatus({ type: null, text: "" });
    }

    try {
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

      const { data: prevPhotos, error: prevErr } = await (supabase as any)
        .from("ky_photos")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50);

      let prevSlope = "";
      let prevPath = "";
      if (!prevErr && Array.isArray(prevPhotos)) {
        for (const p of prevPhotos) {
          const kind = pickKind(p);
          const url = pickUrl(p);
          if (!url) continue;

          if (!prevSlope && (kind === "slope" || kind === "法面" || kind === "slope_photo" || kind === "")) prevSlope = url;
          if (!prevPath && (kind === "path" || kind === "通路" || kind === "path_photo" || kind === "")) prevPath = url;

          if (prevSlope && prevPath) break;
        }
      }

      if (mountedRef.current) {
        setProject((proj as any) ?? null);
        setPartnerOptions(opts);
        setSlopePrevUrl(prevSlope);
        setPathPrevUrl(prevPath);
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

  // ✅ weather：POSTが405ならGETへフォールバック
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
      if (!res.ok) throw new Error(j?.error || "気象取得に失敗しました");

      const slots = Array.isArray(j?.slots) ? (j.slots as WeatherSlot[]) : [];
      const normalized: WeatherSlot[] = slots
        .filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15))
        .sort((a, b) => a.hour - b.hour);

      setWeatherSlots(normalized);

      if (normalized.length) {
        setSelectedSlotHour(normalized[0].hour);
      } else {
        setSelectedSlotHour(null);
        setAppliedSlotHour(null);
      }
    } catch {
      setWeatherSlots([]);
      setSelectedSlotHour(null);
      setAppliedSlotHour(null);
    }
  }, [project?.lat, project?.lon, workDate]);

  useEffect(() => {
    fetchWeather();
  }, [fetchWeather]);

  const onApplyWeather = useCallback(() => {
    if (!selectedSlotHour) return;
    setAppliedSlotHour(selectedSlotHour);
  }, [selectedSlotHour]);

  // ✅ 適用枠を先頭へ（保存にも使う）
  const appliedSlots = useMemo(() => {
    if (!appliedSlotHour) return weatherSlots;
    const arr = [...weatherSlots];
    arr.sort((a, b) => {
      if (a.hour === appliedSlotHour) return -1;
      if (b.hour === appliedSlotHour) return 1;
      return a.hour - b.hour;
    });
    return arr;
  }, [weatherSlots, appliedSlotHour]);

  const appliedSlotObj = useMemo(() => {
    if (!appliedSlotHour) return null;
    return weatherSlots.find((x) => x.hour === appliedSlotHour) ?? null;
  }, [weatherSlots, appliedSlotHour]);

  const onPickSlopeFile = useCallback(() => slopeFileRef.current?.click(), []);
  const onPickPathFile = useCallback(() => pathFileRef.current?.click(), []);

  const onSlopeFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    setSlopeMode("file");
    setSlopeFile(f);
    setSlopeFileName(f.name);
  }, []);

  const onPathFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    setPathMode("file");
    setPathFile(f);
    setPathFileName(f.name);
  }, []);

  const uploadToStorage = useCallback(
    async (file: File, kind: "slope" | "path"): Promise<string> => {
      const ext = extFromName(file.name);
      const path = `ky/${projectId}/${kind}_${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage.from(KY_PHOTO_BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(KY_PHOTO_BUCKET).getPublicUrl(path);
      const url = data?.publicUrl ?? "";
      if (!url) throw new Error("アップロード後のURL取得に失敗しました（Storage公開設定を確認してください）");
      return url;
    },
    [KY_PHOTO_BUCKET, projectId]
  );

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
      let slopeSavedUrl: string | null = null;
      let pathSavedUrl: string | null = null;

      if (slopeMode === "file" && slopeFile) slopeSavedUrl = await uploadToStorage(slopeFile, "slope");
      else if (slopeMode === "url") slopeSavedUrl = slopeUrlFromProject || null;

      if (pathMode === "file" && pathFile) pathSavedUrl = await uploadToStorage(pathFile, "path");
      else if (pathMode === "url") pathSavedUrl = pathUrlFromProject || null;

      const insertPayload: any = {
        project_id: projectId,
        work_date: workDate,
        work_detail: workDetail.trim(),
        hazards: hazards.trim() ? hazards.trim() : null,
        countermeasures: countermeasures.trim() ? countermeasures.trim() : null,
        third_party_level: thirdPartyLevel.trim() ? thirdPartyLevel.trim() : null,
        partner_company_name: partnerCompanyName.trim(),

        // ✅ 適用枠を先頭にした並びで保存（レビューで先頭＝適用枠として使う）
        weather_slots: appliedSlots && appliedSlots.length ? appliedSlots : null,

        worker_count: workerCount.trim() ? Number(workerCount.trim()) : null,

        ai_work_detail: aiWork.trim() ? aiWork.trim() : null,
        ai_hazards: aiHazards.trim() ? aiHazards.trim() : null,
        ai_countermeasures: aiCounter.trim() ? aiCounter.trim() : null,
        ai_third_party: aiThird.trim() ? aiThird.trim() : null,
        ai_supplement: [
          "【AI補足｜作業内容】",
          aiWork.trim(),
          "【AI補足｜危険予知】",
          aiHazards.trim(),
          "【AI補足｜対策】",
          aiCounter.trim(),
          "【AI補足｜第三者】",
          aiThird.trim(),
        ]
          .filter(Boolean)
          .join("\n"),
      };

      const { data: inserted, error: insErr } = await (supabase as any).from("ky_entries").insert(insertPayload).select("id").maybeSingle();
      if (insErr) throw insErr;

      const kyId = s(inserted?.id).trim();
      if (!kyId) throw new Error("保存に失敗しました（kyId不明）");

      const photoRows: any[] = [];
      if (slopeSavedUrl) {
        photoRows.push({
          project_id: projectId,
          ky_id: kyId,
          ky_entry_id: kyId,
          kind: "slope",
          image_url: slopeSavedUrl,
          photo_url: slopeSavedUrl,
        });
      }
      if (pathSavedUrl) {
        photoRows.push({
          project_id: projectId,
          ky_id: kyId,
          ky_entry_id: kyId,
          kind: "path",
          image_url: pathSavedUrl,
          photo_url: pathSavedUrl,
        });
      }

      if (photoRows.length) {
        const { error: photoErr } = await (supabase as any).from("ky_photos").insert(photoRows);
        if (photoErr) throw photoErr;
      }

      setStatus({ type: "success", text: "保存しました" });
      router.push(`/projects/${projectId}/ky`);
      router.refresh();
      setTimeout(() => {
        window.location.href = `/projects/${projectId}/ky`;
      }, 200);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  }, [
    partnerCompanyName,
    workDetail,
    hazards,
    countermeasures,
    thirdPartyLevel,
    projectId,
    workDate,
    appliedSlots,
    aiWork,
    aiHazards,
    aiCounter,
    aiThird,
    router,
    slopeMode,
    pathMode,
    slopeFile,
    pathFile,
    uploadToStorage,
    slopeUrlFromProject,
    pathUrlFromProject,
    workerCount,
  ]);

  const WeatherCard = useCallback(({ slot, appliedHour }: { slot: WeatherSlot; appliedHour: 9 | 12 | 15 | null }) => {
    const isApplied = appliedHour != null && slot.hour === appliedHour;
    return (
      <div className={`rounded-lg border p-3 ${isApplied ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
          {isApplied && <div className="text-xs font-semibold text-emerald-700">適用中</div>}
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
  }, []);

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
          <div className="text-lg font-bold text-slate-900">KY 新規作成</div>
          <div className="mt-1 text-sm text-slate-600">工事件名：{project?.name ?? "（不明）"}</div>
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

      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
        工事情報編集で「通路（定点）停止画URL」を入力してください（未設置なら空欄OK）
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">施工会社（固定）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
          {project?.contractor_name ?? "（未入力）"}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">
          協力会社 <span className="text-rose-600">（必須）</span>
        </div>

        <select
          value={partnerCompanyName}
          onChange={(e) => setPartnerCompanyName(e.target.value)}
          className="relative z-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">選択してください</option>
          {partnerOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.name}
            </option>
          ))}
        </select>

        <div className="text-xs text-slate-500">※ 工事詳細で「入場登録」した会社がここに出ます</div>
        <div className="text-xs text-slate-500">候補数：{partnerOptions.length}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">本日の作業員数</div>
        <input
          type="number"
          inputMode="numeric"
          value={workerCount}
          onChange={(e) => setWorkerCount(String(e.target.value ?? "").replace(/[^\d]/g, ""))}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="例：12"
        />
        <div className="text-xs text-slate-500">※ 半角数字で入力してください</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">日付</div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <div className="text-sm text-slate-600">{fmtDateJp(workDate)}</div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>

        {appliedSlots.length ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {appliedSlots.map((slot) => (
                <WeatherCard key={slot.hour} slot={slot} appliedHour={appliedSlotHour} />
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedSlotHour ?? ""}
                onChange={(e) => setSelectedSlotHour((Number(e.target.value) as any) || null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">選択</option>
                {weatherSlots.map((x) => (
                  <option key={x.hour} value={x.hour}>
                    {x.hour}時
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onApplyWeather}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
              >
                気象を適用
              </button>

              {appliedSlotHour && (
                <div className="text-xs text-slate-600">
                  適用：{appliedSlotHour}時 / {slotSummary(appliedSlotObj)}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-500">（気象が取得できません：工事の緯度経度が未設定の可能性があります）</div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">人の入力</div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">
            作業内容 <span className="text-rose-600">（必須）</span>
          </div>
          <textarea
            value={workDetail}
            onChange={(e) => setWorkDetail(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="例：法面整形、転圧、土砂運搬 など"
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知（1行でもOK）</div>
          <textarea value={hazards} onChange={(e) => setHazards(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策（1行でもOK）</div>
          <textarea value={countermeasures} onChange={(e) => setCountermeasures(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">第三者（墓参者）の状況</div>
        <select value={thirdPartyLevel} onChange={(e) => setThirdPartyLevel(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">選択してください</option>
          <option value="多い">多い</option>
          <option value="少ない">少ない</option>
        </select>
        <div className="text-xs text-slate-500">※ 墓参者の多少に応じて、誘導・区画分離・声掛け等をAI補足に反映します。</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">法面（定点）写真（任意）</div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSlopeMode("url")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            URLで使用
          </button>

          <button type="button" onClick={onPickSlopeFile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            写真をアップロード
          </button>
        </div>

        <input ref={slopeFileRef} type="file" accept="image/*" onChange={onSlopeFileChange} className="hidden" />

        <div className="mt-1 text-sm text-slate-700">
          {slopeMode === "file" && slopeFileName
            ? `選択中：${slopeFileName}`
            : slopeMode === "url"
            ? slopeUrlFromProject
              ? "URLを使用（工事情報編集で設定済み）"
              : "URL未設定（工事情報編集で入力してください）"
            : "ファイル選択  選択されていません"}
        </div>

        {!!slopePrevUrl && (
          <div className="mt-2 text-xs text-slate-600">
            前回写真：<span className="break-all">{slopePrevUrl}</span>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">通路（定点）写真（任意）</div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPathMode("url")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            URLで使用
          </button>

          <button type="button" onClick={onPickPathFile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            写真をアップロード
          </button>
        </div>

        <input ref={pathFileRef} type="file" accept="image/*" onChange={onPathFileChange} className="hidden" />

        <div className="mt-1 text-sm text-slate-700">
          {pathMode === "file" && pathFileName
            ? `選択中：${pathFileName}`
            : pathMode === "url"
            ? pathUrlFromProject
              ? "URLを使用（工事情報編集で設定済み）"
              : "URL未設定（工事情報編集で入力してください）"
            : "ファイル選択  選択されていません"}
        </div>

        {!!pathPrevUrl && (
          <div className="mt-2 text-xs text-slate-600">
            前回写真：<span className="break-all">{pathPrevUrl}</span>
          </div>
        )}
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
        <button type="button" onClick={() => router.push(`/projects/${projectId}/ky`)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          戻る
        </button>

        <button type="button" onClick={onSave} disabled={saving} className={`rounded-lg px-4 py-2 text-sm text-white ${saving ? "bg-slate-400" : "bg-black hover:bg-slate-900"}`}>
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
