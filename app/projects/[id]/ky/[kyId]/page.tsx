import { redirect } from "next/navigation";

export default async function Page(props: {
  params: { id: string; kyId: string } | Promise<{ id: string; kyId: string }>;
}) {
  const { id, kyId } = await Promise.resolve(props.params);

  // ✅ 旧URLは /edit に一本化
  redirect(`/projects/${id}/ky/${kyId}/edit`);
}
