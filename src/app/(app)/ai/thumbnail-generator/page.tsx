import { Frame } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";

export const metadata = { title: "Thumbnail Generator" };

export default function ThumbnailGeneratorPage() {
  return (
    <AiToolPage
      icon={Frame}
      title="Thumbnail Generator"
      description="Click-worthy 16:9 thumbnails that match your Brand Kit — planned from the video's best moment, never clickbait. Thumbnail generation needs a connected provider; this build plans the request and produces no thumbnail image."
      capability="thumbnail_generation"
      formats="16:9 (1280×720)"
      capabilities={[
        "Generated from the script hook or key scene",
        "Brand Kit colors, fonts and watermark applied",
        "Text overlay options and layout presets",
        "Saved as an asset tied to the project",
        "Thumbnail preferences live in the Brand Kit",
      ]}
    />
  );
}
