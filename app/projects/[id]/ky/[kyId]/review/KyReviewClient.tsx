// app/projects/[id]/ky/[kyId]/review/KyReviewClient.tsx
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
  precipitation_mm?: number | null;
  weather_code?: number | null;
};

type KyEntry = {
  id: string;
  project_id: string | null;

  work_date: string | null;

  // 人が入力
  work_detail: string | null;
  hazards: string | null;
  countermeasures: string | null;

  // 第三者（多い/少ない）
  third_party_level?: string | boolean | null;
  third_party?: string | boolean | null;

  // 気象（表示用）
  weather?: string | null;
  temperature_text?: string | null;
  wind_direction?: string | null;
  wind_speed_text?: string | null;
  precipitation_mm?: number | null;

  // AI補足：列名変遷吸収
  ai_work_detail?: string | null;
  ai_hazards?: string | null;
  ai_countermeasures?: string | null;
  ai_third_party?: string | null;

  work_detail_ai?: string | null;
  hazards_ai?: string | null;
  countermeasures_ai?: string | null;
  third_party_ai?: string | null;

  ai_supplement?: string | null; // JSON文字列 or まとめテキスト
  ai_supplement_json?: any | null;

  workers?: number | null;
  notes?: string | null;

  partner_company_name?: string | null;
  is_approved?: boolean | null;

  created_at?: string | null;
  updated_at?: string | null;

  // 気象スロット（JSONの可能性）
  weather_slots?: any | null;
};

type Project = {
  id: string;
  name: string;
};

function fmtDateJp(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function safeText(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function normalizeBullets(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.replace(/\u3000/g, " ").trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^([•・\-\*]|\d+[.)]|[①-⑳])\s*/g, "").trim();
    if (cleaned) out.push(cleaned);
  }
  return out.length ? out : [raw];
}

function tryParseJson<T = any>(s: any): T | null {
  if (!s) return null;
  if (typeof s === "object") return s as T;
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

/**
 * 「全部入りAI補足テキスト」を見出しで分割
 * 対応する見出し例：
 * - 【AI補足｜作業内容】 / [AI補足｜作業内容]
 * - 作業内容: / 危険予知: / 対策: / 第三者(墓参者):
 */
function splitAiCombined(text: string): { work: string; hazards: string; countermeasures: string; third: string } {
  const src = (text || "").trim();
  if (!src) return { work: "", hazards: "", countermeasures: "", third: "" };

  // 行頭（または改行後）に出る見出しを拾う
  const makeBracketRe = (label: string) =>
    new RegExp(
      String.raw`(?:^|\n)\s*(?:[•・\-*]\s*)?[【\[]\s*AI補足\s*[｜|]\s*${label}\s*[】\]]`,
      "g"
    );

  const headings: Array<{ key: "work" | "hazards" | "countermeasures" | "third"; re: RegExp }> = [
    // 【AI補足｜作業内容】系
    { key: "work", re: makeBracketRe("作業内容") },
    { key: "hazards", re: makeBracketRe("危険予知") },
    { key: "countermeasures", re: makeBracketRe("対策") },
    { key: "third", re: makeBracketRe("第三者(?:\\s*（\\s*墓参者\\s*）)?") },

    // 「作業内容:」系（旧形式）
    { key: "work", re: /(?:^|\n)\s*(作業内容の補足|作業内容補足|作業の補足|作業内容)\s*[:：]/g },
    { key: "hazards", re: /(?:^|\n)\s*(危険予知の補足|危険予知補足|危険予知)\s*[:：]/g },
    { key: "countermeasures", re: /(?:^|\n)\s*(対策の補足|対策補足|対策)\s*[:：]/g },
    {
      key: "third",
      re: /(?:^|\n)\s*(第三者（?墓参者）?の補足|第三者の補足|第三者（?墓参者）?|墓参者)\s*[:：]/g,
    },
  ];

  const marks: Array<{ idx: number; key: "work" | "hazards" | "countermeasures" | "third"; len: number }> = [];
  for (const h of headings) {
    let m: RegExpExecArray | null;
    h.re.lastIndex = 0; // 念のため
    while ((m = h.re.exec(src))) {
      marks.push({ idx: m.index, key: h.key, len: m[0].length });
    }
  }
  marks.sort((a, b) => a.idx - b.idx);

  // 見出しがないなら全部 work 扱い
  if (marks.length === 0) return { work: src, hazards: "", countermeasures: "", third: "" };

  const out = { work: "", hazards: "", countermeasures: "", third: "" };

  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const next = marks[i + 1];
    const start = cur.idx + cur.len;
    const end = next ? next.idx : src.length;
    const chunk = src.slice(start, end).trim();
    if (!chunk) continue;

    const prev = (out as any)[cur.key] as string;
    (out as any)[cur.key] = prev ? `${prev}\n${chunk}` : chunk;
  }

  return out;
}

function pickFirstNonEmpty(entry: any, keys: string[]): string {
  for (const k of keys) {
    const v = entry?.[k];
    const s = typeof v === "string" ? v.trim() : "";
    if (s) return s;
  }
  return "";
}

function resolveAiSections(entry: KyEntry | null): { work: string; hazards: string; countermeasures: string; third: string } {
  if (!entry) return { work: "", hazards: "", countermeasures: "", third: "" };

  // まずは「専用カラム（あれば）」を拾う
  const workCol = pickFirstNonEmpty(entry, ["ai_work_detail", "work_detail_ai"]);
  const hazardsCol = pickFirstNonEmpty(entry, ["ai_hazards", "hazards_ai"]);
  const counterCol = pickFirstNonEmpty(entry, ["ai_countermeasures", "countermeasures_ai"]);
  const thirdCol = pickFirstNonEmpty(entry, ["ai_third_party", "third_party_ai"]);

  // 次に JSON 形式の ai_supplement があれば拾う（安全に）
  const json = tryParseJson<any>(entry.ai_supplement_json) || tryParseJson<any>(entry.ai_supplement);

  const workJ = safeText(json?.work_detail ?? json?.work ?? json?.workDetail ?? json?.work_detail_ai ?? "").trim();
  const hazardsJ = safeText(json?.hazards ?? json?.danger ?? json?.hazards_ai ?? "").trim();
  const counterJ = safeText(json?.countermeasures ?? json?.measures ?? json?.countermeasures_ai ?? "").trim();
  const thirdJ = safeText(json?.third_party ?? json?.third ?? json?.visitor ?? json?.third_party_ai ?? "").trim();

  // 「全部入りテキスト」を split して使う（今回ここが主役）
  const combined = pickFirstNonEmpty(entry, ["ai_supplement", "ai_work_detail", "work_detail_ai"]);
  if (combined) {
    const split = splitAiCombined(combined);

    // hazards/counter/third が split で取れるなら「全部入り」と判定（workCol をそのまま使うと全部入ってしまう）
    const looksCombined = !!(split.hazards.trim() || split.countermeasures.trim() || split.third.trim());

    return {
      // 重要：全部入りなら workCol は信用せず split を優先
      work: (looksCombined ? (workJ || split.work) : (workCol || workJ || split.work)).trim(),
      hazards: (hazardsCol || hazardsJ || split.hazards).trim(),
      countermeasures: (counterCol || counterJ || split.countermeasures).trim(),
      third: (thirdCol || thirdJ || split.third).trim(),
    };
  }

  // combined が無い場合は、専用カラム or JSON をそのまま
  return {
    work: (workCol || workJ).trim(),
    hazards: (hazardsCol || hazardsJ).trim(),
    countermeasures: (counterCol || counterJ).trim(),
    third: (thirdCol || thirdJ).trim(),
  };
}

function parseWeatherSlots(v: any): WeatherSlot[] {
  const j = tryParseJson<any>(v);
  const arr = Array.isArray(j) ? j : Array.isArray(v) ? v : [];
  const normalized: WeatherSlot[] = [];
  for (const it of arr) {
    const hour = it?.hour;
    if (hour !== 9 && hour !== 12 && hour !== 15) continue;
    normalized.push({
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
  normalized.sort((a, b) => a.hour - b.hour);
  return normalized;
}

function degToDirJp(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}

function thirdPartyDisplay(v: string | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "多い" : "少ない";
  return String(v).trim();
}

export default function KyReviewClient() {
  const params = useParams<{ id: string; kyId: string }>();
  const router = useRouter();

  // ✅ params の瞬間空を吸収し、値を安定化
  const projectId = useMemo(() => String((params as any)?.id ?? ""), [params]);
  const kyId = useMemo(() => String((params as any)?.kyId ?? ""), [params]);

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [entry, setEntry] = useState<KyEntry | null>(null);

  const [userId, setUserId] = useState<string>("");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isAdmin = useMemo(() => {
    const adminId = process.env.NEXT_PUBLIC_KY_ADMIN_USER_ID;
    if (!adminId) return false;
    if (!userId) return false;
    return userId === adminId;
  }, [userId]);

  const weatherSlots = useMemo(() => parseWeatherSlots(entry?.weather_slots), [entry?.weather_slots]);
  const ai = useMemo(() => resolveAiSections(entry), [entry]);

  const refetch = useCallback(async () => {
    // ✅ ここで return すると “読み込み中のまま” になり得るので、必ず loading を落とす
    if (!projectId || !kyId) {
      if (mountedRef.current) setLoading(false);
      return;
    }

    if (mountedRef.current) {
      setStatus({ type: null, text: "" });
      setLoading(true);
    }

    try {
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      if (mountedRef.current) setUserId(session?.user?.id ?? "");

      const { data: ky, error: kyErr } = await supabase.from("ky_entries").select("*").eq("id", kyId).maybeSingle();
      if (kyErr) throw kyErr;
      if (!ky) throw new Error("KYが見つかりません");

      const { data: proj, error: projErr } = await supabase.from("projects").select("id,name").eq("id", projectId).maybeSingle();
      if (projErr) throw projErr;

      if (mountedRef.current) {
        setEntry(ky as unknown as KyEntry);
        setProject((proj as Project) ?? null);
      }
    } catch (e: any) {
      if (mountedRef.current) setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId, kyId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const onPrint = useCallback(() => {
    window.print();
    setTimeout(() => refetch(), 200);
  }, [refetch]);

  const onApprove = useCallback(async () => {
    if (!projectId || !kyId) return;

    setStatus({ type: null, text: "" });
    try {
      const {
        data: { session },
        error: sErr,
      } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      if (!session?.access_token) throw new Error("ログイン情報が取得できません");

      const res = await fetch("/api/ky-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ projectId, kyId, accessToken: session.access_token }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "承認に失敗しました");

      setStatus({ type: "success", text: "承認しました" });
      await refetch();
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "承認に失敗しました" });
    }
  }, [projectId, kyId, refetch]);

  const onUnapprove = useCallback(async () => {
    if (!projectId || !kyId) return;

    setStatus({ type: null, text: "" });
    try {
      const {
        data: { session },
        error: sErr,
      } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      if (!session?.access_token) throw new Error("ログイン情報が取得できません");

      const res = await fetch("/api/ky-unapprove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ projectId, kyId, accessToken: session.access_token }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "承認解除に失敗しました");

      setStatus({ type: "success", text: "承認解除しました" });
      await refetch();
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "承認解除に失敗しました" });
    }
  }, [projectId, kyId, refetch]);

  const Card = useCallback(
    ({ title, children, tone = "default" }: { title: string; children: React.ReactNode; tone?: "default" | "ai" }) => {
      const base = tone === "ai" ? "border border-emerald-200 bg-emerald-50/60" : "border border-slate-200 bg-white";
      return (
        <div className={`rounded-xl p-4 ${base}`}>
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <div className="mt-2 text-sm text-slate-800 leading-relaxed">{children}</div>
        </div>
      );
    },
    []
  );

  const AIBullets = useCallback(({ text }: { text: string }) => {
    const items = normalizeBullets(text);
    if (!items.length) return <div className="text-slate-500">（なし）</div>;
    return (
      <ul className="list-disc pl-5 space-y-1">
        {items.map((it, idx) => (
          <li key={idx}>{it}</li>
        ))}
      </ul>
    );
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="p-4">
        <div className="text-slate-800 font-semibold">KYが見つかりません</div>
        <div className="mt-3">
          <Link className="text-blue-600 underline" href={`/projects/${projectId}/ky`}>
            一覧へ戻る
          </Link>
        </div>
      </div>
    );
  }

  const thirdPartyLabel = "第三者（墓参者）";
  const thirdPartyValue = thirdPartyDisplay(entry.third_party_level ?? entry.third_party);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">KYレビュー</div>
          <div className="mt-1 text-sm text-slate-600">
            工事名：{project?.name ?? "（不明）"} / 日付：{fmtDateJp(entry.work_date)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            協力会社：{entry.partner_company_name ? entry.partner_company_name : "（未入力）"}
            {entry.is_approved ? " / 状態：承認済み" : " / 状態：未承認"}
          </div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          <button
            onClick={() => router.push(`/projects/${projectId}/ky`)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            一覧へ戻る
          </button>

          <button onClick={onPrint} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            印刷
          </button>

          {isAdmin && !entry.is_approved && (
            <button onClick={onApprove} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">
              承認
            </button>
          )}

          {isAdmin && entry.is_approved && (
            <button onClick={onUnapprove} className="rounded-lg bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700">
              承認解除
            </button>
          )}
        </div>
      </div>

      {status.type && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            status.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {status.text}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>

        {weatherSlots.length ? (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlots.map((s) => (
              <div key={s.hour} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-800">{s.hour}時</div>
                <div className="mt-1 text-sm text-slate-700">{s.weather_text || "（不明）"}</div>
                <div className="mt-2 text-xs text-slate-600 space-y-1">
                  <div>気温：{s.temperature_c ?? "—"} ℃</div>
                  <div>
                    風：{degToDirJp(s.wind_direction_deg) || "—"}{" "}
                    {s.wind_speed_ms !== null && s.wind_speed_ms !== undefined ? `${s.wind_speed_ms} m/s` : "—"}
                  </div>
                  <div>降水：{s.precipitation_mm ?? "—"} mm</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-sm text-slate-500">（気象スロットがありません）</div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Card title="作業内容">
          <div className="whitespace-pre-wrap">{entry.work_detail?.trim() || "（未入力）"}</div>
        </Card>

        <Card title="危険予知">
          <div className="whitespace-pre-wrap">{entry.hazards?.trim() || "（未入力）"}</div>
        </Card>

        <Card title="対策">
          <div className="whitespace-pre-wrap">{entry.countermeasures?.trim() || "（未入力）"}</div>
        </Card>

        <Card title={thirdPartyLabel}>
          <div className="text-sm">
            状況： <span className="font-semibold">{thirdPartyValue || "（未入力）"}</span>
          </div>
        </Card>
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
        <div className="text-sm font-semibold text-slate-900">AI補足</div>

        <div className="mt-3 grid grid-cols-1 gap-3">
          <Card title="作業内容の補足（AI）" tone="ai">
            <AIBullets text={ai.work} />
          </Card>

          <Card title="危険予知の補足（AI）" tone="ai">
            <AIBullets text={ai.hazards} />
          </Card>

          <Card title="対策の補足（AI）" tone="ai">
            <AIBullets text={ai.countermeasures} />
          </Card>

          <Card title={`${thirdPartyLabel}（AI）`} tone="ai">
            <AIBullets text={ai.third} />
          </Card>
        </div>
      </div>
    </div>
  );
}
