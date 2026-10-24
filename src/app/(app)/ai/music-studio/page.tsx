import { Music } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { AI_TOOL_CAPABILITIES } from "@/lib/product/ai-tool-capabilities";
import { MusicStudioClient } from "./music-studio-client";

export const metadata = { title: "Music Studio" };

export default function MusicStudioPage() {
  return (
    <div>
      <AiToolPage
        icon={Music}
        title="Music Studio"
        description="Plan your score from 15 licensed cinematic categories — matched to your topic, emotion and pace, with automatic ducking under voiceover. This build produces the plan and its licensing metadata; audio needs a connected music provider."
        capability="music_generation"
        formats="Audio · all video formats"
        capabilities={AI_TOOL_CAPABILITIES["music-studio"]}
      />
      <div className="mt-6">
        <MusicStudioClient />
      </div>
    </div>
  );
}