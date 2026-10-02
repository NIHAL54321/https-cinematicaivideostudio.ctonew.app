import { SlidersHorizontal } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
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
        capabilities={[
          "Exactly 4 tracks — voice, music, SFX, ambient",
          "Independent per-track volume (0-100%)",
          "Deterministic clipping prevention via gain staging (≤ -1 dBFS)",
          "Loudness normalization toward a target (default -14 LUFS)",
          "Music ducking curve applied from the Music Studio schedule",
          "Mix PLAN only — real audio rendering arrives in Phase 5",
        ]}
      />
      <div className="mt-6">
        <AudioMixClient />
      </div>
    </div>
  );
}