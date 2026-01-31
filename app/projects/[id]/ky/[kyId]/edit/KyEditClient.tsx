"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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

type AiParts = { work: string; hazards: string; measures: string; thirdParty: string };
type PartnerCompany = { id: string; name: string };

type KyRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;
  partner_company_name: string | null;

  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  third_party_situation: string | null;

  weather: string | null;
  temperature_text: string | null;
  wind_direction: string | null;
  wind_speed_text: string | null;
  precipitation_mm: number | null;

  workers: number | null;
  notes: string | null;

  ai_supplement_raw: string | null;
  ai_supplement_work: string | null;
  ai_supplement_hazards: string | null;
  ai_supplement_measures: string | null;
  ai_supplement_third_party: string | null;
};

function toBullets(text: string): string {
  const t = (text ?? "").trim();
  if (!t) return "";
  const lines = t
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const already = lines.every((l) => /^[-*•・\d]+\s*/.test(l));
  if (already) return lines.map((l) => l.replace(/^[-*•・\d]+\s*/, "・")).join("\n");

  const joined = lines.join(" ");
  const parts = joined
    .split(/(?:。|；|;|\.|\u3002)\s*/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = (parts.length ? parts : lines).map((p) => `・${p}`);
  return out.join("\n");
}

function pickAiParts(raw: string): AiParts {
  const t = (raw ?? "").replace(/\r/g, "");
  const pick = (label: string) => {
    const re = new RegExp(`【${label}】([\\s\\S]*?)(?=【|$)`, "m");
    const m = t.match(re);
    return m ? m[1].trim() : "";
  };
  return {
    work: pick("作業内容の補足"),
    hazards: pick("危険予知の補足"),
    measures: pick("対策の補足"),
    thirdParty: pick("第三者（参考者）の補足"),
  };
}

export default function KyEditClient() {
  const params = useParams<{ id: string; kyId: string }>();
  const projectId = params?.id;
  const kyId = params?.kyId;
  const router = useRouter();

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [partnerCompanies, setPartnerCompanies] = useState<PartnerCompany[]>([]);

  // 入力
  const [workDate, setWorkDate] = useState<string>("");
  const [partnerName, setPartnerName] = useState<string>("");

  const [workDetail, setWorkDetail] = useState<string>("");
  const [hazards, setHazards] = useState<string>("");
  const [countermeasures, setCountermeasures] = useState<string>("");

  const [thirdPartySituation, setThirdPartySituation] = useState<"" | "多い" | "少ない">("");

  // 気象
  const [weatherText, setWeatherText] = useState<string>("");
  const [temperatureText, setTemperatureText] = useState<string>("");
  const [windDirection, setWindDirection] = useState<string>("");
  const [windSpeedText, setWindSpeedText] = useState<string>("");
  const [precipitationMm, setPrecipitationMm] = useState<string>("");
  const [workers, setWorkers] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // 9/12/15
  const [slots, setSlots] = useState<WeatherSlot[]>([]);
  const slotsByHour = useMemo(() => {
    const map = new Map<number, WeatherSlot>();
    for (const s of slots) map.set(s.hour, s);
    return map;
  }, [slots]);

  // AI補足
  const [aiRaw, setAiRaw] = useState<string>("");
  const aiParts = useMemo(() => pickAiParts(aiRaw), [aiRaw]);
  const aiWork = useMemo(() => toBullets(aiParts.work), [aiParts.work]);
  const aiHazards = useMemo(() => toBullets(aiParts.hazards), [aiParts.hazards]);
  const aiMeasures = useMemo(() => toBullets(aiParts.measures), [aiParts.measures]);
  const aiThird = useMemo(() => toBullets(aiParts.thirdParty), [aiParts.thirdParty]);

  const ensureSession = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) return null;
    return data.session ?? null;
  }, []);

  const loadPartnerCompanies = useCallback(async () => {
    const { data, error } = await supabase
      .from("partner_companies")
      .select("id,name")
      .order("name", { ascending: true });
    if (!error && Array.isArray(data)) setPartnerCompanies(data as PartnerCompany[]);
    else setPartnerCompanies([]);
  }, []);

  const loadProjectLatLonAndFetchWeather = useCallback(async () => {
    const { data, error } = await supabase
      .from("projects")
      .select("lat,lon")
      .eq("id", projectId)
      .maybeSingle();

    if (error || !data?.lat || !data?.lon) {
      setStatus({ type: "error", text: "気象取得：現場の緯度経度が未設定です（工事情報で設定してください）。" });
      return;
    }

    const url = new URL("/api/weather", window.location.origin);
    url.searchParams.set("lat", String(data.lat));
    url.searchParams.set("lon", String(data.lon));

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) {
      setStatus({ type: "error", text: "気象取得に失敗しました。" });
      return;
    }
    const json = await res.json();
    const got = (json?.slots ?? []) as WeatherSlot[];
    setSlots(got);

    const s9 = got.find((s) => s.hour === 9) ?? got.find((s) => s.hour === 12) ?? got.find((s) => s.hour === 15);
    if (s9) {
      setWeatherText(s9.weather_text ?? "");
      setTemperatureText(s9.temperature_c != null ? String(s9.temperature_c) : "");
      setWindDirection(s9.wind_direction_deg != null ? String(s9.wind_direction_deg) : "");
      setWindSpeedText(s9.wind_speed_ms != null ? String(s9.wind_speed_ms) : "");
      setPrecipitationMm(s9.precipitation_mm != null ? String(s9.precipitation_mm) : "");
    }

    setStatus({ type: "success", text: "気象データを取得しました。" });
  }, [projectId]);

  const loadKy = useCallback(async () => {
    setLoading(true);
    setStatus({ type: null, text: "" });

    const { data, error } = await supabase.from("ky_entries").select("*").eq("id", kyId).maybeSingle();
    if (error || !data) {
      setStatus({ type: "error", text: "KYデータを取得できません。" });
      setLoading(false);
      return;
    }

    const r = data as KyRow;

    setWorkDate(r.work_date ?? "");
    setPartnerName(r.partner_company_name ?? "");

    setWorkDetail(r.work_detail ?? "");
    setHazards(r.hazards ?? "");
    setCountermeasures(r.countermeasures ?? "");

    setThirdPartySituation((r.third_party_situation as any) ?? "");

    setWeatherText(r.weather ?? "");
    setTemperatureText(r.temperature_text ?? "");
    setWindDirection(r.wind_direction ?? "");
    setWindSpeedText(r.wind_speed_text ?? "");
    setPrecipitationMm(r.precipitation_mm != null ? String(r.precipitation_mm) : "");
    setWorkers(r.workers != null ? String(r.workers) : "");
    setNotes(r.notes ?? "");

    // AI補足は raw 優先。無ければ4区分から復元しても良いが、今回は保存設計に従う
    setAiRaw(r.ai_supplement_raw ?? "");
    setLoading(false);
  }, [kyId]);

  const generateAi = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const session = await ensureSession();
    if (!session) {
      setStatus({ type: "error", text: "ログイン状態を確認できません。/login から再ログインしてください。" });
      return;
    }

    if (!workDetail.trim() || !hazards.trim() || !countermeasures.trim() || !thirdPartySituation) {
      setStatus({ type: "error", text: "AI補足の前に、作業内容・危険予知・対策・第三者の状況（多い/少ない）を入力してください。" });
      return;
    }

    const res = await fetch("/api/ky-ai-generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        workDate,
        workDetail,
        hazards,
        countermeasures,
        thirdPartySituation,
        weather: {
          weather_text: weatherText,
          temperature_text: temperatureText,
          wind_direction: windDirection,
          wind_speed_text: windSpeedText,
          precipitation_mm: precipitationMm,
        },
      }),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      setStatus({ type: "error", text: `AI補足の生成に失敗しました。${t ? `(${t})` : ""}` });
      return;
    }

    const json = await res.json();
    setAiRaw((json?.text ?? "") as string);
    setStatus({ type: "success", text: "AI補足を生成しました。" });
  }, [
    ensureSession,
    projectId,
    workDate,
    workDetail,
    hazards,
    countermeasures,
    thirdPartySituation,
    weatherText,
    temperatureText,
    windDirection,
    windSpeedText,
    precipitationMm,
  ]);

  const save = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const session = await ensureSession();
    if (!session) {
      setStatus({ type: "error", text: "ログイン状態を確認できません。/login から再ログインしてください。" });
      return;
    }

    if (!workDate) return setStatus({ type: "error", text: "作業日は必須です。" });
    if (!partnerName.trim()) return setStatus({ type: "error", text: "協力会社は必須です。" });
    if (!workDetail.trim()) return setStatus({ type: "error", text: "本日の作業内容は必須です。" });
    if (!hazards.trim()) return setStatus({ type: "error", text: "危険ポイント（K）は必須です。" });
    if (!countermeasures.trim()) return setStatus({ type: "error", text: "対策（Y）は必須です。" });
    if (!thirdPartySituation) return setStatus({ type: "error", text: "第三者の状況（多い/少ない）は必須です。" });

    const parts = pickAiParts(aiRaw);
    const payload: any = {
      work_date: workDate,
      partner_company_name: partnerName.trim(),

      work_detail: workDetail.trim(),
      hazards: hazards.trim(),
      countermeasures: countermeasures.trim(),

      third_party_situation: thirdPartySituation,

      weather: weatherText || null,
      temperature_text: temperatureText || null,
      wind_direction: windDirection || null,
      wind_speed_text: windSpeedText || null,
      precipitation_mm: precipitationMm ? Number(precipitationMm) : null,

      workers: workers ? Number(workers) : null,
      notes: notes || null,

      ai_supplement_raw: aiRaw || null,
      ai_supplement_work: toBullets(parts.work) || null,
      ai_supplement_hazards: toBullets(parts.hazards) || null,
      ai_supplement_measures: toBullets(parts.measures) || null,
      ai_supplement_third_party: toBullets(parts.thirdParty) || null,
    };

    const { error } = await supabase.from("ky_entries").update(payload).eq("id", kyId);
    if (error) {
      setStatus({ type: "error", text: `保存に失敗しました：${error.message}` });
      return;
    }

    setStatus({ type: "success", text: "保存しました。" });
    router.push(`/projects/${projectId}/ky/${kyId}/review`);
  }, [
    ensureSession,
    kyId,
    projectId,
    workDate,
    partnerName,
    workDetail,
    hazards,
    countermeasures,
    thirdPartySituation,
    weatherText,
    temperatureText,
    windDirection,
    windSpeedText,
    precipitationMm,
    workers,
    notes,
    aiRaw,
    router,
  ]);

  useEffect(() => {
    (async () => {
      const session = await ensureSession();
      if (!session) setStatus({ type: "error", text: "ログイン状態を確認できません。/login から再ログインしてください。" });
      await loadPartnerCompanies();
      await loadKy();
    })();
  }, [ensureSession, loadPartnerCompanies, loadKy]);

  const slotCard = (hour: 9 | 12 | 15) => {
    const s = slotsByHour.get(hour);
    return (
      <div className="border rounded p-3 text-sm">
        <div className="font-semibold mb-1">{hour}:00</div>
        {!s ? (
          <div className="text-gray-500">—</div>
        ) : (
          <div className="space-y-1">
            <div>天候：{s.weather_text ?? "—"}</div>
            <div>気温：{s.temperature_c != null ? `${s.temperature_c}℃` : "—"}</div>
            <div>
              風：{s.wind_direction_deg != null ? `${s.wind_direction_deg}°` : "—"} /{" "}
              {s.wind_speed_ms != null ? `${s.wind_speed_ms} m/s` : "—"}
            </div>
            <div>降水：{s.precipitation_mm != null ? `${s.precipitation_mm} mm` : "—"}</div>
          </div>
        )}
      </div>
    );
  };

  const title = workDetail?.trim() ? workDetail.trim() : "KY編集";

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{title}</h1>
        <Link className="text-sm underline" href={`/projects/${projectId}/ky`}>
          一覧へ戻る
        </Link>
      </div>

      {status.type && (
        <div
          className={`rounded border p-3 text-sm ${
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

      {!loading && (
        <div className="border rounded p-4 space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">作業日 *</label>
            <input type="date" className="w-full border rounded px-3 py-2" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">協力会社 *</label>
            <select className="w-full border rounded px-3 py-2" value={partnerName} onChange={(e) => setPartnerName(e.target.value)}>
              <option value="">選択してください</option>
              {partnerCompanies.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">本日の作業内容 *</label>
            <textarea className="w-full border rounded px-3 py-2 min-h-[90px]" value={workDetail} onChange={(e) => setWorkDetail(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">危険ポイント（K）*</label>
            <textarea className="w-full border rounded px-3 py-2 min-h-[90px]" value={hazards} onChange={(e) => setHazards(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">対策（Y）*</label>
            <textarea className="w-full border rounded px-3 py-2 min-h-[90px]" value={countermeasures} onChange={(e) => setCountermeasures(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">第三者（墓参者など）の状況 *</label>
            <select className="w-full border rounded px-3 py-2" value={thirdPartySituation} onChange={(e) => setThirdPartySituation(e.target.value as any)}>
              <option value="">選択してください</option>
              <option value="多い">多い</option>
              <option value="少ない">少ない</option>
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold">気象（9/12/15）</div>
              <button type="button" className="border rounded px-3 py-1 text-sm" onClick={loadProjectLatLonAndFetchWeather}>
                気象データ取得
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {slotCard(9)}
              {slotCard(12)}
              {slotCard(15)}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1">天候</label>
              <input className="w-full border rounded px-3 py-2" value={weatherText} onChange={(e) => setWeatherText(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">気温（temperature_text）</label>
              <input className="w-full border rounded px-3 py-2" value={temperatureText} onChange={(e) => setTemperatureText(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">作業人数</label>
              <input className="w-full border rounded px-3 py-2" value={workers} onChange={(e) => setWorkers(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">風向（wind_direction）</label>
              <input className="w-full border rounded px-3 py-2" value={windDirection} onChange={(e) => setWindDirection(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">風速（wind_speed_text）</label>
              <div className="flex items-center gap-2">
                <input className="w-full border rounded px-3 py-2" value={windSpeedText} onChange={(e) => setWindSpeedText(e.target.value)} />
                <div className="text-sm text-gray-500">m/s</div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1">降水量（precipitation_mm）</label>
              <input className="w-full border rounded px-3 py-2" value={precipitationMm} onChange={(e) => setPrecipitationMm(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">備考</label>
            <textarea className="w-full border rounded px-3 py-2 min-h-[70px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">AI補足（項目別）</div>
              <button type="button" className="border rounded px-3 py-1 text-sm" onClick={generateAi}>
                AI補足を生成
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">作業内容の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{aiWork || "—"}</pre>
              </div>
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">危険予知の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{aiHazards || "—"}</pre>
              </div>
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">対策の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{aiMeasures || "—"}</pre>
              </div>
              <div className="border rounded p-3 bg-gray-50">
                <div className="font-semibold mb-2">第三者（参考者）の補足</div>
                <pre className="text-sm whitespace-pre-wrap">{aiThird || "—"}</pre>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button type="button" className="border rounded px-4 py-2" onClick={() => router.back()}>
              戻る
            </button>
            <button type="button" className="bg-black text-white rounded px-5 py-2" onClick={save}>
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
