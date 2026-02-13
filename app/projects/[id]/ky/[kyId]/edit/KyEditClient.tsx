// app/projects/[id]/ky/[kyId]/edit/KyEditClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function splitAiCombined(text: string): { work: string; hazards: string; countermeasures: string; third: string } {
  const src = (text || "").trim();
  if (!src) return { work: "", hazards: "", countermeasures: "", third: "" };

  const makeBracketRe = (label: string) =>
    new RegExp(String.raw`(?:^|\n)\s*(?:[•・\-*]\s*)?[【\[]\s*AI補足\s*[｜|]\s*${label}\s*[】\]]`, "g");

  const headings: Array<{ key: "work" | "hazards" | "countermeasures" | "third"; re: RegExp }> = [
    { key: "work", re: makeBracketRe("作業内容") },
    { key: "hazards", re: makeBracketRe("危険予知") },
    { key: "countermeasures", re: makeBracketRe("対策") },
    { key: "third", re: makeBracketRe("第三者(?:\\s*（\\s*墓参者\\s*）)?") },
    { key: "work", re: /(?:^|\n)\s*(作業内容)\s*[:：]/g },
    { key: "hazards", re: /(?:^|\n)\s*(危険予知)\s*[:：]/g },
    { key: "countermeasures", re: /(?:^|\n)\s*(対策)\s*[:：]/g },
    { key: "third", re: /(?:^|\n)\s*(第三者|墓参者)\s*[:：]/g },
  ];

  const marks: Array<{ idx: number; key: "work" | "hazards" | "countermeasures" | "third"; len: number }> = [];
  for (const h of headings) {
    let m: RegExpExecArray | null;
    h.re.lastIndex = 0;
    while ((m = h.re.exec(src))) marks.push({ idx: m.index, key: h.key, len: m[0].length });
  }
  marks.sort((a, b) => a.idx - b.idx);

  if (!marks.length) return { work: src, hazards: "", countermeasures: "", third: "" };

  const out = { work: "", hazards: "", countermeasures: "", third: "" };
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const next = marks[i + 1];
    const start = cur.idx + cur.len;
    const end = next ? next.idx : src.length;
    const chunk = src.slice(start, end).trim();
    if (!chunk) continue;
    (out as any)[cur.key] = (out as any)[cur.key] ? `${(out as any)[cur.key]}\n${chunk}` : chunk;
  }
  return out;
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

export default function KyEditClient() {
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
  const [saving, setSaving] = useState(false);

  const [project, setProject] = useState<Project | null>(null);
  const [ky, setKy] = useState<KyEntry | null>(null);

  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>([]);

  const [workDate, setWorkDate] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [partnerCompanyName, setPartnerCompanyName] = useState<string>("");
  const [workerCount, setWorkerCount] = useState<string>("");

  const [workDetail, setWorkDetail] = useState("");
  const [hazards, setHazards] = useState("");
  const [countermeasures, setCountermeasures] = useState("");
  const [thirdPartyLevel, setThirdPartyLevel] = useState<string>("");

  const [weatherSlots, setWeatherSlots] = useState<WeatherSlot[]>([]);
  const [selectedSlotHour, setSelectedSlotHour] = useState<9 | 12 | 15 | null>(null);
  const [appliedSlotHour, setAppliedSlotHour] = useState<9 | 12 | 15 | null>(null);

  const [aiWork, setAiWork] = useState("");
  const [aiHazards, setAiHazards] = useState("");
  const [aiCounter, setAiCounter] = useState("");
  const [aiThird, setAiThird] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // 写真（編集は「追加アップロード」のみ：既存は保持）
  const KY_PHOTO_BUCKET = process.env.NEXT_PUBLIC_KY_PHOTO_BUCKET || "ky-photos";
  const slopeFileRef = useRef<HTMLInputElement | null>(null);
  const pathFileRef = useRef<HTMLInputElement | null>(null);
  const [slopeFile, setSlopeFile] = useState<File | null>(null);
  const [pathFile, setPathFile] = useState<File | null>(null);
  const [slopeFileName, setSlopeFileName] = useState("");
  const [pathFileName, setPathFileName] = useState("");

  const [kySlopeLatestUrl, setKySlopeLatestUrl] = useState<string>("");
  const [kyPathLatestUrl, setKyPathLatestUrl] = useState<string>("");

  const slopeUrlFromProject = useMemo(() => s(project?.slope_camera_snapshot_url).trim(), [project?.slope_camera_snapshot_url]);
  const pathUrlFromProject = useMemo(() => s(project?.path_camera_snapshot_url).trim(), [project?.path_camera_snapshot_url]);

  const fetchInitial = useCallback(async () => {
    if (!projectId || !kyId) return;

    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data: proj, error: projErr } = await (supabase as any)
        .from("projects")
        .select("id,name,contractor_name,lat,lon,slope_camera_snapshot_url,path_camera_snapshot_url")
        .eq("id", projectId)
        .maybeSingle();
      if (projErr) throw projErr;

      const { data: kyRow, error: kyErr } = await (supabase as any)
        .from("ky_entries")
        .select(
          "id,project_id,work_date,title,partner_company_name,worker_count,work_detail,hazards,countermeasures,third_party_level,weather_slots,ai_work_detail,ai_hazards,ai_countermeasures,ai_third_party,ai_supplement"
        )
        .eq("id", kyId)
        .maybeSingle();
      if (kyErr) throw kyErr;
      if (!kyRow) throw new Error("KYが見つかりません");

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

      // ky_photos：KYに紐づく最新（無ければプロジェクト定点URL）
      const { data: photos, error: pErr } = await (supabase as any)
        .from("ky_photos")
        .select("*")
        .eq("project_id", projectId)
        .eq("ky_id", kyId)
        .order("created_at", { ascending: false })
        .limit(50);

      let slopeLatest = "";
      let pathLatest = "";
      if (!pErr && Array.isArray(photos)) {
        for (const p of photos) {
          const kind = pickKind(p);
          const url = pickUrl(p);
          if (!url) continue;
          if (!slopeLatest && (kind === "slope" || kind === "法面" || kind === "slope_photo" || kind === "")) slopeLatest = url;
          if (!pathLatest && (kind === "path" || kind === "通路" || kind === "path_photo" || kind === "")) pathLatest = url;
          if (slopeLatest && pathLatest) break;
        }
      }

      if (!mountedRef.current) return;

      setProject((proj as any) ?? null);
      setKy((kyRow as any) ?? null);
      setPartnerOptions(opts);

      setWorkDate(s(kyRow.work_date) || "");
      setTitle(s(kyRow.title) || "");
      setPartnerCompanyName(s(kyRow.partner_company_name) || "");
      setWorkerCount(kyRow.worker_count == null ? "" : String(kyRow.worker_count));

      setWorkDetail(s(kyRow.work_detail) || "");
      setHazards(s(kyRow.hazards) || "");
      setCountermeasures(s(kyRow.countermeasures) || "");
      setThirdPartyLevel(s(kyRow.third_party_level) || "");

      setAiWork(s(kyRow.ai_work_detail) || "");
      setAiHazards(s(kyRow.ai_hazards) || "");
      setAiCounter(s(kyRow.ai_countermeasures) || "");
      setAiThird(s(kyRow.ai_third_party) || "");

      // weather_slots：先頭＝適用枠（仕様）
      const slots = Array.isArray(kyRow.weather_slots) ? (kyRow.weather_slots as WeatherSlot[]) : [];
      const normalized = slots
        .filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15))
        .sort((a, b) => a.hour - b.hour);

      // 保存順序が「適用枠先頭」なので、そのまま表示したい：ただし UIの一覧は3枠でOK
      // ここでは「表示用」は昇順、適用枠は kyRow.weather_slots[0].hour を採用
      setWeatherSlots(normalized);

      const appliedHour = (Array.isArray(kyRow.weather_slots) && kyRow.weather_slots[0]?.hour) as any;
      const applied = appliedHour === 9 || appliedHour === 12 || appliedHour === 15 ? appliedHour : null;
      setAppliedSlotHour(applied);
      setSelectedSlotHour(applied ?? (normalized[0]?.hour ?? null));

      setKySlopeLatestUrl(slopeLatest || "");
      setKyPathLatestUrl(pathLatest || "");
    } catch (e: any) {
      if (mountedRef.current) setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId, kyId]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  // ✅ workDate変更時：気象を再取得（lat/lon必須）
  const fetchWeather = useCallback(async () => {
    const lat = project?.lat ?? null;
    const lon = project?.lon ?? null;
    if (lat == null || lon == null || !workDate) return;

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
      if (normalized.length && !selectedSlotHour) setSelectedSlotHour(normalized[0].hour);
    } catch {
      // 取得失敗でも既存表示は残す（編集の邪魔をしない）
    }
  }, [project?.lat, project?.lon, workDate, selectedSlotHour]);

  useEffect(() => {
    if (!project || !workDate) return;
    fetchWeather();
  }, [fetchWeather, project, workDate]);

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

  const uploadToStorage = useCallback(
    async (file: File, kind: "slope" | "path"): Promise<string> => {
      const ext = extFromName(file.name);
      const path = `ky/${projectId}/${kyId}/${kind}_${Date.now()}.${ext}`;

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
    [KY_PHOTO_BUCKET, projectId, kyId]
  );

  const onPickSlopeFile = useCallback(() => slopeFileRef.current?.click(), []);
  const onPickPathFile = useCallback(() => pathFileRef.current?.click(), []);

  const onSlopeFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    setSlopeFile(f);
    setSlopeFileName(f.name);
  }, []);

  const onPathFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    setPathFile(f);
    setPathFileName(f.name);
  }, []);

  const buildAiPayload = useCallback(async () => {
    const w = workDetail.trim();
    if (!w) throw new Error("作業内容（必須）を入力してください");

    // 編集は「KYに紐づく最新写真（あれば）」＋「追加アップロード（選択時）」をAIへ渡す
    let slopeNowUrl: string | null = kySlopeLatestUrl || slopeUrlFromProject || null;
    let pathNowUrl: string | null = kyPathLatestUrl || pathUrlFromProject || null;

    if (slopeFile) slopeNowUrl = await uploadToStorage(slopeFile, "slope");
    if (pathFile) pathNowUrl = await uploadToStorage(pathFile, "path");

    const slotsForAi = (appliedSlots || []).map((x) => ({
      hour: x.hour,
      weather_text: x.weather_text,
      temperature_c: x.temperature_c ?? null,
      wind_direction_deg: x.wind_direction_deg ?? null,
      wind_speed_ms: x.wind_speed_ms ?? null,
      precipitation_mm: x.precipitation_mm ?? null,
    }));

    const lat = project?.lat ?? null;
    const lon = project?.lon ?? null;

    return {
      work_detail: w,
      hazards: hazards.trim() ? hazards.trim() : null,
      countermeasures: countermeasures.trim() ? countermeasures.trim() : null,
      third_party_level: thirdPartyLevel.trim() ? thirdPartyLevel.trim() : null,

      worker_count: workerCount.trim() ? Number(workerCount.trim()) : null,

      lat,
      lon,

      weather_slots: slotsForAi.length ? slotsForAi : null,
      slope_photo_url: slopeNowUrl,
      slope_prev_photo_url: kySlopeLatestUrl || null,
      path_photo_url: pathNowUrl,
      path_prev_photo_url: kyPathLatestUrl || null,
    };
  }, [
    workDetail,
    hazards,
    countermeasures,
    thirdPartyLevel,
    workerCount,
    appliedSlots,
    slopeFile,
    pathFile,
    uploadToStorage,
    project?.lat,
    project?.lon,
    kySlopeLatestUrl,
    kyPathLatestUrl,
    slopeUrlFromProject,
    pathUrlFromProject,
  ]);

  const onGenerateAi = useCallback(async () => {
    setStatus({ type: null, text: "生成中..." });
    setAiGenerating(true);

    try {
      const payload = await buildAiPayload();

      const res = await fetch("/api/ky-ai-supplement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "AI補足生成に失敗しました");

      const w = normalizeText(s(j?.ai_work_detail));
      const h = normalizeText(s(j?.ai_hazards));
      const c = normalizeText(s(j?.ai_countermeasures));
      const t = normalizeText(s(j?.ai_third_party));

      if (w || h || c || t) {
        setAiWork(w);
        setAiHazards(h);
        setAiCounter(c);
        setAiThird(t);
      } else {
        const combined = normalizeText(s(j?.ai_supplement));
        const split = splitAiCombined(combined);

        setAiWork(normalizeText(split.work));
        setAiHazards(normalizeText(split.hazards));
        setAiCounter(normalizeText(split.countermeasures));
        setAiThird(normalizeText(split.third));
      }

      setStatus({ type: "success", text: "AI補足を生成しました" });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "AI補足生成に失敗しました" });
    } finally {
      setAiGenerating(false);
    }
  }, [buildAiPayload]);

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
    if (!workDate.trim()) {
      setStatus({ type: "error", text: "日付が不正です" });
      return;
    }

    setSaving(true);
    try {
      // 追加アップロードが選択されていたら ky_photos に追加
      const newPhotoRows: any[] = [];
      if (slopeFile) {
        const url = await uploadToStorage(slopeFile, "slope");
        newPhotoRows.push({
          project_id: projectId,
          ky_id: kyId,
          ky_entry_id: kyId,
          kind: "slope",
          image_url: url,
          photo_url: url,
        });
      }
      if (pathFile) {
        const url = await uploadToStorage(pathFile, "path");
        newPhotoRows.push({
          project_id: projectId,
          ky_id: kyId,
          ky_entry_id: kyId,
          kind: "path",
          image_url: url,
          photo_url: url,
        });
      }
      if (newPhotoRows.length) {
        const { error: photoErr } = await (supabase as any).from("ky_photos").insert(newPhotoRows);
        if (photoErr) throw photoErr;
      }

      const updatePayload: any = {
        work_date: workDate,
        title: title.trim() ? title.trim() : null,

        partner_company_name: partnerCompanyName.trim(),
        worker_count: workerCount.trim() ? Number(workerCount.trim()) : null,

        work_detail: workDetail.trim(),
        hazards: hazards.trim() ? hazards.trim() : null,
        countermeasures: countermeasures.trim() ? countermeasures.trim() : null,
        third_party_level: thirdPartyLevel.trim() ? thirdPartyLevel.trim() : null,

        // ✅ 適用枠先頭で保存（レビューは先頭＝適用枠として表示）
        weather_slots: appliedSlots && appliedSlots.length ? appliedSlots : null,

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

      const { error: upErr } = await (supabase as any).from("ky_entries").update(updatePayload).eq("id", kyId);
      if (upErr) throw upErr;

      setStatus({ type: "success", text: "保存しました" });

      // 編集後はレビューへ
      router.push(`/projects/${projectId}/ky/${kyId}/review`);
      router.refresh();
      setTimeout(() => {
        window.location.href = `/projects/${projectId}/ky/${kyId}/review`;
      }, 200);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  }, [
    projectId,
    kyId,
    partnerCompanyName,
    workerCount,
    workDetail,
    hazards,
    countermeasures,
    thirdPartyLevel,
    workDate,
    title,
    appliedSlots,
    aiWork,
    aiHazards,
    aiCounter,
    aiThird,
    router,
    slopeFile,
    pathFile,
    uploadToStorage,
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

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">KY 編集</div>
          <div className="mt-1 text-sm text-slate-600">工事件名：{project?.name ?? "（不明）"}</div>
          <div className="mt-1 text-xs text-slate-500">KY ID：{kyId}</div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky/${kyId}/review`}>
            レビューへ
          </Link>
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky`}>
            KY一覧へ
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">施工会社（固定）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{project?.contractor_name ?? "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">日付</div>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
          <div className="text-sm text-slate-600">{workDate ? fmtDateJp(workDate) : ""}</div>
        </div>
        <div className="text-xs text-slate-500">※ 日付変更すると気象も再取得します（工事の緯度経度が必要）</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>

        {weatherSlots.length ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {weatherSlots.map((slot) => (
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

              <button type="button" onClick={onApplyWeather} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">協力会社 <span className="text-rose-600">（必須）</span></div>
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
        <div className="text-xs text-slate-500">※ 工事詳細で「入場登録」した会社が候補に出ます</div>
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
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">タイトル（任意）</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="未入力の場合、作業内容がタイトルとして表示されます"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">人の入力</div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">
            作業内容 <span className="text-rose-600">（必須）</span>
          </div>
          <textarea value={workDetail} onChange={(e) => setWorkDetail(e.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
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
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-800">写真（追加アップロード：任意）</div>
          <div className="text-xs text-slate-500">※ 既存写真は保持、選択分だけ追加します</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-sm font-semibold text-slate-800">法面（定点）</div>
            <div className="text-xs text-slate-600 break-all">現在（KY最新）：{kySlopeLatestUrl || "（なし）"}</div>
            <div className="text-xs text-slate-600 break-all">工事URL：{slopeUrlFromProject || "（なし）"}</div>
            <button type="button" onClick={onPickSlopeFile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              法面写真を選択
            </button>
            <input ref={slopeFileRef} type="file" accept="image/*" onChange={onSlopeFileChange} className="hidden" />
            <div className="text-xs text-slate-600">{slopeFileName ? `選択中：${slopeFileName}` : "未選択"}</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="text-sm font-semibold text-slate-800">通路（定点）</div>
            <div className="text-xs text-slate-600 break-all">現在（KY最新）：{kyPathLatestUrl || "（なし）"}</div>
            <div className="text-xs text-slate-600 break-all">工事URL：{pathUrlFromProject || "（なし）"}</div>
            <button type="button" onClick={onPickPathFile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              通路写真を選択
            </button>
            <input ref={pathFileRef} type="file" accept="image/*" onChange={onPathFileChange} className="hidden" />
            <div className="text-xs text-slate-600">{pathFileName ? `選択中：${pathFileName}` : "未選択"}</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-800">AI補足（項目別）</div>
          <button
            type="button"
            onClick={onGenerateAi}
            disabled={aiGenerating}
            className={`rounded-lg border px-3 py-2 text-sm ${aiGenerating ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"}`}
          >
            {aiGenerating ? "生成中..." : "AI補足を再生成"}
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">作業内容の補足</div>
          <textarea value={aiWork} onChange={(e) => setAiWork(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足</div>
          <textarea value={aiHazards} onChange={(e) => setAiHazards(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足</div>
          <textarea value={aiCounter} onChange={(e) => setAiCounter(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足</div>
          <textarea value={aiThird} onChange={(e) => setAiThird(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>
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
        <button type="button" onClick={() => router.push(`/projects/${projectId}/ky/${kyId}/review`)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          戻る（レビュー）
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={`rounded-lg px-4 py-2 text-sm text-white ${saving ? "bg-slate-400" : "bg-black hover:bg-slate-900"}`}
        >
          {saving ? "保存中..." : "保存してレビューへ"}
        </button>
      </div>
    </div>
  );
}
