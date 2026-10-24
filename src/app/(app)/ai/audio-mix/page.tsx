import { SlidersHorizontal } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { AI_TOOL_CAPABILITIES } from "@/lib/product/ai-tool-capabilities";
import { AudioMixClient } from "./audio-mix-client";

export const metadata = { title: "Audio Mix" };

export default function AudioMixPage() {
  return (
    <div>
      <AiToolPage
        icon={SlidersHorizontal}
        title="Audio Mix"
        description="Final mix plan for the four audio tracks — voice, music, SFX and ambient — with independent volume control, deterministic clipping prevention, loudness normalization and the ducking curve from the Music Studio baked into the music level."
        capability="music_generation"
        formats="Audio mix · all video formats"
        capabilities={AI_TOOL_CAPABILITIES["audio-mix"]}
      />
      <div className="mt-6">
        <AudioMixClient />
      </div>
    </div>
  );
}