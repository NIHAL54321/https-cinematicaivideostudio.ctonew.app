import { Music } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
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
        capabilities={[
          "15 licensed categories — cinematic, emotional, technology, epic, ambient…",
          "Auto-selection by topic, emotion, scene type and pace",
          "Mood / tempo / BPM / energy profile per category",
          "Automatic ducking under voiceover with manual volume control",
          "Licensing metadata recorded on every generated track",
        ]}
      />
      <div className="mt-6">
        <MusicStudioClient />
      </div>
    </div>
  );
}