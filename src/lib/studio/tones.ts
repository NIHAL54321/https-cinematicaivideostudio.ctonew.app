/**
 * The 13 voice/editorial tones. Pure data — descriptors only. These label the
 * intended feel of the (future, AI-written) script; they never fabricate copy.
 */
export interface Tone {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  voice: string;
  pacing: string;
  vocabulary: string;
  emotion: string;
}

export const TONES: Tone[] = [
  {
    id: "cinematic",
    name: "Cinematic",
    description: "Film-grade drama, wide emotional swells, sensory detail.",
    keywords: ["film", "movie", "cinema", "epic", "visual"],
    voice: "Deep, resonant, deliberate",
    pacing: "Slow to medium, beat-aware",
    vocabulary: "Evocative, sensory, image-led",
    emotion: "Awe, immersion",
  },
  {
    id: "inspirational",
    name: "Inspirational",
    description: "Lifting, aspirational, momentum-building.",
    keywords: ["inspire", "motivat", "dream", "achieve", "believe"],
    voice: "Warm, rising, affirming",
    pacing: "Medium, builds toward peaks",
    vocabulary: "Aspirational, action-oriented",
    emotion: "Hope, resolve",
  },
  {
    id: "emotional",
    name: "Emotional",
    description: "Heart-led, personal, resonant.",
    keywords: ["feel", "heart", "loss", "love", "grief", "joy"],
    voice: "Soft, intimate, human",
    pacing: "Slow, space for feeling",
    vocabulary: "Personal, concrete, felt",
    emotion: "Empathy, connection",
  },
  {
    id: "dramatic",
    name: "Dramatic",
    description: "High stakes, tension, weight.",
    keywords: ["drama", "tension", "stakes", "intense", "conflict"],
    voice: "Low, weighted, urgent",
    pacing: "Tense, punctuated",
    vocabulary: "Stakes-led, contrast-rich",
    emotion: "Suspense, gravity",
  },
  {
    id: "professional",
    name: "Professional",
    description: "Polished, credible, on-brand.",
    keywords: ["business", "corporate", "work", "office", "brand"],
    voice: "Steady, assured, neutral",
    pacing: "Even, structured",
    vocabulary: "Precise, business-grade",
    emotion: "Trust, competence",
  },
  {
    id: "educational",
    name: "Educational",
    description: "Clear, structured, teacher-led.",
    keywords: ["learn", "teach", "lesson", "course", "explain"],
    voice: "Clear, patient, articulate",
    pacing: "Measured, example-driven",
    vocabulary: "Explicit, definition-led",
    emotion: "Clarity, curiosity",
  },
  {
    id: "friendly",
    name: "Friendly",
    description: "Warm, approachable, everyday.",
    keywords: ["friend", "welcome", "hello", "buddy", "pal"],
    voice: "Bright, relaxed, personable",
    pacing: "Conversational",
    vocabulary: "Simple, warm, inclusive",
    emotion: "Welcome, ease",
  },
  {
    id: "authoritative",
    name: "Authoritative",
    description: "Expert, confident, decisive.",
    keywords: ["expert", "authority", "proven", "guide", "expertise"],
    voice: "Firm, grounded, assured",
    pacing: "Steady, commanding",
    vocabulary: "Assertive, evidence-backed",
    emotion: "Certainty, leadership",
  },
  {
    id: "energetic",
    name: "Energetic",
    description: "Fast, bright, high-velocity.",
    keywords: ["fast", "pump", "hype", "quick", "rush", "energy"],
    voice: "Upbeat, fast, punchy",
    pacing: "Quick, clipped, propulsive",
    vocabulary: "Short, bold, dynamic",
    emotion: "Excitement, momentum",
  },
  {
    id: "calm",
    name: "Calm",
    description: "Soothing, grounded, unhurried.",
    keywords: ["calm", "peace", "relax", "sleep", "slow", "breath"],
    voice: "Soft, low, unhurried",
    pacing: "Slow, spacious",
    vocabulary: "Simple, grounding, sensory",
    emotion: "Serenity, safety",
  },
  {
    id: "mysterious",
    name: "Mysterious",
    description: "Enigmatic, withheld, intriguing.",
    keywords: ["mystery", "secret", "unknown", "riddle", "hidden"],
    voice: "Low, partial, suggestive",
    pacing: "Slow, gap-filled",
    vocabulary: "Evocative, withheld, teaser-led",
    emotion: "Curiosity, unease",
  },
  {
    id: "serious",
    name: "Serious",
    description: "Gravity without melodrama — news-grade.",
    keywords: ["serious", "news", "report", "analysis", "grave"],
    voice: "Flat, careful, weighted",
    pacing: "Deliberate, factual",
    vocabulary: "Precise, neutral, accountable",
    emotion: "Sobriety, focus",
  },
  {
    id: "conversational",
    name: "Conversational",
    description: "Talk-to-a-friend cadence, direct address.",
    keywords: ["talk", "chat", "you", "hey", "guys", "casual"],
    voice: "Natural, off-the-cuff, direct",
    pacing: "Rhythmic, casual",
    vocabulary: "Colloquial, direct, second-person",
    emotion: "Familiarity, rapport",
  },
];

export function getTone(id: string | undefined | null): Tone | undefined {
  if (!id) return undefined;
  return TONES.find((t) => t.id === id);
}

export function toneByIdOrFirst(id: string | undefined | null): Tone {
  return getTone(id) ?? TONES[0];
}
