import { Captions } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import {
  SUBTITLE_STUDIO_CAPABILITIES,
  SUBTITLE_STUDIO_DESCRIPTION,
} from "@/lib/product/subtitle-studio-copy";
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
        capabilities={SUBTITLE_STUDIO_CAPABILITIES}
      />
      <div className="mt-6">
        <SubtitleStudioClient />
      </div>
    </div>
  );
}
