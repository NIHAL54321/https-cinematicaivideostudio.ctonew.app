import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import type { Metadata } from "next";
import { PAGE_DESCRIPTION } from "@/lib/product/public-copy";

/**
 * The metadata every page ships in `<head>` — a signed-out surface (it is what a
 * search result or a shared link shows), so its description is owned by
 * `src/lib/product/public-copy.ts` rather than typed here.
 */
export const metadata: Metadata = {
  title: {
    default: "Cinematic AI Video Studio",
    template: "%s · Cinematic AI Video Studio",
  },
  description: PAGE_DESCRIPTION,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-void text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
