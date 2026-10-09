import { Image as ImageIcon } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";

export const metadata = { title: "Image Generator" };

export default function ImageGeneratorPage() {
  return (
    <AiToolPage
      icon={ImageIcon}
      title="Image Generator"
      description="Cinematic stills for scenes, backgrounds and b-roll — sized to the exact aspect ratio of your video. The prompt pipeline is real and deterministic; images need a connected provider, so none is generated until one is wired."
      capability="image_generation"
      formats="All aspect ratios (16:9 · 9:16 · 1:1 · 4:3 · 21:9 · 4:5)"
      capabilities={[
        "Aspect-ratio-correct images for every scene",
        "Negative prompts & seed control",
        "Batch generation for whole chapters",
        "Automatic Brand Kit color grading",
        "Saved to the Media Library with licensing metadata",
      ]}
    />
  );
}
