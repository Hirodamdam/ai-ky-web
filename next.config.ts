import type { NextConfig } from "next";

// ✅ PWA
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // ✅ Turbopack 警告を抑止（空でOK）
  turbopack: {},
};

export default withPWA(nextConfig);
