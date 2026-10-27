import { BoardRoute } from "@/components/workspace/BoardRoute";

export default async function WorkspaceScreen({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}) {
  const { segments } = await params;
  return <BoardRoute route={segments.join("/")} />;
}
