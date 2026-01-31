"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/lib/supabaseClient";

/* =========================
   partner utils（KY一覧と同じ定義）
========================= */
function normalizeText(v: any) {
  if (v == null) return "";
  return String(v);
}

function normForSearch(v: any) {
  let s = normalizeText(v);
  s = s.replace(/\u3000/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.toLowerCase();
}

function displayPartner(v: any) {
  return normalizeText(v).replace(/\u3000/g, " ").replace(/\s+/g, " ").trim();
}

function isValidPartnerCandidate(name: string) {
  const s = displayPartner(name);
  if (!s) return false;

  const key = normForSearch(s);
  if (key === "未登録") return false;
  if (key === "(未登録)") return false;
  if (key.includes("未登録")) return false;

  return true;
}

export function isPartnerMissing(v: any) {
  const s = displayPartner(v);
  return !isValidPartnerCandidate(s);
}

/* =========================
   global cache（KY一覧と同じキー/TTL）
========================= */
const LS_GLOBAL_PARTNER_CACHE_KEY = "ky_global_partner_cache_v1";
const GLOBAL_PARTNER_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type GlobalPartnerCache = { ts: number; list: string[] };

function readGlobalPartnerCache(): GlobalPartnerCache | null {
  try {
    const raw = localStorage.getItem(LS_GLOBAL_PARTNER_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const ts = Number(obj?.ts);
    const list = Array.isArray(obj?.list) ? obj.list.map((x: any) => String(x)) : [];
    if (!Number.isFinite(ts)) return null;
    return { ts, list };
  } catch {
    return null;
  }
}

function writeGlobalPartnerCache(list: string[]) {
  try {
    const payload: GlobalPartnerCache = { ts: Date.now(), list };
    localStorage.setItem(LS_GLOBAL_PARTNER_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // noop
  }
}

// ✅ Supabaseの型定義が古いと SelectQueryError/Update型エラーが出続けるケースの逃げ道
const selectAny = (s: string) => s as any;

type Props = {
  projectId: string;
  kyId: string;
  initialValue: string | null | undefined;
  onSaved?: (newValue: string) => void;
};

export default function PartnerPicker({ projectId, kyId, initialValue, onSaved }: Props) {
  const [value, setValue] = useState<string>(displayPartner(initialValue));
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<{ type: "success" | "error" | null; text: string }>({ type: null, text: "" });

  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [globalOptions, setGlobalOptions] = useState<string[]>([]);
  const [loadingGlobal, setLoadingGlobal] = useState(false);

  const missing = useMemo(() => isPartnerMissing(value), [value]);

  useEffect(() => {
    setValue(displayPartner(initialValue));
  }, [initialValue]);

  const fetchProjectOptions = useCallback(async () => {
    if (!projectId) return;

    const q = supabase
      .from("ky_entries")
      .select(selectAny("partner_company_name, created_at"))
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(500);

    const runner: any = q as any;
    const execQuery = typeof runner.returns === "function" ? runner.returns() : runner;

    const { data, error } = await execQuery;
    if (error) return;

    const raw = Array.isArray(data) ? data : [];
    const seen = new Set<string>();
    const list: string[] = [];

    for (const r of raw) {
      const name = displayPartner((r as any)?.partner_company_name);
      if (!isValidPartnerCandidate(name)) continue;

      const key = normForSearch(name);
      if (seen.has(key)) continue;
      seen.add(key);

      list.push(name);
      if (list.length >= 120) break;
    }

    list.sort((a, b) => a.localeCompare(b, "ja"));
    setProjectOptions(list);
  }, [projectId]);

  const fetchGlobalOptions = useCallback(async (opts?: { force?: boolean }) => {
    if (opts?.force !== true) {
      const cache = readGlobalPartnerCache();
      if (cache && Date.now() - cache.ts < GLOBAL_PARTNER_TTL_MS) {
        setGlobalOptions(cache.list);
        return;
      }
    }

    setLoadingGlobal(true);
    try {
      const q = supabase
        .from("ky_entries")
        .select(selectAny("partner_company_name, created_at"))
        .order("created_at", { ascending: false })
        .limit(800);

      const runner: any = q as any;
      const execQuery = typeof runner.returns === "function" ? runner.returns() : runner;

      const { data, error } = await execQuery;
      if (error) {
        setGlobalOptions([]);
        return;
      }

      const raw = Array.isArray(data) ? data : [];
      const seen = new Set<string>();
      const list: string[] = [];

      for (const r of raw) {
        const name = displayPartner((r as any)?.partner_company_name);
        if (!isValidPartnerCandidate(name)) continue;

        const key = normForSearch(name);
        if (seen.has(key)) continue;
        seen.add(key);

        list.push(name);
        if (list.length >= 200) break;
      }

      setGlobalOptions(list);
      writeGlobalPartnerCache(list);
    } finally {
      setLoadingGlobal(false);
    }
  }, []);

  useEffect(() => {
    fetchProjectOptions();
    fetchGlobalOptions();
  }, [fetchProjectOptions, fetchGlobalOptions]);

  useEffect(() => {
    if (!selected) return;
    setValue(selected);
  }, [selected]);

  const mergedOptions = useMemo(() => {
    const used = new Set<string>();
    const pick = (src: string[], max: number) => {
      const out: string[] = [];
      for (const x of src) {
        const name = displayPartner(x);
        if (!isValidPartnerCandidate(name)) continue;

        const key = normForSearch(name);
        if (used.has(key)) continue;
        used.add(key);

        out.push(name);
        if (out.length >= max) break;
      }
      return out;
    };

    const p = pick(projectOptions, 60);
    const g = pick(globalOptions, 140);
    return { project: p, global: g };
  }, [projectOptions, globalOptions]);

  const hasAnyOptions = mergedOptions.project.length + mergedOptions.global.length > 0;

  const savePartnerOnly = useCallback(async () => {
    const v = displayPartner(value);

    if (isPartnerMissing(v)) {
      setStatus({ type: "error", text: "協力会社が未登録です。協力会社名を入力（または候補から選択）してください。" });
      return;
    }

    setStatus({ type: null, text: "" });

    // ✅ Supabase型定義が古いと partner_company_name が Update型に存在せず ts(2353) になるので as any で回避
    const payload = { partner_company_name: v } as any;

    const q = supabase.from("ky_entries").update(payload).eq("id", kyId).eq("project_id", projectId);

    const runner: any = q as any;
    const execQuery = typeof runner.returns === "function" ? runner.returns() : runner;

    const { error } = await execQuery;
    if (error) {
      setStatus({ type: "error", text: error.message });
      return;
    }

    setStatus({ type: "success", text: "協力会社を保存しました。" });
    onSaved?.(v);

    fetchProjectOptions();
    fetchGlobalOptions({ force: true });
  }, [value, kyId, projectId, onSaved, fetchProjectOptions, fetchGlobalOptions]);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>協力会社（入場時に登録）</div>
        {missing ? <span style={badgeNeeds}>未登録</span> : <span style={badgeOk}>登録済み</span>}
        {loadingGlobal ? <span style={{ fontSize: 12, color: "#6b7280" }}>（横断候補 読み込み中…）</span> : null}
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
        <div>
          <div style={hintStyle}>候補から選ぶ</div>
          <select style={inputStyle} value={selected} onChange={(e) => setSelected(e.target.value)} disabled={!hasAnyOptions}>
            <option value="">{hasAnyOptions ? "（候補から選択）" : "（候補なし）"}</option>

            {mergedOptions.project.length > 0 ? (
              <optgroup label="この工事の候補">
                {mergedOptions.project.map((name) => (
                  <option key={`p:${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ) : null}

            {mergedOptions.global.length > 0 ? (
              <optgroup label="全体（横断）の候補（24hキャッシュ）">
                {mergedOptions.global.map((name) => (
                  <option key={`g:${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </div>

        <div>
          <div style={hintStyle}>手入力</div>
          <input
            style={{ ...inputStyle, borderColor: missing ? "#fecaca" : "#e5e7eb", background: missing ? "#fff1f2" : "white" }}
            placeholder="例：〇〇建設 / 株式会社〇〇 / 有限会社〇〇"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (selected) setSelected("");
            }}
          />
          {missing ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#be123c" }}>
              ※ 協力会社が未登録のため、レビュー（承認）へ進めません。
            </div>
          ) : null}
        </div>

        {status.type ? <div style={{ ...statusBox, ...(status.type === "error" ? statusErr : statusOk) }}>{status.text}</div> : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btnPrimary} onClick={savePartnerOnly}>
            協力会社を保存
          </button>
          <button
            type="button"
            style={btnSecondary}
            onClick={() => {
              setSelected("");
              setValue("");
              setStatus({ type: null, text: "" });
            }}
          >
            クリア
          </button>
          <button type="button" style={btnSecondary} onClick={() => fetchGlobalOptions({ force: true })}>
            候補を再取得
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================
   styles
========================= */
const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 14,
  background: "white",
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontSize: 14,
  background: "white",
};

const btnBase: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "white",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  border: "1px solid #111827",
  background: "#111827",
  color: "white",
};

const btnSecondary: React.CSSProperties = { ...btnBase };

const statusBox: React.CSSProperties = {
  borderRadius: 12,
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  fontSize: 13,
};

const statusErr: React.CSSProperties = { background: "#fff1f2", color: "#be123c" };
const statusOk: React.CSSProperties = { background: "#ecfdf5", color: "#065f46" };

const badgeBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 10px",
  borderRadius: 999,
  border: "1px solid transparent",
  fontSize: 12,
  fontWeight: 800,
  lineHeight: "18px",
};

const badgeNeeds: React.CSSProperties = {
  ...badgeBase,
  border: "1px solid #fecdd3",
  background: "#fff1f2",
  color: "#be123c",
};

const badgeOk: React.CSSProperties = {
  ...badgeBase,
  border: "1px solid #bbf7d0",
  background: "#ecfdf5",
  color: "#065f46",
};
