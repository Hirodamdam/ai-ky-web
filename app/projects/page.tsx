"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";

type Project = {
  id: string;
  name: string;
  is_active: boolean;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState("loading...");
const [onlyActive, setOnlyActive] = useState(true);
  useEffect(() => {
    const fetchProjects = async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, is_active");

      if (error) {
        setStatus("ERROR: " + error.message);
        return;
      }

      setProjects((data ?? []) as Project[]);
      setStatus(`OK: loaded ${(data ?? []).length} project(s)`);
    };

    fetchProjects();
  }, []);
const filteredProjects = onlyActive
  ? projects.filter((p) => p.is_active === true)
  : projects;

  return (
    <div style={{ padding: 24 }}>
      <a href="/">← トップへ戻る</a>

      <h1>工事プロジェクト一覧</h1>
      <p>{status}</p>
<div style={{ marginTop: 12, display: "flex", gap: 8 }}>
  <button
    onClick={() => setOnlyActive((v) => !v)}
    style={{
      padding: "8px 12px",
      border: "1px solid #ddd",
      borderRadius: 8,
      background: onlyActive ? "#111" : "#fff",
      color: onlyActive ? "#fff" : "#111",
      cursor: "pointer",
    }}
  >
    {onlyActive ? "稼働中のみ表示：ON" : "稼働中のみ表示：OFF"}
  </button>
</div>
      <div style={{ display: "grid", gap: 12 }}>
       {filteredProjects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            {p.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
