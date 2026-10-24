import { Smartphone } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { AI_TOOL_CAPABILITIES } from "@/lib/product/ai-tool-capabilities";

export const metadata = { title: "Shorts Maker" };

export default function ShortsMakerPage() {
  return (
    <AiToolPage
      icon={Smartphone}
      title="Shorts Maker"
      description="Re-cut any long-form video into punchy 9:16 Shorts — moment selection, 9:16 reframing and captions run on the deterministic engines in this build; music needs a connected provider and nothing is rendered."
      capability="video_generation"
      formats="9:16 (1080×1920)"
      capabilities={AI_TOOL_CAPABILITIES["shorts-maker"]}
    />
  );
}
