"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";

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

type Ky = {
  work_date: string | null;
  partner_company_name: string | null;
  third_party_level?: string | null;

  weather_slots?: WeatherSlot[] | null;

  ai_work_detail?: string | null;
  ai_hazards?: string | null;
  ai_countermeasures?: string | null;
  ai_third_party?: string | null;

  ai_supplement?: string | null;

  is_approved?: boolean | null;
  public_enabled?: boolean | null;
};

type Project = { contractor_name: string | null; name: string | null } | null;

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

// ✅ 見出し付きテキストの分解（レビューと同等）
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

function getDeviceLabel(): string {
  try {
    const ua = navigator.userAgent || "";
    const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    return isMobile ? "mobile" : "pc";
  } catch {
    return "";
  }
}

export default function KyPublicClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [ky, setKy] = useState<Ky | null>(null);
  const [project, setProject] = useState<Project>(null);

  // ✅ 既読（確認）UI
  const storageKeyName = useMemo(() => `ky_reader_name_v1`, []);
  const storageKeyDone = useMemo(() => `ky_read_done_v1:${token}`, [token]);

  const [readerName, setReaderName] = useState<string>("");
  const [readDone, setReadDone] = useState<boolean>(false);
  const [readAt, setReadAt] = useState<string>("");
  const [readStatus, setReadStatus] = useState<{ type: "success" | "error" | null; text: string }>({ type: null, text: "" });
  const [readActing, setReadActing] = useState(false);

  useEffect(() => {
    // localStorage復元
    try {
      const n = localStorage.getItem(storageKeyName);
      if (n && !readerName) setReaderName(n);
      const done = localStorage.getItem(storageKeyDone);
      if (done) {
        setReadDone(true);
        setReadAt(done);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKeyName, storageKeyDone]);

  const statusClass = useMemo(() => {
    if (readStatus.type === "success") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    if (readStatus.type === "error") return "border border-rose-200 bg-rose-50 text-rose-800";
    return "border border-slate-200 bg-slate-50 text-slate-700";
  }, [readStatus.type]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch("/api/ky-public", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ token }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

        const ky0: Ky | null = j?.ky ?? null;

        // ✅ 公開側でもAI補足を保険で復元（レビューと同様）
        if (ky0) {
          const sup = safeParseJson(ky0.ai_supplement);
          if (sup) {
            const parsed = pickAiFromSupplement(sup);
            if (!s(ky0.ai_work_detail).trim() && parsed.work) ky0.ai_work_detail = parsed.work;
            if (!s(ky0.ai_hazards).trim() && parsed.hazards) ky0.ai_hazards = parsed.hazards;
            if (!s(ky0.ai_countermeasures).trim() && parsed.measures) ky0.ai_countermeasures = parsed.measures;
            if (!s(ky0.ai_third_party).trim() && parsed.third) ky0.ai_third_party = parsed.third;
          } else {
            const parts = splitAiHeadedText(ky0.ai_supplement || "");
            if (!s(ky0.ai_work_detail).trim() && parts.work) ky0.ai_work_detail = parts.work;
            if (!s(ky0.ai_hazards).trim() && parts.hazards) ky0.ai_hazards = parts.hazards;
            if (!s(ky0.ai_countermeasures).trim() && parts.counter) ky0.ai_countermeasures = parts.counter;
            if (!s(ky0.ai_third_party).trim() && parts.third) ky0.ai_third_party = parts.third;
          }
        }

        setKy(ky0);
        setProject(j?.project ?? null);
      } catch (e: any) {
        setErr(e?.message ?? "読み込みに失敗しました");
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [token]);

  const weatherSlots = useMemo(() => {
    const raw = ky?.weather_slots ?? null;
    const arr = Array.isArray(raw) ? (raw as WeatherSlot[]) : [];
    const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
    filtered.sort((a, b) => a.hour - b.hour);
    return filtered;
  }, [ky?.weather_slots]);

  const onConfirmRead = useCallback(async () => {
    setReadStatus({ type: null, text: "" });

    const name = s(readerName).trim();
    if (!name) {
      setReadStatus({ type: "error", text: "氏名を入力してください。" });
      return;
    }

    setReadActing(true);
    try {
      // localStorageに氏名保存
      try {
        localStorage.setItem(storageKeyName, name);
      } catch {
        // ignore
      }

      const device = getDeviceLabel();
      const res = await fetch("/api/ky-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          token,
          readerName: name,
          readerRole: null,
          readerDevice: device || null,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      const at = j?.created_at ? String(j.created_at) : new Date().toISOString();

      // 同日重複でもOK扱い（押した人にとっては確認済み）
      setReadDone(true);
      setReadAt(at);

      try {
        localStorage.setItem(storageKeyDone, at);
      } catch {
        // ignore
      }

      setReadStatus({
        type: "success",
        text: j?.duplicated ? "確認済み（本日はすでに確認済みです）" : "確認しました（既読登録しました）",
      });
    } catch (e: any) {
      setReadStatus({ type: "error", text: e?.message ?? "既読登録に失敗しました" });
    } finally {
      setReadActing(false);
    }
  }, [readerName, storageKeyName, storageKeyDone, token]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  if (!ky) {
    return (
      <div className="p-4 space-y-3">
        {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{err}</div> : null}
        <div className="text-slate-700">このリンクは無効です。</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-lg font-bold text-slate-900">KY（公開）</div>
        <div className="mt-1 text-sm text-slate-600">日付：{ky.work_date ? fmtDateJp(ky.work_date) : "（不明）"}</div>
      </div>

      {/* ✅ 既読（確認） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">確認（既読登録）</div>

        {!!readStatus.text && <div className={`rounded-lg px-3 py-2 text-sm ${statusClass}`}>{readStatus.text}</div>}

        <div className="space-y-2">
          <div className="text-xs text-slate-600">氏名（必須）</div>
          <input
            value={readerName}
            onChange={(e) => setReaderName(e.target.value)}
            placeholder="例）山田太郎"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            disabled={readDone || readActing}
            inputMode="text"
          />
        </div>

        <button
          type="button"
          onClick={onConfirmRead}
          disabled={readDone || readActing}
          className={`w-full rounded-lg px-4 py-2 text-sm text-white ${
            readDone || readActing ? "bg-slate-400" : "bg-black hover:bg-slate-900"
          }`}
        >
          {readDone ? "確認済み" : readActing ? "送信中..." : "確認しました"}
        </button>

        {readDone ? (
          <div className="text-xs text-slate-500">
            ※この端末では確認済みです{readAt ? `（${readAt}）` : ""}。<br />
            ※同じ氏名は同日に二重登録されません。
          </div>
        ) : (
          <div className="text-xs text-slate-500">※入力した氏名は次回以降も自動入力されます。</div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">施工会社（固定）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
          {project?.contractor_name ?? "（未入力）"}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">協力会社</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
          {ky.partner_company_name ?? "（未入力）"}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">気象（9/12/15）</div>
        {weatherSlots.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {weatherSlots.map((slot) => (
              <div key={slot.hour} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">AI補足（項目別）</div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">作業内容の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky.ai_work_detail).trim() || "（なし）"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky.ai_hazards).trim() || "（なし）"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky.ai_countermeasures).trim() || "（なし）"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky.ai_third_party).trim() || "（なし）"}
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500">※このページは閲覧専用です（編集・承認はできません）。</div>
    </div>
  );
}
