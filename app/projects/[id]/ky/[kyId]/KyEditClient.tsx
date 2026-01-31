"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type KyRow = {
  id: string;
  project_id: string | null;

  work_date: string | null;
  title: string | null;
  work_detail: string | null;

  hazards: string | null;
  countermeasures: string | null;

  weather: string | null;
  temperature_text: string | null;
  wind_direction: string | null;
  wind_speed_text: string | null;
  precipitation_mm: number | null;

  workers: number | null;
  notes: string | null;

  // ✅ DBに存在する列名（確認済み）
  partner_company_name: string | null;

  // ✅ 承認
  is_approved: boolean | null;
  approved_at: string | null;
  approved_by: string | null;

  created_at: string | null;
  updated_at: string | null;
};

type Project = {
  id: string;
  name: string | null;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function isoDateTodayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export default function KyEditClient() {
  const params = useParams<{ id: string; kyId: string }>();
  const projectId = params?.id;
  const kyId = params?.kyId;

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  const [project, setProject] = useState<Project | null>(null);
  const [ky, setKy] = useState<KyRow | null>(null);

  // フォーム state
  const [workDate, setWorkDate] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [workDetail, setWorkDetail] = useState<string>("");
  const [hazards, setHazards] = useState<string>("");
  const [countermeasures, setCountermeasures] = useState<string>("");
  const [workers, setWorkers] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // 気象
  const [weather, setWeather] = useState<string>("");
  const [temperatureText, setTemperatureText] = useState<string>("");
  const [windDirection, setWindDirection] = useState<string>("");
  const [windSpeedText, setWindSpeedText] = useState<string>("");
  const [precipMm, setPrecipMm] = useState<string>("");

  // ✅ 承認済みロック
  const isLocked = useMemo(() => ky?.is_approved === true, [ky?.is_approved]);

  const setMsg = useCallback((type: "success" | "error", text: string) => {
    setStatus({ type, text });
    window.setTimeout(() => setStatus({ type: null, text: "" }), 5000);
  }, []);

  const load = useCallback(async () => {
    if (!projectId || !kyId) return;

    setLoading(true);
    setStatus({ type: null, text: "" });

    // Project
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id,name")
      .eq("id", projectId)
      .single();

    if (projErr) {
      setMsg("error", `プロジェクト取得に失敗：${projErr.message}`);
      setLoading(false);
      return;
    }
    setProject((proj ?? null) as any);

    // KY
    const { data: kyRow, error: kyErr } = await supabase
      .from("ky_entries")
      .select(
        `
        id, project_id,
        work_date, title, work_detail,
        hazards, countermeasures,
        weather, temperature_text, wind_direction, wind_speed_text, precipitation_mm,
        workers, notes,
        partner_company_name,
        is_approved, approved_at, approved_by,
        created_at, updated_at
      `
      )
      .eq("id", kyId)
      .eq("project_id", projectId)
      .single();

    if (kyErr) {
      setMsg("error", `KY取得に失敗：${kyErr.message}`);
      setLoading(false);
      return;
    }

    // ✅ ここが安定化ポイント：型生成が無くてもTSで詰まらない
    const row = kyRow as unknown as KyRow;
    setKy(row);

    setWorkDate(row.work_date ? fmtDate(row.work_date) : "");
    setTitle(row.title ?? "");
    setWorkDetail(row.work_detail ?? "");
    setHazards(row.hazards ?? "");
    setCountermeasures(row.countermeasures ?? "");
    setWorkers(row.workers == null ? "" : String(row.workers));
    setNotes(row.notes ?? "");

    setWeather(row.weather ?? "");
    setTemperatureText(row.temperature_text ?? "");
    setWindDirection(row.wind_direction ?? "");
    setWindSpeedText(row.wind_speed_text ?? "");
    setPrecipMm(row.precipitation_mm == null ? "" : String(row.precipitation_mm));

    setLoading(false);
  }, [projectId, kyId, setMsg]);

  useEffect(() => {
    void load();
  }, [load]);

  const readonlyClass = isLocked ? "bg-gray-100 cursor-not-allowed" : "";

  const onSave = useCallback(async () => {
    if (!projectId || !kyId) return;

    if (isLocked) {
      setMsg("error", "このKYは承認済みのため保存できません。");
      return;
    }

    const finalWorkDate = workDate?.trim() ? workDate.trim() : isoDateTodayJst();

    const workersNum =
      workers.trim() === "" ? null : Number.isFinite(Number(workers)) ? Number(workers) : null;

    const precipitationNum =
      precipMm.trim() === "" ? null : Number.isFinite(Number(precipMm)) ? Number(precipMm) : null;

    const payload = {
      work_date: finalWorkDate,
      title: title.trim() || null,
      work_detail: workDetail.trim() || null,
      hazards: hazards.trim() || null,
      countermeasures: countermeasures.trim() || null,
      workers: workersNum,
      notes: notes.trim() || null,

      // 気象を編集で触らない運用なら外してOK（今は維持）
      weather: weather.trim() || null,
      temperature_text: temperatureText.trim() || null,
      wind_direction: windDirection.trim() || null,
      wind_speed_text: windSpeedText.trim() || null,
      precipitation_mm: precipitationNum,
    };

    // ✅ 二重ガード（承認済みを更新させない）
    const { error } = await supabase
      .from("ky_entries")
      .update(payload)
      .eq("id", kyId)
      .eq("project_id", projectId)
      .eq("is_approved", false);

    if (error) {
      setMsg("error", `保存に失敗：${error.message}`);
      await load();
      return;
    }

    setMsg("success", "保存しました。");
    await load();
  }, [
    projectId,
    kyId,
    isLocked,
    workDate,
    title,
    workDetail,
    hazards,
    countermeasures,
    workers,
    notes,
    weather,
    temperatureText,
    windDirection,
    windSpeedText,
    precipMm,
    setMsg,
    load,
  ]);

  const onApplyAi = useCallback(() => {
    if (isLocked) {
      setMsg("error", "このKYは承認済みのためAI反映できません。");
      return;
    }
    setMsg("error", "AI反映処理は既存のAI提案パネル実装に接続してください。");
  }, [isLocked, setMsg]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">読み込み中...</div>
      </div>
    );
  }

  if (!ky) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-600">KYが見つかりません。</div>
        <div className="mt-3">
          <Link className="underline" href={`/projects/${projectId}/ky`}>
            一覧へ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-600">工事件名</div>
          <div className="text-lg font-semibold">{project?.name ?? "（未設定）"}</div>

          <div className="mt-1 text-sm text-gray-600">
            KY ID: <span className="font-mono">{ky.id}</span>
          </div>

          <div className="mt-1 flex items-center gap-2">
            {ky.is_approved ? (
              <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-800">承認済み</span>
            ) : (
              <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">未承認</span>
            )}
            {ky.approved_at && (
              <span className="text-xs text-gray-600">承認日時: {ky.approved_at}</span>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Link className="underline text-sm" href={`/projects/${projectId}/ky`}>
            一覧へ
          </Link>
          <Link className="underline text-sm" href={`/projects/${projectId}/ky/${kyId}/review`}>
            レビュー
          </Link>
        </div>
      </div>

      {isLocked && (
        <div className="rounded bg-yellow-50 p-3 text-sm text-yellow-800">
          このKYは承認済みのため編集できません。（閲覧のみ）
        </div>
      )}

      {status.type && (
        <div
          className={`rounded p-3 text-sm ${
            status.type === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {status.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 作業日 */}
        <div className="space-y-1">
          <div className="text-sm text-gray-700">作業日</div>
          <input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            readOnly={isLocked}
            className={`w-full rounded border p-2 ${readonlyClass}`}
          />
          {!workDate && !isLocked && (
            <div className="text-xs text-gray-500">未入力の場合は保存時に今日の日付を入れます。</div>
          )}
        </div>

        {/* 協力会社（表示のみ） */}
        <div className="space-y-1">
          <div className="text-sm text-gray-700">協力会社</div>
          <input
            value={ky.partner_company_name ?? ""}
            readOnly
            className="w-full rounded border p-2 bg-gray-100"
          />
        </div>

        {/* タイトル */}
        <div className="space-y-1 md:col-span-2">
          <div className="text-sm text-gray-700">タイトル</div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            readOnly={isLocked}
            className={`w-full rounded border p-2 ${readonlyClass}`}
            placeholder="（任意）"
          />
        </div>

        {/* 作業内容 */}
        <div className="space-y-1 md:col-span-2">
          <div className="text-sm text-gray-700">作業内容</div>
          <textarea
            value={workDetail}
            onChange={(e) => setWorkDetail(e.target.value)}
            readOnly={isLocked}
            className={`w-full rounded border p-2 min-h-[110px] ${readonlyClass}`}
            placeholder="作業内容を入力"
          />
        </div>

        {/* 危険予知 */}
        <div className="space-y-1 md:col-span-2">
          <div className="text-sm text-gray-700">危険予知</div>
          <textarea
            value={hazards}
            onChange={(e) => setHazards(e.target.value)}
            readOnly={isLocked}
            className={`w-full rounded border p-2 min-h-[110px] ${readonlyClass}`}
            placeholder="危険要因を入力"
          />
        </div>

        {/* 対策 */}
        <div className="space-y-1 md:col-span-2">
          <div className="text-sm text-gray-700">対策</div>
          <textarea
            value={countermeasures}
            onChange={(e) => setCountermeasures(e.target.value)}
            readOnly={isLocked}
            className={`w-full rounded border p-2 min-h-[110px] ${readonlyClass}`}
            placeholder="対策を入力"
          />
        </div>

        {/* 人数 */}
        <div className="space-y-1">
          <div className="text-sm text-gray-700">作業員数</div>
          <input
            value={workers}
            onChange={(e) => setWorkers(e.target.value)}
            readOnly={isLocked}
            className={`w-full rounded border p-2 ${readonlyClass}`}
            placeholder="例）6"
            inputMode="numeric"
          />
        </div>

        {/* 備考 */}
        <div className="space-y-1">
          <div className="text-sm text-gray-700">備考</div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            readOnly={isLocked}
            className={`w-full rounded border p-2 ${readonlyClass}`}
            placeholder="（任意）"
          />
        </div>
      </div>

      {/* 気象 */}
      <div className="rounded border p-4 space-y-3">
        <div className="font-semibold text-sm">気象（参考）</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="text-sm text-gray-700">天気</div>
            <input
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
              readOnly={isLocked}
              className={`w-full rounded border p-2 ${readonlyClass}`}
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm text-gray-700">気温</div>
            <input
              value={temperatureText}
              onChange={(e) => setTemperatureText(e.target.value)}
              readOnly={isLocked}
              className={`w-full rounded border p-2 ${readonlyClass}`}
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm text-gray-700">風向</div>
            <input
              value={windDirection}
              onChange={(e) => setWindDirection(e.target.value)}
              readOnly={isLocked}
              className={`w-full rounded border p-2 ${readonlyClass}`}
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm text-gray-700">風速</div>
            <input
              value={windSpeedText}
              onChange={(e) => setWindSpeedText(e.target.value)}
              readOnly={isLocked}
              className={`w-full rounded border p-2 ${readonlyClass}`}
            />
          </div>
          <div className="space-y-1">
            <div className="text-sm text-gray-700">降雨量(mm)</div>
            <input
              value={precipMm}
              onChange={(e) => setPrecipMm(e.target.value)}
              readOnly={isLocked}
              className={`w-full rounded border p-2 ${readonlyClass}`}
              inputMode="decimal"
            />
          </div>
        </div>
      </div>

      {/* 操作 */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onSave}
          disabled={isLocked}
          className={`rounded px-4 py-2 text-sm ${
            isLocked ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "bg-blue-600 text-white"
          }`}
        >
          保存
        </button>

        <button
          onClick={onApplyAi}
          disabled={isLocked}
          className={`rounded px-4 py-2 text-sm ${
            isLocked ? "bg-gray-200 text-gray-500 cursor-not-allowed" : "bg-indigo-600 text-white"
          }`}
        >
          AI反映
        </button>

        <Link className="rounded border px-4 py-2 text-sm" href={`/projects/${projectId}/ky`}>
          一覧へ戻る
        </Link>
      </div>

      <div className="text-xs text-gray-500">
        updated_at: {ky.updated_at ?? "—"} / created_at: {ky.created_at ?? "—"}
      </div>
    </div>
  );
}
