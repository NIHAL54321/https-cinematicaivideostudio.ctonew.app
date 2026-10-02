import { Mic } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { VoiceStudioClient } from "./voice-studio-client";

export const metadata = { title: "Voice Studio" };

export default function VoiceStudioPage() {
  return (
    <div>
      <AiToolPage
        icon={Mic}
        title="Voice Studio"
        description="Direct a professional AI voiceover — per-scene voices, languages and pacing, tuned by your Brand Kit."
        capability="voice_generation"
        formats="Audio · all video formats"
        capabilities={[
          "Scene-by-scene voiceover from narration text",
          "Multi-language dubbing with 50+ provider languages",
          "Voice, pitch, speed and pacing controls",
          "Pronunciation corrections and lexicon",
          "Directed segment plan with timing estimates",
        ]}
      />
      <div className="mt-6">
        <VoiceStudioClient />
      </div>
    </div>
  );
}
