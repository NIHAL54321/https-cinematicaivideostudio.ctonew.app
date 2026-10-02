/**
 * Phase 4 — Voice catalog & voice directory.
 *
 * Pure, deterministic, no IO: a curated catalog of TTS voice personas plus
 * lookup helpers and a deterministic recommendation heuristic. The actual
 * audio synthesis always routes through the AI Model Orchestrator
 * (capability "voice_generation"); until a TTS provider is connected the API
 * returns the honest "Provider Not Connected" contract.
 */

export type VoiceGender = "male" | "female";

export interface VoiceEntry {
  id: string;
  name: string;
  gender: VoiceGender;
  /** Primary persona bucket, e.g. "documentary", "narrator", "energetic". */
  persona: string;
  description: string;
  accent: string;
  tone: string;
  /** Suggested pitch multiplier (0-2). */
  recommendedPitch: number;
  /** Suggested speed multiplier (0.5-1.5). */
  recommendedSpeed: number;
  /** Provider-side voice id when a provider maps this persona, else null. */
  providerVoiceId: string | null;
  capabilities: string[];
}

export const VOICE_CATALOG: VoiceEntry[] = [
  {
    id: "marcus-deep",
    name: "Marcus",
    gender: "male",
    persona: "documentary",
    description: "Deep, authoritative documentary narrator for long-form storytelling.",
    accent: "American (US)",
    tone: "authoritative",
    recommendedPitch: 0.9,
    recommendedSpeed: 0.95,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "eleanor-classic",
    name: "Eleanor",
    gender: "female",
    persona: "documentary",
    description: "Classic British documentary voice — measured, credible, timeless.",
    accent: "British (UK)",
    tone: "measured",
    recommendedPitch: 1.0,
    recommendedSpeed: 0.92,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "sam-narrator",
    name: "Sam",
    gender: "male",
    persona: "narrator",
    description: "Warm all-round narrator for explainers and faceless channels.",
    accent: "American (US)",
    tone: "warm",
    recommendedPitch: 1.0,
    recommendedSpeed: 1.0,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "priya-narrator",
    name: "Priya",
    gender: "female",
    persona: "narrator",
    description: "Clear, friendly narrator with crisp diction for tutorials.",
    accent: "Indian",
    tone: "warm",
    recommendedPitch: 1.05,
    recommendedSpeed: 1.0,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "alex-energetic",
    name: "Alex",
    gender: "male",
    persona: "energetic",
    description: "High-energy hook voice for Shorts, intros andRetention beats.",
    accent: "American (US)",
    tone: "energetic",
    recommendedPitch: 1.1,
    recommendedSpeed: 1.12,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "zara-energetic",
    name: "Zara",
    gender: "female",
    persona: "energetic",
    description: "Bright, punchy creator voice for hooks and fast-paced edits.",
    accent: "Australian",
    tone: "energetic",
    recommendedPitch: 1.12,
    recommendedSpeed: 1.1,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "oliver-calm",
    name: "Oliver",
    gender: "male",
    persona: "calm",
    description: "Soft-spoken calm voice for sleep stories, meditation and essays.",
    accent: "British (UK)",
    tone: "calm",
    recommendedPitch: 0.9,
    recommendedSpeed: 0.88,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "luna-calm",
    name: "Luna",
    gender: "female",
    persona: "calm",
    description: "Gentle, soothing voice for wellness and slow-cinema narration.",
    accent: "American (US)",
    tone: "calm",
    recommendedPitch: 1.0,
    recommendedSpeed: 0.9,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "david-emotional",
    name: "David",
    gender: "male",
    persona: "emotional",
    description: "Expressive cinematic voice for dramatic arcs and true stories.",
    accent: "American (US)",
    tone: "emotional",
    recommendedPitch: 0.95,
    recommendedSpeed: 0.97,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "sofia-emotional",
    name: "Sofia",
    gender: "female",
    persona: "emotional",
    description: "Heartfelt storyteller for personal stories and climaxes.",
    accent: "British (UK)",
    tone: "emotional",
    recommendedPitch: 1.05,
    recommendedSpeed: 0.96,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "james-professional",
    name: "James",
    gender: "male",
    persona: "professional",
    description: "Boardroom-grade corporate voice for finance and business topics.",
    accent: "American (US)",
    tone: "confident",
    recommendedPitch: 0.95,
    recommendedSpeed: 1.0,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "amelia-professional",
    name: "Amelia",
    gender: "female",
    persona: "professional",
    description: "Polished professional voice for news-style and B2B content.",
    accent: "British (UK)",
    tone: "confident",
    recommendedPitch: 1.0,
    recommendedSpeed: 1.0,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "leo-conversational",
    name: "Leo",
    gender: "male",
    persona: "conversational",
    description: "Casual creator-style voice that feels like a friend explaining.",
    accent: "Australian",
    tone: "friendly",
    recommendedPitch: 1.0,
    recommendedSpeed: 1.05,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "mia-conversational",
    name: "Mia",
    gender: "female",
    persona: "conversational",
    description: "Relatable conversational voice for vlogs and commentary.",
    accent: "American (US)",
    tone: "friendly",
    recommendedPitch: 1.05,
    recommendedSpeed: 1.04,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "kai-young",
    name: "Kai",
    gender: "male",
    persona: "young",
    description: "Youthful voice for gaming, tech and Gen-Z formats.",
    accent: "American (US)",
    tone: "playful",
    recommendedPitch: 1.15,
    recommendedSpeed: 1.08,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "ivy-young",
    name: "Ivy",
    gender: "female",
    persona: "young",
    description: "Fresh youthful voice for Shorts and lifestyle content.",
    accent: "American (US)",
    tone: "playful",
    recommendedPitch: 1.15,
    recommendedSpeed: 1.08,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "arthur-mature",
    name: "Arthur",
    gender: "male",
    persona: "mature",
    description: "Distinguished mature voice for history and prestige topics.",
    accent: "British (UK)",
    tone: "wise",
    recommendedPitch: 0.85,
    recommendedSpeed: 0.93,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "helen-mature",
    name: "Helen",
    gender: "female",
    persona: "mature",
    description: "Warm mature voice for biographies and timeless stories.",
    accent: "American (US)",
    tone: "wise",
    recommendedPitch: 0.95,
    recommendedSpeed: 0.94,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "victor-male",
    name: "Victor",
    gender: "male",
    persona: "male",
    description: "Default balanced male voice — a safe starting point for any script.",
    accent: "American (US)",
    tone: "neutral",
    recommendedPitch: 1.0,
    recommendedSpeed: 1.0,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
  {
    id: "nora-female",
    name: "Nora",
    gender: "female",
    persona: "female",
    description: "Default balanced female voice — a safe starting point for any script.",
    accent: "American (US)",
    tone: "neutral",
    recommendedPitch: 1.0,
    recommendedSpeed: 1.0,
    providerVoiceId: null,
    capabilities: ["tts"],
  },
];

/** All catalog voices (shallow copy). */
export function listVoices(): VoiceEntry[] {
  return [...VOICE_CATALOG];
}

/** Find a voice by id, or null. */
export function findVoice(id: string | null | undefined): VoiceEntry | null {
  if (!id) return null;
  return VOICE_CATALOG.find((v) => v.id === id) ?? null;
}

/** All voices whose persona matches (case-insensitive). */
export function voicesByPersona(persona: string): VoiceEntry[] {
  const key = (persona ?? "").trim().toLowerCase();
  return VOICE_CATALOG.filter((v) => v.persona.toLowerCase() === key);
}

/** Distinct persona buckets in catalog order. */
export function voicePersonas(): string[] {
  const seen: string[] = [];
  for (const v of VOICE_CATALOG) {
    if (!seen.includes(v.persona)) seen.push(v.persona);
  }
  return seen;
}

export interface VoiceRecommendationInput {
  scriptTone?: string;
  sceneType?: string;
  durationMin?: number;
  gender?: VoiceGender;
}

/**
 * Deterministic recommendation heuristic: maps tone/scene keywords onto a
 * persona bucket (documentary→documentary, energetic hook→energetic, calm
 * essay→calm, long prestige pieces→mature, shorts→energetic/young, …).
 * Falls back to a gender-matched default when nothing matches.
 */
export function getVoiceRecommendation(input: VoiceRecommendationInput = {}): VoiceEntry {
  const hay = `${input.scriptTone ?? ""} ${input.sceneType ?? ""}`.toLowerCase();
  const gender = input.gender;
  const pickFrom = (persona: string, fallbackPersona: "male" | "female"): VoiceEntry => {
    const pool = voicesByPersona(persona).filter((v) => !gender || v.gender === gender);
    if (pool.length > 0) return pool[0];
    const fallbackPool = voicesByPersona(fallbackPersona).filter(
      (v) => !gender || v.gender === gender,
    );
    return fallbackPool[0] ?? VOICE_CATALOG[0];
  };
  const has = (...words: string[]) => words.some((w) => hay.includes(w));

  if (has("documentary", "history", "biograph", "prestige")) return pickFrom("documentary", gender ?? "male");
  if (has("energetic", "hook", "shorts", "viral", "gaming", "hype", "intro"))
    return pickFrom("energetic", gender ?? "male");
  if (has("calm", "sleep", "meditat", "relax", "wellness", "essay", "slow"))
    return pickFrom("calm", gender ?? "female");
  if (has("dramatic", "emotional", "story", "climax", "true crime", "cinematic"))
    return pickFrom("emotional", gender ?? "female");
  if (has("serious", "finance", "business", "corporate", "news", "professional", "technical"))
    return pickFrom("professional", gender ?? "male");
  if (has("conversational", "vlog", "commentary", "casual", "friend"))
    return pickFrom("conversational", gender ?? "female");
  if (has("young", "gen-z", "gen z", "tiktok", "lifestyle")) return pickFrom("young", gender ?? "female");
  if (has("mature", "wise", "classic")) return pickFrom("mature", gender ?? "male");
  if (has("narrator", "explain", "tutorial", "education", "faceless"))
    return pickFrom("narrator", gender ?? "male");

  // Long prestige pieces default to mature/documentary; short punchy ones to energetic.
  if ((input.durationMin ?? 0) >= 20) return pickFrom("documentary", gender ?? "male");
  if ((input.durationMin ?? 0) > 0 && input.durationMin! <= 2) return pickFrom("energetic", gender ?? "male");
  return pickFrom(gender === "female" ? "female" : "male", gender ?? "male");
}
