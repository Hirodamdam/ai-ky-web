// app/projects/[id]/ky/[kyId]/edit/KyEditClient.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type Project = { id: string; name: string | null; lat: number | null; lon: number | null };

type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm?: number | null;
  weather_code?: number | null;
};

type KyRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;

  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  partner_company_name: string | null;

  // 第三者（DB環境差）
  third_party_level?: any | null;
  third_party_status?: any | null;
  third_party?: any | null;

  // 気象（旧列）
  weather?: string | null;
  temperature_text?: string | null;
  wind_direction?: string | null;
  wind_speed_text?: string | null;
  precipitation_mm?: number | null;

  // 気象（新列があれば）
  weather_slots?: any | null;
  applied_hour?: any | null;

  // AI補足（保存値）
  ai_supplement?: string | null;

  // ✅ 承認済み判定（列名差があるかもしれないのでanyで拾う）
  approved_at?: any | null;
  approved?: any | null;
  is_approved?: any | null;
};

function tryParseJson<T = any>(v: any): T | null {
  if (!v) return null;
  if (typeof v === "object") return v as T;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

function parseWeatherSlots(v: any): WeatherSlot[] {
  const j = tryParseJson<any>(v);
  const arr = Array.isArray(j) ? j : Array.isArray(v) ? v : [];
  const out: WeatherSlot[] = [];
  for (const it of arr) {
    const hour = it?.hour;
    if (hour !== 9 && hour !== 12 && hour !== 15) continue;
    out.push({
      hour,
      time_iso: String(it?.time_iso ?? it?.time ?? ""),
      weather_text: String(it?.weather_text ?? it?.weather ?? ""),
      temperature_c: it?.temperature_c ?? it?.temperature ?? null,
      wind_direction_deg: it?.wind_direction_deg ?? it?.wind_direction ?? null,
      wind_speed_ms: it?.wind_speed_ms ?? it?.wind_speed ?? null,
      precipitation_mm: it?.precipitation_mm ?? null,
      weather_code: it?.weather_code ?? null,
    });
  }
  out.sort((a, b) => a.hour - b.hour);
  return out;
}

function degToCompassJa(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "—";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}

function normalizeThirdPartyLabel(v: any): "多い" | "少ない" {
  if (v === true) return "多い";
  if (v === false) return "少ない";
  if (typeof v === "number") return v === 1 ? "多い" : "少ない";
  const s0 = typeof v === "string" ? v.trim() : "";
  if (!s0) return "少ない";
  if (s0.includes("多")) return "多い";
  if (s0.includes("少")) return "少ない";
  return "少ない";
}

type AiParts = { work: string; hazards: string; counter: string; third: string };

function splitAiSupplement(s0: string): AiParts {
  const text = (s0 ?? "").trim();
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

function buildAiSupplementFromParts(p: AiParts): string {
  const blocks = [
    p.work?.trim() ? `【AI補足｜作業内容】\n${p.work.trim()}` : "",
    p.hazards?.trim() ? `【AI補足｜危険予知】\n${p.hazards.trim()}` : "",
    p.counter?.trim() ? `【AI補足｜対策】\n${p.counter.trim()}` : "",
    p.third?.trim() ? `【AI補足｜第三者】\n${p.third.trim()}` : "",
  ].filter(Boolean);

  return blocks.join("\n\n").trim();
}

function s(v: any) {
  if (v == null) return "";
  return String(v);
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

function isApprovedLike(row: KyRow | null): boolean {
  if (!row) return false;
  const a = (row as any)?.approved_at;
  const b = (row as any)?.approved;
  const c = (row as any)?.is_approved;
  if (a) return true;
  if (b === true) return true;
  if (c === true) return true;
  return false;
}

/** ===== 表示用整形（レビューと同じ） ===== */

function normalizeLineBase(raw: string): string {
  return raw
    .replace(/^[•・\-*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripGenericAccidentNote(x: string): string {
  return x
    .replace(/（\s*事故につながる恐れ\s*）/g, "")
    .replace(/（\s*事故に繋がる恐れ\s*）/g, "")
    .replace(/（\s*事故につながる可能性\s*）/g, "")
    .replace(/（\s*事故に繋がる可能性\s*）/g, "")
    .trim();
}

function takeRightOfArrow(line: string): string {
  const t = line;
  const seps = ["→", "⇒", "->", "＞", "〉"];
  for (const sep of seps) {
    const idx = t.indexOf(sep);
    if (idx >= 0) {
      const right = t.slice(idx + sep.length).trim();
      if (right) return right;
    }
  }
  return t.trim();
}

function dedupeKeepOrder(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const k = x.trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// 危険予知：右側だけ採用、(事故につながる恐れ)削除、最大5件、番号なし
function formatHazardsForView5(text: string): string[] {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const picked: string[] = [];
  for (const l0 of lines) {
    const base = normalizeLineBase(l0);
    if (!base) continue;

    let v = takeRightOfArrow(base);
    v = stripGenericAccidentNote(v);
    v = v.replace(/（\s*[^）]*事故[^）]*恐れ\s*）\s*$/g, "").trim();

    if (/^危険予知/i.test(v) || /^対策/i.test(v) || /^AI補足/i.test(v)) continue;
    if (v) picked.push(v);
  }
  return dedupeKeepOrder(picked).slice(0, 5);
}

function splitMeasuresLine(line: string): string[] {
  const t = line.trim();
  const noLead = t
    .replace(/^\s*\[\s*\d+\s*\]\s*/g, "")
    .replace(/^\s*\d+[)\.]\s*/g, "")
    .trim();

  const hasMulti = /\[\s*\d+\s*\]/.test(noLead);
  if (!hasMulti) return [noLead];

  const parts = noLead
    .split(/\[\s*\d+\s*\]/g)
    .map((x) => x.replace(/^[、,\s]+/, "").trim())
    .filter(Boolean);

  return parts.length ? parts : [noLead];
}

// 対策：番号削除、右側だけ採用、最大5件、番号なし
function formatMeasuresForView5(text: string): string[] {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

  const items: string[] = [];
  for (const l0 of lines) {
    const base0 = normalizeLineBase(l0);
    if (!base0) continue;

    const parts = splitMeasuresLine(base0);
    for (let p of parts) {
      p = normalizeLineBase(p);
      if (!p) continue;

      p = takeRightOfArrow(p);

      if (/^対策/i.test(p) || /^AI補足/i.test(p)) continue;
      if (p) items.push(p);
    }
  }
  return dedupeKeepOrder(items).slice(0, 5);
}

// 第三者：番号なし（今は上限なし）
function formatThirdForView(text: string): string[] {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.replace(/^[•・\-*]\s*/, "").trim())
    .filter(Boolean);
}

export default function KyEditClient() {
  const params = useParams();
  const router = useRouter();

  const projectId = String((params as any)?.id ?? "");
  const kyId = String((params as any)?.kyId ?? "");

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [project, setProject] = useState<Project | null>(null);
  const [row, setRow] = useState<KyRow | null>(null);

  // 入力欄
  const [workDate, setWorkDate] = useState<string>("");
  const [workDetail, setWorkDetail] = useState<string>("");
  const [hazards, setHazards] = useState<string>("");
  const [countermeasures, setCountermeasures] = useState<string>("");

  const [thirdPartyLevel, setThirdPartyLevel] = useState<"多い" | "少ない">("少ない");

  // AI補足（4枠）
  const [aiWork, setAiWork] = useState<string>("");
  const [aiHazards, setAiHazards] = useState<string>("");
  const [aiCounter, setAiCounter] = useState<string>("");
  const [aiThird, setAiThird] = useState<string>("");

  const [aiGenerating, setAiGenerating] = useState(false);

  const weatherSlots = useMemo(() => parseWeatherSlots(row?.weather_slots), [row?.weather_slots]);

  const appliedHour = useMemo(() => {
    const n = Number((row as any)?.applied_hour);
    return n === 9 || n === 12 || n === 15 ? (n as 9 | 12 | 15) : null;
  }, [row]);

  const appliedSlot = useMemo(() => {
    if (!weatherSlots.length || appliedHour == null) return null;
    return weatherSlots.find((slt) => slt.hour === appliedHour) ?? null;
  }, [weatherSlots, appliedHour]);

  const appliedLine = useMemo(() => {
    if (appliedSlot) {
      const parts: string[] = [];
      parts.push(`適用中：${String(appliedSlot.hour).padStart(2, "0")}:00`);
      if (appliedSlot.weather_text) parts.push(appliedSlot.weather_text);
      if (appliedSlot.temperature_c != null) parts.push(`気温${appliedSlot.temperature_c}℃`);
      if (appliedSlot.wind_direction_deg != null) parts.push(`風向${degToCompassJa(appliedSlot.wind_direction_deg)}`);
      if (appliedSlot.wind_speed_ms != null) parts.push(`風速${appliedSlot.wind_speed_ms}m/s`);
      if (appliedSlot.precipitation_mm != null) parts.push(`雨量${appliedSlot.precipitation_mm}mm`);
      return parts.join(" / ");
    }

    const parts: string[] = [];
    if (row?.weather) parts.push(row.weather);
    if (row?.temperature_text) parts.push(`気温${row.temperature_text}`);
    if (row?.wind_direction) parts.push(`風向${row.wind_direction}`);
    if (row?.wind_speed_text) parts.push(`風速${row.wind_speed_text}`);
    if (row?.precipitation_mm != null) parts.push(`雨量${row.precipitation_mm}mm`);
    return parts.length ? `適用中：${parts.join(" / ")}` : "適用中：（未適用）";
  }, [appliedSlot, row]);

  const load = useCallback(async () => {
    if (!projectId || !kyId) return;
    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data: ky, error: kyErr } = await supabase.from("ky_entries").select("*").eq("id", kyId).maybeSingle();
      if (kyErr) throw kyErr;
      if (!ky) throw new Error("KYが見つかりません");

      // ✅ lat/lon を取得
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("id,name,lat,lon")
        .eq("id", projectId)
        .maybeSingle();
      if (projErr) throw projErr;

      setRow(ky as any);
      setProject((proj as any) ?? null);

      setWorkDate((ky as any)?.work_date ?? "");
      setWorkDetail((ky as any)?.work_detail ?? "");
      setHazards((ky as any)?.hazards ?? "");
      setCountermeasures((ky as any)?.countermeasures ?? "");

      // 第三者：存在する列から拾う
      const t = (ky as any)?.third_party_level ?? (ky as any)?.third_party_status ?? (ky as any)?.third_party ?? null;
      setThirdPartyLevel(normalizeThirdPartyLabel(t));

      // AI補足：保存値 ai_supplement を分割して4枠へ
      const parts = splitAiSupplement(String((ky as any)?.ai_supplement ?? ""));
      setAiWork(parts.work);
      setAiHazards(parts.hazards);
      setAiCounter(parts.counter);
      setAiThird(parts.third);

      setLoading(false);
    } catch (e: any) {
      console.error(e);
      setLoading(false);
      setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    }
  }, [projectId, kyId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRegenerateAi = useCallback(async () => {
    if (isApprovedLike(row)) {
      setStatus({ type: "error", text: "承認済みのため、AI補足の再生成はできません。" });
      return;
    }

    setAiGenerating(true);
    setStatus({ type: null, text: "AI補足を再生成中..." });

    try {
      const w = (workDetail ?? "").trim();
      if (!w) throw new Error("作業内容（必須）が空です");

      const third = normalizeThirdPartyLabel(thirdPartyLevel);

      const slotsForAi = (weatherSlots || []).map((x) => ({
        hour: x.hour,
        weather_text: x.weather_text,
        temperature_c: x.temperature_c ?? null,
        wind_direction_deg: x.wind_direction_deg ?? null,
        wind_speed_ms: x.wind_speed_ms ?? null,
        precipitation_mm: x.precipitation_mm ?? null,
      }));

      // ✅ lat/lon をpayloadに載せる
      const lat = project?.lat ?? null;
      const lon = project?.lon ?? null;

      const payload: any = {
        work_detail: w,
        hazards: (hazards ?? "").trim() ? (hazards ?? "").trim() : null,
        countermeasures: (countermeasures ?? "").trim() ? (countermeasures ?? "").trim() : null,
        third_party_level: third ? third : null,
        weather_slots: slotsForAi.length ? slotsForAi : null,
        lat,
        lon,

        // 編集画面は写真を扱っていないので null（API側は画像無しでも動く）
        slope_photo_url: null,
        slope_prev_photo_url: null,
        path_photo_url: null,
        path_prev_photo_url: null,
      };

      const res = await fetch("/api/ky-ai-supplement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(payload),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "AI補足生成に失敗しました");

      const combined = normalizeText(s(j?.ai_supplement));
      const split = splitAiCombined(combined);

      setAiWork(normalizeText(split.work));
      setAiHazards(normalizeText(split.hazards));
      setAiCounter(normalizeText(split.countermeasures));
      setAiThird(normalizeText(split.third));

      setStatus({ type: "success", text: "AI補足を再生成しました（未保存）" });
    } catch (e: any) {
      console.error(e);
      setStatus({ type: "error", text: e?.message ?? "AI補足生成に失敗しました" });
    } finally {
      setAiGenerating(false);
    }
  }, [row, project, workDetail, hazards, countermeasures, thirdPartyLevel, weatherSlots]);

  const onSave = useCallback(async () => {
    if (!kyId) return;

    try {
      setSaving(true);
      setStatus({ type: null, text: "" });

      const ai_supplement = buildAiSupplementFromParts({
        work: aiWork,
        hazards: aiHazards,
        counter: aiCounter,
        third: aiThird,
      });

      const thirdLabel = normalizeThirdPartyLabel(thirdPartyLevel);
      const thirdBool = thirdLabel === "多い";

      // ✅ まず「確実にある列」だけでpatchを作る（これで400自体を潰す）
      const patch: any = {
        work_date: workDate || null,
        work_detail: workDetail,
        hazards,
        countermeasures,
        ai_supplement: ai_supplement ? ai_supplement : null,
      };

      // ✅ DBに存在する第三者列だけ追加（rowにキーが存在する＝列が存在する）
      if (row && Object.prototype.hasOwnProperty.call(row, "third_party_level")) patch.third_party_level = thirdLabel;
      if (row && Object.prototype.hasOwnProperty.call(row, "third_party_status")) patch.third_party_status = thirdLabel;
      if (row && Object.prototype.hasOwnProperty.call(row, "third_party")) patch.third_party = thirdBool;

      const { error } = await supabase.from("ky_entries").update(patch).eq("id", kyId);
      if (error) throw new Error(error.message);

      setStatus({ type: "success", text: "更新しました" });
      router.push(`/projects/${projectId}/ky`);
    } catch (e: any) {
      console.error(e);
      setStatus({ type: "error", text: e?.message ?? "更新に失敗しました" });
    } finally {
      setSaving(false);
    }
  }, [kyId, projectId, workDate, workDetail, hazards, countermeasures, thirdPartyLevel, aiWork, aiHazards, aiCounter, aiThird, row, router]);

  const approved = isApprovedLike(row);

  // ✅ AI表示（レビューと同じ：危険予知/対策は5件・番号なし・重複/注記除去）
  const aiHazardsTop5 = useMemo(() => formatHazardsForView5(aiHazards), [aiHazards]);
  const aiMeasuresTop5 = useMemo(() => formatMeasuresForView5(aiCounter), [aiCounter]);
  const aiThirdView = useMemo(() => formatThirdForView(aiThird), [aiThird]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-slate-600">読み込み中…</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xl font-bold">KY 編集</div>
          <div className="text-sm text-gray-700 mt-1">工事件名：{project?.name ?? "（未設定）"}</div>
        </div>

        <Link className="text-blue-600 underline" href={`/projects/${projectId}/ky`}>
          ← KY一覧へ
        </Link>
      </div>

      {status.type && (
        <div className={`p-3 rounded ${status.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          {status.text}
        </div>
      )}

      {/* --- 基本 --- */}
      <div className="border rounded-xl bg-white">
        <div className="px-4 py-3 border-b font-semibold">基本</div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4">
          <div className="text-sm text-gray-700">作業日</div>
          <input type="date" className="border rounded px-3 py-2 w-full" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />

          <div className="text-sm text-gray-700">
            協力会社 <span className="text-red-600">（必須）</span>
          </div>
          <input className="border rounded px-3 py-2 w-full bg-gray-50" value={row?.partner_company_name ?? ""} readOnly />
        </div>

        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-[140px_1fr] gap-4">
          <div className="text-sm text-gray-700">作業内容</div>
          <textarea className="border rounded p-3 w-full" rows={4} value={workDetail} onChange={(e) => setWorkDetail(e.target.value)} />

          <div className="text-sm text-gray-700">危険予知</div>
          <textarea className="border rounded p-3 w-full" rows={4} value={hazards} onChange={(e) => setHazards(e.target.value)} />

          <div className="text-sm text-gray-700">対策</div>
          <textarea className="border rounded p-3 w-full" rows={4} value={countermeasures} onChange={(e) => setCountermeasures(e.target.value)} />

          <div className="text-sm text-gray-700">第三者（墓参者）</div>
          <select className="border rounded px-3 py-2 w-full" value={thirdPartyLevel} onChange={(e) => setThirdPartyLevel(e.target.value as any)}>
            <option value="多い">多い</option>
            <option value="少ない">少ない</option>
          </select>
        </div>
      </div>

      {/* --- 気象 --- */}
      <div className="border rounded-xl bg-white p-4">
        <div className="font-semibold">気象（9/12/15）</div>

        {!weatherSlots.length ? (
          <div className="text-sm text-gray-600 mt-1">（気象スロットがありません）</div>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlots.map((slt) => (
              <div key={slt.hour} className="border rounded p-3 bg-slate-50">
                <div className="font-semibold">{String(slt.hour).padStart(2, "0")}:00</div>
                <div className="text-sm mt-1">{slt.weather_text}</div>
                <div className="text-xs text-gray-700 mt-1">
                  気温 {slt.temperature_c ?? "—"}℃ / 風向 {degToCompassJa(slt.wind_direction_deg)} / 風速 {slt.wind_speed_ms ?? "—"}m/s / 雨量{" "}
                  {slt.precipitation_mm ?? "—"}mm
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-sm text-gray-700 mt-3">{appliedLine}</div>
      </div>

      {/* --- AI補足（保存値）--- */}
      <div className="border rounded-xl bg-white">
        <div className="px-4 py-3 border-b font-semibold flex items-center justify-between gap-3">
          <div>AI補足（保存値）</div>

          <button
            type="button"
            onClick={onRegenerateAi}
            disabled={aiGenerating || approved}
            className={`px-3 py-2 rounded border text-sm ${
              aiGenerating || approved ? "bg-slate-100 text-slate-400 border-slate-200" : "bg-white hover:bg-slate-50 border-slate-300"
            }`}
            title={approved ? "承認済みのため再生成不可" : "AI補足を再生成"}
          >
            {aiGenerating ? "再生成中..." : approved ? "承認済み" : "AI補足を再生成"}
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold mb-1">作業内容の補足（AI）</div>
            <textarea className="border rounded p-3 w-full" rows={4} value={aiWork} onChange={(e) => setAiWork(e.target.value)} />
          </div>

          <div>
            <div className="text-sm font-semibold mb-1">危険予知の補足（AI：上位5項目・番号なし）</div>
            {aiHazardsTop5.length ? (
              <div className="border rounded p-3 bg-white">
                <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                  {aiHazardsTop5.map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-slate-600 border rounded p-3 bg-white">（なし）</div>
            )}
            <textarea className="border rounded p-3 w-full mt-2" rows={4} value={aiHazards} onChange={(e) => setAiHazards(e.target.value)} />
          </div>

          <div>
            <div className="text-sm font-semibold mb-1">対策の補足（AI：上位5項目・番号なし）</div>
            {aiMeasuresTop5.length ? (
              <div className="border rounded p-3 bg-white">
                <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                  {aiMeasuresTop5.map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-slate-600 border rounded p-3 bg-white">（なし）</div>
            )}
            <textarea className="border rounded p-3 w-full mt-2" rows={4} value={aiCounter} onChange={(e) => setAiCounter(e.target.value)} />
          </div>

          <div>
            <div className="text-sm font-semibold mb-1">第三者の補足（AI：番号なし）</div>
            {aiThirdView.length ? (
              <div className="border rounded p-3 bg-white">
                <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                  {aiThirdView.map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-slate-600 border rounded p-3 bg-white">（なし）</div>
            )}
            <textarea className="border rounded p-3 w-full mt-2" rows={4} value={aiThird} onChange={(e) => setAiThird(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button className={`px-5 py-3 rounded bg-black text-white ${saving ? "opacity-50" : ""}`} onClick={onSave} disabled={saving}>
          更新して一覧へ
        </button>
        <button className="px-5 py-3 rounded border" onClick={() => router.push(`/projects/${projectId}/ky`)} type="button">
          キャンセル
        </button>
      </div>
    </div>
  );
}
