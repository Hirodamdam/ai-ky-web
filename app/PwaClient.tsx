"use client";

import { useEffect } from "react";

export default function PwaClient() {
  useEffect(() => {
    // ✅ これが出なければ「クライアントで動いていない」ことが確定
    console.log("🔥 PwaClient mounted");

    if (!("serviceWorker" in navigator)) {
      console.log("SW not supported");
      return;
    }

    (async () => {
      try {
        const res = await fetch("/sw.js", { cache: "no-store" });
        console.log("SW fetch:", res.status, res.headers.get("content-type"));

        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        console.log("✅ SW registered:", reg.scope);

        await navigator.serviceWorker.ready;
        console.log("✅ SW ready");
      } catch (e) {
        console.error("❌ SW register failed:", e);
      }
    })();
  }, []);

  return null;
}
