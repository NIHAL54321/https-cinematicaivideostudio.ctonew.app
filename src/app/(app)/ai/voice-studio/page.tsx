import { Mic } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { AI_TOOL_CAPABILITIES } from "@/lib/product/ai-tool-capabilities";
import { VoiceStudioClient } from "./voice-studio-client";

export const metadata = { title: "Voice Studio" };

export default function VoiceStudioPage() {
  return (
    <div>
      <AiToolPage
        icon={Mic}
        title="Voice Studio"
        description="Direct a professional AI voiceover — per-scene voices, languages and pacing, with your voice defaults seeded from your Brand Kit. The directed plan is built here; narration audio needs a connected voice provider."
        capability="voice_generation"
        formats="Audio · all video formats"
        capabilities={AI_TOOL_CAPABILITIES["voice-studio"]}
      />
      <div className="mt-6">
        <VoiceStudioClient />
      </div>
    </div>
  );
}
