// app/projects/[id]/ky/[kyId]/review/KyReviewClient.tsx
"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

type KyEntryRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;

  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  third_party_level?: string | null;

  partner_company_name: string | null;

  worker_count?: number | null;

  weather_slots?: WeatherSlot[] | null;

  ai_work_detail?: string | null;
  ai_hazards?: string | null;
  ai_countermeasures?: string | null;
  ai_third_party?: string | null;
  ai_supplement?: string | null;

  is_approved?: boolean | null;

  approved_at?: string | null;
  approved_by?: string | null;

  public_id?: string | null;
  public_token?: string | null;
  public_enabled?: boolean | null;
  public_enabled_at?: string | null;

  created_at?: string | null;
};

type ProjectRow = {
  id: string;
  name: string | null;
  contractor_name: string | null;
};

type ReadLog = {
  id: string;
  reader_name: string | null;
  reader_role: string | null;
  reader_device: string | null;
  created_at: string | null;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function normalizeName(v: any): string {
  return s(v).replace(/[ 　\t]/g, "").trim();
}

function normEntrantNoLoose(v: any): string {
  return s(v).trim().toUpperCase();
}

function fmtDateJp(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function fmtDateTimeJp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP");
}

function degToDirJp(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "—";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
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
function canonicalKind(kindRaw: string): "slope" | "path" | "" {
  const k = s(kindRaw).trim();
  if (!k) return "";
  if (k === "slope" || k === "slope_photo" || k === "法面") return "slope";
  if (k === "path" || k === "path_photo" || k === "通路") return "path";
  if (k.includes("slope") || k.includes("法面")) return "slope";
  if (k.includes("path") || k.includes("通路")) return "path";
  return "";
}

function safeParseJson(text: string | null | undefined): any | null {
  const t = s(text).trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function pickAiFromSupplement(obj: any): { work: string; hazards: string; measures: string; third: string } {
  const get = (keys: string[]) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "";
  };

  return {
    work: get(["work_detail", "workDetail", "ai_work_detail"]),
    hazards: get(["hazards", "hazard", "ai_hazards"]),
    measures: get(["countermeasures", "measures", "counterMeasures", "ai_countermeasures"]),
    third: get(["third_party", "thirdParty", "ai_third_party"]),
  };
}

function splitAiHeadedText(text: string): { work: string; hazards: string; counter: string; third: string } {
  const src = s(text).replace(/\r\n/g, "\n").trim();
  if (!src) return { work: "", hazards: "", counter: "", third: "" };

  const normalizeLabel = (x: string) => x.replace(/[｜|]/g, "|");
  const src2 = normalizeLabel(src);

  const marks: Array<{ idx: number; key: "work" | "hazards" | "counter" | "third"; len: number }> = [];
  const patterns: Array<{ key: "work" | "hazards" | "counter" | "third"; re: RegExp }> = [
    { key: "work", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*作業内容\s*[】\]]\s*/g },
    { key: "hazards", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*危険予知\s*[】\]]\s*/g },
    { key: "counter", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*対策\s*[】\]]\s*/g },
    { key: "third", re: /(?:^|\n)\s*[【\[]\s*AI補足\s*[｜|]\s*第三者\s*[】\]]\s*/g },
  ];

  for (const p of patterns) {
    let m: RegExpExecArray | null;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(src2))) {
      marks.push({ idx: m.index, key: p.key, len: m[0].length });
    }
  }
  marks.sort((a, b) => a.idx - b.idx);

  if (!marks.length) return { work: src, hazards: "", counter: "", third: "" };

  const out = { work: "", hazards: "", counter: "", third: "" };
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const next = marks[i + 1];
    const start = cur.idx + cur.len;
    const end = next ? next.idx : src2.length;
    const chunk = src2.slice(start, end).trim();
    if (!chunk) continue;
    (out as any)[cur.key] = (out as any)[cur.key] ? `${(out as any)[cur.key]}\n${chunk}` : chunk;
  }
  return out;
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

/** =========================
 * AI補足：見せ方（あなたの箇条書き要求をコード化）
 * - 重複除去：AI各行が人入力に一定以上似ていたら除外
 * - 重要度スコアリング：危険系キーワードで加点
 * - 上位5件抽出：点数でソートして5件
 * - 番号削除：番号/記号を除去して「番号なし・箇条書き」統一
 * - 最小一致文削除：テンプレ寄り語は減点して沈める
 * - 整合：対策側は「上位危険予知と同じ語を含む行」を加点
 * ========================= */

const DANGER_KEYWORDS: Array<{ k: string; w: number }> = [
  { k: "墜落", w: 6 },
  { k: "転落", w: 6 },
  { k: "崩壊", w: 6 },
  { k: "落石", w: 6 },
  { k: "土砂", w: 5 },
  { k: "崩れる", w: 5 },
  { k: "挟まれ", w: 6 },
  { k: "巻き込まれ", w: 6 },
  { k: "重機", w: 5 },
  { k: "バックホウ", w: 5 },
  { k: "ユンボ", w: 5 },
  { k: "クレーン", w: 5 },
  { k: "吊り荷", w: 6 },
  { k: "第三者", w: 6 },
  { k: "通行人", w: 6 },
  { k: "墓参", w: 6 },
  { k: "飛来", w: 5 },
  { k: "落下物", w: 6 },
  { k: "感電", w: 6 },
  { k: "火災", w: 5 },
  { k: "酸欠", w: 6 },
  { k: "有毒", w: 6 },
  { k: "熱中症", w: 4 },
  { k: "強風", w: 4 },
  { k: "雨", w: 3 },
  { k: "滑落", w: 6 },
];

const GENERIC_TEMPLATES: Array<{ k: string; p: number }> = [
  { k: "ヘルメット", p: 3 },
  { k: "保護具", p: 3 },
  { k: "安全帯", p: 2 },
  { k: "声掛け", p: 3 },
  { k: "注意する", p: 3 },
  { k: "注意喚起", p: 3 },
  { k: "周知徹底", p: 3 },
  { k: "安全確認", p: 2 },
  { k: "整理整頓", p: 2 },
  { k: "KY活動", p: 2 },
  { k: "ルール遵守", p: 2 },
];

function normalizeJa(s0: string): string {
  return (s0 ?? "")
    .toString()
    .replace(/\s+/g, "")
    .replace(/[・･]/g, "")
    .replace(/[（）()\[\]【】「」『』]/g, "")
    .replace(/[.,。､、:：;；!?！？]/g, "")
    .trim()
    .toLowerCase();
}

// 2-gram Jaccard（日本語向け）
function shingles2(s0: string): Set<string> {
  const t = normalizeJa(s0);
  const set = new Set<string>();
  if (!t) return set;
  if (t.length === 1) {
    set.add(t);
    return set;
  }
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

function similarity(a: string, b: string): number {
  return jaccard(shingles2(a), shingles2(b));
}

function stripLeadingMarker(line: string): string {
  return (line ?? "")
    .replace(/^\s*(?:\(?\d+\)?[).．、:]|\(?[一二三四五六七八九十]+\)?[).．、:]|[①-⑳]|[-–—*・●◯◎■□▶▷◆◇])\s*/g, "")
    .trim();
}

function splitLines(text: string | null | undefined): string[] {
  const raw = (text ?? "").toString();
  return raw
    .split(/\r?\n+/)
    .map((x) => stripLeadingMarker(x))
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter((x) => x.length >= 2);
}

function uniqExact(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const key = normalizeJa(l);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function scoreBase(line: string): number {
  let score = 0;

  for (const { k, w } of DANGER_KEYWORDS) {
    if (line.includes(k)) score += w;
  }

  for (const { k, p } of GENERIC_TEMPLATES) {
    if (line.includes(k)) score -= p;
  }

  const len = normalizeJa(line).length;
  if (len <= 6) score -= 2;
  if (len <= 3) score -= 4;

  return score;
}

function extractHitKeywords(lines: string[]): string[] {
  const hits = new Set<string>();
  for (const l of lines) {
    for (const { k } of DANGER_KEYWORDS) if (l.includes(k)) hits.add(k);
  }
  return Array.from(hits);
}

type ProcessOptions = {
  humanText?: string;
  similarityThreshold?: number;
  topN?: number;
  alignKeywords?: string[];
  alignBonus?: number;
};

function processAiLines(aiText: string | null | undefined, opts: ProcessOptions = {}) {
  const { humanText = "", similarityThreshold = 0.72, topN = 5, alignKeywords = [], alignBonus = 2 } = opts;

  const humanLines = uniqExact(splitLines(humanText));
  const aiLines = uniqExact(splitLines(aiText));

  const filtered = aiLines.filter((l) => {
    if (!humanLines.length) return true;
    const maxSim = humanLines.reduce((m, h) => Math.max(m, similarity(l, h)), 0);
    return maxSim < similarityThreshold;
  });

  const scored = filtered.map((l) => {
    let sc = scoreBase(l);

    if (alignKeywords.length) {
      let hit = 0;
      for (const k of alignKeywords) if (l.includes(k)) hit++;
      if (hit) sc += Math.min(alignBonus * hit, 6);
    }

    return { line: l, score: sc };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}

function renderBullets(lines: Array<{ line: string; score: number }>) {
  if (!lines.length) return null;
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm text-slate-800">
      {lines.map((x, i) => (
        <li key={`${i}-${x.line.slice(0, 24)}`}>{x.line}</li>
      ))}
    </ul>
  );
}

/** ============ リスク評価（API計算：0-100） ============ */

type SummaryItem = {
  key: "weather" | "photo" | "third_party" | "workers" | "text_quality_ai";
  label: string;
  score: number;
  reason: string;
};

type BreakdownItem = { score: number; reasons: string[] };

type RiskOut = {
  total_human: number;
  total_ai: number;
  delta: number;
  breakdown: {
    weather: BreakdownItem;
    photo: BreakdownItem;
    third_party: BreakdownItem;
    workers: BreakdownItem;
    keyword: BreakdownItem;
    text_quality_human: BreakdownItem;
    text_quality_ai: BreakdownItem;
  };
  ai_top5: SummaryItem[];
  meta?: any;
};

export default function KyReviewClient() {
  const params = useParams() as { id?: string; kyId?: string };
  const router = useRouter();

  const projectId = useMemo(() => String(params?.id ?? ""), [params?.id]);
  const kyId = useMemo(() => String(params?.kyId ?? ""), [params?.kyId]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<ProjectRow | null>(null);
  const [ky, setKy] = useState<KyEntryRow | null>(null);

  const [slopeNowUrl, setSlopeNowUrl] = useState<string>("");
  const [slopePrevUrl, setSlopePrevUrl] = useState<string>("");
  const [pathNowUrl, setPathNowUrl] = useState<string>("");
  const [pathPrevUrl, setPathPrevUrl] = useState<string>("");

  const [acting, setActing] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [qrOpen, setQrOpen] = useState(false);

  // ✅ 既読一覧
  const [readLoading, setReadLoading] = useState(false);
  const [readLogs, setReadLogs] = useState<ReadLog[]>([]);
  const [readErr, setReadErr] = useState<string>("");

  // ✅ 未読（入場登録ベース）
  const [unreadLoading, setUnreadLoading] = useState(false);
  const [unreadList, setUnreadList] = useState<string[]>([]);
  const [unreadMode, setUnreadMode] = useState<"person" | "company" | "none">("none");
  const [unreadErr, setUnreadErr] = useState<string>("");

  // ✅ リスク（API）
  const [risk, setRisk] = useState<RiskOut | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskErr, setRiskErr] = useState("");

  // ✅ 表示用：既読者を未読から除外（表記ゆれ対策）
  const unreadFiltered = useMemo(() => {
    const readNameSet = new Set(readLogs.map((r) => normalizeName(r.reader_name)));
    const readNoSet = new Set(
      readLogs
        .map((r) => normalizeName(r.reader_name))
        .filter(Boolean)
        .map((x) => {
          const m = x.match(/^No:([0-9A-Za-z_-]{1,32})$/i);
          if (!m) return "";
          return `No:${normEntrantNoLoose(m[1])}`;
        })
        .filter(Boolean)
    );

    return (unreadList || []).filter((name) => {
      const n = normalizeName(name);
      if (!n) return false;

      if (readNameSet.has(n)) return false;

      const m = n.match(/^No:([0-9A-Za-z_-]{1,32})$/i);
      if (m) {
        const key = `No:${normEntrantNoLoose(m[1])}`;
        if (readNoSet.has(key)) return false;
      }

      return true;
    });
  }, [unreadList, readLogs]);

  const statusClass = useMemo(() => {
    if (status.type === "success") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    if (status.type === "error") return "border border-rose-200 bg-rose-50 text-rose-800";
    return "border border-slate-200 bg-slate-50 text-slate-700";
  }, [status.type]);

  const latestReadAt = useMemo(() => {
    const t = readLogs?.[0]?.created_at;
    return t ? fmtDateTimeJp(t) : "";
  }, [readLogs]);

  const loadReadLogs = useCallback(async () => {
    setReadErr("");
    setReadLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("セッションがありません。ログインしてください。");

      const j = await postJsonTry(["/api/ky-read-list"], { projectId, kyId, accessToken });
      const arr = Array.isArray(j?.logs) ? (j.logs as ReadLog[]) : [];
      setReadLogs(arr);
    } catch (e: any) {
      setReadErr(e?.message ?? "既読一覧の取得に失敗しました");
      setReadLogs([]);
    } finally {
      setReadLoading(false);
    }
  }, [projectId, kyId]);

  const loadUnread = useCallback(async () => {
    setUnreadErr("");
    setUnreadLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("セッションがありません。ログインしてください。");

      const j = await postJsonTry(["/api/ky-unread-list"], { projectId, kyId, accessToken });

      const mode = s(j?.mode).trim();
      if (mode === "person" || mode === "company" || mode === "none") setUnreadMode(mode);
      else setUnreadMode("none");

      const arr = Array.isArray(j?.unread) ? (j.unread as string[]) : [];
      setUnreadList(arr.map((x) => s(x).trim()).filter(Boolean));
    } catch (e: any) {
      setUnreadErr(e?.message ?? "未読一覧の取得に失敗しました");
      setUnreadList([]);
      setUnreadMode("none");
    } finally {
      setUnreadLoading(false);
    }
  }, [projectId, kyId]);

  const load = useCallback(async () => {
    if (!projectId || !kyId) return;

    setLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const { data: kyRow, error: kyErr } = await supabase
        .from("ky_entries")
        .select(
          [
            "id",
            "project_id",
            "work_date",
            "work_detail",
            "hazards",
            "countermeasures",
            "third_party_level",
            "partner_company_name",
            "worker_count",
            "weather_slots",
            "ai_work_detail",
            "ai_hazards",
            "ai_countermeasures",
            "ai_third_party",
            "ai_supplement",
            "is_approved",
            "approved_at",
            "approved_by",
            "public_id",
            "public_token",
            "public_enabled",
            "public_enabled_at",
            "created_at",
          ].join(",")
        )
        .eq("id", kyId)
        .maybeSingle();

      if (kyErr) throw kyErr;

      const kyDataRaw: KyEntryRow | null = (kyRow as any) ?? null;
      const kyData: KyEntryRow | null = kyDataRaw ? ({ ...kyDataRaw } as KyEntryRow) : null;

      if (kyData) {
        const sup = safeParseJson(kyData.ai_supplement);
        if (sup) {
          const parsed = pickAiFromSupplement(sup);
          if (!s(kyData.ai_work_detail).trim() && parsed.work) kyData.ai_work_detail = parsed.work;
          if (!s(kyData.ai_hazards).trim() && parsed.hazards) kyData.ai_hazards = parsed.hazards;
          if (!s(kyData.ai_countermeasures).trim() && parsed.measures) kyData.ai_countermeasures = parsed.measures;
          if (!s(kyData.ai_third_party).trim() && parsed.third) kyData.ai_third_party = parsed.third;
        } else {
          const parts = splitAiHeadedText(kyData.ai_supplement || "");
          if (!s(kyData.ai_work_detail).trim() && parts.work) kyData.ai_work_detail = parts.work;
          if (!s(kyData.ai_hazards).trim() && parts.hazards) kyData.ai_hazards = parts.hazards;
          if (!s(kyData.ai_countermeasures).trim() && parts.counter) kyData.ai_countermeasures = parts.counter;
          if (!s(kyData.ai_third_party).trim() && parts.third) kyData.ai_third_party = parts.third;
        }
      }
      setKy(kyData);

      const projectTargetId = kyData?.project_id || projectId;
      const { data: pRow, error: pErr } = await supabase.from("projects").select("id,name,contractor_name").eq("id", projectTargetId).maybeSingle();
      if (pErr) throw pErr;
      setProject((pRow as any) ?? null);

      const photoProjectId = kyData?.project_id || projectId;
      const { data: photos, error: phErr } = await supabase
        .from("ky_photos")
        .select("*")
        .eq("project_id", photoProjectId)
        .order("created_at", { ascending: false })
        .limit(200);

      if (phErr) throw phErr;

      let slopeNow = "";
      let slopePrev = "";
      let pathNow = "";
      let pathPrev = "";

      const curKyKey = s(kyId).trim();

      if (Array.isArray(photos)) {
        for (const row of photos as any[]) {
          const url = pickUrl(row);
          if (!url) continue;

          const k = canonicalKind(pickKind(row));
          if (!k) continue;

          const rowKy = s(row?.ky_id).trim() || s(row?.ky_entry_id).trim();
          const isCurrent = rowKy === curKyKey;

          if (k === "slope") {
            if (!slopeNow && isCurrent) {
              slopeNow = url;
              continue;
            }
            if (!slopePrev && !isCurrent) {
              slopePrev = url;
              continue;
            }
          }

          if (k === "path") {
            if (!pathNow && isCurrent) {
              pathNow = url;
              continue;
            }
            if (!pathPrev && !isCurrent) {
              pathPrev = url;
              continue;
            }
          }

          if (slopeNow && slopePrev && pathNow && pathPrev) break;
        }
      }

      setSlopeNowUrl(slopeNow);
      setSlopePrevUrl(slopePrev);
      setPathNowUrl(pathNow);
      setPathPrevUrl(pathPrev);

      if (kyData?.is_approved) {
        await loadReadLogs();
        await loadUnread();
      } else {
        setReadLogs([]);
        setReadErr("");
        setUnreadList([]);
        setUnreadErr("");
        setUnreadMode("none");
      }
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      setLoading(false);
    }
  }, [projectId, kyId, loadReadLogs, loadUnread]);

  useEffect(() => {
    load();
  }, [load]);

  const weatherSlots = useMemo(() => {
    const raw = ky?.weather_slots ?? null;
    const arr = Array.isArray(raw) ? (raw as WeatherSlot[]) : [];
    const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
    // ✅ 保存時に「適用枠を先頭」にしているので、ここでは順序を崩さない
    return filtered;
  }, [ky?.weather_slots]);

  // ✅ 適用枠（保存順の先頭）
  const appliedWeather = useMemo(() => {
    return weatherSlots.length ? weatherSlots[0] : null;
  }, [weatherSlots]);

  const onPrint = useCallback(() => {
    window.print();
  }, []);

  const onApprove = useCallback(async () => {
    setStatus({ type: null, text: "" });
    setActing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("セッションがありません。ログインしてください。");

      const j = await postJsonTry(["/api/ky-approve"], { projectId, kyId, accessToken });

      let token = s(j?.public_token || j?.token || j?.publicToken).trim();
      if (!token) {
        const { data: row, error } = await supabase.from("ky_entries").select("public_token").eq("id", kyId).maybeSingle();
        if (error) throw error;
        token = s((row as any)?.public_token).trim();
      }
      if (!token) throw new Error("公開トークンが取得できませんでした（public_tokenが空です）。");

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}/ky/public/${token}`;

      const msg = `KY承認しました\n${project?.name ? `工事：${project.name}\n` : ""}${url}`;
      const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(msg)}`;

      setStatus({ type: "success", text: "承認しました（LINEを開きます）" });
      await load();
      window.location.href = lineUrl;
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "承認に失敗しました" });
    } finally {
      setActing(false);
    }
  }, [projectId, kyId, load, project?.name]);

  const onUnapprove = useCallback(async () => {
    setStatus({ type: null, text: "" });
    setActing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token;
      if (!accessToken) throw new Error("セッションがありません。ログインしてください。");

      await postJsonTry(["/api/ky-unapprove", "/api/ky-approve"], { projectId, kyId, accessToken, action: "unapprove" });

      setStatus({ type: "success", text: "承認解除しました（公開停止）" });
      await load();
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "承認解除に失敗しました" });
    } finally {
      setActing(false);
    }
  }, [projectId, kyId, load]);

  const onRegenerateAi = useCallback(async () => {
    if (!ky) return;

    if (ky.is_approved) {
      setStatus({ type: "error", text: "承認済みのため、AI補足の再生成はできません。" });
      return;
    }

    setStatus({ type: null, text: "" });
    setAiGenerating(true);

    try {
      const payload = {
        work_detail: ky.work_detail,
        hazards: ky.hazards,
        countermeasures: ky.countermeasures,
        third_party_level: ky.third_party_level,
        weather_slots: weatherSlots,
        slope_photo_url: slopeNowUrl || null,
        slope_prev_photo_url: slopePrevUrl || null,
        path_photo_url: pathNowUrl || null,
        path_prev_photo_url: pathPrevUrl || null,
        worker_count: ky.worker_count ?? null,
      };

      const data = await postJsonTry(["/api/ky-ai-supplement"], payload);

      const next: KyEntryRow = {
        ...ky,
        ai_work_detail: s(data?.ai_work_detail).trim(),
        ai_hazards: s(data?.ai_hazards).trim(),
        ai_countermeasures: s(data?.ai_countermeasures).trim(),
        ai_third_party: s(data?.ai_third_party).trim(),
        ai_supplement: s(data?.ai_supplement).trim() || ky.ai_supplement || null,
      };

      setKy(next);

      const { error } = await supabase
        .from("ky_entries")
        .update({
          ai_work_detail: next.ai_work_detail || null,
          ai_hazards: next.ai_hazards || null,
          ai_countermeasures: next.ai_countermeasures || null,
          ai_third_party: next.ai_third_party || null,
          ai_supplement: next.ai_supplement || null,
        })
        .eq("id", ky.id);

      if (error) throw error;

      setStatus({ type: "success", text: "AI補足を再生成して保存しました。" });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "AI補足の再生成に失敗しました" });
    } finally {
      setAiGenerating(false);
    }
  }, [ky, weatherSlots, slopeNowUrl, slopePrevUrl, pathNowUrl, pathPrevUrl]);

  const publicUrl = useMemo(() => {
    const token = s(ky?.public_token).trim();
    const approved = !!ky?.is_approved;
    if (!approved || !token) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (!origin) return "";
    return `${origin}/ky/public/${token}`;
  }, [ky?.public_token, ky?.is_approved]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!publicUrl) {
        setQrDataUrl("");
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(publicUrl, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 320,
        });
        if (!cancelled) setQrDataUrl(dataUrl);
      } catch {
        if (!cancelled) setQrDataUrl("");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  const onCopyPublicUrl = useCallback(async () => {
    const url = publicUrl;
    if (!url) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setStatus({ type: "success", text: "公開リンクをコピーしました" });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "コピーに失敗しました" });
    }
  }, [publicUrl]);

  /** ============ リスク（API呼び出し） ============ */
  const loadRisk = useCallback(async () => {
    setRiskErr("");
    if (!ky) {
      setRisk(null);
      return;
    }

    setRiskLoading(true);
    try {
      const payload = {
        human: {
          work_detail: ky.work_detail ?? null,
          hazards: ky.hazards ?? null,
          countermeasures: ky.countermeasures ?? null,
          third_party_level: ky.third_party_level ?? null,
          worker_count: ky.worker_count ?? null,
        },
        ai: {
          ai_hazards: ky.ai_hazards ?? null,
          ai_countermeasures: ky.ai_countermeasures ?? null,
          ai_third_party: ky.ai_third_party ?? null,
        },
        weather_applied: appliedWeather
          ? {
              hour: appliedWeather.hour,
              weather_text: appliedWeather.weather_text,
              temperature_c: appliedWeather.temperature_c ?? null,
              wind_direction_deg: appliedWeather.wind_direction_deg ?? null,
              wind_speed_ms: appliedWeather.wind_speed_ms ?? null,
              precipitation_mm: appliedWeather.precipitation_mm ?? null,
            }
          : null,
        photos: {
          slope_now_url: slopeNowUrl || null,
          slope_prev_url: slopePrevUrl || null,
          path_now_url: pathNowUrl || null,
          path_prev_url: pathPrevUrl || null,
        },
      };

      const j = await postJsonTry(["/api/ky-risk-score"], payload);
      setRisk(j as RiskOut);
    } catch (e: any) {
      setRisk(null);
      setRiskErr(e?.message ?? "リスク評価の取得に失敗しました");
    } finally {
      setRiskLoading(false);
    }
  }, [ky, appliedWeather, slopeNowUrl, slopePrevUrl, pathNowUrl, pathPrevUrl]);

  useEffect(() => {
    if (!ky) return;
    const t = setTimeout(() => {
      loadRisk();
    }, 120);
    return () => clearTimeout(t);
  }, [
    ky?.id,
    ky?.work_detail,
    ky?.hazards,
    ky?.countermeasures,
    ky?.third_party_level,
    ky?.worker_count,
    ky?.ai_hazards,
    ky?.ai_countermeasures,
    ky?.ai_third_party,
    appliedWeather?.hour,
    appliedWeather?.weather_text,
    appliedWeather?.wind_speed_ms,
    appliedWeather?.precipitation_mm,
    slopeNowUrl,
    slopePrevUrl,
    pathNowUrl,
    pathPrevUrl,
    loadRisk,
  ]);

  const riskBadge = useMemo(() => {
    const v = risk?.total_ai ?? 0;
    if (v >= 70) return { label: "高", cls: "bg-rose-100 text-rose-800 border-rose-200" };
    if (v >= 40) return { label: "中", cls: "bg-amber-100 text-amber-800 border-amber-200" };
    return { label: "低", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" };
  }, [risk?.total_ai]);

  // ✅ AI補足（表示用：重複除去/スコアリング/上位抽出/番号なし/整合）
  const humanAllForAi = useMemo(() => {
    return `${s(ky?.work_detail)}\n${s(ky?.hazards)}\n${s(ky?.countermeasures)}`.trim();
  }, [ky?.work_detail, ky?.hazards, ky?.countermeasures]);

  const hazardsTop = useMemo(() => {
    return processAiLines(ky?.ai_hazards, { humanText: humanAllForAi, topN: 5, similarityThreshold: 0.72 });
  }, [ky?.ai_hazards, humanAllForAi]);

  const alignKeys = useMemo(() => {
    return extractHitKeywords(hazardsTop.map((x) => x.line));
  }, [hazardsTop]);

  const measuresTop = useMemo(() => {
    return processAiLines(ky?.ai_countermeasures, {
      humanText: humanAllForAi,
      topN: 5,
      similarityThreshold: 0.72,
      alignKeywords: alignKeys,
      alignBonus: 2,
    });
  }, [ky?.ai_countermeasures, humanAllForAi, alignKeys]);

  const thirdTop = useMemo(() => {
    return processAiLines(ky?.ai_third_party, { humanText: humanAllForAi, topN: 5, similarityThreshold: 0.72 });
  }, [ky?.ai_third_party, humanAllForAi]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* ✅ 印刷：AI補足は「内部スクロール禁止」＋「改ページOK」 */}
      <style jsx global>{`
        @media print {
          .print-no-scroll {
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
          }
          .print-break-auto {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }
        }
      `}</style>

      <div className="flex items-start justify-between gap-3 no-print">
        <div>
          <div className="text-lg font-bold text-slate-900">KY レビュー</div>
          <div className="mt-1 text-sm text-slate-600">日付：{ky?.work_date ? fmtDateJp(ky.work_date) : "（不明）"}</div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <Link className="text-sm text-blue-600 underline text-right" href={`/projects/${projectId}/ky`}>
            KY一覧へ
          </Link>
        </div>
      </div>

      {!!status.text && <div className={`rounded-lg px-3 py-2 text-sm ${statusClass} no-print`}>{status.text}</div>}

      {ky?.is_approved ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 print-avoid-break">
          承認済み{ky.approved_at ? `（${fmtDateTimeJp(ky.approved_at)}）` : ""}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 print-avoid-break">未承認</div>
      )}

      {/* ✅ リスク評価（比較＋内訳）：レビューだけに表示 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 print-avoid-break">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-800">リスク評価（比較＋内訳）</div>
          <div className={`text-xs px-2 py-1 rounded-full border ${riskBadge.cls}`}>
            AI総合：{risk ? risk.total_ai : "—"}（{riskBadge.label}）
          </div>
        </div>

        {riskLoading ? (
          <div className="text-sm text-slate-600">リスク評価 計算中...</div>
        ) : riskErr ? (
          <div className="text-sm text-rose-700">リスク評価：{riskErr}</div>
        ) : risk ? (
          <>
            {/* ✅ まとめ：人入力以外 TOP5 */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-800 mb-2">要注意ポイント（人入力以外：高い順 TOP5）</div>
              {risk.ai_top5?.length ? (
                <ol className="list-decimal pl-5 text-sm text-slate-800 space-y-1">
                  {risk.ai_top5.slice(0, 5).map((it, i) => (
                    <li key={`${it.key}-${i}`}>
                      <span className="font-semibold">{it.label}</span>
                      <span className="ml-2 text-slate-600">[{it.score}]</span>
                      <div className="text-xs text-slate-600 mt-0.5">{it.reason}</div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="text-sm text-slate-600">（要注意ポイントはありません）</div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-1">R_human（人の入力）</div>
                <div className="text-2xl font-bold text-slate-900">{risk.total_human}</div>
                <div className="text-xs text-slate-600 mt-1">作業員/第三者/気象/キーワード/文章</div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-1">R_ai（AIデータ）</div>
                <div className="text-2xl font-bold text-slate-900">{risk.total_ai}</div>
                <div className="text-xs text-slate-600 mt-1">写真/第三者/気象/AI文章</div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-1">Δ（AI − 人）</div>
                <div className="text-2xl font-bold text-slate-900">
                  {risk.total_ai - risk.total_human >= 0 ? `+${risk.total_ai - risk.total_human}` : `${risk.total_ai - risk.total_human}`}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {risk.total_ai - risk.total_human >= 10 ? "AIが厳しめ" : risk.total_ai - risk.total_human <= -10 ? "人が厳しめ" : "同程度"}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-600 mb-1">R_photo（写真）</div>
                <div className="text-xl font-bold text-slate-900">{risk.breakdown.photo.score}</div>
                <ul className="mt-2 text-xs text-slate-600 list-disc pl-5 space-y-1">
                  {(risk.breakdown.photo.reasons ?? []).slice(0, 3).map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-600 mb-1">R_third（第三者）</div>
                <div className="text-xl font-bold text-slate-900">{risk.breakdown.third_party.score}</div>
                <ul className="mt-2 text-xs text-slate-600 list-disc pl-5 space-y-1">
                  {(risk.breakdown.third_party.reasons ?? []).slice(0, 3).map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-600 mb-1">R_weather（気象：適用枠）</div>
                <div className="text-xl font-bold text-slate-900">{risk.breakdown.weather.score}</div>
                <div className="text-xs text-slate-600 mt-1">適用：{appliedWeather ? `${appliedWeather.hour}時` : "—"}</div>
                <ul className="mt-2 text-xs text-slate-600 list-disc pl-5 space-y-1">
                  {(risk.breakdown.weather.reasons ?? []).slice(0, 4).map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600 mb-2">参考：人側内訳</div>
              <div className="text-xs text-slate-700 flex flex-wrap gap-3">
                <span>作業員：{risk.breakdown.workers.score}</span>
                <span>キーワード：{risk.breakdown.keyword.score}</span>
                <span>文章（人）：{risk.breakdown.text_quality_human.score}</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600 mb-2">参考：AI側内訳</div>
              <div className="text-xs text-slate-700 flex flex-wrap gap-3">
                <span>AI文章：{risk.breakdown.text_quality_ai.score}</span>
              </div>
            </div>

            <div className="text-xs text-slate-500">
              ※ リスクは /api/ky-risk-score で計算（0〜100）。要注意TOP5は「人入力以外（写真/気象/第三者/作業員/AI文章）」を高い順に抽出。
            </div>
          </>
        ) : (
          <div className="text-sm text-slate-600">（リスク評価なし）</div>
        )}
      </div>

      {publicUrl ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 print-avoid-break">
          <div className="text-sm font-semibold text-slate-800">公開リンク（作業員閲覧用）</div>

          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm break-all">{publicUrl}</div>

          <div className="flex items-center gap-3 flex-wrap no-print">
            <button type="button" onClick={onCopyPublicUrl} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
              コピー
            </button>
            <a className="text-sm text-blue-600 underline" href={publicUrl} target="_blank" rel="noreferrer">
              別タブで開く
            </a>

            {qrDataUrl ? (
              <button type="button" onClick={() => setQrOpen(true)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
                QRを表示
              </button>
            ) : null}

            <button
              type="button"
              onClick={loadReadLogs}
              disabled={readLoading}
              className={`rounded-lg border px-4 py-2 text-sm ${
                readLoading ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              {readLoading ? "既読 更新中..." : "既読を更新"}
            </button>

            <button
              type="button"
              onClick={loadUnread}
              disabled={unreadLoading}
              className={`rounded-lg border px-4 py-2 text-sm ${
                unreadLoading ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              {unreadLoading ? "未読 更新中..." : "未読を更新"}
            </button>
          </div>

          {qrDataUrl ? (
            <div className="flex items-start gap-4 flex-wrap">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="公開リンクQR" className="w-40 h-40" />
              </div>
              <div className="text-xs text-slate-500 leading-relaxed">
                ・スマホのカメラでQRを読み取り→そのまま閲覧できます。<br />
                ・このページは閲覧専用（編集不可）です。<br />
                ・承認解除すると公開停止になります。
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2 no-print">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-800">既読状況</div>
              <div className="text-right">
                <div className="text-sm text-slate-700">
                  既読：<span className="font-semibold">{readLogs.length}</span> 名
                </div>
                {latestReadAt ? <div className="text-xs text-slate-500">最新：{latestReadAt}</div> : null}
              </div>
            </div>

            {readErr ? <div className="text-xs text-rose-700">{readErr}</div> : null}

            {readLogs.length ? (
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <div className="grid grid-cols-12 gap-0 border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
                  <div className="col-span-5 px-3 py-2">氏名</div>
                  <div className="col-span-2 px-3 py-2">役割</div>
                  <div className="col-span-5 px-3 py-2">時刻</div>
                </div>
                {readLogs.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-0 border-b border-slate-100 text-sm">
                    <div className="col-span-5 px-3 py-2 text-slate-800">{s(r.reader_name) || "（不明）"}</div>
                    <div className="col-span-2 px-3 py-2 text-slate-700">{s(r.reader_role) || "—"}</div>
                    <div className="col-span-5 px-3 py-2 text-slate-700">{r.created_at ? fmtDateTimeJp(r.created_at) : "—"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-600">（まだ既読がありません）</div>
            )}
          </div>

          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2 no-print">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-rose-800">
                未読状況（入場登録ベース）{unreadMode === "company" ? "：会社単位" : unreadMode === "person" ? "：個人単位" : ""}
              </div>
              <div className="text-sm text-rose-800">
                未読：<span className="font-semibold">{unreadFiltered.length}</span>
              </div>
            </div>

            {unreadErr ? <div className="text-xs text-rose-700">{unreadErr}</div> : null}

            {unreadLoading ? (
              <div className="text-sm text-rose-700">（未読一覧 更新中...）</div>
            ) : unreadFiltered.length ? (
              <div className="rounded-lg border border-rose-200 bg-white p-3">
                <ul className="list-disc pl-5 text-sm text-slate-800 space-y-1">
                  {unreadFiltered.map((x, i) => (
                    <li key={`${x}-${i}`}>{x}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-sm text-rose-700">（未読はありません）</div>
            )}
          </div>

          {qrOpen && qrDataUrl ? (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 no-print" onClick={() => setQrOpen(false)}>
              <div className="bg-white rounded-xl p-4 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold text-slate-800">QRコード（拡大）</div>
                  <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50" onClick={() => setQrOpen(false)}>
                    閉じる
                  </button>
                </div>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="公開リンクQR（拡大）" className="w-72 h-72" />
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs break-all">{publicUrl}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">施工会社（固定）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{project?.contractor_name ?? "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">
          協力会社 <span className="text-rose-600">（必須）</span>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{ky?.partner_company_name ?? "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">本日の作業員数</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{ky?.worker_count != null ? `${ky.worker_count} 人` : "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">作業内容</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky?.work_detail).trim() || "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">危険予知</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky?.hazards).trim() || "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">対策</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky?.countermeasures).trim() || "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">第三者（墓参者）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky?.third_party_level).trim() || "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 print-avoid-break">
        <div className="text-sm font-semibold text-slate-800">気象（先頭＝適用枠）</div>
        {weatherSlots.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlots.map((slot, idx) => (
              <div
                key={`${slot.hour}-${idx}`}
                className={`rounded-lg border p-3 print-avoid-break ${idx === 0 ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
                  {idx === 0 ? <div className="text-xs font-semibold text-emerald-700">適用</div> : null}
                </div>
                <div className="mt-1 text-sm text-slate-700">{slot.weather_text || "（不明）"}</div>
                <div className="mt-2 text-xs text-slate-600 space-y-1">
                  <div>気温：{slot.temperature_c ?? "—"} ℃</div>
                  <div>
                    風：{degToDirJp(slot.wind_direction_deg)} {slot.wind_speed_ms != null ? `${slot.wind_speed_ms} m/s` : "—"}
                  </div>
                  <div>降水：{slot.precipitation_mm ?? "—"} mm</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">（気象データがありません）</div>
        )}
      </div>

      <div className="print-page-break" />

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">写真（今回／前回）</div>

        <div className="space-y-3">
          <div className="print-avoid-break">
            <div className="text-sm font-semibold text-slate-800">法面（定点）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 print-avoid-break">
                <div className="text-xs text-slate-600 mb-2">今回写真</div>
                {slopeNowUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slopeNowUrl} alt="法面（今回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 print-avoid-break">
                <div className="text-xs text-slate-600 mb-2">前回写真</div>
                {slopePrevUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slopePrevUrl} alt="法面（前回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
            </div>
          </div>

          <div className="print-avoid-break">
            <div className="text-sm font-semibold text-slate-800">通路（定点）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 print-avoid-break">
                <div className="text-xs text-slate-600 mb-2">今回写真</div>
                {pathNowUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pathNowUrl} alt="通路（今回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 print-avoid-break">
                <div className="text-xs text-slate-600 mb-2">前回写真</div>
                {pathPrevUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pathPrevUrl} alt="通路（前回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="print-page-break" />

      {/* ✅ AI補足：印刷は「内部スクロール厳禁」なので、ここは改ページOKにする */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 print-break-auto print-no-scroll">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-800">AI補足（要点抽出・重複除外・整合）</div>

          <button
            type="button"
            onClick={onRegenerateAi}
            disabled={aiGenerating || acting || !!ky?.is_approved}
            className={`rounded-lg border px-4 py-2 text-sm no-print ${
              aiGenerating || acting || !!ky?.is_approved ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
            }`}
          >
            {!!ky?.is_approved ? "承認済み（再生成不可）" : aiGenerating ? "AI補足 生成中..." : "AI補足 再生成"}
          </button>
        </div>

        {/* ✅ 仕様：作業内容のAI補足は表示しない */}

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足（上位5：番号なし）</div>
          <div className="rounded-lg border border-slate-300 bg-white p-3 print-no-scroll print-break-auto">
            {renderBullets(hazardsTop) ?? <div className="text-sm text-slate-600">（なし）</div>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足（上位5：危険予知と整合を加点／番号なし）</div>
          <div className="rounded-lg border border-slate-300 bg-white p-3 print-no-scroll print-break-auto">
            {renderBullets(measuresTop) ?? <div className="text-sm text-slate-600">（なし）</div>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足（上位5：番号なし）</div>
          <div className="rounded-lg border border-slate-300 bg-white p-3 print-no-scroll print-break-auto">
            {renderBullets(thirdTop) ?? <div className="text-sm text-slate-600">（なし）</div>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 no-print">
        <button type="button" onClick={() => router.push(`/projects/${projectId}/ky`)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
          戻る
        </button>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onPrint} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50">
            印刷
          </button>

          {ky?.is_approved ? (
            <button
              type="button"
              disabled={acting}
              onClick={onUnapprove}
              className={`rounded-lg border px-4 py-2 text-sm ${acting ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"}`}
            >
              承認解除
            </button>
          ) : (
            <button type="button" disabled={acting} onClick={onApprove} className={`rounded-lg px-4 py-2 text-sm text-white ${acting ? "bg-slate-400" : "bg-black hover:bg-slate-900"}`}>
              承認
            </button>
          )}

          <button
            type="button"
            onClick={() => load()}
            disabled={acting}
            className={`rounded-lg border px-4 py-2 text-sm ${acting ? "border-slate-300 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"}`}
          >
            再読み込み
          </button>
        </div>
      </div>
    </div>
  );
}
