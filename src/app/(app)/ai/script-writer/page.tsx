import { PenLine } from "lucide-react";
import { PageHeader, Badge } from "@/components/ui";
import { ScriptWriterStudio } from "@/components/script-writer/studio";
import { wiringBadge } from "@/lib/product/public-copy";

export const metadata = { title: "AI Script Writer" };

export default async function ScriptWriterPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const { projectId } = await searchParams;

  return (
    <div>
      <PageHeader
        title="AI Script Writer Studio"
        description="Turn one idea into a structured, cinematic script — video type, tone, hook, structure, retention and a real timeline outline. Deterministic engines run live; AI writing honestly shows “Provider Not Connected” until a provider is wired."
        actions={<Badge tone="accent">{wiringBadge()}</Badge>}
      />
      <ScriptWriterStudio projectId={projectId} />
    </div>
  );
}
