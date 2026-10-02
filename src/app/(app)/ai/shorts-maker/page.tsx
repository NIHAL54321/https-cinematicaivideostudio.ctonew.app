import { Smartphone } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";

export const metadata = { title: "Shorts Maker" };

export default function ShortsMakerPage() {
  return (
    <AiToolPage
      icon={Smartphone}
      title="Shorts Maker"
      description="Re-cut any long-form video into punchy 9:16 Shorts — hooks, captions and music built in."
      capability="video_generation"
      formats="9:16 (1080×1920)"
      capabilities={[
        "Auto-extract the most engaging moments",
        "Reframe 16:9 footage for vertical",
        "Auto-captions with animated subtitles",
        "Hook generation from the strongest line",
        "Direct export to YouTube Shorts / TikTok",
      ]}
    />
  );
}
