import { Film } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { GeneratorStudio } from "@/components/studio/generator";

export const metadata = { title: "Video Generator" };

export default function VideoGeneratorPage() {
  return (
    <div>
      <PageHeader
        title="Video Generator"
        description="Plan cinematic footage (camera move, motion and effects) for a scene and a style preset — then route the composed prompt through the AI Model Orchestrator for real generation when a provider is connected."
        actions={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-panel-2 text-ink-dim">
            <Film size={18} strokeWidth={1.75} />
          </span>
        }
      />
      <GeneratorStudio mode="video" />
    </div>
  );
}
