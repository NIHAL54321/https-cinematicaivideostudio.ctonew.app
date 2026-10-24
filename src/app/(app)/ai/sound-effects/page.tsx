import { AudioWaveform } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { AI_TOOL_CAPABILITIES } from "@/lib/product/ai-tool-capabilities";
import { SoundEffectsClient } from "./sound-effects-client";

export const metadata = { title: "Sound Effects" };

export default function SoundEffectsPage() {
  return (
    <div>
      <AiToolPage
        icon={AudioWaveform}
        title="Sound Effects"
        description="Plan sparse, cinematic sound effects — transitions, emphasis beats, ambience and UI accents — placed conservatively across your scenes."
        capability="sound_effects"
        formats="Audio · all video formats"
        capabilities={AI_TOOL_CAPABILITIES["sound-effects"]}
      />
      <div className="mt-6">
        <SoundEffectsClient />
      </div>
    </div>
  );
}