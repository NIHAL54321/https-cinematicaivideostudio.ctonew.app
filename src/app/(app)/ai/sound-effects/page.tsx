import { AudioWaveform } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
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
        capabilities={[
          "14 licensed effect types — whoosh, impact, ambience, UI accents…",
          "Transition-matched whooshes and impacts (never keyword-guessed)",
          "Ambience and UI effects only on keyword-matched scenes",
          "Conservative placement: max 2 per scene, 1.5s minimum gap",
          "Licensing metadata recorded on every generated effect",
        ]}
      />
      <div className="mt-6">
        <SoundEffectsClient />
      </div>
    </div>
  );
}