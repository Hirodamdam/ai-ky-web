import ProjectSubcontractorsClient from "./ProjectSubcontractorsClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectSubcontractorsClient projectId={id} />;
}
