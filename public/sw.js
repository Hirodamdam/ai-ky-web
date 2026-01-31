/* Minimal Service Worker for PWA installability */

self.addEventListener("install", (event) => {
  // すぐに有効化
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // 既存クライアントを即制御
  event.waitUntil(self.clients.claim());
});

// ※ まずは最小構成（キャッシュ戦略は後で拡張）
