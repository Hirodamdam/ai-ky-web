// app/HeaderLinksClient.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function HeaderLinksClient() {
  const pathname = usePathname() || "";

  // ✅ 公開ページではログイン導線を出さない
  const isPublicKy = pathname.startsWith("/ky/public/");

  if (isPublicKy) return null;

  return (
    <div className="flex justify-end gap-3 text-sm">
      <Link href="/login" className="text-blue-600 underline">
        ログイン
      </Link>
    </div>
  );
}
