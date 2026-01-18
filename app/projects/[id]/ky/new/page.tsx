"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

function todayYYYYMMDD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// 天気文の「先頭（最初の語）」で決める
function normalizeWeatherForSelect(s: string): string {
  let text = s.replace(/\u3000/g, " ").trim();
  const firstChunk = text.split(/\s+/)[0] ?? "";
  const head = firstChunk;

  if (head.includes("雷")) return "雷";
  if (head.includes("強風")) return "強風";
  if (head.includes("霧")) return "霧";
  if (head.includes("雪")) return "雪";
  if (head.includes("雨")) return "雨";
  if (head.includes("くもり") || head.includes("曇")) return "曇り";
  if (head.includes("晴")) return "晴れ";
  return "その他";
}

export default function KyNewPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;

  // ★追加：Hydration回避（mounted後に描画）
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [date, setDate] = useState(""); // ★初期は空にしておく（SSR/CSR差を避ける）
  useEffect(() => {
    // mounted後に今日の日付を入れる
    setDate(todayYYYYMMDD());
  }, []);

  const [work, setWork] = useState("");
  const [hazards, setHazards] = useState("");
  const [measures, setMeasures] = useState("");

  const [weather, setWeather] = useState("");
  const [workers, setWorkers] = useState<string>("");
  const [notes, setNotes] = useState("");

  const [temperature, setTemperature] = useState<string>("");

  const [windDirection, setWindDirection] = useState<string>("");
  const [windSpeedMs, setWindSpeedMs] = useState<string>("");
  const [precipitationMm, setPrecipitationMm] = useState<string>("");

  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [wxLoading, setWxLoading] = useState(false);

  const canSubmit = useMemo(() => {
    return date && work.trim() && hazards.trim() && measures.trim();
  }, [date, work, hazards, measures]);

  const onFetchWeather = async () => {
    if (wxLoading || saving) return;

    try {
      setWxLoading(true);
      setStatus("");

      const res = await fetch(`/api/weather?lat=31.59&lon=130.56`, { cache: "no-store" });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "気象データ取得に失敗しました。");
      }

      const w = json.data ?? {};

      if (typeof w.weather === "string") {
        setWeather(normalizeWeatherForSelect(w.weather));
      }

      if (typeof w.temperature_text === "string") setTemperature(w.temperature_text);
      if (typeof w.wind_direction === "string") setWindDirection(w.wind_direction);

      if (typeof w.wind_speed_text === "string") {
        const numeric = w.wind_speed_text.replace(/[^0-9.]/g, "");
        setWindSpeedMs(numeric);
      }

      if (typeof w.precipitation_mm === "number") {
        setPrecipitationMm(String(w.precipitation_mm));
      }

      setStatus("気象データを取得してフォームへ反映しました。");
    } catch (e: any) {
      setStatus(`ERROR: ${e?.message ?? "気象データ取得でエラーが発生しました。"}`);
    } finally {
      setWxLoading(false);
    }
  };

  const onSubmit = async () => {
    if (!canSubmit || saving) return;

    setSaving(true);
    setStatus("");

    const { data: authRes, error: authErr } = await supabase.auth.getUser();
    const userId = authRes?.user?.id;

    if (authErr || !userId) {
      setStatus("ERROR: ログイン状態を確認できません。");
      setSaving(false);
      return;
    }

    const precipitationValue = precipitationMm.trim() === "" ? null : Number(precipitationMm);

    if (precipitationMm.trim() !== "" && Number.isNaN(precipitationValue)) {
      setStatus("ERROR: 降水量は数値で入力してください。");
      setSaving(false);
      return;
    }

    const workersValue = workers.trim() === "" ? null : Number(workers);

    if (
      workers.trim() !== "" &&
      (Number.isNaN(workersValue) || !Number.isInteger(workersValue))
    ) {
      setStatus("ERROR: 作業人数は整数で入力してください。");
      setSaving(false);
      return;
    }

    const payload = {
      project_id: projectId,
      work_date: date,

      work_detail: work,
      hazards,
      countermeasures: measures,

      weather: weather.trim() === "" ? null : weather.trim(),
      workers: workersValue,
      notes: notes.trim() === "" ? null : notes.trim(),

      temperature_text: temperature.trim() === "" ? null : temperature.trim(),
      wind_direction: windDirection.trim() === "" ? null : windDirection.trim(),
      wind_speed_text: windSpeedMs.trim() === "" ? null : `${windSpeedMs.trim()}m/s`,
      precipitation_mm: precipitationValue,

      foreman_ra_1: "未設定",
      foreman_ra_2: null,
      foreman_ra_3: null,

      created_by: userId,
    };

    const { data, error } = await supabase
      .from("ky_entries")
      .insert([payload])
      .select("id, created_at, temperature_text, wind_direction, wind_speed_text, precipitation_mm")
      .maybeSingle();

    if (error) {
      setStatus(`ERROR: ${error.message}`);
      setSaving(false);
      return;
    }

    if (!data) {
      setStatus("ERROR: 保存結果を取得できませんでした。");
      setSaving(false);
      return;
    }

    setStatus(`保存しました。編集画面へ移動します… (${data.id})`);
    setSaving(false);

    const nextUrl = `/projects/${projectId}/ky/${data.id}/edit`;
    window.location.href = nextUrl;
  };

  // ★mounted前は何も描画しない（Hydration mismatch回避）
  if (!mounted) return null;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <Link href={`/projects/${projectId}`}>← 工事詳細へ戻る</Link>

      <h1 style={{ marginTop: 12 }}>KY登録</h1>

      <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>作業日 *</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>本日の作業内容 *</span>
          <textarea
            value={work}
            onChange={(e) => setWork(e.target.value)}
            rows={3}
            placeholder="例）法面整形、客土、転圧、清掃 など"
            style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>危険ポイント（K） *</span>
          <textarea
            value={hazards}
            onChange={(e) => setHazards(e.target.value)}
            rows={4}
            placeholder="例）転倒・墜落、重機接触、飛来落下、熱中症 など"
            style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span>対策（Y） *</span>
          <textarea
            value={measures}
            onChange={(e) => setMeasures(e.target.value)}
            rows={4}
            placeholder="例）立入禁止範囲明示、誘導員配置、声掛け徹底、保護具、散水 など"
            style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
          />
        </label>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>天候</span>
            <select
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
              style={{
                padding: "8px 10px",
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              <option value="">（未選択）</option>
              <option value="晴れ">晴れ</option>
              <option value="曇り">曇り</option>
              <option value="雨">雨</option>
              <option value="雪">雪</option>
              <option value="霧">霧</option>
              <option value="強風">強風</option>
              <option value="雷">雷</option>
              <option value="その他">その他</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>気温（temperature_text）</span>
            <input
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="例）18.5（文字列でOK）"
              style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>作業人数</span>
            <input
              type="number"
              value={workers}
              onChange={(e) => setWorkers(e.target.value)}
              placeholder="例）6"
              min={0}
              step={1}
              inputMode="numeric"
              style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
            />
          </label>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>風向（wind_direction）</span>
            <input
              value={windDirection}
              onChange={(e) => setWindDirection(e.target.value)}
              placeholder="例）北 / 北東 / NNE"
              style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>風速（wind_speed_text）</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="text"
                value={windSpeedMs}
                onChange={(e) => {
                  let v = e.target.value;
                  v = v.replace(/．/g, ".");
                  v = v.replace(/[^0-9.]/g, "");
                  const firstDot = v.indexOf(".");
                  if (firstDot !== -1) {
                    v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
                  }
                  setWindSpeedMs(v);
                }}
                placeholder="例）3"
                inputMode="decimal"
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  border: "1px solid #ddd",
                  borderRadius: 8,
                }}
              />
              <span style={{ minWidth: 40, color: "#666" }}>m/s</span>
            </div>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>降水量（precipitation_mm）</span>
            <input
              type="text"
              value={precipitationMm}
              onChange={(e) => {
                let v = e.target.value;
                v = v.replace(/．/g, ".");
                v = v.replace(/[^0-9.]/g, "");
                const firstDot = v.indexOf(".");
                if (firstDot !== -1) {
                  v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
                }
                setPrecipitationMm(v);
              }}
              placeholder="例）0 / 1.5"
              inputMode="decimal"
              style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
            />
          </label>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span>備考</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
          />
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={onFetchWeather}
            disabled={wxLoading || saving}
            style={{
              padding: "10px 14px",
              border: "1px solid #ddd",
              borderRadius: 10,
              background: !wxLoading && !saving ? "#fff" : "#eee",
              color: !wxLoading && !saving ? "#111" : "#777",
              cursor: !wxLoading && !saving ? "pointer" : "not-allowed",
            }}
          >
            {wxLoading ? "気象取得中..." : "気象データ取得"}
          </button>

          <button
            onClick={onSubmit}
            disabled={!canSubmit || saving}
            style={{
              padding: "10px 14px",
              border: "1px solid #ddd",
              borderRadius: 10,
              background: canSubmit && !saving ? "#111" : "#eee",
              color: canSubmit && !saving ? "#fff" : "#777",
              cursor: canSubmit && !saving ? "pointer" : "not-allowed",
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>

          <span style={{ color: status.startsWith("ERROR") ? "#b00020" : "#111" }}>
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
