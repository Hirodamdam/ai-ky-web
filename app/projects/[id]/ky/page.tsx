// app/projects/[id]/ky/page.tsx
import KyListClient from "./KyListClient";

export default function Page() {
  // ✅ params は触らない（NextのPromise警告回避）
  return <KyListClient />;
}
