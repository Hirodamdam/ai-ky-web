"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type Status = { type: "success" | "error" | null; text: string };

type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso?: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm?: number | null;
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

export default function PublicKyClient() {
  const params = useParams() as { publicId?: string };
  const sp = useSearchParams();

  const publicId = useMemo(() => s(params?.publicId).trim(), [params?.publicId]);
  const token = useMemo(() => s(sp.get("t")).trim(), [sp]);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ type: null, text: "" });

  const [project, setProject] = useState<any>(null);
  const [ky, setKy] = useState<any>(null);
  const [photos, setPhotos] = useState<{ slopeNow: string; slopePrev: string; pathNow: string; pathPrev: string } | null>(null);

  const statusClass = useMemo(() => {
    if (status.type === "success") return "border border-emerald-200 bg-emerald-50 text-emerald-800";
    if (status.type === "error") return "border border-rose-200 bg-rose-50 text-rose-800";
    return "border border-slate-200 bg-slate-50 text-slate-700";
  }, [status.type]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setStatus({ type: null, text: "" });

      try {
        if (!publicId || !token) throw new Error("URLが不正です（t がありません）");

        const qs = new URLSearchParams({ public_id: publicId, t: token });
        const res = await fetch(`/api/public-ky?${qs.toString()}`, { cache: "no-store" });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "読み込みに失敗しました");

        setProject(j?.project ?? null);
        setKy(j?.ky ?? null);
        setPhotos(j?.photos ?? null);
      } catch (e: any) {
        setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
      } finally {
        setLoading(false);
      }
    })();
  }, [publicId, token]);

  const weatherSlots = useMemo(() => {
    const raw = ky?.weather_slots ?? null;
    const arr = Array.isArray(raw) ? (raw as WeatherSlot[]) : [];
    const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
    filtered.sort((a, b) => a.hour - b.hour);
    return filtered;
  }, [ky?.weather_slots]);

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
          <div className="text-lg font-bold text-slate-900">KY レビュー（公開）</div>
          <div className="mt-1 text-sm text-slate-600">日付：{ky?.work_date ? fmtDateJp(ky.work_date) : "（不明）"}</div>
        </div>
      </div>

      {!!status.text && <div className={`rounded-lg px-3 py-2 text-sm ${statusClass}`}>{status.text}</div>}

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        承認済み{ky?.approved_at ? `（${fmtDateTimeJp(ky.approved_at)}）` : ""}
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
          {ky?.partner_company_name ?? "（未入力）"}
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
        <div className="text-sm font-semibold text-slate-800">写真（今回／前回）</div>

        <div className="space-y-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">法面（定点）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">今回写真</div>
                {photos?.slopeNow ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos.slopeNow} alt="法面（今回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">前回写真</div>
                {photos?.slopePrev ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos.slopePrev} alt="法面（前回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
            </div>
          </div>

          <div className="print-page-break" />

          <div>
            <div className="text-sm font-semibold text-slate-800">通路（定点）</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">今回写真</div>
                {photos?.pathNow ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos.pathNow} alt="通路（今回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-600 mb-2">前回写真</div>
                {photos?.pathPrev ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos.pathPrev} alt="通路（前回）" className="w-full rounded-md border border-slate-200" />
                ) : (
                  <div className="text-sm text-slate-500">（なし）</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">AI補足（項目別）</div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">作業内容の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky?.ai_work_detail).trim() || "（なし）"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">危険予知の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky?.ai_hazards).trim() || "（なし）"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">対策の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky?.ai_countermeasures).trim() || "（なし）"}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">第三者（墓参者）の補足</div>
          <div className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm whitespace-pre-wrap">
            {s(ky?.ai_third_party).trim() || "（なし）"}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:bg-slate-50"
        >
          印刷
        </button>
      </div>
    </div>
  );
}
