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
import type { MediaType } from "@/lib/studio/scene-intelligence";
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

/** Function words that carry no subject. Applied to a single token. */
const STOPWORDS =
  /^(the|and|that|with|this|these|those|from|into|over|under|onto|upon|your|our|their|when|what|which|should|would|could)$/i;

/**
 * Split text into cleaned, deduped, capped keyword tokens.
 *
 * A token keeps its INTERNAL punctuation (`close-up`, `time-lapse`) because that
 * is part of the word, and loses any punctuation on its ENDS: the splitter keeps
 * `.` inside a token, so a sentence-final word arrived as `metres.`, which no
 * provider and no ranking comparison ever matches against `metres`.
 *
 * `blocked` lets a caller draw several fields from one shared budget: terms
 * already taken from an earlier field are skipped rather than repeated.
 */
function termsFromText(text: string, cap: number, blocked?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9'#%&+.-]+/)) {
    const t = raw.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!t || t.length < 3 || STOPWORDS.test(t)) continue;
    const key = t.toLowerCase();
    if (blocked?.has(key)) continue;
    if (!out.includes(key)) out.push(key);
    if (out.length >= cap) break;
  }
  return out;
}

/** How many subject terms any one query carries. */
export const SUBJECT_TERM_CAP = 8;

/**
 * Where the subject terms come from, IN ORDER, and how much of the cap each
 * field is guaranteed before any field may take more than its share.
 *
 * This ordering is the whole point. The builder used to concatenate
 * narration + visualPrompt + title and take the first 8 tokens of the result,
 * so NARRATION — prose about what is *said* — consumed the entire budget and
 * the concrete subject never reached the provider. The 9-scene fixture showed
 * it plainly: a scene whose visual prompt is "Close on an engraved brass scale"
 * and whose narration reads "The scale is engraved in feet and metres" queried
 * `scale engraved feet metres reader writes both down`, and came back with a
 * clip of stairs and feet.
 *
 * The visual prompt names the thing that is on screen, so it leads and holds the
 * largest share; the title is a one-line summary; narration comes last and keeps
 * a single guaranteed term so a scene's spoken context is not lost entirely.
 * Unused share rolls forward, so a short visual prompt does not shrink the query.
 */
const SUBJECT_SOURCES: ReadonlyArray<{
  field: "visualPrompt" | "title" | "narration";
  reserve: number;
}> = [
  { field: "visualPrompt", reserve: 5 },
  { field: "title", reserve: 2 },
  { field: "narration", reserve: 1 },
];

/**
 * The scene's subject terms, drawn from the visual prompt first, then the title,
 * then the narration, never exceeding `SUBJECT_TERM_CAP` and never repeating a
 * term. Deterministic and pure: the same three strings always give the same list.
 */
function buildSubjectTerms(fields: { visualPrompt: string; title: string; narration: string }): string[] {
  const out: string[] = [];
  const taken = new Set<string>();
  const draw = (text: string, budget: number) => {
    if (!text || budget <= 0) return;
    for (const term of termsFromText(text, budget, taken)) {
      out.push(term);
      taken.add(term);
    }
  };
  // Pass 1 — each field's guaranteed share, in order.
  for (const { field, reserve } of SUBJECT_SOURCES) {
    draw(fields[field], Math.min(reserve, SUBJECT_TERM_CAP - out.length));
  }
  // Pass 2 — whatever is left of the cap, in the same order.
  for (const { field } of SUBJECT_SOURCES) {
    draw(fields[field], SUBJECT_TERM_CAP - out.length);
  }
  return out.slice(0, SUBJECT_TERM_CAP);
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

/**
 * What the CALLER asked for → the stock media type to search.
 *
 * An explicit request wins, and it is read narrowly on purpose — this function
 * never guesses motion footage from the scene's text, only from a value the
 * caller actually supplied:
 *
 *   "VIDEO" / "video"   → video   (an explicit motion-footage request)
 *   "AI_VIDEO"          → video   (the one scene media type that means motion)
 *   "STOCK" | "AI_IMAGE" | "ANIMATION" | "IMAGE" → image
 *   anything else, or nothing at all → image
 *
 * The last line is the documented default and is unchanged: images are the
 * broadest stock inventory, so an unknown value (a chart, a map, a typo) gets
 * the default rather than being promoted to video.
 *
 * Exported because the route's behaviour depends on it and a test asserts it.
 */
export function resolveMediaType(media: string | undefined | null): StockMediaType {
  const m = (media ?? "").trim().toUpperCase();
  if (m === "VIDEO" || m === "AI_VIDEO") return "video";
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

  // Say which media type the search will ask for, and why — the caller's own
  // words when it supplied one, the documented default when it did not.
  const asked = (input.mediaType ?? "").trim();
  rationale.mediaType = asked
    ? `the caller asked for "${asked}" → searching ${mediaType}`
    : `no media type was given → searching ${mediaType} (the documented default: images are the broadest stock inventory)`;

  // Subject: the visual prompt leads, then the title, then the narration. The
  // order is the fix — see SUBJECT_SOURCES for what went wrong when narration led.
  const subject = buildSubjectTerms({ visualPrompt, title, narration });
  rationale.subject = subject.length
    ? "visual prompt first (up to 5 terms), then title (2), then narration (1), topped up in that order to 8 — the visual prompt names the concrete subject, the narration only says what is spoken about it"
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
