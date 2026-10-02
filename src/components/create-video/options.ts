/**
 * Client-safe option data for the Create Video wizard. These are selection
 * presets (formats, durations, styles, languages, voices) — never AI output.
 * Voice entries are labeled presets: actual voiceover generation requires a
 * connected provider via the Voice Studio.
 */
import { DURATION_LABELS } from "@/lib/studio/types";
import type { VideoFormat } from "@/lib/studio/types";

export const FORMAT_OPTIONS: { id: VideoFormat; label: string; description: string; badge: string }[] = [
  {
    id: "LONG",
    label: "Long Video",
    description: "YouTube long-form, up to 120 minutes. 16:9 widescreen.",
    badge: "16:9",
  },
  {
    id: "SHORT",
    label: "Short Video",
    description: "Shorts / reels, up to 3 minutes. 9:16 vertical.",
    badge: "9:16",
  },
  {
    id: "SOCIAL",
    label: "Social Video",
    description: "Feed posts, up to 5 minutes. 1:1 square.",
    badge: "1:1",
  },
];

export const DURATION_OPTIONS_LABELED = Object.entries(DURATION_LABELS).map(([seconds, label]) => ({
  seconds: Number(seconds),
  label,
}));

export const VISUAL_STYLES: { id: string; name: string; description: string }[] = [
  { id: "cinematic", name: "Cinematic", description: "Film-grade color, dramatic lighting, big frames." },
  { id: "documentary", name: "Documentary", description: "Natural, observational, truthful." },
  { id: "educational", name: "Educational", description: "Clean graphics, clear diagrams, structured." },
  { id: "vlog", name: "Vlog", description: "Personal, handheld, authentic." },
  { id: "corporate", name: "Corporate", description: "Polished, on-brand, professional." },
  { id: "faceless-creator", name: "Faceless Creator", description: "No on-camera talent — visuals + voiceover." },
  { id: "minimalist", name: "Minimalist", description: "Negative space, muted palette, restraint." },
  { id: "animated", name: "Animated", description: "Illustration / motion graphics." },
];

export const LANGUAGES: { id: string; name: string; native: string }[] = [
  { id: "en", name: "English", native: "English" },
  { id: "es", name: "Spanish", native: "Español" },
  { id: "fr", name: "French", native: "Français" },
  { id: "de", name: "German", native: "Deutsch" },
  { id: "pt", name: "Portuguese", native: "Português" },
  { id: "it", name: "Italian", native: "Italiano" },
  { id: "ru", name: "Russian", native: "Русский" },
  { id: "hi", name: "Hindi", native: "हिन्दी" },
  { id: "ja", name: "Japanese", native: "日本語" },
  { id: "ko", name: "Korean", native: "한국어" },
  { id: "zh", name: "Chinese (Simplified)", native: "中文" },
  { id: "ar", name: "Arabic", native: "العربية" },
  { id: "tr", name: "Turkish", native: "Türkçe" },
  { id: "nl", name: "Dutch", native: "Nederlands" },
  { id: "pl", name: "Polish", native: "Polski" },
  { id: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { id: "vi", name: "Vietnamese", native: "Tiếng Việt" },
  { id: "th", name: "Thai", native: "ไทย" },
];

export const VOICE_PRESETS: { id: string; name: string; description: string }[] = [
  { id: "aria", name: "Aria", description: "Warm, clear female — documentary" },
  { id: "ethan", name: "Ethan", description: "Deep, calm male — cinematic" },
  { id: "luna", name: "Luna", description: "Bright, energetic female — creator" },
  { id: "noah", name: "Noah", description: "Friendly, conversational male" },
  { id: "nova", name: "Nova", description: "Neutral, professional — narration" },
  { id: "kairo", name: "Kairo", description: "Authoritative male — explainer" },
];
