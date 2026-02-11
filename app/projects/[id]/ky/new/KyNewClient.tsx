// app/projects/[id]/ky/new/KyNewClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

type PartnerOption = { value: string; name: string; uuid: string | null };

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
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "—";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}

function weatherCodeToText(code: number | null): string {
  const c = code ?? -1;
  if (c === 0) return "快晴";
  if (c === 1) return "晴れ";
  if (c === 2) return "薄曇り";
  if (c === 3) return "曇り";
  if (c === 45 || c === 48) return "霧";
  if (c === 51 || c === 53 || c === 55) return "霧雨";
  if (c === 56 || c === 57) return "着氷性霧雨";
  if (c === 61 || c === 63 || c === 65) return "雨";
  if (c === 66 || c === 67) return "着氷性の雨";
  if (c === 71 || c === 73 || c === 75) return "雪";
  if (c === 77) return "霧雪";
  if (c === 80 || c === 81 || c === 82) return "にわか雨";
  if (c === 85 || c === 86) return "にわか雪";
  if (c === 95) return "雷雨";
  if (c === 96 || c === 99) return "雷雨（雹）";
  return "—";
}

function clampInt(v: string, min: number, max: number): number | null {
  const t = s(v).trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  const x = Math.floor(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function buildSlotText(slot: WeatherSlot): string {
  const temp = slot.temperature_c != null ? `${slot.temperature_c}℃` : "—";
  const wind = slot.wind_speed_ms != null ? `${degToDirJp(slot.wind_direction_deg)} ${slot.wind_speed_ms}m/s` : "—";
  const rain = slot.precipitation_mm != null ? `${slot.precipitation_mm}mm` : "—";
  return `${slot.hour}時 ${slot.weather_text || "—"} / 気温:${temp} / 風:${wind} / 降水:${rain}`;
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

function buildNotesPayload(args: {
  workDetail: string;
  hazards: string;
  countermeasures: string;
  thirdPartyLevel: string;
  workerCount: number | null;
  weatherApplied: boolean;
  weatherAppliedHour: 9 | 12 | 15 | null;
  weatherSlots: WeatherSlot[];
  aiWork: string;
  aiHazards: string;
  aiMeasures: string;
  aiThird: string;
}): string | null {
  const lines: string[] = [];

  const w = s(args.workDetail).trim();
  const h = s(args.hazards).trim();
  const c = s(args.countermeasures).trim();
  const t = s(args.thirdPartyLevel).trim();

  if (args.workerCount != null) lines.push(`【作業員数】\n${args.workerCount} 名`);
  if (t) lines.push(`【第三者（墓参者）】\n${t}`);

  if (args.weatherApplied && args.weatherAppliedHour != null) {
    const slot = args.weatherSlots.find((x) => x.hour === args.weatherAppliedHour);
    if (slot) lines.push(`【気象（適用）】\n${buildSlotText(slot)}`);
    else lines.push(`【気象（適用）】\n${args.weatherAppliedHour}時（詳細なし）`);
  }

  if (w) lines.push(`【作業内容】\n${w}`);
  if (h) lines.push(`【危険予知】\n${h}`);
  if (c) lines.push(`【対策】\n${c}`);

  const ai1 = s(args.aiWork).trim();
  const ai2 = s(args.aiHazards).trim();
  const ai3 = s(args.aiMeasures).trim();
  const ai4 = s(args.aiThird).trim();

  if (ai1) lines.push(`【AI補足｜作業内容】\n${ai1}`);
  if (ai2) lines.push(`【AI補足｜危険予知】\n${ai2}`);
  if (ai3) lines.push(`【AI補足｜対策】\n${ai3}`);
  if (ai4) lines.push(`【AI補足｜第三者】\n${ai4}`);

  const text = lines.filter(Boolean).join("\n\n").trim();
  return text ? text : null;
}

export default function KyNewClient() {
  const params = useParams() as { id?: string };
  const router = useRouter();
  const projectId = useMemo(() => String(params?.id ?? ""), [params?.id]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  const [project, setProject] = useState<Project | null>(null);
  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>([]);

  const [workDate, setWorkDate] = useState<string>(() => {
    const d = new Date();
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  });

  const [partnerCompany, setPartnerCompany] = useState<string>("");
  const [thirdPartyLevel, setThirdPartyLevel] = useState<string>("");
  const [workerCountText, setWorkerCountText] = useState<string>("");
  const workerCountNum = useMemo(() => clampInt(workerCountText, 0, 9999), [workerCountText]);

  const [workDetail, setWorkDetail] = useState<string>("");
  const [hazards, setHazards] = useState<string>("");
  const [countermeasures, setCountermeasures] = useState<string>("");

  const [weatherSlots, setWeatherSlots] = useState<WeatherSlot[]>([]);
  const [weatherAppliedHour, setWeatherAppliedHour] = useState<9 | 12 | 15 | null>(null);
  const [weatherApplied, setWeatherApplied] = useState<boolean>(false);

  const [aiWork, setAiWork] = useState<string>("");
  const [aiHazards, setAiHazards] = useState<string>("");
  const [aiMeasures, setAiMeasures] = useState<string>("");
  const [aiThird, setAiThird] = useState<string>("");

  const statusClass = useMemo(() => {
    if (status.type === "success") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    if (status.type === "error") return "border border-rose-200 bg-rose-50 text-rose-800";
    return "border border-slate-200 bg-slate-50 text-slate-700";
  }, [status.type]);

  // 初期ロード：Project / 協力会社
  const load = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data: pRow, error: pErr } = await supabase
        .from("projects")
        .select("id,name,contractor_name,lat,lon,slope_camera_snapshot_url,path_camera_snapshot_url")
        .eq("id", projectId)
        .maybeSingle();

      if (pErr) throw pErr;
      setProject((pRow as any) ?? null);

      // ✅ 型定義に無いテーブルは any 経由で呼ぶ（これが今回のTSエラー原因）
      const sb: any = supabase;

      const { data: partners, error: paErr } = await sb
        .from("project_partner_entries")
        .select("id, partner_company_name, partner_company_id")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (!paErr && Array.isArray(partners)) {
        const opts: PartnerOption[] = partners
          .map((r: any) => ({
            value: s(r?.partner_company_id).trim() || s(r?.partner_company_name).trim(),
            name: s(r?.partner_company_name).trim() || "（不明）",
            uuid: s(r?.partner_company_id).trim() || null,
          }))
          .filter((x) => !!x.name);

        setPartnerOptions(opts);
        if (!partnerCompany && opts.length) setPartnerCompany(opts[0].name);
      } else {
        setPartnerOptions([]);
      }
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  }, [projectId, partnerCompany]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchWeather = useCallback(async () => {
    setStatus({ type: null, text: "" });
    setWeatherApplied(false);
    setWeatherAppliedHour(null);

    const lat = project?.lat;
    const lon = project?.lon;
    if (lat == null || lon == null) {
      setWeatherSlots([]);
      setStatus({ type: "error", text: "プロジェクトに緯度・経度がありません（気象を自動取得できません）。" });
      return;
    }

    try {
      const tz = "Asia%2FTokyo";
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(lat))}` +
        `&longitude=${encodeURIComponent(String(lon))}` +
        `&hourly=temperature_2m,precipitation,weathercode,windspeed_10m,winddirection_10m` +
        `&timezone=${tz}`;

      const res = await fetch(url, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));

      const times: string[] = Array.isArray(j?.hourly?.time) ? j.hourly.time : [];
      const temps: any[] = Array.isArray(j?.hourly?.temperature_2m) ? j.hourly.temperature_2m : [];
      const rains: any[] = Array.isArray(j?.hourly?.precipitation) ? j.hourly.precipitation : [];
      const codes: any[] = Array.isArray(j?.hourly?.weathercode) ? j.hourly.weathercode : [];
      const winds: any[] = Array.isArray(j?.hourly?.windspeed_10m) ? j.hourly.windspeed_10m : [];
      const dirs: any[] = Array.isArray(j?.hourly?.winddirection_10m) ? j.hourly.winddirection_10m : [];

      const dateKey = s(workDate).trim();
      const wanted = [9, 12, 15] as const;

      const slots: WeatherSlot[] = [];
      for (const hour of wanted) {
        const key = `${dateKey}T${String(hour).padStart(2, "0")}:00`;
        const idx = times.findIndex((t) => s(t).startsWith(key));
        if (idx < 0) {
          slots.push({
            hour,
            time_iso: `${dateKey}T${String(hour).padStart(2, "0")}:00`,
            weather_text: "—",
            temperature_c: null,
            wind_direction_deg: null,
            wind_speed_ms: null,
            precipitation_mm: null,
            weather_code: null,
          });
          continue;
        }
        const code = Number(codes[idx]);
        slots.push({
          hour,
          time_iso: s(times[idx]),
          weather_text: weatherCodeToText(Number.isFinite(code) ? code : null),
          temperature_c: Number.isFinite(Number(temps[idx])) ? Number(temps[idx]) : null,
          wind_direction_deg: Number.isFinite(Number(dirs[idx])) ? Number(dirs[idx]) : null,
          wind_speed_ms: Number.isFinite(Number(winds[idx])) ? Number(winds[idx]) : null,
          precipitation_mm: Number.isFinite(Number(rains[idx])) ? Number(rains[idx]) : null,
          weather_code: Number.isFinite(code) ? code : null,
        });
      }

      setWeatherSlots(slots);
      setStatus({ type: "success", text: "気象を取得しました（9/12/15）。" });
    } catch (e: any) {
      setWeatherSlots([]);
      setStatus({ type: "error", text: e?.message ?? "気象の取得に失敗しました" });
    }
  }, [project?.lat, project?.lon, workDate]);

  const onApplyWeather = useCallback(() => {
    if (!weatherSlots.length) return;
    if (weatherAppliedHour == null) {
      setStatus({ type: "error", text: "気象の適用時間（9/12/15）を選択してください。" });
      return;
    }
    setWeatherApplied(true);
    setStatus({ type: "success", text: "気象を適用しました。" });
  }, [weatherSlots.length, weatherAppliedHour]);

  const onGenerateAi = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const wd = s(workDetail).trim();
    if (!wd) {
      setStatus({ type: "error", text: "作業内容を入力してからAI補足を生成してください。" });
      return;
    }

    setAiGenerating(true);
    try {
      const payload = {
        work_detail: s(workDetail).trim() || null,
        hazards: s(hazards).trim() || null,
        countermeasures: s(countermeasures).trim() || null,
        third_party_level: s(thirdPartyLevel).trim() || null,
        weather_slots: Array.isArray(weatherSlots) ? weatherSlots : null,
      };

      const data = await postJsonTry(["/api/ky-ai-supplement"], payload);

      setAiWork(s(data?.ai_work_detail).trim());
      setAiHazards(s(data?.ai_hazards).trim());
      setAiMeasures(s(data?.ai_countermeasures).trim());
      setAiThird(s(data?.ai_third_party).trim());

      setStatus({ type: "success", text: "AI補足を生成しました。" });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "AI補足の生成に失敗しました" });
    } finally {
      setAiGenerating(false);
    }
  }, [workDetail, hazards, countermeasures, thirdPartyLevel, weatherSlots]);

  const onSave = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const wd = s(workDate).trim();
    if (!wd) {
      setStatus({ type: "error", text: "日付を入力してください。" });
      return;
    }
    const pc = s(partnerCompany).trim();
    if (!pc) {
      setStatus({ type: "error", text: "協力会社（必須）を選択してください。" });
      return;
    }

    setActing(true);
    try {
      const notes = buildNotesPayload({
        workDetail,
        hazards,
        countermeasures,
        thirdPartyLevel,
        workerCount: workerCountNum,
        weatherApplied,
        weatherAppliedHour,
        weatherSlots,
        aiWork,
        aiHazards,
        aiMeasures,
        aiThird,
      });

      // ✅ DB実在カラムだけ
      const ins = {
        project_id: projectId,
        work_date: wd,
        partner_company_name: pc,
        worker_count: workerCountNum,
        weather_applied_slot: weatherApplied && weatherAppliedHour != null ? weatherAppliedHour : null,
        notes: notes,
      };

      const { data: kyRow, error: kyErr } = await supabase.from("ky_entries").insert(ins as any).select("id").maybeSingle();
      if (kyErr) throw kyErr;

      const kyId = s((kyRow as any)?.id).trim();
      if (!kyId) throw new Error("保存はできましたが、KY IDが取得できませんでした。");

      setStatus({ type: "success", text: "保存しました。" });
      router.push(`/projects/${projectId}/ky`);
      router.refresh();
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "保存に失敗しました" });
    } finally {
      setActing(false);
    }
  }, [
    projectId,
    workDate,
    partnerCompany,
    workerCountNum,
    thirdPartyLevel,
    workDetail,
    hazards,
    countermeasures,
    weatherApplied,
    weatherAppliedHour,
    weatherSlots,
    aiWork,
    aiHazards,
    aiMeasures,
    aiThird,
    router,
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
          <div className="mt-1 text-sm text-slate-600">
            工事：{project?.name ?? "（不明）"} ／ 日付：{workDate ? fmtDateJp(workDate) : "（未入力）"}
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky`}>
            KY一覧へ
          </Link>
        </div>
      </div>

      {!!status.text && <div className={`rounded-lg px-3 py-2 text-sm ${statusClass}`}>{status.text}</div>}

      {/* 日付 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">日付</div>
        <input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
      </div>

      {/* 施工会社（固定） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">施工会社（固定）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{project?.contractor_name ?? "（未入力）"}</div>
      </div>

      {/* 協力会社（必須） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">
          協力会社 <span className="text-rose-600">（必須）</span>
        </div>

        {partnerOptions.length ? (
          <select value={partnerCompany} onChange={(e) => setPartnerCompany(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            {partnerOptions.map((o) => (
              <option key={`${o.value}-${o.name}`} value={o.name}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={partnerCompany}
            onChange={(e) => setPartnerCompany(e.target.value)}
            placeholder="協力会社名を入力（名簿が無い場合）"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
        )}
      </div>

      {/* 第三者（墓参者） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">第三者（墓参者）</div>
        <select value={thirdPartyLevel} onChange={(e) => setThirdPartyLevel(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">（選択）</option>
          <option value="少ない">少ない</option>
          <option value="多い">多い</option>
        </select>
      </div>

      {/* 作業員数 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">本日の作業員数</div>
        <input
          value={workerCountText}
          onChange={(e) => setWorkerCountText(e.target.value)}
          inputMode="numeric"
          placeholder="例）12"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <div className="text-xs text-slate-500">※未入力でも保存できます（必要なら入力）。</div>
      </div>

      {/* 作業内容 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">作業内容</div>
        <textarea value={workDetail} onChange={(e) => setWorkDetail(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm min-h-[90px]" />
      </div>

      {/* 危険予知 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">危険予知</div>
        <textarea value={hazards} onChange={(e) => setHazards(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm min-h-[90px]" />
      </div>

      {/* 対策 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">対策</div>
        <textarea value={countermeasures} onChange={(e) => setCountermeasures(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm min-h-[90px]" />
      </div>

      {/* 気象 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">気象（9/12/15の3枠）</div>
          <button type="button" onClick={fetchWeather} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs hover:bg-slate-50">
            気象を取得
          </button>
        </div>

        {weatherSlots.length ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {weatherSlots.map((slot) => (
                <label key={slot.hour} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
                    <input type="radio" name="weatherApplied" checked={weatherAppliedHour === slot.hour} onChange={() => setWeatherAppliedHour(slot.hour)} />
                  </div>
                  <div className="text-sm text-slate-700">{slot.weather_text || "—"}</div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <div>気温：{slot.temperature_c ?? "—"} ℃</div>
                    <div>
                      風：{degToDirJp(slot.wind_direction_deg)} {slot.wind_speed_ms != null ? `${slot.wind_speed_ms} m/s` : "—"}
                    </div>
                    <div>降水：{slot.precipitation_mm ?? "—"} mm</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button type="button" onClick={onApplyWeather} className="rounded-lg px-4 py-2 text-sm text-white bg-black hover:bg-slate-900">
                気象を適用
              </button>
              <div className="text-xs text-slate-500">選択後に「気象を適用」で確定（保存時に weather_applied_slot へ入れます）。</div>
            </div>

            {weatherApplied && weatherAppliedHour != null ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                気象を適用しました：{buildSlotText(weatherSlots.find((x) => x.hour === weatherAppliedHour) as WeatherSlot)}
              </div>
            ) : null}
          </>
        ) : (
          <div className="text-sm text-slate-500">（まだ気象を取得していません）</div>
        )}
      </div>

      {/* AI補足 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-800">AI補足（項目別）</div>
          <button
            type="button"
            onClick={onGenerateAi}
            disabled={aiGenerating}
            className={`rounded-lg border px-4 py-2 text-sm ${
              aiGenerating ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
            }`}
          >
            {aiGenerating ? "AI補足 生成中..." : "AI補足を生成"}
          </button>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">作業内容の補足</div>
          <textarea value={aiWork} onChange={(e) => setAiWork(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm min-h-[90px] whitespace-pre-wrap" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足</div>
          <textarea value={aiHazards} onChange={(e) => setAiHazards(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm min-h-[90px] whitespace-pre-wrap" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足</div>
          <textarea value={aiMeasures} onChange={(e) => setAiMeasures(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm min-h-[90px] whitespace-pre-wrap" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足</div>
          <textarea value={aiThird} onChange={(e) => setAiThird(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm min-h-[90px] whitespace-pre-wrap" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => router.push(`/projects/${projectId}/ky`)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          戻る
        </button>

        <button type="button" onClick={onSave} disabled={acting} className={`rounded-lg px-4 py-2 text-sm text-white ${acting ? "bg-slate-400" : "bg-black hover:bg-slate-900"}`}>
          {acting ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}
