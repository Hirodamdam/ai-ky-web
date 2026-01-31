import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // ✅ App ID を明示（警告解消・将来の更新安定）
    id: "/",

    name: "KYシステム",
    short_name: "KY",
    description: "現場KYの作成・閲覧・承認（所長管理、現場スマホ閲覧中心）",

    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",

    theme_color: "#0f172a",
    background_color: "#ffffff",

    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
