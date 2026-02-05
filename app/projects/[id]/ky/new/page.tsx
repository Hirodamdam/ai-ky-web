// app/projects/[id]/ky/new/page.tsx
import KyNewClient from "./KyNewClient";
import { default as KyNewClientDefault } from "./KyNewClient";
import * as Mod from "./KyNewClient";

export default function Page() {
  // ✅ default export が消えても（named export になっても）落ちないように両対応
  const Comp: any =
    (KyNewClient as any) ||
    (KyNewClientDefault as any) ||
    (Mod as any).KyNewClient ||
    (Mod as any).default;

  return <Comp />;
}
