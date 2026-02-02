// app/projects/[id]/ky/[kyId]/review/page.tsx
import KyReviewClient from "./KyReviewClient";

export default function Page() {
  // ✅ params は触らない（Nextの警告回避）
  return <KyReviewClient />;
}
