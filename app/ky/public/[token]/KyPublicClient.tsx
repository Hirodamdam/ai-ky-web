// app/ky/public/[token]/KyPublicClient.tsx
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

  // ✅ 作業員数（APIが返す列名に合わせる）
  workers?: number | null;

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

type PartnerRow = {
  id: string;
  partner_company_name: string | null;
};

type EntrantRow = {
  id: string;
  partner_entry_id: string | null;
  entrant_no: string | null;
  entrant_name: string | null;
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

function getEntrantNoFromUrl(): string {
  try {
    const sp = new URLSearchParams(window.location.search || "");
    return s(sp.get("eno")).trim();
  } catch {
    return "";
  }
}

function isValidEntrantNo(v: string): boolean {
  const x = s(v).trim();
  if (!x) return false;
  return /^[0-9A-Za-z_-]{1,32}$/.test(x);
}

function labelEntrant(e: EntrantRow): string {
  const name = s(e.entrant_name).trim();
  const no = s(e.entrant_no).trim();
  if (name && no) return `${name}（${no}）`;
  if (name) return name;
  if (no) return `（${no}）`;
  return "（不明）";
}

export default function KyPublicClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  const [ky, setKy] = useState<Ky | null>(null);
  const [project, setProject] = useState<Project>(null);

  // ✅ entrantNo（URL or 名簿選択）
  const [entrantNo, setEntrantNo] = useState<string>("");

  // ✅ 名簿（会社→個人）
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterErr, setRosterErr] = useState("");
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [entrantsAll, setEntrantsAll] = useState<EntrantRow[]>([]);
  const [selectedPartnerEntryId, setSelectedPartnerEntryId] = useState<string>("");
  const [selectedEntrantId, setSelectedEntrantId] = useState<string>("");

  const entrants = useMemo(() => {
    if (!selectedPartnerEntryId) return [];
    return entrantsAll.filter((e) => s(e.partner_entry_id).trim() === selectedPartnerEntryId);
  }, [entrantsAll, selectedPartnerEntryId]);

  const selectedPartnerName = useMemo(() => {
    const p = partners.find((x) => x.id === selectedPartnerEntryId);
    return p?.partner_company_name ?? "";
  }, [partners, selectedPartnerEntryId]);

  // ✅ 既読（確認）UI
  const storageKeyName = useMemo(() => `ky_reader_name_v1`, []);
  const storageKeyDoneByNo = useMemo(() => `ky_read_done_v1:${token}:eno:${entrantNo || "none"}`, [token, entrantNo]);

  const [readerName, setReaderName] = useState<string>("");
  const [readDone, setReadDone] = useState<boolean>(false);
  const [readAt, setReadAt] = useState<string>("");
  const [readStatus, setReadStatus] = useState<{ type: "success" | "error" | null; text: string }>({ type: null, text: "" });
  const [readActing, setReadActing] = useState(false);

  // URLからenoを取得（初回のみ）
  useEffect(() => {
    const eno = getEntrantNoFromUrl();
    if (eno) setEntrantNo(eno);
  }, []);

  useEffect(() => {
    // localStorage復元
    try {
      const n = localStorage.getItem(storageKeyName);
      if (n && !readerName) setReaderName(n);

      const done = localStorage.getItem(storageKeyDoneByNo);
      if (done) {
        setReadDone(true);
        setReadAt(done);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKeyName, storageKeyDoneByNo, entrantNo]);

  const statusClass = useMemo(() => {
    if (readStatus.type === "success") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    if (readStatus.type === "error") return "border border-rose-200 bg-rose-50 text-rose-800";
    return "border border-slate-200 bg-slate-50 text-slate-700";
  }, [readStatus.type]);

  // ✅ 公開KY取得
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

        // ✅ 公開側でもAI補足を保険で復元
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

  // ✅ 名簿を取得（承認済みの公開でだけ）
  const loadRoster = useCallback(async () => {
    setRosterErr("");
    setRosterLoading(true);
    try {
      const res = await fetch("/api/public-ky-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      const ps = Array.isArray(j?.partners) ? (j.partners as PartnerRow[]) : [];
      const es = Array.isArray(j?.entrants) ? (j.entrants as EntrantRow[]) : [];

      setPartners(ps);
      setEntrantsAll(es);

      // 初期選択：未選択なら先頭会社
      if (!selectedPartnerEntryId && ps.length) {
        setSelectedPartnerEntryId(s(ps[0]?.id).trim());
      }
    } catch (e: any) {
      setPartners([]);
      setEntrantsAll([]);
      setRosterErr(e?.message ?? "名簿の取得に失敗しました");
    } finally {
      setRosterLoading(false);
    }
  }, [token, selectedPartnerEntryId]);

  useEffect(() => {
    if (!ky?.is_approved) return;
    loadRoster();
  }, [ky?.is_approved, loadRoster]);

  // 会社が変わったら個人選択をリセット
  useEffect(() => {
    setSelectedEntrantId("");
  }, [selectedPartnerEntryId]);

  // 個人が選択されたら entrantNo を自動セット（現場操作優先）
  useEffect(() => {
    if (!selectedEntrantId) return;
    const e = entrantsAll.find((x) => x.id === selectedEntrantId);
    const no = s(e?.entrant_no).trim();
    const nm = s(e?.entrant_name).trim();

    if (isValidEntrantNo(no)) setEntrantNo(no);
    if (nm) setReaderName(nm); // ✅ 既読一覧に氏名が残せるよう補助
  }, [selectedEntrantId, entrantsAll]);

  const weatherSlots = useMemo(() => {
    const raw = ky?.weather_slots ?? null;
    const arr = Array.isArray(raw) ? (raw as WeatherSlot[]) : [];
    const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
    filtered.sort((a, b) => a.hour - b.hour);
    return filtered;
  }, [ky?.weather_slots]);

  const onConfirmRead = useCallback(async () => {
    setReadStatus({ type: null, text: "" });

    const eno = s(entrantNo).trim();
    const enoOk = isValidEntrantNo(eno);
    const name = s(readerName).trim();

    if (!enoOk && !name) {
      setReadStatus({ type: "error", text: "氏名を入力してください（または個人Noを選択してください）。" });
      return;
    }

    setReadActing(true);
    try {
      if (name) {
        try {
          localStorage.setItem(storageKeyName, name);
        } catch {}
      }

      const device = getDeviceLabel();
      const res = await fetch("/api/ky-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          token,
          entrantNo: enoOk ? eno : null,
          readerName: name || null, // ✅ eno運用でも氏名を送る（一覧表示のため）
          readerRole: null,
          readerDevice: device || null,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);

      const at = new Date().toISOString();
      setReadDone(true);
      setReadAt(at);

      try {
        localStorage.setItem(storageKeyDoneByNo, at);
      } catch {}

      setReadStatus({
        type: "success",
        text: enoOk ? "確認しました（個人Noで既読登録しました）" : "確認しました（既読登録しました）",
      });
    } catch (e: any) {
      setReadStatus({ type: "error", text: e?.message ?? "既読登録に失敗しました" });
    } finally {
      setReadActing(false);
    }
  }, [entrantNo, readerName, storageKeyName, storageKeyDoneByNo, token]);

  // ✅ entrantNo が有効なら「自動既読」（失敗しても手動で押せる設計に）
  useEffect(() => {
    if (!ky) return;
    if (!ky.is_approved) return;
    if (readDone) return;

    const eno = s(entrantNo).trim();
    if (!isValidEntrantNo(eno)) return;

    try {
      const done = localStorage.getItem(storageKeyDoneByNo);
      if (done) {
        setReadDone(true);
        setReadAt(done);
        return;
      }
    } catch {}

    onConfirmRead().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ky, entrantNo, readDone, storageKeyDoneByNo]);

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

  const enoOk = isValidEntrantNo(entrantNo);

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-lg font-bold text-slate-900">KY（公開）</div>
        <div className="mt-1 text-sm text-slate-600">日付：{ky.work_date ? fmtDateJp(ky.work_date) : "（不明）"}</div>
      </div>

      {/* ✅ 既読（確認） */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-800">確認（既読登録）</div>
          {enoOk ? (
            <div className="text-xs text-slate-600">
              個人No：<span className="font-semibold">{entrantNo}</span>
            </div>
          ) : null}
        </div>

        {!!readStatus.text && <div className={`rounded-lg px-3 py-2 text-sm ${statusClass}`}>{readStatus.text}</div>}

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-slate-700 font-semibold">会社・入場者を選択（おすすめ）</div>
            <button
              type="button"
              onClick={loadRoster}
              disabled={rosterLoading || readActing}
              className={`rounded-lg border px-3 py-1.5 text-xs ${
                rosterLoading || readActing ? "border-slate-200 bg-slate-100 text-slate-400" : "border-slate-300 bg-white hover:bg-slate-50"
              }`}
            >
              {rosterLoading ? "更新中..." : "名簿を更新"}
            </button>
          </div>

          {rosterErr ? <div className="text-xs text-rose-700">{rosterErr}</div> : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">協力会社</div>
              <select
                value={selectedPartnerEntryId}
                onChange={(e) => setSelectedPartnerEntryId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                disabled={!partners.length || rosterLoading || readActing}
              >
                {!partners.length ? <option value="">（協力会社が未登録です）</option> : null}
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partner_company_name ?? "（不明）"}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-slate-500">選択中：{selectedPartnerName || "（未選択）"}</div>
            </div>

            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">入場者（個人）</div>
              <select
                value={selectedEntrantId}
                onChange={(e) => setSelectedEntrantId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                disabled={!selectedPartnerEntryId || rosterLoading || readActing}
              >
                <option value="">（選択）</option>
                {entrants.map((e) => (
                  <option key={e.id} value={e.id}>
                    {labelEntrant(e)}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-slate-500">※選ぶと「個人No」が自動入力されます。</div>
            </div>
          </div>
        </div>

        {/* 氏名（保険） */}
        <div className="space-y-2">
          <div className="text-xs text-slate-600">氏名（名簿選択時は自動入力されます）</div>
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
          className={`w-full rounded-lg px-4 py-2 text-sm text-white ${readDone || readActing ? "bg-slate-400" : "bg-black hover:bg-slate-900"}`}
        >
          {readDone ? "確認済み" : readActing ? "送信中..." : "確認しました"}
        </button>

        {readDone ? <div className="text-xs text-slate-500">※この端末では確認済みです{readAt ? `（${readAt}）` : ""}。</div> : null}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">施工会社（固定）</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{project?.contractor_name ?? "（未入力）"}</div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">協力会社</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">{ky.partner_company_name ?? "（未入力）"}</div>
      </div>

      {/* ✅ 作業員数 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">本日の作業員数</div>
        <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
          {ky.workers != null ? `${ky.workers} 名` : "（未入力）"}
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
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky.ai_work_detail).trim() || "（なし）"}</div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky.ai_hazards).trim() || "（なし）"}</div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky.ai_countermeasures).trim() || "（なし）"}</div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">{s(ky.ai_third_party).trim() || "（なし）"}</div>
        </div>
      </div>

      <div className="text-xs text-slate-500">※このページは閲覧専用です（編集・承認はできません）。</div>
    </div>
  );
}
