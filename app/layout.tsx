import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import PwaRegister from "./PwaRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KYシステム",
  description: "現場KYの作成・閲覧・承認（所長管理、現場スマホ閲覧中心）",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* PWA: Service Worker 登録（必須） */}
        <PwaRegister />

        {/* 全ページ共通レイアウト */}
        <div className="min-h-screen bg-gray-50">
          <main className="mx-auto w-full max-w-5xl px-4 md:px-6 py-4 md:py-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
