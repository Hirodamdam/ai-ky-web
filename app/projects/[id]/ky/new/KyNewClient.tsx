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

type Project = { id: string; name: string | null; lat: number | null; lon: number | null };

type PartnerCompanyOption = {
  value: string; // select value（UUID優先、なければ会社名）
  name: string; // 表示名
  uuid: string | null; // UUIDが判明している場合
};

const FIXED_CONTRACTOR_NAME = "株式会社三竹工業";

function isoDateTodayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeBullets(text: string): string[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];

  const lines = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 1) {
    const one = lines[0];
    const parts = one
      .split(/(?:・|;|；|、|，|\/|／|　|。)(?=\S)/)
      .map((s) => s.trim())
      .filter(Boolean);

    const numParts =
      parts.length >= 2
        ? parts
        : one
            .split(/(?=(?:\d+[\)\.、]|[①-⑳]))/)
            .map((s) => s.trim())
            .filter(Boolean);

    if (numParts.length >= 2) {
      return numParts
        .map((p) => p.replace(/^([①-⑳]|\d+[\)\.、])\s*/, "").trim())
        .filter(Boolean);
    }
  }

  return lines
    .map((l) => l.replace(/^([・\-\*\u2022]\s*)/, "").trim())
    .filter(Boolean);
}

function BulletText({ text }: { text: string | null | undefined }) {
  const items = useMemo(() => normalizeBullets(text ?? ""), [text]);
  if (items.length === 0) return <div className="text-sm text-gray-500">（AI補足なし）</div>;
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm">
      {items.map((t, i) => (
        <li key={i} className="whitespace-pre-wrap">
          {t}
        </li>
      ))}
    </ul>
  );
}

type AiParts = { work: string; hazards: string; counter: string; third: string };

function splitAiSupplement(s: string): AiParts {
  const text = (s ?? "").trim();
  if (!text) return { work: "", hazards: "", counter: "", third: "" };

  const keys = [
    { k: "work", re: /(作業内容)/ },
    { k: "hazards", re: /(危険予知|危険予測|危険源)/ },
    { k: "counter", re: /(対策|措置|予防策)/ },
    { k: "third", re: /(第三者|一般通行人|墓参者)/ },
  ] as const;

  let current: keyof AiParts | null = null;
  const buf: Record<keyof AiParts, string[]> = { work: [], hazards: [], counter: [], third: [] };

  for (const line0 of text.split("\n")) {
    const line = line0.trim();
    if (!line) continue;

    const header = keys.find((x) => x.re.test(line));
    if (header && /AI補足|【|】|:|：/.test(line)) {
      current = header.k;
      continue;
    }

    const inline = keys.find((x) => x.re.test(line) && /[:：]/.test(line));
    if (inline) {
      current = inline.k;
      const after = line.split(/[:：]/).slice(1).join("：").trim();
      if (after) buf[current].push(after);
      continue;
    }

    if (!current) buf.work.push(line);
    else buf[current].push(line);
  }

  return {
    work: buf.work.join("\n").trim(),
    hazards: buf.hazards.join("\n").trim(),
    counter: buf.counter.join("\n").trim(),
    third: buf.third.join("\n").trim(),
  };
}

function buildSupplementFrom4(json: any): string {
  const w = json?.ai_work_detail ?? json?.aiWorkDetail ?? json?.work ?? "";
  const h = json?.ai_hazards ?? json?.aiHazards ?? json?.hazards ?? "";
  const c = json?.ai_countermeasures ?? json?.aiCountermeasures ?? json?.counter ?? "";
  const t = json?.ai_third_party ?? json?.aiThirdParty ?? json?.third ?? "";

  const blocks = [
    w ? `【AI補足｜作業内容】\n${w}` : "",
    h ? `【AI補足｜危険予知】\n${h}` : "",
    c ? `【AI補足｜対策】\n${c}` : "",
    t ? `【AI補足｜第三者】\n${t}` : "",
  ].filter(Boolean);

  return blocks.join("\n\n").trim();
}

function degToCompassJa(deg: number | null | undefined): string {
  if (deg === null || deg === undefined) return "—";
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const d = ((deg % 360) + 360) % 360;
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}

function fmtAppliedWeather(w: WeatherSlot | null): string {
  if (!w) return "";
  const parts: string[] = [];
  parts.push(`${w.hour}:00`);
  if (w.weather_text) parts.push(w.weather_text);
  if (w.temperature_c != null) parts.push(`気温${w.temperature_c}℃`);
  if (w.wind_direction_deg != null) parts.push(`風向${degToCompassJa(w.wind_direction_deg)}`);
  if (w.wind_speed_ms != null) parts.push(`風速${w.wind_speed_ms}m/s`);
  if (w.precipitation_mm != null) parts.push(`雨量${w.precipitation_mm}mm`);
  return parts.join(" / ");
}

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

// ✅ 型定義に無いテーブルを触る時は any
const fromAny = (table: string) => (supabase as any).from(table);

function formatPostgrestError(e: any): string {
  if (!e) return "保存に失敗しました";
  if (typeof e === "string") return e;
  const parts: string[] = [];
  const msg = e.message ?? e.error_description ?? e.error ?? null;
  const code = e.code ?? null;
  const details = e.details ?? null;
  const hint = e.hint ?? null;

  if (code) parts.push(`code: ${code}`);
  if (msg) parts.push(String(msg));
  if (details) parts.push(String(details));
  if (hint) parts.push(`hint: ${hint}`);

  if (parts.length) return parts.join("\n");
  try {
    return JSON.stringify(e, null, 2);
  } catch {
    return String(e);
  }
}

// ✅ INSERTで「未知列」ならその列だけ落としてリトライ（パターン増やして確実に）
async function insertWithDropUnknownColumns(table: string, row: any) {
  let payload = { ...row };
  const fromAnyLocal = (t: string) => (supabase as any).from(t);

  for (let i = 0; i < 8; i++) {
    const { error } = await fromAnyLocal(table).insert(payload);
    if (!error) return;

    const msg = String(error.message ?? "");

    // パターン1: column "x" of relation "y" does not exist
    const m1 = msg.match(/column "([^"]+)" of relation "([^"]+)" does not exist/i);

    // パターン2: Could not find the 'x' column of 'y' in the schema cache
    const m2 = msg.match(/Could not find the '([^']+)' column of '([^']+)'/i);

    const col = (m1 && m1[1]) || (m2 && m2[1]) || null;

    if (col && col in payload) {
      delete (payload as any)[col];
      continue;
    }

    const errText = formatPostgrestError(error);
    const wrapped = new Error(errText);
    (wrapped as any).raw = error;
    throw wrapped;
  }

  const { error } = await fromAnyLocal(table).insert(payload);
  if (error) throw new Error(formatPostgrestError(error));
}

export default function KyNewClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params?.id;

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [project, setProject] = useState<Project | null>(null);

  const [workDate, setWorkDate] = useState<string>(isoDateTodayJst());

  const [partnerValue, setPartnerValue] = useState<string>("");
  const [partners, setPartners] = useState<PartnerCompanyOption[]>([]);

  const [workDetail, setWorkDetail] = useState<string>("");
  const [hazards, setHazards] = useState<string>("");
  const [countermeasures, setCountermeasures] = useState<string>("");

  const [thirdPartyLevel, setThirdPartyLevel] = useState<"多い" | "少ない">("少ない");

  const [weatherSlots, setWeatherSlots] = useState<WeatherSlot[] | null>(null);
  const [weatherApplied, setWeatherApplied] = useState<WeatherSlot | null>(null);
  const [weatherSelectedHour, setWeatherSelectedHour] = useState<9 | 12 | 15 | null>(null);

  const [aiSupplement, setAiSupplement] = useState<string>("");

  const aiParts = useMemo(() => splitAiSupplement(aiSupplement), [aiSupplement]);

  const canGenerateAi = useMemo(() => {
    return !!workDetail.trim() && !!hazards.trim() && !!countermeasures.trim() && !!weatherApplied;
  }, [workDetail, hazards, countermeasures, weatherApplied]);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data, error } = await supabase.from("projects").select("id,name,lat,lon").eq("id", projectId).maybeSingle();
      if (!error) setProject((data as any) ?? null);
    })();
  }, [projectId]);

  // ✅ 協力会社：入場登録 → (可能なら) partner_companies に突き合わせてUUID付与
  useEffect(() => {
    if (!projectId) return;

    (async () => {
      try {
        setStatus({ type: null, text: "" });

        const { data: pp, error: ppErr } = await fromAny("project_partner_entries")
          .select("partner_company_name, created_at")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });

        if (ppErr) throw ppErr;

        const names = (pp ?? [])
          .map((r: any) => String(r?.partner_company_name ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean);

        const uniqNames: string[] = [];
        const seen = new Set<string>();
        for (const n of names) {
          if (seen.has(n)) continue;
          seen.add(n);
          uniqNames.push(n);
        }

        let nameToUuid = new Map<string, string>();
        if (uniqNames.length > 0) {
          const { data: pc, error: pcErr } = await supabase.from("partner_companies").select("id,name").in("name", uniqNames);
          if (!pcErr && Array.isArray(pc)) {
            for (const r of pc as any[]) {
              const nm = String(r?.name ?? "").replace(/\s+/g, " ").trim();
              const id = String(r?.id ?? "").trim();
              if (nm && id) nameToUuid.set(nm, id);
            }
          }
        }

        let options: PartnerCompanyOption[] = uniqNames.map((nm) => {
          const uuid = nameToUuid.get(nm) ?? null;
          return { value: uuid ?? nm, name: nm, uuid };
        });

        // 入場登録が無ければマスタ一覧
        if (options.length === 0) {
          const { data: master, error: mErr } = await supabase.from("partner_companies").select("id,name").order("name", { ascending: true });
          if (!mErr && Array.isArray(master)) {
            options = (master as any[]).map((r) => {
              const id = String(r.id);
              const nm = (r.name ?? "") as string;
              return { value: id, name: nm || "(名称未設定)", uuid: id };
            });
          }
        }

        setPartners(options);

        if (partnerValue && !options.some((o) => o.value === partnerValue)) {
          setPartnerValue("");
        }
      } catch (e: any) {
        console.error("[partner options error]", e);
        setStatus({ type: "error", text: formatPostgrestError(e) });
        setPartners([]);
      }
    })();
  }, [projectId, partnerValue]);

  const fetchWeather = useCallback(async () => {
    try {
      setStatus({ type: null, text: "" });
      if (!project?.lat || !project?.lon) {
        setWeatherSlots(null);
        setWeatherApplied(null);
        setWeatherSelectedHour(null);
        return;
      }

      const url = new URL("/api/weather", window.location.origin);
      url.searchParams.set("lat", String(project.lat));
      url.searchParams.set("lon", String(project.lon));
      url.searchParams.set("date", workDate);

      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `weather fetch failed (${res.status})`);

      setWeatherSlots(json?.slots ?? null);
      setWeatherApplied(null);
      setWeatherSelectedHour(null);
    } catch (e: any) {
      console.error("[weather error]", e);
      setStatus({ type: "error", text: formatPostgrestError(e) });
    }
  }, [project?.lat, project?.lon, workDate]);

  useEffect(() => {
    if (!project?.lat || !project?.lon) return;
    fetchWeather();
  }, [project?.lat, project?.lon, workDate, fetchWeather]);

  const selectedSlot = useMemo(() => {
    if (!weatherSlots || weatherSelectedHour == null) return null;
    return weatherSlots.find((s) => s.hour === weatherSelectedHour) ?? null;
  }, [weatherSlots, weatherSelectedHour]);

  const applySelectedWeather = () => {
    if (!selectedSlot) {
      setStatus({ type: "error", text: "上の枠を選んでから「気象を適用」を押してください" });
      return;
    }
    setWeatherApplied(selectedSlot);
    setStatus({ type: "success", text: `気象を適用しました（${selectedSlot.hour}時）` });
  };

  const generateAi = useCallback(async () => {
    try {
      setGenerating(true);
      setStatus({ type: null, text: "" });

      if (!projectId) throw new Error("projectId が不正です");
      if (!workDetail.trim()) throw new Error("作業内容を入力してください");
      if (!hazards.trim()) throw new Error("危険予知を1行でも入力してください");
      if (!countermeasures.trim()) throw new Error("対策を1行でも入力してください");
      if (!weatherApplied) throw new Error("気象を適用してください（上の枠を選んで「気象を適用」）");

      const body = {
        projectId,
        work_date: workDate,
        work_detail: workDetail,
        hazards,
        countermeasures,
        third_party_level: thirdPartyLevel,
        weather: {
          hour: weatherApplied.hour,
          weather_text: weatherApplied.weather_text,
          temperature_c: weatherApplied.temperature_c,
          wind_direction_deg: weatherApplied.wind_direction_deg,
          wind_speed_ms: weatherApplied.wind_speed_ms,
          precipitation_mm: weatherApplied.precipitation_mm,
        },
      };

      const res = await fetch("/api/ky-ai-generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const msg = json?.error ?? `AI生成に失敗しました (${res.status})`;
        const extra = !json && text ? ` / response: ${text.slice(0, 200)}` : "";
        throw new Error(msg + extra);
      }

      const supp = json?.ai_supplement ?? json?.aiSupplement ?? json?.aiSupplementText ?? buildSupplementFrom4(json) ?? json?.text;

      if (!supp || !String(supp).trim()) {
        throw new Error("AI補足の取得に失敗しました（APIレスポンスにAI補足が含まれていません）");
      }

      setAiSupplement(String(supp));
      setStatus({ type: "success", text: "AI補足を更新しました" });
    } catch (e: any) {
      console.error("[ai generation error]", e);
      setStatus({ type: "error", text: formatPostgrestError(e) });
    } finally {
      setGenerating(false);
    }
  }, [projectId, workDate, workDetail, hazards, countermeasures, thirdPartyLevel, weatherApplied]);

  const save = useCallback(async () => {
    try {
      setSaving(true);
      setStatus({ type: null, text: "" });

      if (!projectId) throw new Error("projectId が不正です");
      if (!partnerValue) throw new Error("協力会社（必須）を選択してください");
      if (!workDetail.trim()) throw new Error("作業内容を入力してください");
      if (!weatherApplied) throw new Error("気象を適用してください（上の枠を選んで「気象を適用」）");

      const selected = partners.find((p) => p.value === partnerValue);
      const pname = selected?.name?.trim() || "";
      if (!pname) throw new Error("協力会社名が取得できません（候補を確認してください）");

      const partner_company_id = looksLikeUuid(partnerValue) ? partnerValue : selected?.uuid ?? null;

      const insert: any = {
        project_id: projectId,
        work_date: workDate || null,

        work_detail: workDetail,
        hazards,
        countermeasures,

        partner_company_id,
        partner_company_name: pname,

        third_party: thirdPartyLevel === "多い",

        weather: weatherApplied.weather_text ?? null,
        temperature_text: weatherApplied.temperature_c != null ? `${weatherApplied.temperature_c}℃` : null,
        wind_direction: weatherApplied.wind_direction_deg != null ? String(weatherApplied.wind_direction_deg) : null,
        wind_speed_text: weatherApplied.wind_speed_ms != null ? `${weatherApplied.wind_speed_ms}m/s` : null,
        precipitation_mm: weatherApplied.precipitation_mm ?? null,

        // ✅ ここが原因：ky_entries に列が無いので送らない
        // weather_slots: weatherSlots ?? null,

        ai_supplement: aiSupplement ? aiSupplement : null,

        is_approved: false,
      };

      await insertWithDropUnknownColumns("ky_entries", insert);

      setStatus({ type: "success", text: "保存しました" });
      router.push(`/projects/${projectId}/ky`);
    } catch (e: any) {
      console.error("[save error raw]", e?.raw ?? e);
      const msg = formatPostgrestError(e?.raw ?? e);
      setStatus({ type: "error", text: msg });
    } finally {
      setSaving(false);
    }
  }, [
    projectId,
    partnerValue,
    partners,
    workDate,
    workDetail,
    hazards,
    countermeasures,
    thirdPartyLevel,
    weatherApplied,
    weatherSlots,
    aiSupplement,
    router,
  ]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="relative">
        <div className="text-xl font-bold">KY 新規作成</div>
        <div className="text-sm text-gray-700 mt-1">工事件名：{project?.name ?? "（未設定）"}</div>

        <Link className="text-blue-600 underline absolute right-0 top-0" href={`/projects/${projectId}/ky`}>
          KY一覧へ
        </Link>
      </div>

      {status.type && (
        <div
          className={`p-3 rounded ${
            status.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          } whitespace-pre-wrap`}
        >
          {status.text}
        </div>
      )}

      <div className="border rounded p-4">
        <div className="text-sm font-semibold mb-1">施工会社（固定）</div>
        <div className="text-sm">{FIXED_CONTRACTOR_NAME}</div>
      </div>

      <div className="border rounded p-4 space-y-2">
        <div className="text-sm font-semibold">
          協力会社 <span className="text-red-600">（必須）</span>
        </div>

        <select className="border rounded px-2 py-1 w-full" value={partnerValue} onChange={(e) => setPartnerValue(e.target.value)}>
          <option value="">選択してください</option>
          {partners.map((p) => (
            <option key={p.value} value={p.value}>
              {p.name ?? "(名称未設定)"}
            </option>
          ))}
        </select>

        <div className="text-xs text-gray-600">※ 工事詳細で「入場登録」した会社がここに出ます</div>
      </div>

      <div className="border rounded p-4 space-y-2">
        <div className="text-sm font-semibold">作業日</div>
        <input type="date" className="border rounded px-2 py-1 w-full" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
      </div>

      <div className="border rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">気象（自動取得）</div>
          <button className="px-3 py-1 border rounded" onClick={fetchWeather} type="button">
            再取得
          </button>
        </div>

        {!weatherSlots ? (
          <div className="text-sm text-gray-600">取得中…（緯度・経度が未設定の場合は取得されません）</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlots.map((s) => {
              const selected = weatherSelectedHour === s.hour;
              const applied = weatherApplied?.hour === s.hour;
              const boxClass = selected ? "border-blue-600 bg-blue-50" : applied ? "border-green-600 bg-green-50" : "";
              return (
                <button
                  key={s.hour}
                  type="button"
                  onClick={() => setWeatherSelectedHour(s.hour)}
                  className={`text-left border rounded p-3 w-full ${boxClass}`}
                >
                  <div className="font-semibold">{String(s.hour).padStart(2, "0")}:00</div>
                  <div className="text-sm mt-1">{s.weather_text}</div>
                  <div className="text-xs text-gray-700 mt-1">
                    気温 {s.temperature_c ?? "—"}℃ / 風向 {s.wind_direction_deg ?? "—"} / 風速 {s.wind_speed_ms ?? "—"}m/s /
                    雨量 {s.precipitation_mm ?? "—"}mm
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button className="px-4 py-2 rounded bg-blue-600 text-white" type="button" onClick={applySelectedWeather}>
            気象を適用
          </button>

          {!weatherApplied ? (
            <div className="text-sm text-gray-600">
              <span className="text-red-600 font-semibold">未適用</span>（上の枠を選んで「気象を適用」してください）
            </div>
          ) : (
            <div className="text-sm text-green-700">適用中：{fmtAppliedWeather(weatherApplied)}</div>
          )}
        </div>
      </div>

      <div className="border rounded p-4 space-y-3">
        <div>
          <div className="text-sm font-semibold mb-1">作業内容</div>
          <textarea className="border rounded w-full p-2" rows={4} value={workDetail} onChange={(e) => setWorkDetail(e.target.value)} />
        </div>

        <div>
          <div className="text-sm font-semibold mb-1">危険予知</div>
          <textarea
            className="border rounded w-full p-2"
            rows={4}
            value={hazards}
            onChange={(e) => setHazards(e.target.value)}
            placeholder="例）転倒・接触・第三者動線混在"
          />
        </div>

        <div>
          <div className="text-sm font-semibold mb-1">対策</div>
          <textarea
            className="border rounded w-full p-2"
            rows={4}
            value={countermeasures}
            onChange={(e) => setCountermeasures(e.target.value)}
            placeholder="例）区画分離・誘導員配置・合図統一・停止基準"
          />
        </div>
      </div>

      <div className="border rounded p-4 space-y-2">
        <div className="text-sm font-semibold">第三者（墓参者）の状況</div>
        <select
          className="border rounded px-2 py-1 w-full bg-yellow-50"
          value={thirdPartyLevel}
          onChange={(e) => setThirdPartyLevel(e.target.value as any)}
        >
          <option value="多い">多い</option>
          <option value="少ない">少ない</option>
        </select>
        <div className="text-xs text-gray-600">※ 墓参者の多少に応じて、誘導・区画分離・声掛け等をAI補足に反映します。</div>
      </div>

      <div className="border rounded p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-semibold">AI補足（項目別）</div>
          <button
            className={`px-3 py-1 border rounded ${canGenerateAi && !generating ? "" : "opacity-50"}`}
            onClick={generateAi}
            type="button"
            disabled={!canGenerateAi || generating}
          >
            {generating ? "生成中…" : "AI補足を生成"}
          </button>
        </div>

        {!canGenerateAi && <div className="text-xs text-gray-600">※ 生成するには「作業内容」「危険予知（1行）」「対策（1行）」「気象の適用」が必要です</div>}

        <div className="border rounded p-3">
          <div className="font-semibold mb-2">作業内容の補足</div>
          <BulletText text={aiParts.work} />
        </div>

        <div className="border rounded p-3">
          <div className="font-semibold mb-2">危険予知の補足</div>
          <BulletText text={aiParts.hazards} />
        </div>

        <div className="border rounded p-3">
          <div className="font-semibold mb-2">対策の補足</div>
          <BulletText text={aiParts.counter} />
        </div>

        <div className="border rounded p-3">
          <div className="font-semibold mb-2">第三者の補足</div>
          <BulletText text={aiParts.third} />
        </div>
      </div>

      <div className="flex gap-2">
        <button className={`px-4 py-2 rounded bg-blue-600 text-white ${saving ? "opacity-50" : ""}`} onClick={save} disabled={saving}>
          保存
        </button>
        <button className="px-4 py-2 rounded border" onClick={() => router.back()} type="button">
          戻る
        </button>
      </div>
    </div>
  );
}
