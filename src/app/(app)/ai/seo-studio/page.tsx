import { Search } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";

export const metadata = { title: "SEO Studio" };

export default function SeoStudioPage() {
  return (
    <AiToolPage
      icon={Search}
      title="SEO Studio"
      description="Titles, descriptions, tags and transcript-based chapters that help your video get found. All of it is provider-backed: this build produces no title, tag or chapter text until an SEO provider is wired."
      capability="seo_generation"
      formats="Text · all video formats"
      capabilities={[
        "Title & description variants from the script",
        "Tag and keyword suggestions",
        "Chapter titles from scene structure",
        "Thumbnail text hooks",
        "Defaults from ProjectSettings.seoDefaults",
      ]}
    />
  );
}
