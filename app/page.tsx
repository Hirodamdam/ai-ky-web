import Link from "next/link";

export default function Home() {
  return (
    <div style={{ padding: 24 }}>
      <h1>AI-KY-WEB</h1>
      <Link href="/projects">工事プロジェクト一覧へ</Link>
    </div>
  );
}
