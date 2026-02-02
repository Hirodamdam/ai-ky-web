"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    console.log("PwaRegister mounted");

    const run = async () => {
      if (!("serviceWorker" in navigator)) {
        console.log("SW not supported");
        return;
      }

      try {
        // sw.js が本当に取得できるか確認
        const res = await fetch("/sw.js", { cache: "no-store" });
        console.log("SW fetch:", res.status, res.headers.get("content-type"));

        // 登録
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        console.log("✅ SW registered:", reg.scope);

        // ready
        const ready = await navigator.serviceWorker.ready;
        console.log("✅ SW ready:", ready.scope);

        // controller（ページがSWに制御されているか）
        console.log("controller:", navigator.serviceWorker.controller);
      } catch (e) {
        console.error("❌ SW register failed:", e);
      }
    };

    run();
  }, []);

  return null;
}
