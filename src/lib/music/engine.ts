/**
 * Phase 4 Block 2 — Music selection engine (deterministic, pure, no IO).
 *
 * LIBRARY NOTE: all tracks in the catalog are licensed for YouTube use;
 * attribution is recorded in LicensingMetadata.source when a track is added
 * to a project. This engine never fabricates track URLs — it scores and
 * ranks the 15 licensed categories so a connected provider (or a licensed
 * catalog import) knows what to pull. Real synthesis goes through the AI
 * Model Orchestrator ("music_generation").
 */

export type MusicTempo = "slow" | "medium" | "upbeat" | "epic";

export interface MusicCategory {
  id: string;
  name: string;
  description: string;
  moods: string[];
  tempos: MusicTempo;
  /** Typical energy range [min, max] on a 0-100 scale. */
  energyRange: [number, number];
  typicalBpm: number;
  useHint: string;
  /** Lowercase topic keywords that steer the heuristic toward this category. */
  keywords: string[];
}

/**
 * The 15 licensed music categories from the spec. Deterministic data —
 * scoring is a pure function of these entries.
 */
export const MUSIC_CATEGORIES: MusicCategory[] = [
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Widescreen orchestral textures for trailers, openers and story reveals.",
    moods: ["grand", "sweeping", "emotional", "inspiring"],
    tempos: "epic",
    energyRange: [55, 85],
    typicalBpm: 90,
    useHint: "Default for story-driven explainers and documentaries.",
    keywords: ["cinema", "film", "story", "trailer", "movie", "epic tale", "reveal"],
  },
  {
    id: "inspirational",
    name: "Inspirational",
    description: "Uplifting builds that carry personal-growth and success stories.",
    moods: ["hopeful", "uplifting", "warm", "positive"],
    tempos: "medium",
    energyRange: [50, 75],
    typicalBpm: 100,
    useHint: "Use for transformation arcs and motivational payoffs.",
    keywords: ["inspire", "hope", "dream", "success", "growth", "journey", "uplift", "believe"],
  },
  {
    id: "emotional",
    name: "Emotional",
    description: "Tender piano-and-strings beds for heartfelt, human moments.",
    moods: ["tender", "melancholic", "heartfelt", "intimate"],
    tempos: "slow",
    energyRange: [20, 50],
    typicalBpm: 72,
    useHint: "Use under personal stories, loss, love and reflection.",
    keywords: ["emotional", "heart", "tears", "love", "sad", "touching", "family", "memory", "tender"],
  },
  {
    id: "dramatic",
    name: "Dramatic",
    description: "Tense, high-stakes scoring for twists, reveals and conflict.",
    moods: ["tense", "urgent", "powerful", "ominous"],
    tempos: "epic",
    energyRange: [60, 90],
    typicalBpm: 110,
    useHint: "Use for true-crime beats, debates and cliffhangers.",
    keywords: ["dramatic", "shocking", "twist", "conflict", "crisis", "urgent", "warning", "reveal", "scandal"],
  },
  {
    id: "documentary",
    name: "Documentary",
    description: "Neutral, curious underscore that informs without competing with narration.",
    moods: ["curious", "informative", "neutral", "thoughtful"],
    tempos: "medium",
    energyRange: [35, 60],
    typicalBpm: 95,
    useHint: "Default bed for explainers, history and science narration.",
    keywords: ["documentary", "history", "science", "facts", "explainer", "nature", "wildlife", "learn", "education"],
  },
  {
    id: "corporate",
    name: "Corporate",
    description: "Clean, confident grooves for business, finance and product stories.",
    moods: ["confident", "professional", "modern", "optimistic"],
    tempos: "medium",
    energyRange: [45, 70],
    typicalBpm: 112,
    useHint: "Use for startups, earnings, marketing and B2B topics.",
    keywords: ["business", "corporate", "finance", "startup", "marketing", "money", "invest", "company", "product"],
  },
  {
    id: "technology",
    name: "Technology",
    description: "Modern electronic pulses for AI, code, gadgets and the future.",
    moods: ["futuristic", "focused", "innovative", "driving"],
    tempos: "upbeat",
    energyRange: [55, 80],
    typicalBpm: 120,
    useHint: "Use for AI, coding, gadgets and future-tech topics.",
    keywords: ["technology", "tech", "startup", "ai", "code", "software", "robot", "gadget", "digital", "future", "innovation"],
  },
  {
    id: "mystery",
    name: "Mystery",
    description: "Sparse, questioning textures for unsolved cases and the unknown.",
    moods: ["enigmatic", "eerie", "curious", "dark"],
    tempos: "slow",
    energyRange: [25, 55],
    typicalBpm: 80,
    useHint: "Use for crime, cold cases and unexplained phenomena.",
    keywords: ["mystery", "crime", "unknown", "unsolved", "secret", "detective", "cold case", "murder", "conspiracy"],
  },
  {
    id: "adventure",
    name: "Adventure",
    description: "Driving rhythms and folk energy for travel, sport and discovery.",
    moods: ["bold", "free", "exciting", "outdoorsy"],
    tempos: "upbeat",
    energyRange: [60, 85],
    typicalBpm: 125,
    useHint: "Use for travel vlogs, challenges and outdoor stories.",
    keywords: ["adventure", "travel", "explore", "journey", "sport", "challenge", "outdoor", "road trip", "discover"],
  },
  {
    id: "relaxing",
    name: "Relaxing",
    description: "Soft ambient pads for calm, wellness and slow-living content.",
    moods: ["calm", "peaceful", "serene", "gentle"],
    tempos: "slow",
    energyRange: [10, 35],
    typicalBpm: 65,
    useHint: "Use for meditation, sleep, wellness and cozy content.",
    keywords: ["calm", "relax", "meditation", "sleep", "peaceful", "wellness", "spa", "yoga", "cozy", "ambient calm"],
  },
  {
    id: "motivational",
    name: "Motivational",
    description: "High-drive anthems for workouts, hustle and goal content.",
    moods: ["driven", "energetic", "bold", "triumphant"],
    tempos: "upbeat",
    energyRange: [70, 95],
    typicalBpm: 130,
    useHint: "Use for fitness, productivity and grind montages.",
    keywords: ["motivation", "workout", "fitness", "hustle", "grind", "goals", "discipline", "gym", "training", "success mindset"],
  },
  {
    id: "epic",
    name: "Epic",
    description: "Full-orchestra battle-scale climaxes for heroes and finales.",
    moods: ["heroic", "triumphant", "massive", "legendary"],
    tempos: "epic",
    energyRange: [75, 100],
    typicalBpm: 140,
    useHint: "Use for finales, battles, hero moments and big reveals.",
    keywords: ["epic", "battle", "hero", "war", "legend", "finale", "climax", "victory", "warrior", "kingdom"],
  },
  {
    id: "suspense",
    name: "Suspense",
    description: "Pulsing low-end tension that tightens the screws before a payoff.",
    moods: ["tense", "nervous", "pressured", "ominous"],
    tempos: "medium",
    energyRange: [50, 80],
    typicalBpm: 105,
    useHint: "Use under countdowns, investigations and rising stakes.",
    keywords: ["suspense", "tension", "thriller", "chase", "countdown", "stake", "danger", "horror", "fear"],
  },
  {
    id: "luxury",
    name: "Luxury",
    description: "Elegant, polished grooves for fashion, real estate and high-end brands.",
    moods: ["elegant", "sophisticated", "smooth", "premium"],
    tempos: "medium",
    energyRange: [40, 65],
    typicalBpm: 98,
    useHint: "Use for fashion, cars, real estate and premium reviews.",
    keywords: ["luxury", "fashion", "elegant", "premium", "brand", "style", "design", "lifestyle", "real estate", "car"],
  },
  {
    id: "ambient",
    name: "Ambient",
    description: "Weightless drones and textures that sit quietly under any narration.",
    moods: ["airy", "neutral", "spacious", "minimal"],
    tempos: "slow",
    energyRange: [5, 30],
    typicalBpm: 60,
    useHint: "Safest neutral bed when nothing else fits the topic.",
    keywords: ["ambient", "background", "chill", "lofi", "study", "focus", "minimal", "space", "drone"],
  },
];

export interface MusicSelectionInput {
  topic?: string;
  emotion?: string;
  sceneType?: string;
  pace?: string;
  genre?: string;
}

export interface RankedCategory {
  categoryId: string;
  name: string;
  score: number;
  reason: string;
}

function countKeywordHits(haystack: string, keywords: string[]): number {
  let hits = 0;
  for (const kw of keywords) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = haystack.match(new RegExp(`\\b${escaped}\\b`, "gi"));
    if (m) hits += m.length;
  }
  return hits;
}

/**
 * Genre-name affinity 0-30: exact category-name match scores highest, a
 * mood-word mention scores half. Used by selectMusic; exported for tests.
 */
export function scoreGenreMatch(genre: string | undefined, category: MusicCategory): number {
  if (!genre) return 0;
  const g = genre.trim().toLowerCase();
  if (!g) return 0;
  if (g === category.id || g === category.name.toLowerCase()) return 30;
  if (category.moods.some((m) => m.toLowerCase() === g)) return 15;
  if (category.keywords.some((k) => k.toLowerCase() === g)) return 20;
  return 0;
}

const EMOTION_TO_MOODS: Record<string, string[]> = {
  happy: ["hopeful", "uplifting", "positive", "warm", "excited", "exciting"],
  sad: ["tender", "melancholic", "heartfelt", "sorrowful"],
  focused: ["focused", "futuristic", "innovative", "confident", "neutral"],
  calm: ["calm", "peaceful", "serene", "gentle", "soothing"],
  tense: ["tense", "urgent", "ominous", "nervous"],
  epic: ["heroic", "triumphant", "massive", "grand", "legendary"],
  dark: ["dark", "enigmatic", "eerie", "ominous"],
  romantic: ["tender", "intimate", "warm"],
  energetic: ["driven", "energetic", "bold", "exciting", "driving"],
  professional: ["confident", "professional", "modern", "neutral"],
};

const PACE_TO_TEMPO: Record<string, MusicTempo[]> = {
  slow: ["slow"],
  calm: ["slow"],
  medium: ["medium"],
  moderate: ["medium"],
  normal: ["medium"],
  fast: ["upbeat"],
  upbeat: ["upbeat"],
  energetic: ["upbeat", "epic"],
  epic: ["epic"],
  dramatic: ["epic"],
};

const SCENE_TO_CATEGORIES: Record<string, string[]> = {
  intro: ["cinematic", "inspirational", "documentary"],
  opener: ["cinematic", "epic", "dramatic"],
  explainer: ["documentary", "technology", "corporate", "ambient"],
  tutorial: ["documentary", "corporate", "ambient"],
  story: ["cinematic", "emotional", "inspirational"],
  interview: ["documentary", "ambient", "corporate"],
  montage: ["motivational", "adventure", "upbeat"].filter(() => true),
  workout: ["motivational", "epic"],
  travel: ["adventure", "relaxing", "cinematic"],
  review: ["corporate", "technology", "luxury"],
  finale: ["epic", "cinematic", "inspirational"],
  outro: ["relaxing", "ambient", "inspirational"],
  suspense: ["suspense", "mystery", "dramatic"],
  crime: ["mystery", "suspense", "dramatic"],
};

/**
 * Deterministic heuristic over the 15 licensed categories. Same input always
 * yields the same ranking. Returns the full ranking plus the top pick.
 */
export function selectMusic(input: MusicSelectionInput = {}): { ranked: RankedCategory[]; top: RankedCategory } {
  const haystack = [input.topic ?? "", input.sceneType ?? ""].join(" ").toLowerCase();
  const emotion = (input.emotion ?? "").trim().toLowerCase();
  const pace = (input.pace ?? "").trim().toLowerCase();
  const scene = (input.sceneType ?? "").trim().toLowerCase();

  const scored = MUSIC_CATEGORIES.map((cat) => {
    let score = 10; // ambient-friendly base so every category is comparable
    const reasons: string[] = [];

    const hits = countKeywordHits(haystack, cat.keywords);
    if (hits > 0) {
      score += hits * 12;
      reasons.push(`topic keywords match (${hits} hit${hits > 1 ? "s" : ""})`);
    }

    const genreScore = scoreGenreMatch(input.genre, cat);
    if (genreScore > 0) {
      score += genreScore;
      reasons.push(`genre "${input.genre}" matches ${cat.name}`);
    }

    if (emotion) {
      const wanted = EMOTION_TO_MOODS[emotion] ?? [emotion];
      const moodHit = cat.moods.some((m) => wanted.includes(m.toLowerCase()));
      if (moodHit) {
        score += 10;
        reasons.push(`emotion "${input.emotion}" fits ${cat.name} moods`);
      }
    }

    if (pace && PACE_TO_TEMPO[pace]?.includes(cat.tempos)) {
      score += 8;
      reasons.push(`pace "${input.pace}" suits ${cat.tempos} tempo`);
    }

    if (scene) {
      const keys = Object.keys(SCENE_TO_CATEGORIES);
      const match = keys.find((k) => scene.includes(k));
      if (match && SCENE_TO_CATEGORIES[match].includes(cat.id)) {
        score += 10;
        reasons.push(`scene type "${input.sceneType}" favors ${cat.name}`);
      }
    }

    return {
      categoryId: cat.id,
      name: cat.name,
      score,
      reason: reasons.length > 0 ? reasons.join("; ") : "neutral fallback — no strong signal",
    };
  });

  // Deterministic tiebreak: score desc, then category id asc.
  scored.sort((a, b) => b.score - a.score || (a.categoryId < b.categoryId ? -1 : 1));
  return { ranked: scored, top: scored[0] };
}

/** Lookup helper for API/UI layers. */
export function findMusicCategory(id: string | undefined): MusicCategory | null {
  if (!id) return null;
  const lower = id.trim().toLowerCase();
  return MUSIC_CATEGORIES.find((c) => c.id === lower || c.name.toLowerCase() === lower) ?? null;
}
