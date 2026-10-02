import { Captions } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { SubtitleStudioClient } from "./subtitle-studio-client";

export const metadata = { title: "Subtitle Studio" };

export default function SubtitleStudioPage() {
  return (
    <div>
      <AiToolPage
        icon={Captions}
        title="Subtitle Studio"
        description="Generate precise, readable captions for every video — word and sentence timing from your voice plan, automatic line breaks, safe margins, dynamic captions and smart positioning that never covers faces or on-screen text."
        capability="subtitle_generation"
        formats="Text overlay · all video formats"
        capabilities={[
          "Word and sentence timing from the Directed Voice Plan",
          "Automatic line breaks at readable lengths (no mid-word splits)",
          "Safe margins for every format, mobile-friendly sizing",
          "Dynamic captions — long cues split into short on-screen pieces",
          "Keyword emphasis flagged from the voice plan / pronunciation engine",
          "Auto style choice (Minimal, Cinematic, Modern, Creator, Bold…)",
          "Smart positioning that avoids faces, text, charts and subjects",
          "Real SRT export from the deterministic plan",
        ]}
      />
      <div className="mt-6">
        <SubtitleStudioClient />
      </div>
    </div>
  );
}