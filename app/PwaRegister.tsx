"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    alert("PwaRegister mounted"); // ← 絶対に出るはず
    console.log("PwaRegister mounted");
  }, []);

  return null;
}
