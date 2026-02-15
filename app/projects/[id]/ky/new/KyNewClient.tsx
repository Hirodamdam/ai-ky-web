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

function slotSummary(slot: WeatherSlot | null | undefined): string {
  if (!slot) return "";
  const w = slot.weather_text || "（不明）";
  const t = slot.temperature_c == null ? "—" : `${slot.temperature_c}℃`;
  const wd = degToDirJp(slot.wind_direction_deg) || "—";
  const ws = slot.wind_speed_ms == null ? "—" : `${slot.wind_speed_ms}m/s`;
  const p = slot.precipitation_mm == null ? "—" : `${slot.precipitation_mm}mm`;
  return `${w} / 気温${t} / 風${wd} ${ws} / 降水${p}`;
}

/** =========================
 *  表示用整形（壊さず改良）
 *  - 重複除去
 *  - 重要度スコアリング
 *  - 上位N件抽出（デフォルト20）
 *  - 番号削除（全項目統一）
 *  - 人入力との最小一致文削除
 * ========================= */

function normalizeLineBase(raw: string): string {
  return raw
    .replace(/\u3000/g, " ")
    .replace(/^[•・\-*]\s*/, "")
    .replace(/^\s*\[\s*\d+\s*\]\s*/g, "")
    .replace(/^\s*\d+\s*[)\.．、]\s*/g, "")
    .replace(/^\s*（\s*\d+\s*）\s*/g, "")
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
  const seps = ["→", "⇒", "->", "＞", "〉", "→→"];
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

function normalizeForSim(x: string): string {
  return (x || "")
    .toLowerCase()
    .replace(/\u3000/g, " ")
    .replace(/[（）()\[\]【】「」『』]/g, "")
    .replace(/[、，,。．.・:：;；/／|｜]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function charBigrams(x: string): Set<string> {
  const t = normalizeForSim(x).replace(/\s+/g, "");
  const s2 = t;
  const out = new Set<string>();
  if (s2.length <= 1) return out;
  for (let i = 0; i < s2.length - 1; i++) out.add(s2.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

function isTooSimilarToHuman(line: string, humanText: string, threshold = 0.42): boolean {
  const h = normalizeForSim(humanText);
  if (!h) return false;

  const a = charBigrams(line);
  if (!a.size) return false;

  const candidates = h
    .split(/\n+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  for (const c of candidates) {
    const b = charBigrams(c);
    const sim = jaccard(a, b);
    if (sim >= threshold) return true;
  }
  return false;
}

function scoreImportance(line: string, kind: "hazard" | "measure" | "third"): number {
  const t = normalizeForSim(line);

  const strong = [
    "墜落",
    "転落",
    "崩壊",
    "土砂",
    "法面",
    "落下",
    "飛来",
    "挟まれ",
    "巻き込まれ",
    "接触",
    "重機",
    "バックホウ",
    "ユンボ",
    "クレーン",
    "玉掛",
    "感電",
    "ガス",
    "酸欠",
    "火災",
    "倒壊",
    "逸走",
    "第三者",
    "墓参者",
    "一般",
    "通行人",
    "車両",
    "交通",
    "交差",
    "誘導",
  ];

  const medium = [
    "滑り",
    "足元",
    "段差",
    "転倒",
    "つまず",
    "視界",
    "死角",
    "手元",
    "工具",
    "刃物",
    "切創",
    "打撃",
    "激突",
    "騒音",
    "粉じん",
    "粉塵",
    "飛散",
    "風",
    "強風",
    "雨",
    "降雨",
    "ぬかるみ",
    "路面",
    "養生",
    "区画",
    "立入",
    "立入禁止",
    "カラーコーン",
    "バリケード",
    "ロープ",
    "看板",
    "声掛け",
    "監視",
  ];

  let score = 10;

  for (const w of strong) if (t.includes(w)) score += 18;
  for (const w of medium) if (t.includes(w)) score += 10;

  if (kind === "measure") {
    const good = ["立入禁止", "区画", "誘導", "合図", "指差呼称", "退避", "停止", "監視", "点検", "KY", "周知", "周囲確認"];
    for (const w of good) if (t.includes(w)) score += 6;
  }
  if (kind === "third") {
    const good = ["誘導", "区画", "導線", "声掛け", "案内", "掲示", "停止", "同伴", "見守り"];
    for (const w of good) if (t.includes(w)) score += 6;
  }

  const len = normalizeForSim(line).length;
  if (len >= 60) score -= 8;
  if (len >= 90) score -= 12;

  if (t === "注意する" || t === "気をつける" || t === "安全に作業する") score -= 20;

  return Math.max(0, score);
}

function splitMeasuresLine(line: string): string[] {
  const t = line.trim();

  const noLead = t
    .replace(/^\s*\[\s*\d+\s*\]\s*/g, "")
    .replace(/^\s*\d+[)\.．、]\s*/g, "")
    .trim();

  const hasMulti = /\[\s*\d+\s*\]/.test(noLead);
  if (!hasMulti) return [noLead];

  const parts = noLead
    .split(/\[\s*\d+\s*\]/g)
    .map((x) => x.replace(/^[、,\s]+/, "").trim())
    .filter(Boolean);

  return parts.length ? parts : [noLead];
}

/** ✅ 上位N抽出（デフォルト20） */
function pickByScore(lines: string[], kind: "hazard" | "measure" | "third", limit = 20): string[] {
  const scored = lines
    .map((x) => ({ x: x.trim(), score: scoreImportance(x, kind) }))
    .filter((it) => it.x && it.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const out: string[] = [];
  for (const it of scored) {
    if (out.length >= limit) break;
    out.push(it.x);
  }
  return out;
}

/** 危険予知：右側だけ採用、注記削除、重複除去、上位N、人入力と類似は除外、番号なし */
function formatHazardsForView(text: string, humanHazards: string, limit = 20): string[] {
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
    v = normalizeLineBase(v);
    v = stripGenericAccidentNote(v);
    v = v.replace(/（\s*[^）]*事故[^）]*恐れ\s*）\s*$/g, "").trim();

    if (/^危険予知/i.test(v) || /^対策/i.test(v) || /^AI補足/i.test(v)) continue;
    if (!v) continue;

    if (isTooSimilarToHuman(v, humanHazards, 0.42)) continue;

    picked.push(v);
  }

  const deduped = dedupeKeepOrder(picked);
  const ranked = pickByScore(deduped, "hazard", limit);

  // 保険：スコアで減り過ぎたら先頭から補完（最大limit）
  if (ranked.length < Math.min(8, limit)) {
    for (const x of deduped) {
      if (ranked.length >= limit) break;
      if (ranked.includes(x)) continue;
      ranked.push(x);
    }
  }

  return ranked.slice(0, limit);
}

/** 対策：番号削除、複合行分割、右側だけ採用、重複除去、上位N、人入力と類似は除外、番号なし */
function formatMeasuresForView(text: string, humanMeasures: string, limit = 20): string[] {
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
      p = normalizeLineBase(p);

      if (/^対策/i.test(p) || /^AI補足/i.test(p)) continue;
      if (!p) continue;

      if (isTooSimilarToHuman(p, humanMeasures, 0.40)) continue;

      items.push(p);
    }
  }

  const deduped = dedupeKeepOrder(items);
  const ranked = pickByScore(deduped, "measure", limit);

  if (ranked.length < Math.min(8, limit)) {
    for (const x of deduped) {
      if (ranked.length >= limit) break;
      if (ranked.includes(x)) continue;
      ranked.push(x);
    }
  }

  return ranked.slice(0, limit);
}

/** 第三者：番号削除、重複除去、人入力（第三者レベル）と一致しそうな薄い文は落とす（上限なし） */
function formatThirdForView(text: string, thirdLevelHuman: string): string[] {
  const raw = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((x) => normalizeLineBase(x))
    .map((x) => x.replace(/^[•・\-*]\s*/, "").trim())
    .filter(Boolean);

  const filtered = raw.filter((x) => {
    const t = normalizeForSim(x);
    if (!t) return false;
    if (t === "多い" || t === "少ない") return false;
    if (thirdLevelHuman && isTooSimilarToHuman(x, thirdLevelHuman, 0.55)) return false;
    return true;
  });

  return dedupeKeepOrder(filtered);
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

  const [aiWork, setAiWork] = useState("");
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

  const buildAiPayload = useCallback(async () => {
    const w = workDetail.trim();
    if (!w) throw new Error("作業内容（必須）を入力してください");

    let slopeNowUrl: string | null = null;
    let pathNowUrl: string | null = null;

    if (slopeMode === "url") slopeNowUrl = slopeUrlFromProject || null;
    if (slopeMode === "file" && slopeFile) slopeNowUrl = await uploadToStorage(slopeFile, "slope");

    if (pathMode === "url") pathNowUrl = pathUrlFromProject || null;
    if (pathMode === "file" && pathFile) pathNowUrl = await uploadToStorage(pathFile, "path");

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
      // ✅ 人入力は投げない（今の仕様維持）
      hazards: hazards.trim() ? hazards.trim() : null,
      countermeasures: countermeasures.trim() ? countermeasures.trim() : null,
      third_party_level: thirdPartyLevel.trim() ? thirdPartyLevel.trim() : null,

      worker_count: workerCount.trim() ? Number(workerCount.trim()) : null,

      lat,
      lon,

      weather_slots: slotsForAi.length ? slotsForAi : null,
      slope_photo_url: slopeNowUrl,
      slope_prev_photo_url: slopePrevUrl || null,
      path_photo_url: pathNowUrl,
      path_prev_photo_url: pathPrevUrl || null,
    };
  }, [
    workDetail,
    hazards,
    countermeasures,
    thirdPartyLevel,
    workerCount,
    appliedSlots,
    slopeMode,
    pathMode,
    slopeUrlFromProject,
    pathUrlFromProject,
    slopeFile,
    pathFile,
    uploadToStorage,
    slopePrevUrl,
    pathPrevUrl,
    project?.lat,
    project?.lon,
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

      const { data: inserted, error: insErr } = await (supabase as any)
        .from("ky_entries")
        .insert(insertPayload)
        .select("id")
        .maybeSingle();
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

  // ✅ AI表示：最大20件＋スクロール
  const aiHazardsView = useMemo(() => formatHazardsForView(aiHazards, hazards, 20), [aiHazards, hazards]);
  const aiMeasuresView = useMemo(() => formatMeasuresForView(aiCounter, countermeasures, 20), [aiCounter, countermeasures]);
  const aiThirdView = useMemo(() => formatThirdForView(aiThird, thirdPartyLevel), [aiThird, thirdPartyLevel]);

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
        <div className="text-sm font-semibold text-slate-800">第三者の状況</div>
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-800">AI補足（箇条書き）</div>
          <button
            type="button"
            onClick={onGenerateAi}
            disabled={aiGenerating}
            className={`rounded-lg border px-3 py-2 text-sm ${
              aiGenerating ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
            }`}
          >
            {aiGenerating ? "生成中..." : "AI補足を生成"}
          </button>
        </div>

        {/* ✅ 作業内容の補足欄は削除（aiWorkは保持して保存には入るが、UIでは出さない） */}

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足（スクロール表示・最大20項目）</div>
          {aiHazardsView.length ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3 max-h-56 overflow-y-auto">
              <div className="text-xs text-slate-500 mb-2">表示件数：{aiHazardsView.length}</div>
              <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                {aiHazardsView.map((x, i) => (
                  <li key={`${x}-${i}`}>{x}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
          <textarea value={aiHazards} onChange={(e) => setAiHazards(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足（スクロール表示・最大20項目）</div>
          {aiMeasuresView.length ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3 max-h-56 overflow-y-auto">
              <div className="text-xs text-slate-500 mb-2">表示件数：{aiMeasuresView.length}</div>
              <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                {aiMeasuresView.map((x, i) => (
                  <li key={`${x}-${i}`}>{x}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
          <textarea value={aiCounter} onChange={(e) => setAiCounter(e.target.value)} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者の補足（番号なし・重複除去）</div>
          {aiThirdView.length ? (
            <div className="rounded-lg border border-slate-300 bg-white p-3 max-h-56 overflow-y-auto">
              <div className="text-xs text-slate-500 mb-2">表示件数：{aiThirdView.length}</div>
              <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                {aiThirdView.map((x, i) => (
                  <li key={`${x}-${i}`}>{x}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600">（なし）</div>
          )}
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
