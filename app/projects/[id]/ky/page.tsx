import KyListClient from "./KyListClient";

type RouteParams = { id: string };

export default async function Page({
  params,
  searchParams,
}: {
  params: RouteParams | Promise<RouteParams>;
  searchParams?: { approved?: string };
}) {
  const { id: projectId } = await Promise.resolve(params);
  const approvedOnly = searchParams?.approved === "1";

  return <KyListClient projectId={projectId} approvedOnly={approvedOnly} />;
}
