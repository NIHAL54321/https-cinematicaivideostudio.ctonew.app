import { Captions } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { AI_TOOL_CAPABILITIES } from "@/lib/product/ai-tool-capabilities";
import { SUBTITLE_STUDIO_DESCRIPTION } from "@/lib/product/subtitle-studio-copy";
import { SubtitleStudioClient } from "./subtitle-studio-client";

export const metadata = { title: "Subtitle Studio" };

export default function SubtitleStudioPage() {
  return (
    <div>
      <AiToolPage
        icon={Captions}
        title="Subtitle Studio"
        description={SUBTITLE_STUDIO_DESCRIPTION}
        capability="subtitle_generation"
        formats="Text overlay · all video formats"
        capabilities={AI_TOOL_CAPABILITIES["subtitle-studio"]}
      />
      <div className="mt-6">
        <SubtitleStudioClient />
      </div>
    </div>
  );
}
