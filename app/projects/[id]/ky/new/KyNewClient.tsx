"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabaseClient";
import { useAuthReady } from "@/app/lib/useAuthReady";

type Status = { type: "success" | "error" | null; text: string };

type Project = {
  id: string;
  name: string | null;
  lat: number | null;
  lon: number | null;
};

type PartnerCompany = {
  id: string;
  name: string;
};

type Slot = {
  hour: 9 | 12 | 15;
  time_iso: string;
  weather_text: string;
  temperature_c: number | null;
  wind_direction_deg: number | null;
  wind_speed_ms: number | null;
  precipitation_mm: number | null;
  weather_code: number | null;
};

function isoDateTodayJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// "・" や "-" や "1." をいい感じに箇条書き化
function toBullets(text: string | null | undefined): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];

  // 改行で分割 → 先頭記号を除去
  const lines = t
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[-・*]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  // 1行しかなくても返す
  return lines.length ? lines : [t];
}

// 生成文からセクション抽出（既存の生成形式に寄せる）
function pickSection(raw: string, title: string): string {
  // 例: 【作業内容の補足】 ... （次の【...】まで）
  const re = new RegExp(`【${title}】([\\s\\S]*?)(?=【|$)`, "m");
  const m = raw.match(re);
  return (m?.[1] ?? "").trim();
}

export default function KyNewClient() {
  const params = useParams<{ id: string }>();
  const projectId = params?.id;

  const router = useRouter();
  const { ready: authReady, session } = useAuthReady();
  const canOperate = authReady && !!session;

  const [status, setStatus] = useState<Status>({ type: null, text: "" });
  const [loading, setLoading] = useState(true);

  // 入力
  const [workDate, setWorkDate] = useState<string>(isoDateTodayJst());
  const [partnerCompanyId, setPartnerCompanyId] = useState<string>("");
  const [partnerCompanyNameFallback, setPartnerCompanyNameFallback] = useState<string>("");

  const [workDetail, setWorkDetail] = useState("");
  const [hazards, setHazards] = useState("");
  const [countermeasures, setCountermeasures] = useState("");

  const [thirdPartySituation, setThirdPartySituation] = useState<"" | "多い" | "少ない">("");

  const [workers, setWorkers] = useState<number | "">("");
  const [notes, setNotes] = useState("");

  // データ
  const [project, setProject] = useState<Project | null>(null);
  const [partners, setPartners] = useState<PartnerCompany[]>([]);

  // 気象（9/12/15）
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // AI補足（raw + 4区分）
  const [aiRaw, setAiRaw] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);

  const aiSections = useMemo(() => {
    const raw = aiRaw ?? "";
    const work = pickSection(raw, "作業内容の補足");
    const risk = pickSection(raw, "危険予知の補足");
    const measure = pickSection(raw, "対策の補足");
    const third = pickSection(raw, "第三者（参考者）の補足"); // 既存の文字列に寄せる

    return {
      work: toBullets(work),
      risk: toBullets(risk),
      measure: toBullets(measure),
      third: toBullets(third),
    };
  }, [aiRaw]);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setStatus({ type: null, text: "" });

    // project
    const p = await supabase.from("projects").select("id,name,lat,lon").eq("id", projectId).maybeSingle();
    if (p.error || !p.data) {
      setProject(null);
      setPartners([]);
      setLoading(false);
      setStatus({ type: "error", text: "工事情報を取得できません。" });
      return;
    }
    setProject(p.data as Project);

    // 協力会社候補（project_subcontractors などの想定）
    // ※あなたの実装に合わせてテーブル名が違う場合でも、候補ゼロならfallback入力で保存できる設計にしてあります
    const pc = await supabase
      .from("project_subcontractors")
      .select("subcontractors(id,name)")
      .eq("project_id", projectId);

    if (!pc.error && pc.data) {
      const list: PartnerCompany[] = [];
      for (const row of pc.data as any[]) {
        const s = row.subcontractors;
        if (s?.id && s?.name) list.push({ id: s.id, name: s.name });
      }
      setPartners(list);
    } else {
      setPartners([]);
    }

    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fetchWeather = useCallback(async () => {
    if (!project?.lat || !project?.lon) {
      setStatus({ type: "error", text: "緯度・経度が未設定のため、気象を取得できません。" });
      return;
    }
    setWeatherLoading(true);
    setStatus({ type: null, text: "" });

    try {
      const res = await fetch(`/api/weather?lat=${project.lat}&lon=${project.lon}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "weather fetch failed");

      // 期待：{ slots: Slot[] }
      const got: Slot[] = (json?.slots ?? []) as Slot[];
      const normalized = [9, 12, 15]
        .map((h) => got.find((s) => s.hour === h))
        .filter(Boolean) as Slot[];

      setSlots(normalized.length ? normalized : got);
      setStatus({ type: "success", text: "気象データを取得しました。" });
    } catch (e: any) {
      setSlots(null);
      setStatus({ type: "error", text: `気象取得に失敗しました：${e?.message ?? "unknown"}` });
    } finally {
      setWeatherLoading(false);
    }
  }, [project?.lat, project?.lon, project]);

  const generateAi = useCallback(async () => {
    setAiLoading(true);
    setStatus({ type: null, text: "" });

    try {
      // 既存APIに寄せる（あなたのプロジェクトにある ky-ai-supplement を優先）
      const res = await fetch("/api/ky-ai-supplement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          workDate,
          workDetail,
          hazards,
          countermeasures,
          thirdPartySituation,
          weatherSlots: slots,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "ai supplement failed");

      // 期待：{ ai_supplement: string } もしくは { text: string }
      const raw = (json?.ai_supplement ?? json?.text ?? "").toString();
      setAiRaw(raw);
      setStatus({ type: "success", text: "AI補足を生成しました。" });
    } catch (e: any) {
      setStatus({ type: "error", text: `AI補足の生成に失敗しました：${e?.message ?? "unknown"}` });
    } finally {
      setAiLoading(false);
    }
  }, [projectId, workDate, workDetail, hazards, countermeasures, thirdPartySituation, slots]);

  const save = useCallback(async () => {
    if (!canOperate) {
      setStatus({ type: "error", text: "ログイン状態を確認できません。/login から再ログインしてください。" });
      return;
    }
    if (!projectId) return;

    // 必須チェック（完成形の最低限）
    if (!workDate || !workDetail.trim() || !hazards.trim() || !countermeasures.trim() || !thirdPartySituation) {
      setStatus({ type: "error", text: "必須項目（作業日/作業内容/K/対策/第三者）を入力してください。" });
      return;
    }

    // 協力会社：候補が無い場合 fallback（あなたの運用に合わせる）
    const partnerName =
      partners.find((p) => p.id === partnerCompanyId)?.name ||
      (partnerCompanyNameFallback || "").trim() ||
      null;

    if (!partnerName) {
      setStatus({ type: "error", text: "協力会社を選択（または入力）してください。" });
      return;
    }

    // 気象は取得済みなら 9時スロットを代表値として保存（列が既存の想定）
    const s9 = slots?.find((s) => s.hour === 9) ?? slots?.[0] ?? null;

    const payload: any = {
      project_id: projectId,
      work_date: workDate,
      work_detail: workDetail,
      hazards,
      countermeasures,
      third_party_situation: thirdPartySituation,
      workers: workers === "" ? null : Number(workers),
      notes: notes || null,
      partner_company_name: partnerName,

      // 既存カラムに寄せる
      weather: s9?.weather_text ?? null,
      temperature_text: s9?.temperature_c != null ? String(s9.temperature_c) : null,
      wind_direction: s9?.wind_direction_deg != null ? String(s9.wind_direction_deg) : null,
      wind_speed_text: s9?.wind_speed_ms != null ? String(s9.wind_speed_ms) : null,
      precipitation_mm: s9?.precipitation_mm ?? null,

      // AI補足
      ai_supplement: aiRaw || null,
      ai_generated_at: aiRaw ? new Date().toISOString() : null,
    };

    const ins = await supabase.from("ky_entries").insert(payload).select("id").maybeSingle();
    if (ins.error || !ins.data?.id) {
      setStatus({ type: "error", text: `保存に失敗しました：${ins.error?.message ?? "unknown"}` });
      return;
    }

    setStatus({ type: "success", text: "保存しました。" });
    router.push(`/projects/${projectId}/ky/${ins.data.id}/review`);
  }, [
    canOperate,
    projectId,
    workDate,
    workDetail,
    hazards,
    countermeasures,
    thirdPartySituation,
    workers,
    notes,
    partnerCompanyId,
    partnerCompanyNameFallback,
    partners,
    slots,
    aiRaw,
    router,
  ]);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-gray-600">KY登録（新規）</div>
          <div className="text-xs text-gray-500">{project?.name ?? ""}</div>
        </div>
        <Link className="border rounded px-3 py-2 text-sm" href={`/projects/${projectId}/ky`}>
          一覧へ戻る
        </Link>
      </div>

      {!authReady && <div className="text-sm text-gray-500">ログイン確認中…</div>}
      {authReady && !session && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">
          ログイン状態を確認できません。操作（保存/承認等）を行うには{" "}
          <Link className="underline" href="/login">
            /login
          </Link>{" "}
          から再ログインしてください。
        </div>
      )}

      {status.type && (
        <div
          className={`rounded border p-3 text-sm ${
            status.type === "success" ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"
          }`}
        >
          {status.text}
        </div>
      )}

      <div className="border rounded p-4 space-y-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold">作業日 *</div>
          <input
            type="date"
            className="w-full border rounded px-3 py-2"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold">協力会社 *</div>
          <select
            className="w-full border rounded px-3 py-2"
            value={partnerCompanyId}
            onChange={(e) => setPartnerCompanyId(e.target.value)}
          >
            <option value="">選択してください</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* 候補ゼロ/見つからない時の保険（UIは小さく） */}
          {partners.length === 0 && (
            <div className="mt-2">
              <div className="text-xs text-gray-600 mb-1">
                候補が出ない場合は、協力会社名を入力（※後で協力会社管理で整備可）
              </div>
              <input
                className="w-full border rounded px-3 py-2"
                placeholder="協力会社名を入力"
                value={partnerCompanyNameFallback}
                onChange={(e) => setPartnerCompanyNameFallback(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold">本日の作業内容 *</div>
          <textarea
            className="w-full border rounded px-3 py-2 min-h-[110px]"
            value={workDetail}
            onChange={(e) => setWorkDetail(e.target.value)}
            placeholder="例：法面清掃、法面整形、伐木、掘削、埋戻し…"
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold">危険ポイント（K） *</div>
          <textarea
            className="w-full border rounded px-3 py-2 min-h-[110px]"
            value={hazards}
            onChange={(e) => setHazards(e.target.value)}
            placeholder="例：転倒・転落、落石、挟まれ、重機接触…"
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold">対策（Y） *</div>
          <textarea
            className="w-full border rounded px-3 py-2 min-h-[110px]"
            value={countermeasures}
            onChange={(e) => setCountermeasures(e.target.value)}
            placeholder="例：親綱、安全帯、立入禁止、誘導員、手順確認…"
          />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-semibold">第三者（墓参者など）の状況 *</div>
          <select
            className="w-full border rounded px-3 py-2"
            value={thirdPartySituation}
            onChange={(e) => setThirdPartySituation(e.target.value as any)}
          >
            <option value="">選択してください</option>
            <option value="多い">多い</option>
            <option value="少ない">少ない</option>
          </select>
        </div>

        {/* 気象 9/12/15（完成形の3枠表示） */}
        <div className="border rounded p-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">気象（9/12/15）</div>
            <button
              type="button"
              className="border rounded px-3 py-2 text-sm"
              onClick={fetchWeather}
              disabled={weatherLoading}
            >
              {weatherLoading ? "取得中…" : "気象データ取得"}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            {(slots ?? []).length === 0 ? (
              <div className="text-sm text-gray-500 md:col-span-3">※ まだ取得していません</div>
            ) : (
              (slots ?? []).map((s) => (
                <div key={s.hour} className="border rounded p-3 text-sm">
                  <div className="font-semibold">{s.hour}:00</div>
                  <div>天候：{s.weather_text}</div>
                  <div>気温：{s.temperature_c ?? "—"}℃</div>
                  <div>
                    風：{s.wind_direction_deg ?? "—"}° / {s.wind_speed_ms ?? "—"} m/s
                  </div>
                  <div>降水：{s.precipitation_mm ?? "—"} mm</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 作業人数・備考（コンパクト） */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold">作業人数</div>
            <input
              type="number"
              className="w-full border rounded px-3 py-2"
              value={workers}
              onChange={(e) => setWorkers(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="例：6"
              min={0}
            />
          </div>
          <div className="md:col-span-2 space-y-1">
            <div className="text-sm font-semibold">備考</div>
            <input
              className="w-full border rounded px-3 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="周知事項、注意点、特記事項"
            />
          </div>
        </div>

        {/* AI補足（完成形：4枠で囲って表示、箇条書き整形） */}
        <div className="border rounded p-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">AI補足（4項目）</div>
            <button
              type="button"
              className="border rounded px-3 py-2 text-sm"
              onClick={generateAi}
              disabled={aiLoading}
            >
              {aiLoading ? "生成中…" : "AI補足を生成"}
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3">
            {[
              { title: "作業内容の補足", items: aiSections.work },
              { title: "危険予知の補足", items: aiSections.risk },
              { title: "対策の補足", items: aiSections.measure },
              { title: "第三者（参考者）の補足", items: aiSections.third },
            ].map((b) => (
              <div key={b.title} className="border rounded p-3">
                <div className="font-semibold mb-2">{b.title}</div>
                {b.items.length === 0 ? (
                  <div className="text-sm text-gray-500">—</div>
                ) : (
                  <ul className="list-disc pl-5 text-sm space-y-1">
                    {b.items.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="mt-2 text-xs text-gray-500">
            ※ AI補足は保存時に raw と4区分（表示用）の双方を保存（一覧・編集・レビューで同形式表示）
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link className="border rounded px-4 py-2" href={`/projects/${projectId}/ky`}>
            戻る
          </Link>
          <button
            type="button"
            className={`rounded px-6 py-2 ${canOperate ? "bg-black text-white" : "bg-gray-300 text-gray-600"}`}
            onClick={save}
            disabled={!canOperate}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
