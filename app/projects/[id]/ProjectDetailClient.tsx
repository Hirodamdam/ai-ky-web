"use client";

import React from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";

type Project = {
  id: string;
  name: string;
  site_name: string | null;
  lat: number | null;
  lon: number | null;
  is_active: boolean | null;
  created_at: string | null;
};

type KyEntry = {
  id: string;
  project_id: string | null;

  work_date: string | null;
  work_detail: string | null;

  title: string | null;

  hazards: string | null;
  countermeasures: string | null;

  temperature_text: string | null;
  wind_direction: string | null;
  wind_speed_text: string | null;
  precipitation_mm: number | null;

  weather: string | null;
  workers: number | null;
  notes: string | null;

  created_at: string | null;
};
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function ProjectDetailClient({ id }: { id: string }) {
  if (!id) {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ color: "#b00020"}}>ERROR: project id is empty</div>
      <div>URLを確認してください（/projects/&lt;uuid&gt; になっている必要があります）</div>
    </div>
  );
}
  const [project, setProject] = React.useState<Project | null>(null);
  const [status, setStatus] = React.useState<string>("loading...");

  const [kyEntries, setKyEntries] = React.useState<KyEntry[]>([]);
  const [kyStatus, setKyStatus] = React.useState<string>("loading...");
  const [kyError, setKyError] = React.useState<string>("");

  React.useEffect(() => {
    console.log("project id =", id);
    
    if (!id) return;

    const fetchProject = async () => {
      setStatus("loading...");

      const { data, error } = await supabase
        .from("projects")
        .select("id, name, site_name, lat, lon, is_active, created_at")
        .eq("id", id)
        .single();

      if (error) {
        setStatus("ERROR: " + error.message);
        setProject(null);
        return;
      }

      setProject(data as Project);
      setStatus("OK");
    };

    fetchProject();
  }, [id]);

  React.useEffect(() => {
    if (!id) return;

    const fetchKyEntries = async () => {
      setKyStatus("loading...");
      setKyError("");

      const { data, error } = await supabase
        .from("ky_entries")
        .select(
          "id, project_id, work_date, title, work_detail, hazards, countermeasures, temperature_text, wind_direction, wind_speed_text, precipitation_mm, weather, workers, notes, created_at"
        )
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        setKyStatus("ERROR");
        setKyError(error.message);
        setKyEntries([]);
        return;
      }

      setKyEntries((data ?? []) as KyEntry[]);
      setKyStatus("OK");
    };

    fetchKyEntries();
  }, [id]);

  return (
    <div style={{ padding: 24 }}>
      <Link href="/projects">← 一覧へ戻る</Link>

      <h1>工事詳細</h1>

      <p>
        <Link href={`/projects/${id}/ky/new`}>＋ KY登録</Link>
      </p>

      <p>ID: {id}</p>
      <p>状態: {status}</p>

      <h2 style={{ marginTop: 16 }}>工事名</h2>
      <p style={{ fontWeight: "bold" }}>{project?.name ?? "—"}</p>

      <div
        style={{
          marginTop: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div>
          <b>現場名</b>：{project?.site_name ?? "—"}
        </div>
        <div>
          <b>緯度</b>：{project?.lat ?? "—"}
        </div>
        <div>
          <b>経度</b>：{project?.lon ?? "—"}
        </div>
        <div>
          <b>稼働中</b>：{project?.is_active ? "はい" : "いいえ"}
        </div>
        <div>
          <b>登録日時</b>：{project?.created_at ?? "—"}
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>KY一覧</h2>
      <p
        style={{
          marginTop: 6,
          color: kyStatus.startsWith("ERROR") ? "#b00020" : "#666",
        }}
      >
        {kyStatus === "loading..."
          ? "読み込み中..."
          : kyStatus === "OK"
          ? `件数: ${kyEntries.length}`
          : `ERROR: ${kyError}`}
      </p>

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {kyEntries.length === 0 && kyStatus === "OK" ? (
          <div style={{ color: "#666" }}>
            まだKYがありません。右上の「＋ KY登録」から追加してください。
          </div>
        ) : null}

        {kyEntries.map((k) => (
          <div
            key={k.id}
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 12,
              background: "#fff",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <b>作業日</b>：{k.work_date ?? "—"}
              </div>
              <div style={{ color: "#666" }}>
                <b>作成</b>：{fmtDateTime(k.created_at)}
              </div>
            </div>
{k.title && (
  <div style={{ marginTop: 6, fontWeight: 700, fontSize: 18 }}>
    {k.title}
  </div>
)}
            <div style={{ marginTop: 8 }}>
              <b>作業内容</b>
              <div style={{ whiteSpace: "pre-wrap" }}>{k.work_detail ?? "—"}</div>
            </div>

            <div style={{ marginTop: 8 }}>
              <b>危険ポイント（K）</b>
              <div style={{ whiteSpace: "pre-wrap" }}>{k.hazards ?? "—"}</div>
            </div>

            <div style={{ marginTop: 8 }}>
              <b>対策（Y）</b>
              <div style={{ whiteSpace: "pre-wrap" }}>
                {k.countermeasures ?? "—"}
              </div>
            </div>

            <div
              style={{
                marginTop: 10,
                display: "grid",
                gap: 6,
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              }}
            >
              <div>
                <b>気温</b>：{k.temperature_text ?? "—"}
              </div>
              <div>
                <b>風向</b>：{k.wind_direction ?? "—"}
              </div>
              <div>
                <b>風速</b>：{k.wind_speed_text ?? "—"}
              </div>
              <div>
                <b>降水量</b>：{k.precipitation_mm ?? "—"}
              </div>
              <div>
                <b>天候</b>：{k.weather ?? "—"}
              </div>
              <div>
                <b>作業人数</b>：{k.workers ?? "—"}
              </div>
              <div>
                <b>備考</b>：{k.notes ?? "—"}
              </div>
            </div>

            <div
              style={{
                marginTop: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ color: "#666", fontSize: 12 }}>id: {k.id}</div>

              <Link
                href={`/projects/${id}/ky/${k.id}/edit`}
                style={{
                  fontSize: 12,
                  color: "#0a66c2",
                  textDecoration: "underline",
                }}
              >
                編集
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}