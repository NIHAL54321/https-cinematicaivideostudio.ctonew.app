import { Film } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";

export const metadata = { title: "AI Video Generator" };

export default function VideoGeneratorPage() {
  return (
    <AiToolPage
      icon={Film}
      title="AI Video Generator"
      description="Generate cinematic footage for every scene from your storyboard — or pull from premium stock with licensing metadata attached."
      capability="video_generation"
      formats="16:9 · 9:16 · 1:1 · 21:9"
      capabilities={[
        "Text-to-video per scene, resolution up to 4K",
        "Seed control for consistent characters & scenes",
        "Stock fallback with license & attribution tracking",
        "Scene assets tagged by role (visual / B-roll / overlay)",
        "Every generation recorded for audit & cost tracking",
      ]}
    />
  );
}
