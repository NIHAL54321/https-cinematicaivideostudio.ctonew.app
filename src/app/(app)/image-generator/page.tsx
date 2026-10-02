import { Image as ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { GeneratorStudio } from "@/components/studio/generator";

export const metadata = { title: "Image Generator" };

export default function ImageGeneratorPage() {
  return (
    <div>
      <PageHeader
        title="Image Generator"
        description="Compose a cinematic still from a scene description and a style preset — the full prompt pipeline is real and deterministic, and generation routes through the AI Model Orchestrator when a provider is connected."
        actions={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel-2 text-ink-dim">
            <ImageIcon size={18} strokeWidth={1.75} />
          </span>
        }
      />
      <GeneratorStudio mode="image" />
    </div>
  );
}
