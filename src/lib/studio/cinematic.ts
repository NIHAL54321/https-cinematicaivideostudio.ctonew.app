/**
 * Cinematic descriptor library — the 23 visual-quality descriptors.
 *
 * `selectDescriptors` picks a SMALL, appropriate subset per scene (never
 * blindly all of them) using deterministic heuristics on tone + media type +
 * format. Descriptors label the intended look; they are structure, not AI.
 */
export type DescriptorCategory = "realism" | "mood" | "quality" | "color";

export interface CinematicDescriptor {
  id: string;
  label: string;
  category: DescriptorCategory;
  /** Media types the descriptor most applies to (empty = any). */
  appliesTo: string[];
}

export const CINEMATIC_DESCRIPTORS: CinematicDescriptor[] = [
  // realism
  { id: "cinematic", label: "Cinematic", category: "realism", appliesTo: ["AI_VIDEO", "AI_IMAGE", "STOCK"] },
  { id: "filmic", label: "Filmic", category: "realism", appliesTo: ["AI_VIDEO", "AI_IMAGE"] },
  { id: "theatrical", label: "Theatrical", category: "realism", appliesTo: ["AI_VIDEO", "AI_IMAGE"] },
  { id: "cinematographic", label: "Cinematographic", category: "realism", appliesTo: ["AI_VIDEO", "AI_IMAGE", "STOCK"] },
  { id: "anamorphic", label: "Anamorphic", category: "realism", appliesTo: ["AI_VIDEO", "AI_IMAGE"] },
  { id: "hollywood-style", label: "Hollywood-style", category: "realism", appliesTo: ["AI_VIDEO", "STOCK"] },
  { id: "directors-cut", label: "Director's-cut", category: "realism", appliesTo: ["AI_VIDEO"] },
  { id: "lifelike", label: "Lifelike", category: "realism", appliesTo: ["AI_VIDEO", "AI_IMAGE", "STOCK"] },
  { id: "hyper-realistic", label: "Hyper-realistic", category: "realism", appliesTo: ["AI_IMAGE", "AI_VIDEO"] },
  { id: "ultra-realistic", label: "Ultra-realistic", category: "realism", appliesTo: ["AI_IMAGE", "AI_VIDEO"] },
  { id: "photorealistic", label: "Photorealistic", category: "realism", appliesTo: ["AI_IMAGE", "AI_VIDEO", "STOCK"] },
  { id: "true-to-life", label: "True-to-life", category: "realism", appliesTo: ["STOCK", "AI_VIDEO", "AI_IMAGE"] },
  // quality
  { id: "studio-quality", label: "Studio-quality", category: "quality", appliesTo: [] },
  { id: "broadcast-ready", label: "Broadcast-ready", category: "quality", appliesTo: [] },
  { id: "immersive", label: "Immersive", category: "quality", appliesTo: [] },
  { id: "vivid", label: "Vivid", category: "quality", appliesTo: [] },
  { id: "breathtaking", label: "Breathtaking", category: "quality", appliesTo: [] },
  // mood
  { id: "atmospheric", label: "Atmospheric", category: "mood", appliesTo: [] },
  { id: "moody", label: "Moody", category: "mood", appliesTo: [] },
  { id: "luminous", label: "Luminous", category: "mood", appliesTo: [] },
  // color
  { id: "vibrant-tones", label: "Vibrant", category: "color", appliesTo: [] },
  { id: "rich-tones", label: "Rich tones", category: "color", appliesTo: [] },
  { id: "color-accurate", label: "Color-accurate", category: "color", appliesTo: [] },
];

const REALISM_IDS = [
  "cinematic",
  "filmic",
  "cinematographic",
  "photorealistic",
  "lifelike",
  "hollywood-style",
  "hyper-realistic",
  "true-to-life",
];

const MOOD_BY_TONE: Record<string, string[]> = {
  cinematic: ["atmospheric", "moody", "luminous"],
  dramatic: ["moody", "atmospheric"],
  mysterious: ["moody", "atmospheric"],
  calm: ["luminous", "atmospheric"],
  emotional: ["luminous", "atmospheric"],
  inspirational: ["luminous", "vivid"],
  energetic: ["vivid", "vibrant-tones"],
  educational: ["color-accurate"],
  professional: ["color-accurate"],
  serious: ["color-accurate", "moody"],
  friendly: ["vivid", "luminous"],
  conversational: ["vivid"],
};

export interface SelectDescriptorsInput {
  tone?: string;
  mediaType?: string;
  format?: string;
  /** Max descriptors to return (default 5). */
  count?: number;
  /**
   * Deterministic variation index (default 0). A non-zero variant rotates the
   * realism/quality/mood picks so a "re-roll" produces a different but stable
   * prompt — same variant always yields the same descriptors.
   */
  variant?: number;
}

/**
 * Pick a small, appropriate subset of descriptors for a scene — never all 23.
 * Deterministic: 1 realism + 1 quality + tone-matched mood/color, then extras
 * up to `count`, rotating through categories so consecutive scenes vary.
 */
export function selectDescriptors(input: SelectDescriptorsInput): CinematicDescriptor[] {
  const count = Math.min(8, Math.max(3, input.count ?? 5));
  const media = input.mediaType ?? "";
  const tone = input.tone ?? "";
  const v = Math.max(0, Math.floor(input.variant ?? 0));
  const out: CinematicDescriptor[] = [];
  const byId = (id: string) => CINEMATIC_DESCRIPTORS.find((d) => d.id === id)!;

  // 1. realism — rotate by tone hash + variant so re-rolls differ deterministically.
  const realismIdx = (hash(tone + media) + v) % REALISM_IDS.length;
  const realism = byId(REALISM_IDS[realismIdx]);
  if (!realism.appliesTo.length || realism.appliesTo.includes(media)) out.push(realism);

  // 2. quality — always one (rotates through the quality pool with variant).
  const QUALITY_IDS = ["studio-quality", "broadcast-ready", "immersive"];
  out.push(byId(QUALITY_IDS[v % QUALITY_IDS.length]));

  // 3. tone-matched mood/color (fallback: atmospheric) — rotate the start by variant.
  const moodIds = MOOD_BY_TONE[tone] ?? ["atmospheric"];
  const moodStart = v % moodIds.length;
  for (let i = 0; i < moodIds.length; i++) {
    const d = byId(moodIds[(moodStart + i) % moodIds.length]);
    if (!out.includes(d)) out.push(d);
    if (out.length >= count) break;
  }

  // 4. top up deterministically from remaining categories.
  if (out.length < count) {
    const extras = ["broadcast-ready", "immersive", "vivid", "rich-tones", "breathtaking", "color-accurate"];
    for (const eid of extras) {
      if (out.length >= count) break;
      const d = byId(eid);
      if (!out.includes(d)) out.push(d);
    }
  }

  // Ensure at least one color descriptor for vibrant/graphic media.
  if (media === "CHART" || media === "INFOGRAPHIC" || media === "TIMELINE") {
    if (!out.some((d) => d.category === "color")) {
      out.push(byId("color-accurate"));
    }
  }

  return out.slice(0, count);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
