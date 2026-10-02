import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Cinematic AI Video Studio",
    template: "%s · Cinematic AI Video Studio",
  },
  description:
    "Turn one idea into a complete cinematic faceless YouTube video — script, visuals, voice, music, subtitles and 4K export.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-void text-ink font-sans antialiased">{children}</body>
    </html>
  );
}
