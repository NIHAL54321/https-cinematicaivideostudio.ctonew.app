/**
 * Phase 4 Block 3 — Subtitle styles (deterministic data + auto-choice).
 *
 * Eight production caption styles from the spec (Minimal, Cinematic, Modern,
 * Creator, Bold, White, Yellow, Karaoke), each with font/size/color/position/
 * outline/shadow settings on a 1080p pixel basis, plus a deterministic
 * autoSubtitleStyle() that picks a style from topic/emotion/mood/video-kind.
 * Same input always yields the same style + reason.
 */

export type SubtitleStyleId =
  | "minimal"
  | "cinematic"
  | "modern"
  | "creator"
  | "bold"
  | "white"
  | "yellow"
  | "karaoke";

export interface SubtitleStyle {
  id: SubtitleStyleId;
  name: string;
  /** CSS font-family stack. */
  font: string;
  /** px on a 1080p basis (renderer scales with the frame). */
  size: number;
  color: string;
  /** Accent used for emphasis words / karaoke fill. */
  highlightColor: string;
  /** Box/drop background behind the text (CSS color or "none"). */
  background: string;
  position: "bottom" | "center" | "top";
  uppercase: boolean;
  outline: { width: number; color: string };
  shadow: { blur: number; color: string };
  /** Karaoke mode: word-by-word highlight sweep. */
  karaoke: boolean;
}

export const SUBTITLE_STYLES: SubtitleStyle[] = [
  {
    id: "minimal",
    name: "Minimal",
    font: "'Inter', system-ui, sans-serif",
    size: 46,
    color: "#ffffff",
    highlightColor: "#ffffff",
    background: "rgba(0,0,0,0.35)",
    position: "bottom",
    uppercase: false,
    outline: { width: 0, color: "transparent" },
    shadow: { blur: 3, color: "rgba(0,0,0,0.9)" },
    karaoke: false,
  },
  {
    id: "cinematic",
    name: "Cinematic",
    font: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    size: 50,
    color: "#f5f1e8",
    highlightColor: "#f2c14e",
    background: "none",
    position: "bottom",
    uppercase: false,
    outline: { width: 2, color: "rgba(0,0,0,0.95)" },
    shadow: { blur: 8, color: "rgba(0,0,0,0.85)" },
    karaoke: false,
  },
  {
    id: "modern",
    name: "Modern",
    font: "'Inter', system-ui, sans-serif",
    size: 44,
    color: "#e8f4ff",
    highlightColor: "#4cc2ff",
    background: "rgba(10,14,24,0.55)",
    position: "bottom",
    uppercase: false,
    outline: { width: 0, color: "transparent" },
    shadow: { blur: 4, color: "rgba(0,0,0,0.8)" },
    karaoke: false,
  },
  {
    id: "creator",
    name: "Creator",
    font: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    size: 52,
    color: "#ffffff",
    highlightColor: "#ff4d8d",
    background: "rgba(0,0,0,0.45)",
    position: "bottom",
    uppercase: true,
    outline: { width: 1, color: "rgba(0,0,0,0.9)" },
    shadow: { blur: 2, color: "rgba(0,0,0,0.9)" },
    karaoke: false,
  },
  {
    id: "bold",
    name: "Bold",
    font: "'Inter', system-ui, sans-serif",
    size: 56,
    color: "#ffffff",
    highlightColor: "#ffdd57",
    background: "rgba(0,0,0,0.5)",
    position: "bottom",
    uppercase: true,
    outline: { width: 3, color: "#000000" },
    shadow: { blur: 0, color: "transparent" },
    karaoke: false,
  },
  {
    id: "white",
    name: "White",
    font: "'Inter', system-ui, sans-serif",
    size: 46,
    color: "#ffffff",
    highlightColor: "#ffffff",
    background: "none",
    position: "bottom",
    uppercase: false,
    outline: { width: 2, color: "#000000" },
    shadow: { blur: 2, color: "rgba(0,0,0,0.9)" },
    karaoke: false,
  },
  {
    id: "yellow",
    name: "Yellow",
    font: "'Inter', system-ui, sans-serif",
    size: 52,
    color: "#ffe94a",
    highlightColor: "#ffffff",
    background: "rgba(0,0,0,0.55)",
    position: "bottom",
    uppercase: false,
    outline: { width: 2, color: "#000000" },
    shadow: { blur: 3, color: "rgba(0,0,0,0.9)" },
    karaoke: false,
  },
  {
    id: "karaoke",
    name: "Karaoke",
    font: "'Space Grotesk', 'Inter', system-ui, sans-serif",
    size: 48,
    color: "#ffffff",
    highlightColor: "#ffcc33",
    background: "rgba(0,0,0,0.35)",
    position: "bottom",
    uppercase: false,
    outline: { width: 1, color: "rgba(0,0,0,0.9)" },
    shadow: { blur: 2, color: "rgba(0,0,0,0.8)" },
    karaoke: true,
  },
];

export function findSubtitleStyle(id: string | undefined | null): SubtitleStyle | null {
  if (!id) return null;
  const lower = id.trim().toLowerCase();
  return SUBTITLE_STYLES.find((s) => s.id === lower || s.name.toLowerCase() === lower) ?? null;
}

export interface AutoStyleInput {
  topic?: string;
  emotion?: string;
  mood?: string;
  videoKind?: string;
}

export interface AutoStyleResult {
  style: SubtitleStyle;
  reason: string;
}

function hasAny(haystack: string, words: string[]): boolean {
  return words.some((w) => haystack.includes(w));
}

/**
 * Deterministic style auto-choice. Rules are evaluated in priority order and
 * the first match wins; no input always yields Minimal with a generic reason.
 */
export function autoSubtitleStyle(input: AutoStyleInput = {}): AutoStyleResult {
  const topic = (input.topic ?? "").toLowerCase().trim();
  const emotion = (input.emotion ?? "").toLowerCase().trim();
  const mood = (input.mood ?? "").toLowerCase().trim();
  const videoKind = (input.videoKind ?? "").toLowerCase().trim();

  const pick = (id: SubtitleStyleId, reason: string): AutoStyleResult => ({
    style: SUBTITLE_STYLES.find((s) => s.id === id)!,
    reason,
  });

  if (hasAny(`${topic} ${emotion} ${mood}`, ["karaoke", "lyrics", "song", "sing-along", "music sync"])) {
    return pick("karaoke", "karaoke/lyrics input detected — word-by-word highlight sweep fits the music-sync format.");
  }
  if (videoKind === "shorts" || videoKind === "short" || emotion.includes("energetic")) {
    return pick("yellow", "short-form or energetic content — high-contrast captions stay readable on mobile.");
  }
  if (hasAny(topic, ["documentary", "history", "science", "nature", "news", "education", "explainer"])) {
    return pick("minimal", "documentary/educational topic — Minimal keeps narration legible without competing with footage.");
  }
  if (hasAny(emotion, ["emotional", "tender", "sad", "heartfelt", "sorrow", "romantic", "love", "moving"])) {
    return pick("cinematic", "emotional tone — Cinematic lettering adds warmth to human moments.");
  }
  if (hasAny(topic, ["tech", "technology", "ai", "code", "software", "digital", "startup", "gadget", "future", "innovation"])) {
    return pick("modern", "technology topic — Modern blue-tinted captions match a futuristic aesthetic.");
  }
  if (hasAny(emotion, ["creator", "fun", "playful", "gaming", "entertainment", "vlog", "hype"]) || videoKind.includes("vlog")) {
    return pick("creator", "creator/entertainment input — Creator's bold uppercase keeps energy high.");
  }
  if (hasAny(emotion, ["bold", "motivational", "hype", "workout", "gym", "driven"])) {
    return pick("bold", "high-intensity motivation — Bold's thick outline survives bright footage.");
  }
  return pick("minimal", "no strong signal — Minimal is the neutral default for readable captions.");
}