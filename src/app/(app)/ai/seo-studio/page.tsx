import { Search } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { SEO_STUDIO_DESCRIPTION } from "@/lib/product/seo-studio-copy";

export const metadata = { title: "SEO Studio" };

export default function SeoStudioPage() {
  return (
    <AiToolPage
      icon={Search}
      title="SEO Studio"
      description={SEO_STUDIO_DESCRIPTION}
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
