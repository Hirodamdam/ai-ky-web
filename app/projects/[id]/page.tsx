// app/projects/[id]/page.tsx
import ProjectDetailClient from "./ProjectDetailClient";

export default function Page() {
  // params はクライアント側で useParams を使う運用
  return <ProjectDetailClient />;
}
