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
  return `${w} / 気温${t} / 風${wd} ${ws} / 降水${p}`;
}

function bulletsFromItemsHazards(items: RiskItem[]) {
  return items.map((x) => `・${x.hazard}`).join("\n");
}
function bulletsFromItemsMeasures(items: RiskItem[]) {
  return items.map((x) => `・（${x.rank}）${x.countermeasure}`).join("\n");
}

// ✅ "\\n" を実改行へ（¥n対策）
function normalizeNewlines(text: string) {
  return s(text).replace(/\r\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();
}

function parseBulletLines(text: string): string[] {
  return normalizeNewlines(text)
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[-•・\s]+/, "").trim())
    .filter(Boolean);
}

// ✅ ai_hazards / ai_countermeasures から ai_risk_items を復元
function buildItemsFromTexts(aiHazardsText: string, aiCounterText: string): RiskItem[] {
  const hs = parseBulletLines(aiHazardsText);
  const csRaw = parseBulletLines(aiCounterText);

  // 対策の先頭に（1）等が付いても剥がす
  const cs = csRaw.map((x) => x.replace(/^\(?\d+\)?\s*[）)]?\s*/, "").trim());

  const n = Math.min(5, Math.max(hs.length, 0));
  const items: RiskItem[] = [];
  for (let i = 0; i < n; i++) {
    const hazard = hs[i] || "";
    if (!hazard) continue;
    items.push({
      rank: i + 1,
      hazard,
      countermeasure: cs[i] || "",
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

  // 写真（最小構成）
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

  // AI（正本）
  const [aiRiskItems, setAiRiskItems] = useState<RiskItem[]>([]);
  const [aiProfile] = useState<"strict" | "normal">("strict");

  // 互換（旧カラム用）
  const [aiHazards, setAiHazards] = useState("");
  const [aiCounter, setAiCounter] = useState("");
  const [aiThird, setAiThird] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

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

      if (mountedRef.current) {
        setProject((proj as any) ?? null);
        setPartnerOptions(opts);
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
      if (!res.ok) throw new Error(j?.error || "気象取得に失敗しました");

      const slots = Array.isArray(j?.slots) ? (j.slots as WeatherSlot[]) : [];
      const normalized: WeatherSlot[] = slots
        .filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15))
        .sort((a, b) => a.hour - b.hour);

      setWeatherSlots(normalized);
      setSelectedSlotHour(normalized.length ? normalized[0].hour : null);
      if (!normalized.length) setAppliedSlotHour(null);
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

  // 写真入力
  const onPickSlopeFile = useCallback(() => slopeFileRef.current?.click(), []);
  const onPickPathFile = useCallback(() => pathFileRef.current?.click(), []);

  const onSlopeFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    setSlopeMode("file");
    setSlopeFile(f);
    setSlopeFileName(f.name);
    setSlopeNowUrlCached("");
  }, []);

  const onPathFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    setPathMode("file");
    setPathFile(f);
    setPathFileName(f.name);
    setPathNowUrlCached("");
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

  // ✅ AI生成：レスポンスが揺れても「消えない」ように復元する
  const onGenerateAi = useCallback(async () => {
    setStatus({ type: null, text: "生成中..." });
    setAiGenerating(true);

    try {
      const w = workDetail.trim();
      if (!w) throw new Error("作業内容（必須）を入力してください");

      const res = await fetch("/api/ky-ai-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          workContent: w,
          hazardsText: hazards || "",
          thirdPartyLevel: thirdPartyLevel || "",
          profile: aiProfile,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "AI補足生成に失敗しました");

      // ✅ まず文字列を正規化（¥n/\\n対策）
      const hazText = normalizeNewlines(j?.ai_hazards ?? j?.hazards ?? j?.hazards_text ?? "");
      const meaText = normalizeNewlines(j?.ai_countermeasures ?? j?.countermeasures ?? j?.countermeasures_text ?? "");

      // ✅ items は「配列優先」→ 無ければ文字列から復元
      const apiItemsRaw = Array.isArray(j?.ai_risk_items) ? (j.ai_risk_items as any[]) : [];
      let items: RiskItem[] = apiItemsRaw
        .map((x, idx) => ({
          rank: Number(x?.rank) || idx + 1,
          hazard: s(x?.hazard).trim(),
          countermeasure: s(x?.countermeasure).trim(),
          score: x?.score,
          tags: Array.isArray(x?.tags) ? x.tags : undefined,
        }))
        .filter((x) => x.hazard);

      if (!items.length) {
        items = buildItemsFromTexts(hazText, meaText);
      }

      // ✅ ここ重要：itemsが空なら「消さない」
      if (!items.length) {
        throw new Error("AIの出力が不十分でした（危険予知/対策が空）。もう一度生成してください。");
      }

      setAiRiskItems(items.slice(0, 5));

      // 互換文字列（保存・レビュー用）
      setAiHazards(hazText || bulletsFromItemsHazards(items));
      setAiCounter(meaText || bulletsFromItemsMeasures(items));

      // 第三者（ローカル固定）
      const third = (() => {
        if (thirdPartyLevel === "多い") {
          return [
            "・誘導員を配置し、墓参者の動線を常時監視すること",
            "・作業区画をコーン・バーで明確化し、立入規制を行うこと",
            "・接近があれば作業を一時中断し、安全確保後に再開すること",
          ].join("\n");
        }
        if (thirdPartyLevel === "少ない") {
          return [
            "・出入口付近に注意喚起表示を行い、声掛けを徹底すること",
            "・接近時は作業を一時停止し、誘導して安全を確保すること",
          ].join("\n");
        }
        return "";
      })();
      setAiThird(third);

      setStatus({ type: "success", text: "AI補足を生成しました" });
    } catch (e: any) {
      // ✅ エラー時に aiRiskItems を空にしない（消さない）
      setStatus({ type: "error", text: e?.message ?? "AI補足生成に失敗しました" });
    } finally {
      setAiGenerating(false);
    }
  }, [workDetail, hazards, thirdPartyLevel, aiProfile]);

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

  // ✅ 保存：/api/ky-create 経由（kyIdを受け取ってレビューへ）
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
        else if (slopeMode === "url") slopeSavedUrl = slopeUrlFromProject || null;
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

        work_content: workDetail.trim(),
        hazards: hazards.trim() ? hazards.trim() : null,
        countermeasures: countermeasures.trim() ? countermeasures.trim() : null,
        third_party_level: thirdPartyLevel.trim() ? thirdPartyLevel.trim() : null,

        weather_slots: appliedSlots && appliedSlots.length ? appliedSlots : null,

        ai_work_detail: null,
        ai_hazards: aiHazards.trim() ? aiHazards.trim() : null,
        ai_countermeasures: aiCounter.trim() ? aiCounter.trim() : null,
        ai_third_party: aiThird.trim() ? aiThird.trim() : null,

        ai_risk_items: aiRiskItems.length ? aiRiskItems.slice(0, 5) : null,
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
      if (!resp.ok) throw new Error(jr?.error || "保存に失敗しました");

      const kyId = s(jr?.kyId).trim();
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

      setStatus({ type: "success", text: "保存しました（レビューへ移動）" });
      router.push(`/projects/${projectId}/ky/${kyId}/review`);
      router.refresh();
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
    aiHazards,
    aiCounter,
    aiThird,
    aiRiskItems,
    workerCount,
    router,
    slopeMode,
    pathMode,
    slopeFile,
    pathFile,
    uploadToStorage,
    slopeUrlFromProject,
    pathUrlFromProject,
    slopeNowUrlCached,
    pathNowUrlCached,
  ]);

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
            placeholder="例：舗装工（表層工 アスファルト舗設）など"
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">写真（任意）</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-xs text-slate-600">法面（今回）</div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => { setSlopeMode("url"); setSlopeFile(null); setSlopeFileName(""); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                定点URLを使う
              </button>
              <button type="button" onClick={onPickSlopeFile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                ファイル選択
              </button>
              <button type="button" onClick={() => { setSlopeMode("none"); setSlopeFile(null); setSlopeFileName(""); setSlopeNowUrlCached(""); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                なし
              </button>
            </div>
            <div className="text-xs text-slate-500">
              {slopeMode === "url" ? `URL：${slopeUrlFromProject || "（未設定）"}` : slopeMode === "file" ? `ファイル：${slopeFileName}` : "（なし）"}
            </div>
            <input ref={slopeFileRef} type="file" accept="image/*" className="hidden" onChange={onSlopeFileChange} />
          </div>

          <div className="space-y-2">
            <div className="text-xs text-slate-600">通路（今回）</div>
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => { setPathMode("url"); setPathFile(null); setPathFileName(""); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                定点URLを使う
              </button>
              <button type="button" onClick={onPickPathFile} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                ファイル選択
              </button>
              <button type="button" onClick={() => { setPathMode("none"); setPathFile(null); setPathFileName(""); setPathNowUrlCached(""); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
                なし
              </button>
            </div>
            <div className="text-xs text-slate-500">
              {pathMode === "url" ? `URL：${pathUrlFromProject || "（未設定）"}` : pathMode === "file" ? `ファイル：${pathFileName}` : "（なし）"}
            </div>
            <input ref={pathFileRef} type="file" accept="image/*" className="hidden" onChange={onPathFileChange} />
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
            {aiGenerating ? "生成中..." : "AI補足を生成"}
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足（上位5・リスク順）</div>
          {aiRiskItems.length ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                {aiRiskItems.slice(0, 5).map((x) => (
                  <li key={`h-${x.rank}`}>{x.hazard}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足（危険予知に対応：1対1）</div>
          {aiRiskItems.length ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3">
              <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                {aiRiskItems.slice(0, 5).map((x) => (
                  <li key={`m-${x.rank}`}>
                    <span className="font-semibold">（{x.rank}）</span>
                    {x.countermeasure}
                  </li>
                ))}
              </ul>
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
