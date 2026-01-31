// app/projects/[id]/ky/new/page.tsx
import KyNewClient from "./KyNewClient";

export default function Page() {
  // paramsは触らない（Nextの警告回避）
  return <KyNewClient />;
}
