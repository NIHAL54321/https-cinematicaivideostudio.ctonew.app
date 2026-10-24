import { Search } from "lucide-react";
import { AiToolPage } from "@/components/ai-tool-page";
import { AI_TOOL_CAPABILITIES } from "@/lib/product/ai-tool-capabilities";
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
      capabilities={AI_TOOL_CAPABILITIES["seo-studio"]}
    />
  );
}
