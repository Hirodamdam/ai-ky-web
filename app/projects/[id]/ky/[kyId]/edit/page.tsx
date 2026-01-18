import KyEditClient from "./KyEditClient";

type RouteParams = { id: string; kyId: string };

export default async function Page({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}) {
  const { id, kyId } = await Promise.resolve(params);
  return <KyEditClient projectId={id} kyId={kyId} />;
}
