import {
  AudioWaveform,
  Captions,
  Clapperboard,
  CloudUpload,
  Download,
  Film,
  FolderOpen,
  Frame,
  Image as ImageIcon,
  LayoutDashboard,
  Library,
  Mic,
  Music,
  Palette,
  PenLine,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  type LucideIcon,
} from "lucide-react";

/**
 * Aspect ratios are first-class. Adding a new ratio = add the enum value in
 * prisma/schema.prisma + an entry here. No other code changes required.
 */
export const ASPECT_RATIOS = [
  { id: "SIXTEEN_NINE", label: "16:9", description: "Long-form YouTube", width: 1920, height: 1080 },
  { id: "NINE_SIXTEEN", label: "9:16", description: "Shorts / vertical", width: 1080, height: 1920 },
  { id: "ONE_ONE", label: "1:1", description: "Square feed posts", width: 1080, height: 1080 },
  { id: "FOUR_THREE", label: "4:3", description: "Classic / educational", width: 1440, height: 1080 },
  { id: "TWENTY_ONE_NINE", label: "21:9", description: "Cinematic widescreen", width: 2560, height: 1080 },
  { id: "FOUR_FIVE", label: "4:5", description: "Portrait feed posts", width: 1080, height: 1350 },
] as const;

export type AspectRatioId = (typeof ASPECT_RATIOS)[number]["id"];

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Phase 8 block 4: only rendered for an account whose role column says ADMIN.
   * The nav hides it for everyone else and the page itself 404s for them — the
   * hiding is a courtesy, the guard is the control.
   */
  adminOnly?: boolean;
};
export type NavSection = { label: string; items: NavItem[] };

/** The full app navigation — exactly the 15 items specified for Phase 1. */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Create",
    items: [
      { href: "/create-video", label: "Create Video", icon: Clapperboard },
      { href: "/projects", label: "My Projects", icon: FolderOpen },
    ],
  },
  {
    label: "AI Studio",
    items: [
      { href: "/ai/script-writer", label: "AI Script Writer", icon: PenLine },
      { href: "/video-generator", label: "AI Video Generator", icon: Film },
      { href: "/image-generator", label: "Image Generator", icon: ImageIcon },
      { href: "/ai/thumbnail-generator", label: "Thumbnail Generator", icon: Frame },
      { href: "/ai/voice-studio", label: "Voice Studio", icon: Mic },
      { href: "/ai/music-studio", label: "Music Studio", icon: Music },
      { href: "/ai/sound-effects", label: "Sound Effects", icon: AudioWaveform },
      { href: "/ai/subtitle-studio", label: "Subtitle Studio", icon: Captions },
      { href: "/ai/audio-mix", label: "Audio Mix", icon: SlidersHorizontal },
      { href: "/ai/shorts-maker", label: "Shorts Maker", icon: Smartphone },
      { href: "/ai/seo-studio", label: "SEO Studio", icon: Search },
    ],
  },
  {
    label: "Brand & Media",
    items: [
      { href: "/brand-kit", label: "Brand Kit", icon: Palette },
      { href: "/media-library", label: "Media Library", icon: Library },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/export-center", label: "Export Center", icon: CloudUpload },
      { href: "/downloads", label: "Downloads", icon: Download },
      { href: "/billing", label: "Usage & Credits", icon: Receipt },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

export function navItemForPath(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
}
