// app/projects/[id]/edit/ProjectEditClient.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabaseClient";

type Status = { type: "success" | "error" | null; text: string };

type ProjectRow = {
  id: string;
  name: string | null;
  contractor_name: string | null;
  address: string | null;

  lat?: number | null;
  lon?: number | null;

  slope_camera_snapshot_url?: string | null;
  path_camera_snapshot_url?: string | null;
};

type WeatherSlot = {
  hour: 9 | 12 | 15;
  time_iso?: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
  weather_code?: number | null;
};

function s(v: any) {
  if (v == null) return "";
  return String(v);
}

function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "jpg";
}

function toNumOrNull(v: string): number | null {
  const t = (v || "").trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isNaN(n)) return null;
  return n;
}

function degToDirJp(deg: number | null | undefined): string {
  if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "—";
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const idx = Math.round(d / 45) % 8;
  return dirs[idx];
}

// ✅ JSTのYYYY-MM-DD
function ymdJst(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function postJson(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
  return j;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || j?.message || `HTTP ${res.status}`);
  return j;
}

export default function ProjectEditClient() {
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

  // ✅ ログイン状態
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userLabel, setUserLabel] = useState<string>("");

  useEffect(() => {
    let unsub: any = null;

    async function loadSession() {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data?.session?.user ?? null;
        if (mountedRef.current) {
          setIsLoggedIn(!!user);
          setUserLabel(user?.email || user?.id || "");
          setAuthChecked(true);
        }
      } catch {
        if (mountedRef.current) {
          setIsLoggedIn(false);
          setUserLabel("");
          setAuthChecked(true);
        }
      }

      // 状態変化も追従
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const user = session?.user ?? null;
        setIsLoggedIn(!!user);
        setUserLabel(user?.email || user?.id || "");
      });
      unsub = sub?.subscription;
    }

    loadSession();

    return () => {
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  // 既存項目
  const [name, setName] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [address, setAddress] = useState("");

  // 位置情報
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");

  // 定点写真（URL）
  const [slopeUrl, setSlopeUrl] = useState("");
  const [pathUrl, setPathUrl] = useState("");

  // 気象プレビュー
  const [weatherSlots, setWeatherSlots] = useState<WeatherSlot[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const lastWeatherKeyRef = useRef<string>("");

  const fileSlopeRef = useRef<HTMLInputElement | null>(null);
  const filePathRef = useRef<HTMLInputElement | null>(null);

  const BUCKET = process.env.NEXT_PUBLIC_PROJECT_PHOTO_BUCKET || "project-photos";

  const refetch = useCallback(async () => {
    if (!projectId) {
      if (mountedRef.current) setLoading(false);
      return;
    }
    if (mountedRef.current) {
      setLoading(true);
      setStatus({ type: null, text: "" });
    }

    try {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id,name,contractor_name,address,lat,lon,slope_camera_snapshot_url,path_camera_snapshot_url")
        .eq("id", projectId)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("工事情報が見つかりません");

      const p = data as ProjectRow;

      if (mountedRef.current) {
        setName(s(p.name));
        setContractorName(s(p.contractor_name));
        setAddress(s(p.address));

        setLatText(p.lat == null ? "" : String(p.lat));
        setLonText(p.lon == null ? "" : String(p.lon));

        setSlopeUrl(s(p.slope_camera_snapshot_url));
        setPathUrl(s(p.path_camera_snapshot_url));
      }
    } catch (e: any) {
      if (mountedRef.current) setStatus({ type: "error", text: e?.message ?? "読み込みに失敗しました" });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const uploadToStorage = useCallback(
    async (file: File, kind: "slope" | "path"): Promise<string> => {
      const ext = extFromName(file.name);
      const path = `projects/${projectId}/${kind}_${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "application/octet-stream",
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const url = data?.publicUrl ?? "";
      if (!url) throw new Error("アップロード後のURL取得に失敗しました（Storage公開設定を確認してください）");
      return url;
    },
    [BUCKET, projectId]
  );

  const onPickSlopeFile = useCallback(async () => {
    if (!isLoggedIn) {
      setStatus({ type: "error", text: "ログインしてください（未ログインのためアップロードできません）" });
      return;
    }
    fileSlopeRef.current?.click();
  }, [isLoggedIn]);

  const onPickPathFile = useCallback(async () => {
    if (!isLoggedIn) {
      setStatus({ type: "error", text: "ログインしてください（未ログインのためアップロードできません）" });
      return;
    }
    filePathRef.current?.click();
  }, [isLoggedIn]);

  const onSlopeFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      setStatus({ type: null, text: "" });
      try {
        const url = await uploadToStorage(file, "slope");
        setSlopeUrl(url);
        setStatus({ type: "success", text: "法面の写真をアップロードしました（URLに反映）" });
      } catch (err: any) {
        setStatus({ type: "error", text: err?.message ?? "アップロードに失敗しました" });
      }
    },
    [uploadToStorage]
  );

  const onPathFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      setStatus({ type: null, text: "" });
      try {
        const url = await uploadToStorage(file, "path");
        setPathUrl(url);
        setStatus({ type: "success", text: "通路の写真をアップロードしました（URLに反映）" });
      } catch (err: any) {
        setStatus({ type: "error", text: err?.message ?? "アップロードに失敗しました" });
      }
    },
    [uploadToStorage]
  );

  const onUseCurrentLocation = useCallback(async () => {
    setStatus({ type: null, text: "" });

    if (!("geolocation" in navigator)) {
      setStatus({ type: "error", text: "このブラウザは位置情報に対応していません" });
      return;
    }

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        });
      });

      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      setLatText(String(lat));
      setLonText(String(lon));
      setStatus({ type: "success", text: "現在地から緯度経度を入力しました（気象プレビューも自動更新します）" });
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "現在地の取得に失敗しました（権限を確認してください）" });
    }
  }, []);

  const fetchWeatherPreview = useCallback(
    async (lat: number, lon: number) => {
      const date = ymdJst(new Date());
      const key = `${lat.toFixed(6)},${lon.toFixed(6)},${date}`;
      if (lastWeatherKeyRef.current === key) return;

      setWeatherLoading(true);
      try {
        let j: any = null;
        const bodyBase = { lat, lon, date };

        try {
          j = await postJson("/api/weather", bodyBase);
        } catch {
          try {
            j = await postJson("/api/weather", { ...bodyBase, projectId });
          } catch {
            const qs = new URLSearchParams({
              lat: String(lat),
              lon: String(lon),
              date,
              projectId,
            }).toString();
            j = await getJson(`/api/weather?${qs}`);
          }
        }

        const raw = j?.slots ?? j?.weather_slots ?? j?.data ?? j ?? [];
        const arr: WeatherSlot[] = Array.isArray(raw) ? raw : [];
        const filtered = arr.filter((x) => x && (x.hour === 9 || x.hour === 12 || x.hour === 15));
        filtered.sort((a, b) => a.hour - b.hour);

        setWeatherSlots(filtered);
        lastWeatherKeyRef.current = key;

        if (!filtered.length) {
          setStatus({ type: "error", text: "気象データが0件でした（api/weather の戻り値形式を確認してください）" });
        }
      } catch (e: any) {
        setWeatherSlots([]);
        setStatus({ type: "error", text: e?.message ?? "気象の取得に失敗しました" });
      } finally {
        setWeatherLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    const lat = toNumOrNull(latText);
    const lon = toNumOrNull(lonText);
    if (lat == null || lon == null) {
      setWeatherSlots([]);
      lastWeatherKeyRef.current = "";
      return;
    }

    const t = window.setTimeout(() => {
      fetchWeatherPreview(lat, lon);
    }, 700);

    return () => window.clearTimeout(t);
  }, [latText, lonText, fetchWeatherPreview]);

  const onManualWeatherFetch = useCallback(async () => {
    setStatus({ type: null, text: "" });

    const lat = toNumOrNull(latText);
    const lon = toNumOrNull(lonText);

    if ((lat == null) !== (lon == null)) {
      setStatus({ type: "error", text: "緯度と経度は両方入力してください（どちらか片方だけは不可）" });
      return;
    }
    if (lat == null || lon == null) {
      setStatus({ type: "error", text: "緯度と経度を入力してください" });
      return;
    }

    await fetchWeatherPreview(lat, lon);
  }, [latText, lonText, fetchWeatherPreview]);

  const onSave = useCallback(async () => {
    setStatus({ type: null, text: "" });

    // ✅ 保存直前に必ずセッション再確認（「ログイン状態が不明」を潰す）
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user ?? null;
    if (!user) {
      setStatus({ type: "error", text: "ログインしていません。右上の「ログイン」からログインしてください。" });
      return;
    }

    const lat = toNumOrNull(latText);
    const lon = toNumOrNull(lonText);

    if ((lat == null) !== (lon == null)) {
      setStatus({ type: "error", text: "緯度と経度は両方入力してください（どちらか片方だけは不可）" });
      return;
    }

    const payload: any = {
      name: name.trim() || null,
      contractor_name: contractorName.trim() || null,
      address: address.trim() || null,
      lat,
      lon,
      slope_camera_snapshot_url: slopeUrl.trim() || null,
      path_camera_snapshot_url: pathUrl.trim() || null,
    };

    setSaving(true);
    try {
      const { error } = await (supabase as any).from("projects").update(payload).eq("id", projectId);
      if (error) throw error;

      setStatus({ type: "success", text: "保存しました" });

      router.push(`/projects/${projectId}`);
      router.refresh();
      setTimeout(() => {
        window.location.href = `/projects/${projectId}`;
      }, 200);
    } catch (e: any) {
      setStatus({ type: "error", text: e?.message ?? "保存に失敗しました" });
    } finally {
      setSaving(false);
    }
  }, [address, contractorName, name, pathUrl, projectId, router, slopeUrl, latText, lonText]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-slate-600">読み込み中...</div>
      </div>
    );
  }

  const canEdit = authChecked ? isLoggedIn : false;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-slate-900">工事情報編集</div>
          <div className="mt-1 text-sm text-slate-600">プロジェクトID：{projectId}</div>
          <div className="mt-1 text-xs text-slate-500">
            ログイン状態：{authChecked ? (isLoggedIn ? `ログイン中（${userLabel || "user"}）` : "未ログイン") : "確認中..."}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/projects/${projectId}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50"
          >
            戻る
          </Link>
          <button
            onClick={onSave}
            disabled={saving || !canEdit}
            className={`rounded-lg px-3 py-2 text-sm text-white ${
              saving || !canEdit ? "bg-slate-400" : "bg-black hover:bg-slate-900"
            }`}
            title={!canEdit ? "未ログインのため保存できません" : undefined}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          ⚠ ログインしていません。編集・保存はできません。右上の「ログイン」からログインしてください。
        </div>
      )}

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

      {/* 工事基本情報 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">工事情報</div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">工事名</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">施工会社</div>
          <input
            value={contractorName}
            onChange={(e) => setContractorName(e.target.value)}
            disabled={!canEdit}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs text-slate-600">場所（住所）</div>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={!canEdit}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* 位置情報 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800">位置情報（気象の自動取得）</div>
        <div className="text-xs text-slate-500">
          ※ 気象（9/12/15）の自動取得には、緯度・経度が必要です。Googleマップのピン位置などから入力してください（例：31.59 / 130.55）
        </div>

        <div className="flex flex-col md:flex-row gap-2 md:items-end">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
            <div className="space-y-2">
              <div className="text-xs text-slate-600">緯度（lat）</div>
              <input
                value={latText}
                onChange={(e) => setLatText(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="例：31.590123"
                inputMode="decimal"
              />
            </div>

            <div className="space-y-2">
              <div className="text-xs text-slate-600">経度（lon）</div>
              <input
                value={lonText}
                onChange={(e) => setLonText(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="例：130.551234"
                inputMode="decimal"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onUseCurrentLocation}
              disabled={!canEdit}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              現在地から入力
            </button>
            <button
              type="button"
              onClick={onManualWeatherFetch}
              disabled={weatherLoading || !canEdit}
              className={`rounded-lg px-3 py-2 text-sm text-white ${
                weatherLoading || !canEdit ? "bg-slate-400" : "bg-black hover:bg-slate-900"
              }`}
            >
              {weatherLoading ? "取得中..." : "気象を確認"}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs text-slate-600 mb-2">
            気象プレビュー（9/12/15） <span className="text-slate-500">（date: {ymdJst(new Date())}）</span>
          </div>

          {weatherSlots.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {weatherSlots.map((slot) => (
                <div key={slot.hour} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-sm font-semibold text-slate-800">{slot.hour}時</div>
                  <div className="mt-1 text-sm text-slate-700">{slot.weather_text || "（不明）"}</div>
                  <div className="mt-2 text-xs text-slate-600 space-y-1">
                    <div>気温：{slot.temperature_c ?? "—"} ℃</div>
                    <div>
                      風：{degToDirJp(slot.wind_direction_deg)}{" "}
                      {slot.wind_speed_ms != null ? `${slot.wind_speed_ms} m/s` : "—"}
                    </div>
                    <div>降水：{slot.precipitation_mm ?? "—"} mm</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-500">
              {toNumOrNull(latText) != null && toNumOrNull(lonText) != null
                ? "（緯度経度が入ると自動で取得します。表示が出ない場合は「気象を確認」を押してください）"
                : "（緯度経度を入力すると表示されます）"}
            </div>
          )}
        </div>
      </div>

      {/* 定点写真 */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="text-sm font-semibold text-slate-800">通路（定点）／法面（定点）</div>
        <div className="text-xs text-rose-600">
          工事情報編集で「通路（定点）・法面（定点）」を登録してください（未設置なら空欄OK）
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="text-sm font-semibold text-slate-800">法面（定点）</div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <div className="text-xs text-slate-600">停止画URL（任意）</div>
              <input
                value={slopeUrl}
                onChange={(e) => setSlopeUrl(e.target.value)}
                disabled={!canEdit}
                placeholder="https://...（未設置なら空欄OK）"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={onPickSlopeFile}
                disabled={!canEdit}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                写真をアップロード
              </button>
            </div>
          </div>

          {slopeUrl.trim() ? (
            <a href={slopeUrl.trim()} target="_blank" rel="noreferrer" className="block mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slopeUrl.trim()} alt="法面（定点）" className="w-full max-w-[420px] rounded-lg border border-slate-200" loading="lazy" />
            </a>
          ) : (
            <div className="text-sm text-slate-500 mt-2">（未登録・任意）</div>
          )}

          <input ref={fileSlopeRef} type="file" accept="image/*" onChange={onSlopeFileChange} className="hidden" />
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="text-sm font-semibold text-slate-800">通路（定点）</div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
            <div className="space-y-1">
              <div className="text-xs text-slate-600">停止画URL（任意）</div>
              <input
                value={pathUrl}
                onChange={(e) => setPathUrl(e.target.value)}
                disabled={!canEdit}
                placeholder="https://...（未設置なら空欄OK）"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={onPickPathFile}
                disabled={!canEdit}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                写真をアップロード
              </button>
            </div>
          </div>

          {pathUrl.trim() ? (
            <a href={pathUrl.trim()} target="_blank" rel="noreferrer" className="block mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pathUrl.trim()} alt="通路（定点）" className="w-full max-w-[420px] rounded-lg border border-slate-200" loading="lazy" />
            </a>
          ) : (
            <div className="text-sm text-slate-500 mt-2">（未登録・任意）</div>
          )}

          <input ref={filePathRef} type="file" accept="image/*" onChange={onPathFileChange} className="hidden" />
        </div>

        <div className="text-xs text-slate-500">
          ※アップロード先Storageバケット：<span className="font-semibold">{BUCKET}</span>
        </div>
      </div>
    </div>
  );
}
