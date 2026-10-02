/**
 * Phase 3 — Semantic Scene → Stock Query builder.
 *
 * Turns a Scene (narration, title, visualPrompt, mediaType, camera, tone,
 * beat) into a STRUCTURED search query capturing subject, emotion,
 * location, time period, visual style and camera angle.
 *
 * This is DETERMINISTIC — keyword + semantic weighting using the Phase 2
 * studio modules (cameras.ts, cinematic.ts, scene-intelligence.ts, tones.ts).
 * It is NOT fake AI: it never pretends to understand language; it applies
 * explicit keyword mappings and weighted term extraction, and always labels
 * the result as a heuristic query.
 */
import { MEDIA_TYPES, type MediaType } from "@/lib/studio/scene-intelligence";
import { SHOT_TYPES } from "@/lib/studio/cameras";
import { CINEMATIC_DESCRIPTORS } from "@/lib/studio/cinematic";
import { TONES } from "@/lib/studio/tones";
import type { SearchOrientation, StockMediaType } from "./types";

/** The scene fields the builder consumes. All optional except a text source. */
export interface MediaSceneInput {
  narration?: string | null;
  title?: string | null;
  visualPrompt?: string | null;
  mediaType?: string | null;
  camera?: string | null; // shot type id, e.g. "wide", "close-up"
  tone?: string | null; // tone id, e.g. "cinematic"
  emotion?: string | null; // free-text emotion
  beat?: string | null; // beat id/name, e.g. "hook", "crisis"
  aspectRatio?: string | null;
  /** Number of assets to request from each provider. */
  count?: number;
}

/** The structured, provider-ready query produced by the builder. */
export interface SemanticQuery {
  subject: string[]; // core subject terms
  emotion: string[]; // mood / emotional descriptors
  location: string[]; // place / setting terms
  timePeriod: string[]; // era / time-of-day terms
  visualStyle: string[]; // look / grade / quality descriptors
  cameraAngle: string[]; // shot / framing terms
  mediaType: StockMediaType; // image | video
  orientation: SearchOrientation;
  keywords: string; // combined keyword string for provider query
  queryHint: string; // a natural-ish query assembled from the above
  rationale: Record<string, string>; // why each field was chosen (transparency)
  /** Transparency label — this is a structural heuristic query, not AI. */
  source: "semantic-heuristic";
}

// ---------------------------------------------------------------------------
// Deterministic keyword maps
// ---------------------------------------------------------------------------
const EMOTION_TERMS: Record<string, string[]> = {
  cinematic: ["epic", "cinematic", "atmospheric", "dramatic"],
  dramatic: ["dramatic", "intense", "tense"],
  mysterious: ["mysterious", "shadowy", "intriguing", "enigmatic"],
  calm: ["calm", "serene", "peaceful", "tranquil"],
  emotional: ["emotional", "touching", "heartfelt", "moving"],
  inspirational: ["inspiring", "uplifting", "hopeful", "aspirational"],
  energetic: ["energetic", "dynamic", "vibrant", "high-energy"],
  educational: ["clear", "focused", "instructive"],
  professional: ["professional", "polished", "corporate"],
  serious: ["serious", "solemn", "sober"],
  friendly: ["friendly", "warm", "welcoming"],
  conversational: ["casual", "everyday", "relatable"],
  hopeful: ["hopeful", "optimistic", "bright"],
  tense: ["tense", "suspenseful", "gripping"],
  nostalgic: ["nostalgic", "vintage", "timeless"],
};

const CAMERA_PHRASES: Record<string, string> = {
  wide: "wide shot",
  establishing: "wide establishing shot",
  medium: "medium shot",
  "close-up": "close-up",
  "extreme-close-up": "extreme close-up",
  macro: "macro shot",
  pov: "point-of-view shot",
  tracking: "tracking shot",
  dolly: "dolly shot",
  crane: "crane shot",
  drone: "bird's-eye aerial",
  aerial: "aerial view",
  "rack-focus": "shallow depth of field focus",
  "slow-motion": "slow motion",
  "time-lapse": "time-lapse",
};

// A few high-signal phrases to sniff location / period out of free text.
const LOCATION_PATTERNS = [
  /\b(city|urban|downtown|street|skyline)\w*\b/i,
  /\b(nature|forest|mountain|ocean|beach|desert|jungle|field|river)\w*\b/i,
  /\b(office|cityscape|countryside|village|sea|coast|landscape|interior|room|home)\w*\b/i,
];
const PERIOD_PATTERNS = [
  /\b(vintage|retro|antique|1920|1930|1940|1950|1960|1970|1980|1990|old)\w*\b/i,
  /\b(future|futuristic|sci-fi|cyberpunk|tomorrow)\w*\b/i,
  /\b(modern|contemporary|ancient|historical|era|century)\w*\b/i,
];

/** Split text into cleaned, deduped, capped keyword tokens. */
function termsFromText(text: string, cap: number): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9'#%&+.-]+/)) {
    const t = raw.trim();
    if (!t || t.length < 3 || /^(the|and|that|with|this|these|those|from|into|over|under|onto|upon|your|our|their|when|what|which|should|would|could)$/i.test(t)) {
      continue;
    }
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t.toLowerCase());
    if (out.length >= cap) break;
  }
  return out;
}

function matchLocation(text: string): string[] {
  const found = new Set<string>();
  for (const re of LOCATION_PATTERNS) {
    const m = text.match(re);
    if (m) found.add(m[1].toLowerCase());
  }
  return [...found].slice(0, 3);
}
function matchPeriod(text: string): string[] {
  const found = new Set<string>();
  for (const re of PERIOD_PATTERNS) {
    const m = text.match(re);
    if (m) found.add(m[1].toLowerCase());
  }
  return [...found].slice(0, 3);
}

/** Decorate media type with a small, honest style keyword set. */
function styleTerms(mediaType: MediaType | undefined): string[] {
  const m = mediaType?.toUpperCase() ?? "";
  if (m === "STOCK") return ["stock footage", "cinematic"];
  if (m === "AI_VIDEO") return ["cinematic", "dramatic lighting"];
  if (m === "AI_IMAGE") return ["striking", "high detail"];
  if (m === "MAP") return ["aerial map view", "geographic"];
  if (m === "TIMELINE") return ["aerial", "progress"];
  if (m === "CHART" || m === "NUMBER_ANIMATION") return ["abstract", "clean minimal"];
  if (m === "TEXT_ANIMATION") return ["minimal", "clean"];
  return ["cinematic"];
}

function resolveMediaType(media: string | undefined | null): StockMediaType {
  const m = (media ?? "").toUpperCase();
  if (MEDIA_TYPES.includes(m as MediaType) && m === "AI_VIDEO") return "video";
  if (m === "STOCK" || m === "AI_IMAGE" || m === "ANIMATION") return "image";
  // Default: images are the broadest stock inventory; UI can override via
  // ?mediaType=video.
  return "image";
}

function resolveOrientation(aspect: string | undefined | null): SearchOrientation {
  const a = (aspect ?? "").toUpperCase();
  if (a === "PORTRAIT" || a === "9_16" || a === "9:16") return "portrait";
  if (a === "SQUARE" || a === "1_1" || a === "1:1") return "square";
  return "landscape"; // 16:9 default for video
}

/** The user's shot-type id → camera phrase (unknown → generic). */
export function cameraPhraseFor(camera: string | undefined | null): string {
  if (!camera) return "";
  return CAMERA_PHRASES[camera.toLowerCase()] ?? "";
}

/**
 * Build a structured semantic query from a scene. Pure and deterministic —
 * no network, no database, no AI provider.
 */
export function buildSemanticQuery(input: MediaSceneInput): SemanticQuery {
  const narration = (input.narration ?? "").trim();
  const visualPrompt = (input.visualPrompt ?? "").trim();
  const title = (input.title ?? "").trim();
  const raw = [narration, visualPrompt, title].filter(Boolean).join(" ");

  const mediaType = resolveMediaType(input.mediaType);
  const orientation = resolveOrientation(input.aspectRatio);
  const rationale: Record<string, string> = {};

  // Subject: the top weighted terms from narration plus any headline terms
  // from the visual prompt (which often names the concrete subject).
  const subject = termsFromText(raw, 8);
  rationale.subject = subject.length
    ? "top weighted terms extracted from narration/visualPrompt/title"
    : "no text provided — empty subject";

  // Emotion: explicit tone/emotion mapping, then keyword sniffs.
  const emotion = new Set<string>();
  const toneId = (input.tone ?? "").toLowerCase();
  const tone = TONES.find((t) => t.id === toneId);
  if (tone) {
    for (const k of tone.keywords) emotion.add(k);
    for (const w of tone.emotion.toLowerCase().split(/[,/]/)) {
      const c = w.trim();
      if (c) emotion.add(c);
    }
  }
  const emoTerms = emotion.size > 0 ? false : EMOTION_TERMS[toneId];
  if (emoTerms) emoTerms.forEach((e) => emotion.add(e));
  if (input.emotion) {
    for (const e of termsFromText(input.emotion, 3)) {
      if (/mood|feel|emot|atmos/i.test(e) && e.length <= 20) emotion.add(e);
    }
  }
  rationale.emotion = `tone=${toneId ?? "none"} mapped to ${[...emotion].length} mood term(s)`;

  // Location & period: deterministic pattern matches over all scene text.
  const location = matchLocation(raw);
  rationale.location = location.length ? "matched location patterns" : "none detected";

  const timePeriod = matchPeriod(raw);
  rationale.timePeriod = timePeriod.length ? "matched period patterns" : "none detected";

  // Visual style: media-type style terms + cinematic descriptor labels.
  const style = new Set(styleTerms(input.mediaType as MediaType));
  if (tone) {
    const desc = CINEMATIC_DESCRIPTORS.filter(
      (d) => d.appliesTo.length === 0 || d.appliesTo.includes((input.mediaType ?? "").toUpperCase()),
    );
    for (const d of desc.slice(0, 3)) style.add(d.label.toLowerCase());
  }
  rationale.visualStyle = "media-type defaults + cinematic descriptor labels";

  // Camera angle.
  const cameraAngle: string[] = [];
  const camPhrase = cameraPhraseFor(input.camera);
  if (camPhrase) cameraAngle.push(camPhrase);
  if (input.beat && /aerial|map|scale|establish/i.test(input.beat)) cameraAngle.push("wide aerial");
  rationale.cameraAngle = cameraAngle.length
    ? `camera=${input.camera ?? "none"} mapped to ${cameraAngle.join(", ")}`
    : "no camera specified";

  const keywords = [
    ...subject,
    ...emotion,
    ...location,
    ...timePeriod,
    ...style,
    ...cameraAngle,
  ]
    .filter(Boolean)
    .slice(0, 20)
    .join(" ");

  const queryHint = [
    subject.slice(0, 4).join(" "),
    camPhrase,
    location.join(" "),
    timePeriod.join(" "),
    [...style].join(" "),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    subject,
    emotion: [...emotion].slice(0, 6),
    location,
    timePeriod,
    visualStyle: [...style].slice(0, 4),
    cameraAngle,
    mediaType,
    orientation,
    keywords,
    queryHint: queryHint || keywords || (narration ? narration.slice(0, 120) : "cinematic"),
    rationale,
    source: "semantic-heuristic",
  };
}

/** Convenience: build a query string suitable for stock search (keywords). */
export function semanticKeywords(input: MediaSceneInput): string {
  return buildSemanticQuery(input).keywords;
}
