import SubcontractorsClient from "./SubcontractorsClient";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SubcontractorsClient projectId={id} />;
}
