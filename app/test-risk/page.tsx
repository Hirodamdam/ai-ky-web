"use client";

import { useState } from "react";

export default function TestRiskPage() {
  const [status, setStatus] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  async function runTest() {
    setStatus("sending...");
    setResult(null);

    const payload = {
      human: {
        work_detail: "法面整備工事",
        hazards: "法面作業なので滑落の恐れがある",
        countermeasures: "安全帯を使用する",
        third_party_level: "多い",
        worker_count: 12,
      },
      ai: {
        ai_hazards: "法面作業だから転落事故になる恐れがある",
        ai_countermeasures: "親綱を設置する",
        ai_third_party: "第三者との接触事故の恐れがある",
      },
      weather_applied: {
        hour: 9,
        weather_text: "雨",
        temperature_c: 28,
        wind_speed_ms: 8,
        precipitation_mm: 4,
      },
      photos: {
        slope_now_url: "A",
        slope_prev_url: "B",
        path_now_url: "C",
        path_prev_url: "D",
      },
    };

    try {
      const res = await fetch("/api/ky-risk-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text(); // まず text で取得（JSONでなくても原因が見える）
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { _nonJsonResponse: text };
      }

      setStatus(`done: HTTP ${res.status} ${res.ok ? "(ok)" : "(ng)"}`);
      setResult({ request: payload, response: data });
    } catch (e: any) {
      setStatus("network error");
      setResult({ error: e?.message ? String(e.message) : String(e) });
    }
  }

  return (
    <div style={{ padding: 20, fontFamily: "system-ui" }}>
      <h1 style={{ margin: 0 }}>Risk API Test</h1>
      <div style={{ marginTop: 8 }}>
        <button onClick={runTest} style={{ padding: "8px 12px" }}>
          実行
        </button>
        <span style={{ marginLeft: 12 }}>{status}</span>
      </div>

      <pre
        style={{
          marginTop: 16,
          padding: 12,
          background: "#f6f6f6",
          borderRadius: 8,
          overflowX: "auto",
        }}
      >
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}
