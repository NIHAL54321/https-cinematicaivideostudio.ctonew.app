import { MagicCreateScreen } from "@/components/create-video/magic";

export const metadata = { title: "Magic Create" };

export default async function MagicCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;
  return <MagicCreateScreen projectId={projectId ?? ""} />;
}
