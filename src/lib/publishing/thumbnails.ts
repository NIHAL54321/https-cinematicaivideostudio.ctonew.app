/**
 * Phase 7 Block 4 — THUMBNAIL CONCEPTS: a traced SPECIFICATION of a thumbnail,
 * and nothing that pretends to be a picture.
 *
 * THE SHAPE OF THIS BLOCK, decided by what is true on this server: no image
 * provider is wired and no key exists, so NO IMAGE CAN EXIST TODAY. What can be
 * real without a provider is the concept — a structured, traced specification of
 * what the thumbnail would be — and that is what this module builds, entirely by
 * rules from the project's own rows. The image slot on every concept is therefore
 * a DECLARED ABSENCE that names the provider env var names the app's own registry
 * derives (see R-THUMB-IMAGE-ABSENCE). There is no placeholder image, no stock
 * photograph standing in, and no "preview" that is not a render.
 *
 * FIVE INVARIANTS, each enforced rather than promised:
 *
 *  1. NO INVENTED SUBJECT MATTER. The overlay text and the dominant subject are
 *     candidates read out of THIS project's own stored text (its title, its
 *     script, its chapter and scene titles, and the phrases this package already
 *     extracted from them), each carrying the row, field and character span it
 *     came from. Nothing the project does not contain can appear in a concept,
 *     and the app's own prose never embeds the project's characters inside a
 *     sentence — where a meaning needs them, they travel as a traced value
 *     (`textOrigin: "source_verbatim"` + sources), never interpolated (see
 *     ./quotation for the mechanism the audit enforces).
 *
 *  2. NO CLAIM ABOUT AN IMAGE THAT DOES NOT EXIST. The nine criteria the brief
 *     asks for are CHECKS ON THE SPECIFICATION — overlay word count, declared
 *     contrast pairing, how many subjects the concept names, which zones the
 *     composition declares — exactly the shape ./titles uses for its six axes:
 *     each is the COUNT of five named tokens/wordings of the specification that
 *     are present, with a measurement sentence per verdict, and a plan-level
 *     declaration of what that number is not. Nothing here says a viewer will
 *     notice, feel or do anything, and nothing here measures a picture.
 *
 *  3. NO NUMBER WITHOUT A MEASUREMENT. Every number in a plan is one of: the
 *     length of a list this plan carries, a word/character count of a string this
 *     plan carries, an index into one of the ladders this plan carries, or a
 *     bound declared in this file and named on the rule that applies it. There is
 *     no market metric of any kind, and ./audit fails the whole build if a
 *     metric-shaped key can be found at any depth.
 *
 *  4. THE CONTROLS DO REAL WORK OR SAY WHY THEY CANNOT. Regenerate, change text,
 *     change background, change subject, change style and change composition each
 *     produce a NEW traced concept — a fresh derivation by the same rules, with
 *     one named ladder advanced — and a change record saying what moved, from
 *     which candidate to which, by which rule and from which rows. A control with
 *     nothing to advance refuses and names the missing input. UPSCALE CANNOT
 *     WORK: it applies to an image, no image exists, and it renders a gated
 *     refusal naming the `upscaling` capability and its registry env var names.
 *     No control ever reports a change to an image.
 *
 *  5. NO ROW THAT WOULD BE A LIE. No Thumbnail row (prisma/schema.prisma) is
 *     written for a concept, so no generation status is recorded or shown; the
 *     plan carries the statuses this app refuses to write without a provider,
 *     including the progress statuses, because a PENDING row would report work in
 *     progress that is not happening (see the honesty contract's "no progress
 *     state"). See R-THUMB-RECORD.
 *
 * Pure and client-safe: no Prisma, no fetch, no process.env. The provider-facing
 * pieces (the gate's env var names and the model-backed path's ask) live in
 * ./thumbnails-model and are handed in by the caller.
 */
import { derived, emptyNoInput, gatedProvider, type Field, type SourceKind, type SourceRef } from "./provenance";
import { tokenize, STOPWORDS, MIN_TOKEN_LENGTH, type KeywordPlan } from "./keywords";
import { titleCasePhrase } from "./titles";
import type { PublishingRuleId } from "./rules";
import type { PublishingSource } from "./types";

/* ------------------------------------------------------------------ */
/* The brief's own bounds, declared once and applied by a named rule    */
/* ------------------------------------------------------------------ */

/** The brief asks for 5–10 concepts. Both bounds are carried on the plan. */
export const THUMBNAIL_CONCEPT_MINIMUM = 5;
export const THUMBNAIL_CONCEPT_MAXIMUM = 10;
/**
 * The longest overlay text this app will specify, in words. A candidate longer
 * than this is DROPPED and counted rather than shortened: cutting the project's
 * own characters would be this app editing the project's words.
 */
export const OVERLAY_WORD_BOUND = 8;
/** The bound the short-overlay wordings are counted against. */
export const OVERLAY_SHORT_WORDS = 5;
/** The bound the mobile character count is counted against. */
export const OVERLAY_CHAR_BOUND = 40;
/** How many criteria the brief asks for, carried so the count is compared not assumed. */
export const THUMBNAIL_CRITERION_MINIMUM = 9;

/* ------------------------------------------------------------------ */
/* The fixed in-file design vocabulary (this app's own words)           */
/* ------------------------------------------------------------------ */

export type FrameZoneId =
  | "left_third"
  | "right_third"
  | "centre"
  | "lower_third"
  | "top_band"
  | "bottom_band";

export const FRAME_ZONE_LABELS: Record<FrameZoneId, string> = {
  left_third: "the left third of the frame",
  right_third: "the right third of the frame",
  centre: "the centre of the frame",
  lower_third: "the lower third of the frame",
  top_band: "a band across the top of the frame",
  bottom_band: "a band across the bottom of the frame",
};

export interface CompositionSpec {
  id: string;
  label: string;
  definition: string;
  subjectZone: FrameZoneId;
  /** Always a different zone from the subject's — asserted for every entry in the suite. */
  textZone: FrameZoneId;
  marginToken: "wide" | "standard";
  textBlockShape: "one_line" | "two_lines" | "stacked_words";
}

export const THUMBNAIL_COMPOSITIONS: readonly CompositionSpec[] = [
  {
    id: "comp-a",
    label: "Subject left, text band above",
    definition:
      "The subject sits in the left third and the overlay reads across a band at the top, with the wide margin reserved on every edge.",
    subjectZone: "left_third",
    textZone: "top_band",
    marginToken: "wide",
    textBlockShape: "one_line",
  },
  {
    id: "comp-b",
    label: "Subject right, text band below",
    definition:
      "The subject sits in the right third and the overlay reads across a band at the bottom, with the wide margin reserved on every edge.",
    subjectZone: "right_third",
    textZone: "bottom_band",
    marginToken: "wide",
    textBlockShape: "one_line",
  },
  {
    id: "comp-c",
    label: "Subject low, text in the right third",
    definition:
      "The subject sits in the lower third and the overlay reads down the right third, with a standard margin reserved on every edge.",
    subjectZone: "lower_third",
    textZone: "right_third",
    marginToken: "standard",
    textBlockShape: "two_lines",
  },
  {
    id: "comp-d",
    label: "Subject centred, text band below",
    definition:
      "The subject sits in the centre with the overlay in a band at the bottom, and the wide margin is reserved so neither element reaches an edge.",
    subjectZone: "centre",
    textZone: "bottom_band",
    marginToken: "wide",
    textBlockShape: "one_line",
  },
  {
    id: "comp-e",
    label: "Subject right, text in the left third",
    definition:
      "The subject sits in the right third and the overlay reads down the left third, with a standard margin reserved on every edge.",
    subjectZone: "right_third",
    textZone: "left_third",
    marginToken: "standard",
    textBlockShape: "two_lines",
  },
  {
    id: "comp-f",
    label: "Subject left, text stacked to the right",
    definition:
      "The subject sits in the left third with the overlay stacked word by word in the right third, with a standard margin on every edge.",
    subjectZone: "left_third",
    textZone: "right_third",
    marginToken: "standard",
    textBlockShape: "stacked_words",
  },
];

export interface BackgroundSpec {
  id: string;
  label: string;
  definition: string;
  separation: "flat_field" | "soft_falloff" | "hard_edge";
  depthToken: "single_plane" | "layered";
  toneHint: "dark" | "light" | "mid";
}

export const THUMBNAIL_BACKGROUNDS: readonly BackgroundSpec[] = [
  {
    id: "bg-a",
    label: "Dark field, soft falloff behind the subject",
    definition:
      "A dark field with a soft falloff behind the subject, on a single plane, so the subject reads against the field rather than floating on it.",
    separation: "soft_falloff",
    depthToken: "single_plane",
    toneHint: "dark",
  },
  {
    id: "bg-b",
    label: "Light field, hard edge around the subject",
    definition:
      "A light field with a hard edge around the subject, on a single plane, so the subject's outline carries the separation.",
    separation: "hard_edge",
    depthToken: "single_plane",
    toneHint: "light",
  },
  {
    id: "bg-c",
    label: "Layered dark field, soft falloff",
    definition:
      "A dark field in two layers with a soft falloff between them, so the element behind the subject is separated from the element behind the text.",
    separation: "soft_falloff",
    depthToken: "layered",
    toneHint: "dark",
  },
  {
    id: "bg-d",
    label: "Flat mid field",
    definition: "A single mid-tone field with nothing behind the subject, so all separation comes from the style's own tokens.",
    separation: "flat_field",
    depthToken: "single_plane",
    toneHint: "mid",
  },
  {
    id: "bg-e",
    label: "Layered light field, hard edge",
    definition:
      "A light field in two layers with a hard edge between them, so the text's own band carries a different tone from the subject's field.",
    separation: "hard_edge",
    depthToken: "layered",
    toneHint: "light",
  },
  {
    id: "bg-f",
    label: "Dark field, hard edge",
    definition: "A dark field with a hard edge around the subject, so the subject's cut-out is the frame's only shape.",
    separation: "hard_edge",
    depthToken: "single_plane",
    toneHint: "dark",
  },
];

export interface StyleSpec {
  id: string;
  label: string;
  definition: string;
  typography: "heavy_sans" | "heavy_condensed" | "slab_display" | "body_serif";
  strokeToken: "none" | "thin_outline" | "thick_outline";
  paletteToken: "mono_tone" | "two_tone" | "three_tone";
  keying: "none" | "cut_out_subject";
}

export const THUMBNAIL_STYLES: readonly StyleSpec[] = [
  {
    id: "style-a",
    label: "Heavy sans, thin outline, two tones, cut-out subject",
    definition:
      "Heavy sans lettering with a thin outline, a palette of two tones and the subject cut out of the field.",
    typography: "heavy_sans",
    strokeToken: "thin_outline",
    paletteToken: "two_tone",
    keying: "cut_out_subject",
  },
  {
    id: "style-b",
    label: "Heavy condensed, thick outline, three tones",
    definition: "Heavy condensed lettering with a thick outline and a palette of three tones, with the subject left in the field.",
    typography: "heavy_condensed",
    strokeToken: "thick_outline",
    paletteToken: "three_tone",
    keying: "none",
  },
  {
    id: "style-c",
    label: "Slab display, no outline, two tones, cut-out subject",
    definition: "Slab display lettering with no outline, a palette of two tones and the subject cut out of the field.",
    typography: "slab_display",
    strokeToken: "none",
    paletteToken: "two_tone",
    keying: "cut_out_subject",
  },
  {
    id: "style-d",
    label: "Body serif, thin outline, one tone",
    definition:
      "Serif lettering with a thin outline and a single-tone palette, so the frame's own field carries the tone and the lettering stays plain.",
    typography: "body_serif",
    strokeToken: "thin_outline",
    paletteToken: "mono_tone",
    keying: "none",
  },
  {
    id: "style-e",
    label: "Heavy sans, thick outline, three tones, cut-out subject",
    definition:
      "Heavy sans lettering with a thick outline, a palette of three tones and the subject cut out of the field.",
    typography: "heavy_sans",
    strokeToken: "thick_outline",
    paletteToken: "three_tone",
    keying: "cut_out_subject",
  },
  {
    id: "style-f",
    label: "Heavy condensed, no outline, one tone",
    definition: "Heavy condensed lettering with no outline and a single-tone palette, with the subject left in the field.",
    typography: "heavy_condensed",
    strokeToken: "none",
    paletteToken: "mono_tone",
    keying: "none",
  },
];

export interface ContrastPairSpec {
  id: string;
  label: string;
  definition: string;
  /** The token the overlay's ink is declared as. */
  inkToken: "near_white_ink" | "near_black_ink";
  /** The token the field behind that ink is declared as. */
  fieldToken: "darkest_declared_tone" | "lightest_declared_tone";
}

/**
 * THE DECLARED PAIRINGS. Each entry is two of this app's own tokens and nothing
 * else: no ratio, no number, no measurement. A ratio would be a measurement of an
 * image, and no image exists — see R-THUMB-CONTRAST.
 */
export const THUMBNAIL_CONTRAST_PAIRS: readonly ContrastPairSpec[] = [
  {
    id: "pair-dark-field",
    label: "Near-white ink on the darkest declared tone",
    definition: "The overlay's ink is declared as near-white and the field behind it as the concept's darkest declared tone.",
    inkToken: "near_white_ink",
    fieldToken: "darkest_declared_tone",
  },
  {
    id: "pair-light-field",
    label: "Near-black ink on the lightest declared tone",
    definition: "The overlay's ink is declared as near-black and the field behind it as the concept's lightest declared tone.",
    inkToken: "near_black_ink",
    fieldToken: "lightest_declared_tone",
  },
];

/** The fixed coordination table: which pairing this app declares for each tone hint. */
export const TONE_HINT_TO_PAIR: Record<BackgroundSpec["toneHint"], string> = {
  dark: "pair-dark-field",
  light: "pair-light-field",
  mid: "pair-dark-field",
};

export type MoodToken = "grave" | "urgent" | "warm" | "neutral";

export const MOOD_LABELS: Record<MoodToken, string> = {
  grave: "Grave",
  urgent: "Urgent",
  warm: "Warm",
  neutral: "Neutral",
};

/**
 * The fixed tone→mood table. It maps a STORED tone/style token to one of this
 * app's own mood tokens, and it is deliberately small: a stored value that is not
 * a key here does not get an invented mood — the app's default token is used and
 * the value says so (see R-THUMB-MOOD).
 */
export const TONE_TO_MOOD: Record<string, MoodToken> = {
  documentary: "grave",
  serious: "grave",
  somber: "grave",
  dramatic: "urgent",
  epic: "urgent",
  urgent: "urgent",
  warm: "warm",
  humorous: "warm",
  friendly: "warm",
  cinematic: "neutral",
  neutral: "neutral",
  educational: "neutral",
  tutorial: "neutral",
};

/** The default mood token when no stored value maps through the table. */
export const DEFAULT_MOOD: MoodToken = "neutral";

/* ------------------------------------------------------------------ */
/* Ladders: the project's own text (overlay + subject)                  */
/* ------------------------------------------------------------------ */

export interface ThumbnailTextCandidate {
  id: string;
  /** The project's own characters, with the stated normalisation applied. */
  text: string;
  wordCount: number;
  charCount: number;
  sources: SourceRef[];
  /** Where the characters were read from, in this app's own words. */
  from: string;
  textOrigin: "source_verbatim";
  /** The role this candidate was read for, in this app's own words. */
  roleLabel: string;
  roleId: string;
}

export interface ThumbnailSubjectCandidate extends ThumbnailTextCandidate {
  /** The row family the subject was read from. */
  sourceKind: SourceKind;
}

interface RawCandidate {
  id: string;
  text: string;
  roleId: string;
  roleLabel: string;
  sources: SourceRef[];
  from: string;
  sourceKind: SourceKind;
}

function contentWords(text: string): string[] {
  const stop = new Set(STOPWORDS);
  return tokenize(text)
    .filter((t) => !stop.has(t.text) && t.text.replace(/[^a-z0-9]/g, "").length >= MIN_TOKEN_LENGTH)
    .map((t) => t.text);
}

/** Project.title always exists (a required column), so the ladders are never empty. */
function rawCandidates(source: PublishingSource, plan: KeywordPlan): RawCandidate[] {
  const out: RawCandidate[] = [];
  const projectTitle = source.project.title?.trim();
  const primary = plan.buckets.find((b) => b.id === "primary")?.keywords[0] ?? null;
  const threeWord = plan.keywords.find((k) => k.tokenCount >= 3) ?? null;

  if (projectTitle) {
    out.push({
      id: "cand-project-title",
      text: projectTitle,
      roleId: "subject_role_project_title",
      roleLabel: "the project's own title column",
      sources: [{ kind: "project", id: source.project.id, path: "title" }],
      from: "Project.title, character for character",
      sourceKind: "project",
    });
  }
  if (primary) {
    out.push({
      id: "cand-primary",
      text: titleCasePhrase(primary.text),
      roleId: "subject_role_highest_weighted_phrase",
      roleLabel: "the highest-weighted phrase this package extracted from the project's own stored text",
      sources: primary.sources,
      from:
        "the highest-weighted phrase this package extracted from the project's own stored text (its own row, field and character " +
        "spans are on this candidate), title-cased by R-THUMB-TEXT",
      sourceKind: "keyword",
    });
  }
  if (source.script?.title && source.script.title.trim()) {
    out.push({
      id: "cand-script",
      text: source.script.title.trim(),
      roleId: "subject_role_script_title",
      roleLabel: "the project's script title column",
      sources: [{ kind: "script", id: source.script.id, path: "title" }],
      from: "Script.title, character for character",
      sourceKind: "script",
    });
  }
  for (const chapter of [...source.chapters].sort((a, b) => a.order - b.order)) {
    if (chapter.title.trim()) {
      out.push({
        id: `cand-chapter-${chapter.order}`,
        text: chapter.title.trim(),
        roleId: `subject_role_chapter_${chapter.order}`,
        roleLabel: `Chapter.title of the project's chapter at order ${chapter.order}`,
        sources: [{ kind: "chapter", id: chapter.id, path: "title" }],
        from: `Chapter.title of the project's own chapter row at order ${chapter.order}, character for character`,
        sourceKind: "chapter",
      });
    }
    for (const scene of [...chapter.scenes].sort((a, b) => a.order - b.order)) {
      if (scene.title && scene.title.trim()) {
        out.push({
          id: `cand-scene-${chapter.order}-${scene.order}`,
          text: scene.title.trim(),
          roleId: `subject_role_scene_${chapter.order}_${scene.order}`,
          roleLabel: `Scene.title of the project's scene at order ${scene.order} in chapter ${chapter.order}`,
          sources: [{ kind: "scene", id: scene.id, path: "title" }],
          from: `Scene.title of the project's own scene row at order ${scene.order}, character for character`,
          sourceKind: "scene",
        });
      }
    }
  }
  if (threeWord) {
    out.push({
      id: "cand-longtail",
      text: titleCasePhrase(threeWord.text),
      roleId: "subject_role_three_token_phrase",
      roleLabel: "the highest-weighted three-token phrase this package extracted",
      sources: threeWord.sources,
      from:
        "the highest-weighted three-token phrase this package extracted from the project's own stored text (its own row, field and " +
        "character spans are on this candidate), title-cased by R-THUMB-TEXT",
      sourceKind: "keyword",
    });
  }
  return out;
}

interface Ladder {
  overlay: ThumbnailTextCandidate[];
  subject: ThumbnailSubjectCandidate[];
  overlayDroppedTooLong: number;
  candidatesDropped: number;
}

/**
 * The overlay ladder and the subject ladder. Both are the project's own words in
 * a fixed role order, de-duplicated case-insensitively; a duplicate is dropped
 * (and counted) and an overlay candidate longer than OVERLAY_WORD_BOUND is
 * dropped (and counted) rather than shortened.
 */
export function buildThumbnailLadders(source: PublishingSource, plan: KeywordPlan): Ladder {
  const raw = rawCandidates(source, plan);
  const overlay: ThumbnailTextCandidate[] = [];
  const subject: ThumbnailSubjectCandidate[] = [];
  const seenOverlay = new Set<string>();
  const seenSubject = new Set<string>();
  let overlayDroppedTooLong = 0;
  let candidatesDropped = 0;

  for (const candidate of raw) {
    const text = candidate.text.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    const words = tokenize(text).map((t) => t.text);
    const entry: ThumbnailTextCandidate = {
      id: candidate.id,
      text,
      wordCount: words.length,
      charCount: text.length,
      sources: candidate.sources,
      from: candidate.from,
      textOrigin: "source_verbatim",
      roleLabel: candidate.roleLabel,
      roleId: candidate.roleId,
    };
    if (seenSubject.has(key)) {
      candidatesDropped += 1;
    } else {
      seenSubject.add(key);
      subject.push({ ...entry, sourceKind: candidate.sourceKind });
    }
    if (seenOverlay.has(key)) continue;
    if (entry.wordCount > OVERLAY_WORD_BOUND) {
      overlayDroppedTooLong += 1;
      continue;
    }
    seenOverlay.add(key);
    overlay.push(entry);
  }
  return { overlay, subject, overlayDroppedTooLong, candidatesDropped };
}

/* ------------------------------------------------------------------ */
/* The concept's declared tokens                                        */
/* ------------------------------------------------------------------ */

export interface ThumbnailTokens {
  aspectId: "sixteen_nine" | "nine_sixteen" | null;
  /** 1-based position in each ladder, so a control can advance one of them. */
  overlayIndex: number;
  subjectIndex: number;
  styleIndex: number;
  backgroundIndex: number;
  compositionIndex: number;
  /** How far the four design ladders have been shifted (0–5). */
  variation: number;
  subjectZone: FrameZoneId;
  textZone: FrameZoneId;
  marginToken: CompositionSpec["marginToken"];
  textBlockShape: CompositionSpec["textBlockShape"];
  separation: BackgroundSpec["separation"];
  depthToken: BackgroundSpec["depthToken"];
  toneHint: BackgroundSpec["toneHint"];
  typography: StyleSpec["typography"];
  strokeToken: StyleSpec["strokeToken"];
  paletteToken: StyleSpec["paletteToken"];
  keying: StyleSpec["keying"];
  moodToken: MoodToken | null;
}

/** One concept: a specification, every value traced, and NO image. */
export interface ThumbnailConcept {
  id: string;
  /** 1-based position in this plan's concept list. */
  index: number;
  rule: "R-THUMB-CONCEPT";
  overlayText: Field<string>;
  overlayRole: Field<string>;
  overlayWordCount: Field<number>;
  overlayCharCount: Field<number>;
  subject: Field<string>;
  subjectRole: Field<string>;
  background: Field<string>;
  style: Field<string>;
  composition: Field<string>;
  mood: Field<string>;
  contrastPair: Field<string>;
  aspect: Field<string>;
  criteria: ThumbnailCriterion[];
  tokens: ThumbnailTokens;
  /** The image slot: an absence with a named requirement. Never a placeholder. */
  image: Field<never>;
  /** Who wrote the specification. Always this app's rules plus the project's own words. */
  authoredBy: "rule_specification";
  /** The concept this one was revised from, when a control produced it. */
  revisedFrom: string | null;
  revision: number;
  note: string;
}

/* ------------------------------------------------------------------ */
/* The nine criteria — fixed feature lists, each evaluated by a test    */
/* ------------------------------------------------------------------ */

export const THUMBNAIL_CRITERION_IDS = [
  "visual_hierarchy",
  "dominant_subject",
  "curiosity",
  "emotional_appeal",
  "mobile_readability",
  "contrast",
  "bold_typography",
  "minimal_text",
  "clear_story",
] as const;

export type ThumbnailCriterionId = (typeof THUMBNAIL_CRITERION_IDS)[number];

export interface ThumbnailCriterionFeatureDefinition {
  id: string;
  /** What this verdict counts, in one line. Shown beside the verdict on the surface. */
  label: string;
}

export interface ThumbnailCriterionDefinition {
  id: ThumbnailCriterionId;
  /** The brief's own name for this criterion. */
  label: string;
  about: string;
  features: readonly ThumbnailCriterionFeatureDefinition[];
  featureSource: string;
  notA: string;
}

/** The fixed stake wordings the emotional criterion counts. In-file, inspectable. */
export const EMOTIONAL_STAKE_TOKENS = ["cost", "costs", "lost", "loss", "human", "matters", "moments", "decided", "refuse", "refused", "last"] as const;
/** Characters this app counts as sentence punctuation in an overlay text. */
export const OVERLAY_PUNCTUATION = [".", "!", "?", ";"] as const;

export const THUMBNAIL_CRITERIA: readonly ThumbnailCriterionDefinition[] = [
  {
    id: "visual_hierarchy",
    label: "Strong visual hierarchy",
    about: "How many of five named arrangement wordings of the concept's own COMPOSITION and STYLE specifications are present.",
    features: [
      { id: "zones_differ", label: "The composition puts the subject and the overlay text in two different zones of the frame" },
      { id: "wide_margin", label: "The composition declares the wide margin token, so its elements are held off every edge" },
      { id: "field_separated", label: "The background declares a separation between the subject and the field (a soft falloff or a hard edge)" },
      { id: "emphasis_declared", label: "The style declares an outline or a keying that marks the subject against the field" },
      { id: "block_shape_declared", label: "The composition declares a one-line or two-line text block rather than a stacked-word block" },
    ],
    featureSource:
      "Each verdict counts a token this concept's own specification declares: the composition's two zones and its two shape tokens, the " +
      "background's separation token, and the style's outline and keying tokens. All of them are entries in fixed lists in this app's own " +
      "source file, printed on the concept itself.",
    notA:
      "This counts declared tokens of a specification. It is not an observation about any image, because no image exists, and it says " +
      "nothing about what a viewer would notice.",
  },
  {
    id: "dominant_subject",
    label: "One dominant subject",
    about: "How many of five named subject-shaped properties of the concept's own specification are present.",
    features: [
      { id: "one_subject", label: "The concept names exactly one dominant subject" },
      { id: "subject_sourced", label: "The subject value names at least one source row it was read from" },
      { id: "subject_zone_clear", label: "The composition gives the subject a zone that is not the overlay text's zone" },
      { id: "text_not_the_subject", label: "The overlay text is not the same characters as the subject" },
      { id: "subject_role_from_list", label: "The subject was taken by one of this app's fixed subject roles" },
    ],
    featureSource:
      "The subject's own value carries the row, field and character span it was read from; the role it was taken by is named on the " +
      "concept; the zones are the composition's declared tokens. A second subject is not representable on a concept, which is why the " +
      "first verdict counts a one-entry list rather than a judgement.",
    notA:
      "This counts what the specification names. It is not a judgement that the frame would be clear, and no image was made to look at.",
  },
  {
    id: "curiosity",
    label: "Curiosity",
    about: "How many of five named wording shapes of the concept's own overlay text are present.",
    features: [
      { id: "payoff_deferred", label: "The overlay text's first word differs from the subject phrase's first word" },
      { id: "short_overlay", label: `The overlay text is ${OVERLAY_SHORT_WORDS} words or fewer` },
      { id: "not_the_project_title", label: "The overlay text is not the candidate this app's ladder takes from the project's own title" },
      { id: "two_part_shape", label: "The overlay text carries a colon or a dash and so reads in two parts" },
      { id: "past_first_candidate", label: "The overlay text is not the first candidate in this app's ladder" },
    ],
    featureSource:
      "The wordings are counted on the overlay text itself, which is one of this project's own stored phrases — carried on the concept " +
      "with the row, field and character span it was read from — and against the fixed positions of this app's own candidate ladder.",
    notA:
      "This counts shapes in wording. Nothing here measures what anyone thinks or does, and this product holds no data of that kind.",
  },
  {
    id: "emotional_appeal",
    label: "Emotional appeal",
    about: "How many of five named stake-wordings and declared mood tokens of the concept's specification are present.",
    features: [
      { id: "stake_wording_present", label: "One of this app's fixed stake wordings occurs in the overlay text" },
      { id: "mood_declared", label: "The concept carries a mood token from this app's fixed mood list" },
      { id: "mood_from_stored_value", label: "The mood token was read through this app's fixed table from a value the project itself stores" },
      { id: "palette_range_declared", label: "The style declares a palette of more than one tone" },
      { id: "soft_field_declared", label: "The background declares a soft falloff between the subject and the field" },
    ],
    featureSource:
      "The stake wordings are a fixed list in this app's own source file. The mood token is this app's own vocabulary, and the concept " +
      "names the stored value it was read against and whether that value is a key of the app's fixed table.",
    notA:
      "This counts words in a phrase and tokens in a specification. It asserts nothing about what anyone would feel, and no measurement " +
      "of an audience exists in this product.",
  },
  {
    id: "mobile_readability",
    label: "Mobile readability",
    about: "How many of five named readability-shaped properties of the concept's own specification are present.",
    features: [
      { id: "word_count_within_bound", label: `The overlay text is ${OVERLAY_SHORT_WORDS} words or fewer` },
      { id: "char_count_within_bound", label: `The overlay text is ${OVERLAY_CHAR_BOUND} characters or fewer` },
      { id: "text_zone_clear", label: "The composition keeps the overlay text's zone clear of the subject's zone" },
      { id: "wide_margin", label: "The composition declares the wide margin token" },
      { id: "block_shape_not_stacked", label: "The composition does not stack the overlay word by word" },
    ],
    featureSource:
      "The two counts are taken on the overlay text this concept carries; the other three count declared tokens of the composition. The " +
      "bounds are constants in this app's own source file and are named on the verdict that applies them.",
    notA:
      "This is a count of words, characters and declared tokens. It is not a reading test, not a measurement of a rendered frame at any " +
      "size, and not a claim about a small screen this app has never drawn.",
  },
  {
    id: "contrast",
    label: "High contrast",
    about: "How many of five named contrast-shaped declarations of the concept's own specification hold together.",
    features: [
      { id: "pairing_declared", label: "The concept carries a declared ink/field pairing from this app's fixed list" },
      { id: "pairing_matches_background", label: "The declared pairing is the one this app's fixed table gives for the background's own tone hint" },
      { id: "ink_separated", label: "The style declares an outline or a keying that separates the ink from the field" },
      { id: "tones_opposed", label: "The declared ink token and the field's tone hint sit on opposite sides of this app's fixed pairing table" },
      { id: "no_zone_overlap", label: "The composition keeps the overlay text's zone clear of the subject's zone" },
    ],
    featureSource:
      "Each verdict is a comparison between two tokens the concept itself declares: the pairing entry, the background's tone hint and the " +
      "style's outline and keying tokens. The pairing table is in this app's own source file.",
    notA:
      "These are DECLARED tokens, not measurements. This app has measured no image and carries no ratio, no value and no number of any " +
      "kind for contrast, because such a number would be a measurement of a picture that does not exist.",
  },
  {
    id: "bold_typography",
    label: "Bold typography",
    about: "How many of five named typography-shaped declarations of the concept's STYLE and COMPOSITION are present.",
    features: [
      { id: "heavy_family", label: "The style declares a heavy or slab typography family rather than the plain body family" },
      { id: "outline_declared", label: "The style declares an outline on the lettering" },
      { id: "one_line_block", label: "The composition declares a single-line text block" },
      { id: "text_zone_is_a_band", label: "The composition gives the overlay text a band across the frame rather than a third of it" },
      { id: "palette_not_mono", label: "The style declares a palette of more than one tone" },
    ],
    featureSource:
      "Every verdict counts a token this concept declares: the style's typography, outline and palette tokens and the composition's text " +
      "block shape and text zone. All are entries of fixed lists in this app's own source file.",
    notA:
      "This counts declared design tokens. No lettering has been set, no frame has been drawn and nothing here says how type would look at " +
      "any size.",
  },
  {
    id: "minimal_text",
    label: "Minimal text",
    about: "How many of five named brevity-shaped properties of the concept's own overlay text and composition are present.",
    features: [
      { id: "word_count_within_bound", label: `The overlay text is ${OVERLAY_SHORT_WORDS} words or fewer` },
      { id: "char_count_within_bound", label: `The overlay text is ${OVERLAY_CHAR_BOUND} characters or fewer` },
      { id: "block_shape_not_stacked", label: "The composition does not stack the overlay word by word" },
      { id: "no_subject_word_repeated", label: "No content word of the overlay text also occurs in the subject phrase" },
      { id: "no_sentence_punctuation", label: "The overlay text carries no sentence punctuation" },
    ],
    featureSource:
      "The counts are taken on the overlay text this concept carries, the repeated words are counted between that text and the subject " +
      "phrase this concept carries, and the punctuation is read from a fixed list in this app's own source file.",
    notA:
      "This counts the words this app put in the specification. It is not a claim about how much text a viewer would read, and no frame " +
      "was drawn to look at.",
  },
  {
    id: "clear_story",
    label: "Clear story",
    about: "How many of five named provenance-shaped properties of the concept's own specification are present.",
    features: [
      { id: "subject_is_project_text", label: "The subject's characters are declared as copied from one of the project's own rows" },
      { id: "overlay_is_project_text", label: "The overlay's characters are declared as copied from one of the project's own rows" },
      { id: "subject_and_overlay_differ", label: "The overlay text and the subject are not the same characters" },
      { id: "subject_from_structure_row", label: "The subject was read from a chapter or scene row of the project's own script structure" },
      { id: "aspect_declared", label: "The concept carries the frame's aspect, derived from the project's own stored target shape" },
    ],
    featureSource:
      "The origins and the rows are the ones the concept's own values declare; the aspect is derived from the project's stored " +
      "target shape and is empty-with-reason when that column says nothing.",
    notA:
      "This counts where the concept's own words came from. It is not a claim that the video's story is clear, and it measures nothing " +
      "about a picture.",
  },
];

export function thumbnailCriterionDefinition(id: ThumbnailCriterionId): ThumbnailCriterionDefinition {
  const found = THUMBNAIL_CRITERIA.find((c) => c.id === id);
  if (!found) throw new Error(`thumbnailCriterionDefinition(): unknown criterion "${id}"`);
  return found;
}

/** The plan-level statement about what a criterion count is. Rendered on the surface. */
export const THUMBNAIL_CRITERIA_DECLARATION = {
  statement:
    `Each of the ${THUMBNAIL_CRITERION_IDS.length} criteria the brief asks for is the count of five named tokens or wordings of that ` +
    "concept's own specification that are present, so each is a whole number from 0 to 5, and each record carries the five verdicts and " +
    "the measurement behind each one, so the number can be checked by re-reading the specification.",
  specificationNotPicture:
    "Everything counted here is a token of a specification this app wrote: a declared zone, a declared typography, stroke, palette or " +
    "pairing token, or a count taken on the project's own text. No image exists, none was rendered and none is implied, so no verdict here " +
    "is an observation about a picture.",
  whatACriterionIsNot:
    "A criterion is a description of a specification, written by fixed rules in this app's own source file. It is not a measurement of any " +
    "image, not a claim about what a viewer would notice, feel or do, not a comparison with any other thumbnail, and not a prediction of " +
    "how this video would be received. No data of that kind exists in this product.",
  scale: "0 to 5 — the number of that criterion's five named tokens or wordings present in the concept",
  criteriaAreNotIndependent:
    "Several criteria count the same declared token: the overlay's word count is counted by the curiosity, mobile-readability and " +
    "minimal-text criteria, the wide margin token by the hierarchy and mobile-readability criteria, and the text zone by four of them. " +
    "Nine numbers on a concept are not nine independent measurements and must not be read as a profile of anything.",
} as const;

export interface ThumbnailCriterionFeature {
  id: string;
  label: string;
  present: boolean;
  /** The measurement that produced the verdict, in this app's own words. */
  measured: string;
}

export interface ThumbnailCriterion {
  id: ThumbnailCriterionId;
  label: string;
  score: number;
  maxScore: number;
  features: ThumbnailCriterionFeature[];
  about: string;
  notA: string;
  featureSource: string;
  scoreIsTheFeatureCount: boolean;
  rule: "R-THUMB-CRITERION";
  sources: SourceRef[];
}

interface CriterionContext {
  tokens: ThumbnailTokens;
  overlayText: string;
  overlayWords: string[];
  overlayCharCount: number;
  overlayCandidateIndex: number;
  overlayLadderLength: number;
  overlayIsProjectTitleCandidate: boolean;
  overlayTextOrigin: string;
  subjectText: string;
  subjectWords: string[];
  subjectFirstWord: string | null;
  overlayFirstWord: string | null;
  subjectSourceCount: number;
  subjectSourceKinds: SourceKind[];
  subjectRoleLabel: string;
  subjectIsProjectText: boolean;
  moodFromStoredValue: boolean;
  moodSourceLabel: string | null;
  sharedContentWords: string[];
  punctuationPresent: string[];
  twoPartShape: boolean;
  aspectDerived: boolean;
  backgroundLabel: string;
  contrastPairId: string | null;
  expectedPairId: string | null;
}

function hasAny(text: string, list: readonly string[]): string[] {
  return list.filter((token) => text.includes(token));
}

/** The five verdicts for one criterion, each with the measurement behind it. */
function evaluateCriterionFeatures(id: ThumbnailCriterionId, ctx: CriterionContext): ThumbnailCriterionFeature[] {
  const def = thumbnailCriterionDefinition(id);
  const t = ctx.tokens;
  const yes = (present: boolean, measured: string) => ({ present, measured });
  const verdicts: Record<string, { present: boolean; measured: string }> = {};

  switch (id) {
    case "visual_hierarchy": {
      const zonesDiffer = t.subjectZone !== t.textZone;
      verdicts.zones_differ = yes(
        zonesDiffer,
        zonesDiffer
          ? `the composition declares ${FRAME_ZONE_LABELS[t.subjectZone]} for the subject and ${FRAME_ZONE_LABELS[t.textZone]} for the overlay, and the two are different zones`
          : `the composition declares the same zone for the subject and for the overlay`,
      );
      verdicts.wide_margin = yes(
        t.marginToken === "wide",
        `the composition declares the margin token "${t.marginToken}"; the token this verdict counts is "wide"`,
      );
      verdicts.field_separated = yes(
        t.separation !== "flat_field",
        `the background declares the separation token "${t.separation}"; a flat field carries no separation between the subject and the field`,
      );
      verdicts.emphasis_declared = yes(
        t.strokeToken !== "none" || t.keying === "cut_out_subject",
        `the style declares the outline token "${t.strokeToken}" and the keying token "${t.keying}"; either an outline that is not "none" or a cut-out subject satisfies this verdict`,
      );
      verdicts.block_shape_declared = yes(
        t.textBlockShape !== "stacked_words",
        `the composition declares the text block shape "${t.textBlockShape}"; a stacked-word block is not one of the shapes this verdict counts`,
      );
      break;
    }
    case "dominant_subject": {
      verdicts.one_subject = yes(
        true,
        "the concept holds a one-entry list of dominant subjects, so the count this verdict reports is 1",
      );
      verdicts.subject_sourced = yes(
        ctx.subjectSourceCount > 0,
        `the subject value names ${ctx.subjectSourceCount} source row(s) it was read from`,
      );
      const zoneClear = t.subjectZone !== t.textZone;
      verdicts.subject_zone_clear = yes(
        zoneClear,
        zoneClear
          ? `the subject's zone and the overlay's zone are different declared zones`
          : "the subject's zone and the overlay's zone are the same declared zone",
      );
      const differs = ctx.overlayText.toLowerCase() !== ctx.subjectText.toLowerCase();
      verdicts.text_not_the_subject = yes(
        differs,
        differs
          ? "the overlay text and the subject are different strings"
          : "the overlay text and the subject are the same string, so the frame names one element twice",
      );
      verdicts.subject_role_from_list = yes(
        ctx.subjectSourceKinds.length > 0,
        `the subject was taken by the role "${ctx.subjectRoleLabel}", which is one of the fixed roles this app's subject ladder carries`,
      );
      break;
    }
    case "curiosity": {
      const deferred = ctx.overlayFirstWord !== null && ctx.overlayFirstWord !== ctx.subjectFirstWord;
      verdicts.payoff_deferred = yes(
        deferred,
        ctx.overlayFirstWord === null
          ? "the overlay text holds no words, so there is no first word to compare"
          : ctx.overlayFirstWord === ctx.subjectFirstWord
            ? "the overlay text's first word is the same word as the subject phrase's first word, so the payoff is not deferred"
            : "the overlay text's first word differs from the subject phrase's first word",
      );
      verdicts.short_overlay = yes(
        ctx.overlayWords.length <= OVERLAY_SHORT_WORDS,
        `${ctx.overlayWords.length} word(s) in this concept's overlay text; the bound is ${OVERLAY_SHORT_WORDS}`,
      );
      verdicts.not_the_project_title = yes(
        !ctx.overlayIsProjectTitleCandidate,
        ctx.overlayIsProjectTitleCandidate
          ? "this concept's overlay text is the candidate this app's ladder takes from the project's own title column"
          : "this concept's overlay text is not the candidate this app's ladder takes from the project's own title column",
      );
      verdicts.two_part_shape = yes(
        ctx.twoPartShape,
        ctx.twoPartShape
          ? "the overlay text carries a colon or a dash, so it reads in two parts"
          : "the overlay text carries no colon and no dash",
      );
      verdicts.past_first_candidate = yes(
        ctx.overlayCandidateIndex > 1,
        `this concept uses overlay candidate ${ctx.overlayCandidateIndex} of ${ctx.overlayLadderLength} in this app's ladder`,
      );
      break;
    }
    case "emotional_appeal": {
      const stakes = hasAny(ctx.overlayText.toLowerCase(), EMOTIONAL_STAKE_TOKENS);
      verdicts.stake_wording_present = yes(
        stakes.length > 0,
        stakes.length > 0
          ? `${stakes.length} of this app's fixed stake wordings occur in the overlay text (${stakes.join(", ")})`
          : "none of this app's fixed stake wordings occurs in the overlay text",
      );
      verdicts.mood_declared = yes(t.moodToken !== null, `the concept declares the mood token "${t.moodToken ?? "(none)"}"`);
      verdicts.mood_from_stored_value = yes(
        ctx.moodFromStoredValue,
        ctx.moodFromStoredValue
          ? `the mood token was read through this app's fixed table from ${ctx.moodSourceLabel ?? "a stored value of this project"}`
          : "the mood token is this app's default, because no stored tone or style value of this project is a key of the app's fixed table",
      );
      verdicts.palette_range_declared = yes(
        t.paletteToken !== "mono_tone",
        `the style declares the palette token "${t.paletteToken}"; a single-tone palette is not a range`,
      );
      verdicts.soft_field_declared = yes(
        t.separation === "soft_falloff",
        `the background declares the separation token "${t.separation}"; the token this verdict counts is "soft_falloff"`,
      );
      break;
    }
    case "mobile_readability": {
      verdicts.word_count_within_bound = yes(
        ctx.overlayWords.length <= OVERLAY_SHORT_WORDS,
        `${ctx.overlayWords.length} word(s) in this concept's overlay text; the bound is ${OVERLAY_SHORT_WORDS}`,
      );
      verdicts.char_count_within_bound = yes(
        ctx.overlayCharCount <= OVERLAY_CHAR_BOUND,
        `${ctx.overlayCharCount} character(s) in this concept's overlay text; the bound is ${OVERLAY_CHAR_BOUND}`,
      );
      const clear = t.subjectZone !== t.textZone;
      verdicts.text_zone_clear = yes(
        clear,
        clear
          ? "the overlay's zone and the subject's zone are different declared zones"
          : "the overlay's zone and the subject's zone are the same declared zone",
      );
      verdicts.wide_margin = yes(
        t.marginToken === "wide",
        `the composition declares the margin token "${t.marginToken}"; the token this verdict counts is "wide"`,
      );
      verdicts.block_shape_not_stacked = yes(
        t.textBlockShape !== "stacked_words",
        `the composition declares the text block shape "${t.textBlockShape}"; a stacked-word block is not one of the shapes this verdict counts`,
      );
      break;
    }
    case "contrast": {
      const declared = ctx.contrastPairId !== null;
      verdicts.pairing_declared = yes(
        declared,
        declared
          ? `the concept declares the pairing "${ctx.contrastPairId}" from this app's fixed pairing list`
          : "the concept declares no pairing, so no ink and field tokens are declared for it",
      );
      const matches = ctx.expectedPairId !== null && ctx.contrastPairId === ctx.expectedPairId;
      verdicts.pairing_matches_background = yes(
        matches,
        ctx.expectedPairId === null
          ? "the background declares no tone hint, so this app's coordination table gives no pairing for it"
          : `the background's tone hint is "${t.toneHint}" and this app's fixed table pairs it with "${ctx.expectedPairId}"; the concept declares "${ctx.contrastPairId ?? "(none)"}"`,
      );
      verdicts.ink_separated = yes(
        t.strokeToken !== "none" || t.keying === "cut_out_subject",
        `the style declares the outline token "${t.strokeToken}" and the keying token "${t.keying}"`,
      );
      const opposed =
        (t.toneHint === "dark" && ctx.contrastPairId === "pair-dark-field") ||
        (t.toneHint === "light" && ctx.contrastPairId === "pair-light-field") ||
        (t.toneHint === "mid" && ctx.contrastPairId === "pair-dark-field");
      verdicts.tones_opposed = yes(
        opposed,
        `the background's tone hint is "${t.toneHint}" and the declared pairing is "${ctx.contrastPairId ?? "(none)"}"; this verdict counts whether the table puts them on the same side`,
      );
      const noOverlap = t.subjectZone !== t.textZone;
      verdicts.no_zone_overlap = yes(
        noOverlap,
        noOverlap
          ? "the composition's two declared zones are different, so the overlay and the subject are not declared in the same region"
          : "the composition declares the same region for the overlay and the subject",
      );
      break;
    }
    case "bold_typography": {
      verdicts.heavy_family = yes(
        t.typography !== "body_serif",
        `the style declares the typography token "${t.typography}"; the plain body family is not one of the families this verdict counts`,
      );
      verdicts.outline_declared = yes(
        t.strokeToken !== "none",
        `the style declares the outline token "${t.strokeToken}"; the token this verdict counts is any outline other than "none"`,
      );
      verdicts.one_line_block = yes(
        t.textBlockShape === "one_line",
        `the composition declares the text block shape "${t.textBlockShape}"; the shape this verdict counts is "one_line"`,
      );
      const band = t.textZone === "top_band" || t.textZone === "bottom_band";
      verdicts.text_zone_is_a_band = yes(
        band,
        band
          ? `the composition gives the overlay ${FRAME_ZONE_LABELS[t.textZone]}`
          : `the composition gives the overlay ${FRAME_ZONE_LABELS[t.textZone]}, which is a region of the frame rather than a band across it`,
      );
      verdicts.palette_not_mono = yes(
        t.paletteToken !== "mono_tone",
        `the style declares the palette token "${t.paletteToken}"`,
      );
      break;
    }
    case "minimal_text": {
      verdicts.word_count_within_bound = yes(
        ctx.overlayWords.length <= OVERLAY_SHORT_WORDS,
        `${ctx.overlayWords.length} word(s) in this concept's overlay text; the bound is ${OVERLAY_SHORT_WORDS}`,
      );
      verdicts.char_count_within_bound = yes(
        ctx.overlayCharCount <= OVERLAY_CHAR_BOUND,
        `${ctx.overlayCharCount} character(s) in this concept's overlay text; the bound is ${OVERLAY_CHAR_BOUND}`,
      );
      verdicts.block_shape_not_stacked = yes(
        t.textBlockShape !== "stacked_words",
        `the composition declares the text block shape "${t.textBlockShape}"`,
      );
      verdicts.no_subject_word_repeated = yes(
        ctx.sharedContentWords.length === 0,
        ctx.sharedContentWords.length === 0
          ? "no content word of the overlay text also occurs in the subject phrase this concept carries"
          : `${ctx.sharedContentWords.length} content word(s) of the overlay text also occur in the subject phrase this concept carries`,
      );
      verdicts.no_sentence_punctuation = yes(
        ctx.punctuationPresent.length === 0,
        ctx.punctuationPresent.length === 0
          ? "the overlay text carries none of the sentence punctuation characters this app counts"
          : `the overlay text carries ${ctx.punctuationPresent.length} of the sentence punctuation characters this app counts`,
      );
      break;
    }
    case "clear_story": {
      verdicts.subject_is_project_text = yes(
        ctx.subjectIsProjectText,
        ctx.subjectIsProjectText
          ? "the subject value declares its characters as copied from one of the project's own rows, character for character"
          : "the subject value does not declare its characters as copied from a project row",
      );
      verdicts.overlay_is_project_text = yes(
        ctx.overlayTextOrigin === "source_verbatim",
        ctx.overlayTextOrigin === "source_verbatim"
          ? "the overlay value declares its characters as copied from one of the project's own rows, character for character"
          : "the overlay value does not declare its characters as copied from a project row",
      );
      const differ = ctx.overlayText.toLowerCase() !== ctx.subjectText.toLowerCase();
      verdicts.subject_and_overlay_differ = yes(
        differ,
        differ ? "the overlay text and the subject are different strings" : "the overlay text and the subject are the same string",
      );
      const structural = ctx.subjectSourceKinds.some((k) => k === "chapter" || k === "scene");
      verdicts.subject_from_structure_row = yes(
        structural,
        structural
          ? "the subject was read from a chapter or scene row of the project's own script structure"
          : "the subject was read from a row that is not one of the project's chapter or scene rows",
      );
      verdicts.aspect_declared = yes(
        ctx.aspectDerived,
        ctx.aspectDerived
          ? "the concept carries the frame's aspect, derived from the project's own stored target shape"
          : "the concept carries no aspect, because the project's stored target shape column says nothing",
      );
      break;
    }
    default: {
      throw new Error(`evaluateCriterionFeatures(): unhandled criterion "${String(id)}"`);
    }
  }

  return def.features.map((f) => {
    const verdict = verdicts[f.id];
    if (!verdict) throw new Error(`evaluateCriterionFeatures(): criterion ${id} has no verdict for feature ${f.id}`);
    return { id: f.id, label: f.label, present: verdict.present, measured: verdict.measured };
  });
}

/** Counts all nine criteria on one concept's specification. */
export function scoreThumbnailConcept(ctx: CriterionContext, sources: SourceRef[]): ThumbnailCriterion[] {
  return THUMBNAIL_CRITERION_IDS.map((id) => {
    const def = thumbnailCriterionDefinition(id);
    const features = evaluateCriterionFeatures(id, ctx);
    const score = features.filter((f) => f.present).length;
    return {
      id,
      label: def.label,
      score,
      maxScore: def.features.length,
      features,
      about: def.about,
      notA: def.notA,
      featureSource: def.featureSource,
      scoreIsTheFeatureCount: score === features.filter((f) => f.present).length,
      rule: "R-THUMB-CRITERION" as const,
      sources,
    };
  });
}

/* ------------------------------------------------------------------ */
/* The image absence and the record this app refuses to write           */
/* ------------------------------------------------------------------ */

/**
 * The provider facts a gate may name. The CALLER derives them from the app's own
 * registry (names only, never values, and never a literal list in this module) —
 * see ./thumbnails-model and ./service.
 */
export interface ThumbnailImageGateInput {
  /** The registry capability id whose absence this is. */
  capability: string;
  /** Env var NAMES the registry derives for the capability. Never values. */
  envVars: readonly string[];
  /** The registry slots that have a real call() implementation today. */
  wiredProviderIds: readonly string[];
  /** The registry's own sentence about what would enable the capability. */
  requirement: string;
}

export const THUMBNAIL_IMAGE_CAPABILITY = "thumbnail_generation";

export interface ThumbnailImageAbsence {
  rule: "R-THUMB-IMAGE-ABSENCE";
  capability: string;
  statement: string;
  envVars: string[];
  wiredProviderIds: string[];
  requirement: string;
  /** Plainly, the things this plan does not do instead of showing an image. */
  notSubstituted: string;
}

/**
 * The statuses this app refuses to write on a Thumbnail row for a concept that
 * produced no image. PENDING/QUEUED/RUNNING would report work in progress that is
 * not happening; SUCCEEDED would report an outcome no provider gave.
 */
export const REFUSED_THUMBNAIL_STATUSES = ["PENDING", "QUEUED", "RUNNING", "SUCCEEDED"] as const;

export interface ThumbnailRecordState {
  rule: "R-THUMB-RECORD";
  /** The model this app would write to, named. */
  model: string;
  /** True when a row was written for a concept. Always false today. */
  written: boolean;
  /** The status this app reports, which is none, because no row exists. */
  reportedStatus: string | null;
  /** The statuses this app will not write for a concept with no image, and why. */
  refusedStatuses: string[];
  reason: string;
}

/* ------------------------------------------------------------------ */
/* The model-backed path (state only — the ask lives in ./thumbnails-model) */
/* ------------------------------------------------------------------ */

export type ThumbnailModelStatus = "ok" | "not_connected" | "failed" | "rate_limited" | "timeout";

/** The narrow request fields the app's own builder would send. Declared here. */
export const THUMBNAIL_MODEL_REQUEST_FIELDS = [
  "transcript",
  "title",
  "keywords",
  "videoType",
  "aspectRatio",
  "overlayCandidates",
] as const;

/** A provider's own answer, character for character. Not this app's prose. */
export interface ProviderAnswer {
  textOrigin: "provider_verbatim";
  text: string;
  providerId: string;
  model: string | null;
  at: string;
}

/** A concept-shaped thing a provider really returned. Only such a thing may be named as provider-authored. */
export interface ModelThumbnailConcept {
  id: string;
  text: string;
  /** An image reference the provider's own answer carried, when it carried one. */
  imageRef: string | null;
  textOrigin: "provider_verbatim";
  providerId: string;
  model: string | null;
  source: "provider_response";
}

export interface ThumbnailModelAttempt {
  status: ThumbnailModelStatus;
  providerId: string | null;
  model: string | null;
  latencyMs: number | null;
  at: string;
  /** The app's own orchestrator's sentence about this attempt. Our words, scanned. */
  orchestratorMessage: string | null;
  /** The provider's own answer, when it answered. Verbatim, and declared so. */
  providerAnswer: ProviderAnswer | null;
}

export interface ThumbnailsModelOutcome {
  status: ThumbnailModelStatus;
  attempt: ThumbnailModelAttempt | null;
  concepts: ModelThumbnailConcept[];
  requiredEnv: string[];
  nothingAttempted: boolean;
  orchestratorMessage: string | null;
}

export interface ThumbnailsModelPath {
  capability: string;
  capabilityLabel: string;
  rule: "R-THUMB-MODEL-PATH";
  requestBuilder: string;
  requestFieldNames: string[];
  envVars: string[];
  state: Field<number>;
  providerConcepts: ModelThumbnailConcept[];
  attempt: ThumbnailModelAttempt | null;
  orchestratorMessage: string | null;
  authoredByModel: string;
  note: string;
}

export interface ThumbnailsModelPathInput {
  outcome: ThumbnailsModelOutcome | null;
  envVars: readonly string[];
}

/**
 * Maps the orchestrator's own answer into a Field-shaped state. Nothing here can
 * invent a concept: a provider-authored entry exists only when the result was ok
 * AND its own output really carried text.
 */
export function buildThumbnailsModelPath(input: ThumbnailsModelPathInput): ThumbnailsModelPath {
  const envVars = [...input.envVars];
  const outcome = input.outcome;
  const base = {
    capability: THUMBNAIL_IMAGE_CAPABILITY,
    capabilityLabel: "Thumbnail generation",
    rule: "R-THUMB-MODEL-PATH" as const,
    requestBuilder: "thumbnailGenerationRouterRequest() — src/lib/publishing/thumbnails-model.ts",
    requestFieldNames: [...THUMBNAIL_MODEL_REQUEST_FIELDS],
    envVars,
  };
  const nothingAuthored =
    "No concept in this package was written by a model. Every concept above was produced by this app's own rules from this project's own rows.";

  if (!outcome) {
    return {
      ...base,
      state: envVars.length === 0
        ? emptyNoInput(
            "The model-backed concept path was not asked for in this build, and this build named no provider environment variable for it, " +
              "so the state is empty rather than gated on a variable nobody derived.",
            ["a build that asks the app's AI orchestrator for the thumbnail_generation capability and names the variables the registry derives"],
          )
        : gatedProvider(
            "The model-backed concept path was not asked for in this build, so this plan claims nothing about a provider for it. Every " +
              "concept above was produced by this app's own rules from this project's own rows.",
            ["a build that asks the AI orchestrator for the thumbnail_generation capability"],
            envVars,
            { note: "No provider was asked for this capability, and no concept in this plan is attributed to a model." },
          ),
      providerConcepts: [],
      attempt: null,
      orchestratorMessage: null,
      authoredByModel: nothingAuthored,
      note: "The concepts above are rule-derived and involve no provider. This entry records the model-backed path's state only.",
    };
  }

  if (outcome.status === "ok" && outcome.concepts.length > 0) {
    const provider = outcome.concepts[0]?.providerId ?? "unknown";
    const model = outcome.concepts[0]?.model ?? null;
    return {
      ...base,
      state: derived(
        outcome.concepts.length,
        "R-THUMB-MODEL-PATH",
        [{ kind: "request", id: `thumbnail_generation:${provider}:${outcome.attempt?.at ?? "unknown-time"}` }],
        {
          note:
            `A provider really answered: ${provider}${model ? ` (${model})` : ""} returned ${outcome.concepts.length} concept-shaped ` +
            "answer(s), recorded verbatim below and named as provider-authored.",
        },
      ),
      providerConcepts: outcome.concepts,
      attempt: outcome.attempt,
      orchestratorMessage: outcome.orchestratorMessage,
      authoredByModel:
        `The ${outcome.concepts.length} entry(ies) listed as provider-authored were written by ${provider}` +
        `${model ? ` (${model})` : ""} and are recorded exactly as they were returned. They are a provider's own text and are kept separate ` +
        "from the traced concepts above, which this app derived by rule. No rule-derived concept above was replaced by one of them.",
      note: "A provider answered for this capability, so the model-backed list is real and is kept separate from the traced concepts.",
    };
  }

  if (outcome.status === "not_connected" || outcome.nothingAttempted) {
    const gateVars = envVars.length > 0 ? envVars : outcome.requiredEnv;
    if (gateVars.length === 0) {
      return {
        ...base,
        state: emptyNoInput(
          "The app's own AI orchestrator was asked for the thumbnail_generation capability and no provider environment variable was " +
            "derived for it, so the state is empty rather than gated on a variable name nobody derived.",
          ["a provider serving the thumbnail_generation capability whose enabling environment variable the registry derives"],
        ),
        providerConcepts: [],
        attempt: outcome.attempt,
        orchestratorMessage: outcome.orchestratorMessage,
        authoredByModel: nothingAuthored,
        note: "Every concept above is rule-derived; the model-backed path produced none, and no name is printed that the registry did not derive.",
      };
    }
    return {
      ...base,
      state: gatedProvider(
        "The app's own AI orchestrator was asked for the thumbnail_generation capability and its answer was not_connected: it could not " +
          "reach a provider for it, so no request was attempted and no model-authored concept exists. Nothing was simulated — this state is " +
          "what that call returned, and the environment variable names below are the ones the app's provider registry derives for the capability.",
        ["a provider wired and keyed for the thumbnail_generation capability"],
        gateVars,
        { note: "The app's own AI orchestrator was asked, and its own answer is recorded on this plan as it came back." },
      ),
      providerConcepts: [],
      attempt: outcome.attempt,
      orchestratorMessage: outcome.orchestratorMessage,
      authoredByModel: nothingAuthored,
      note:
        "Every concept above is rule-derived. The model-backed path is gated on a provider this server cannot reach, and it says so rather " +
        "than printing a concept list that looks generated.",
    };
  }

  return {
    ...base,
    state: emptyNoInput(
      `The attempt to get model-authored concepts did not come back accepted (${outcome.status}), so no model-authored concept exists. ` +
        "The provider's own answer, where there was one, is recorded character for character on this plan's attempt, and this app adds no " +
        "interpretation to it.",
      [`a provider answer of "ok" for the thumbnail_generation capability`],
      { note: "A rejected or failed attempt is not a concept list. No concept in this plan is attributed to a model." },
    ),
    providerConcepts: [],
    attempt: outcome.attempt,
    orchestratorMessage: outcome.orchestratorMessage,
    authoredByModel: nothingAuthored,
    note: "The provider was reached and did not accept the request; the attempt is recorded above exactly as it was answered.",
  };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export interface ThumbnailPlan {
  kind: "thumbnail_concepts";
  rule: "R-THUMB-CONCEPT";
  countRule: "R-THUMB-COUNT";
  criterionRule: "R-THUMB-CRITERION";
  controlRule: "R-THUMB-CONTROL";
  recordRule: "R-THUMB-RECORD";
  modelRule: "R-THUMB-MODEL-PATH";
  declaration: typeof THUMBNAIL_CRITERIA_DECLARATION;
  concepts: ThumbnailConcept[];
  totalConcepts: number;
  minimumRequested: number;
  maximumAllowed: number;
  meetsMinimum: boolean;
  withinMaximum: boolean;
  criterionIds: ThumbnailCriterionId[];
  criterionCount: number;
  /** The project's own overlay ladder, so a reader can see what the concepts chose from. */
  overlayLadder: ThumbnailTextCandidate[];
  /** The project's own subject ladder. */
  subjectLadder: ThumbnailSubjectCandidate[];
  ladders: {
    background: BackgroundSpec[];
    style: StyleSpec[];
    composition: CompositionSpec[];
    contrastPair: ContrastPairSpec[];
  };
  ladderDrops: { overlayTextsDropped: number; candidatesDropped: number };
  controls: ThumbnailControlDefinition[];
  imageAbsence: ThumbnailImageAbsence;
  records: ThumbnailRecordState;
  modelPath: ThumbnailsModelPath;
  notes: string[];
}

export interface BuildThumbnailPlanInput {
  source: PublishingSource;
  keywords: KeywordPlan;
  imageGate: ThumbnailImageGateInput;
  modelPath: ThumbnailsModelPathInput;
  now?: Date;
}

function aspectField(source: PublishingSource): Field<string> {
  const stored = source.project.targetAspectRatio;
  if (stored === "SIXTEEN_NINE") {
    return derived("16:9", "R-THUMB-ASPECT", [{ kind: "project", id: source.project.id, path: "targetAspectRatio" }], {
      textOrigin: "rule_authored",
      note: "The project's stored target shape says SIXTEEN_NINE, which this app's rule maps to the long-form 16:9 frame.",
    });
  }
  if (stored === "NINE_SIXTEEN") {
    return derived("9:16", "R-THUMB-ASPECT", [{ kind: "project", id: source.project.id, path: "targetAspectRatio" }], {
      textOrigin: "rule_authored",
      note: "The project's stored target shape says NINE_SIXTEEN, which this app's rule maps to the Shorts 9:16 frame.",
    });
  }
  return emptyNoInput(
    stored === null || stored === undefined
      ? "The project's own stored target shape column (Project.targetAspectRatio) says nothing, so no aspect is carried for this concept."
      : "The project's own stored target shape column (Project.targetAspectRatio) holds a value that is not one of the two shapes this " +
        "app's rule maps, so no aspect is carried for this concept and the value itself is not reprinted here.",
    ["Project.targetAspectRatio holding SIXTEEN_NINE or NINE_SIXTEEN"],
  );
}

interface MoodResolution {
  field: Field<string>;
  token: MoodToken | null;
  fromStoredValue: boolean;
  sourceLabel: string | null;
}

function resolveMood(source: PublishingSource): MoodResolution {
  const slots: { value: string | null; kind: SourceKind; id: string; path: string; label: string }[] = [
    { value: source.script?.tone ?? null, kind: "script", id: source.script?.id ?? "", path: "tone", label: "Script.tone" },
    { value: source.settings?.tone ?? null, kind: "project_settings", id: source.project.id, path: "tone", label: "ProjectSettings.tone" },
    { value: source.script?.style ?? null, kind: "script", id: source.script?.id ?? "", path: "style", label: "Script.style" },
    { value: source.settings?.style ?? null, kind: "project_settings", id: source.project.id, path: "style", label: "ProjectSettings.style" },
  ];
  for (const slot of slots) {
    const stored = slot.value;
    if (typeof stored !== "string" || !stored.trim() || !slot.id) continue;
    const token = TONE_TO_MOOD[stored.trim().toLowerCase()] ?? null;
    if (token === null) {
      return {
        field: derived(DEFAULT_MOOD, "R-THUMB-MOOD", [{ kind: slot.kind, id: slot.id, path: slot.path }], {
          textOrigin: "rule_authored",
          note:
            `The project's stored value in ${slot.label} is not a key of this app's fixed tone-to-mood table, so this app's default mood ` +
            `token ("${DEFAULT_MOOD}") is used, and this note says so rather than inventing a mapping.`,
        }),
        token: DEFAULT_MOOD,
        fromStoredValue: false,
        sourceLabel: slot.label,
      };
    }
    return {
      field: derived(token, "R-THUMB-MOOD", [{ kind: slot.kind, id: slot.id, path: slot.path }], {
        textOrigin: "rule_authored",
        note:
          `Selected from this app's fixed tone-to-mood table using the project's own stored value in ${slot.label}, which is a key of that table.`,
      }),
      token,
      fromStoredValue: true,
      sourceLabel: slot.label,
    };
  }
  return {
    field: emptyNoInput(
      "No tone or style value is stored on this project's script or settings rows, so no mood token is carried for this concept.",
      ["Script.tone, ProjectSettings.tone, Script.style or ProjectSettings.style holding a value"],
    ),
    token: null,
    fromStoredValue: false,
    sourceLabel: null,
  };
}

/** Builds one concept for one ladder position (and variation). */
function buildConcept(input: {
  planSource: PublishingSource;
  index: number;
  ladders: Ladder;
  tokens: ThumbnailTokens;
  mood: MoodResolution;
  imageGate: ThumbnailImageGateInput;
  revisedFrom: string | null;
  revision: number;
  id: string;
}): ThumbnailConcept {
  const { ladders } = input;
  const overlay = ladders.overlay[input.tokens.overlayIndex - 1] ?? null;
  const subject = ladders.subject[input.tokens.subjectIndex - 1] ?? null;
  if (!overlay || !subject) {
    throw new Error("buildConcept(): a ladder index fell outside the ladder it names");
  }
  const background = THUMBNAIL_BACKGROUNDS[input.tokens.backgroundIndex - 1]!;
  const style = THUMBNAIL_STYLES[input.tokens.styleIndex - 1]!;
  const composition = THUMBNAIL_COMPOSITIONS[input.tokens.compositionIndex - 1]!;
  const expectedPairId = TONE_HINT_TO_PAIR[background.toneHint] ?? null;
  const pair = THUMBNAIL_CONTRAST_PAIRS.find((p) => p.id === expectedPairId) ?? null;
  const aspect = aspectField(input.planSource);
  const storedToneRows: SourceRef[] = [
    { kind: "project_settings", id: input.planSource.project.id, path: "tone" },
  ];
  if (input.planSource.script) storedToneRows.unshift({ kind: "script", id: input.planSource.script.id, path: "tone" });

  const overlayText = derived(overlay.text, "R-THUMB-TEXT", overlay.sources, {
    textOrigin: "source_verbatim",
    note: `Read for the role "${overlay.roleLabel}" — ${overlay.from}`,
  });
  const subjectField = derived(subject.text, "R-THUMB-SUBJECT", subject.sources, {
    textOrigin: "source_verbatim",
    note: `Read for the role "${subject.roleLabel}" — ${subject.from}`,
  });
  const overlayWords = tokenize(overlay.text).map((t) => t.text);
  const subjectWords = tokenize(subject.text).map((t) => t.text);
  const subjectContent = contentWords(subject.text);
  const sharedContentWords = contentWords(overlay.text).filter((w) => subjectContent.includes(w));

  const ctx: CriterionContext = {
    tokens: { ...input.tokens, toneHint: background.toneHint, separation: background.separation, depthToken: background.depthToken, typography: style.typography, strokeToken: style.strokeToken, paletteToken: style.paletteToken, keying: style.keying, moodToken: input.mood.token },
    overlayText: overlay.text,
    overlayWords,
    overlayCharCount: overlay.text.length,
    overlayCandidateIndex: input.tokens.overlayIndex,
    overlayLadderLength: ladders.overlay.length,
    overlayIsProjectTitleCandidate: overlay.id === "cand-project-title",
    /** Read off the value's own declaration, not assumed from the producer. */
    overlayTextOrigin: overlayText.textOrigin ?? "",
    subjectText: subject.text,
    subjectWords,
    subjectFirstWord: subjectWords[0] ?? null,
    overlayFirstWord: overlayWords[0] ?? null,
    subjectSourceCount: subject.sources.length,
    subjectSourceKinds: subject.sources.map((s) => s.kind),
    subjectRoleLabel: subject.roleLabel,
    subjectIsProjectText: subjectField.state === "derived" && subjectField.textOrigin === "source_verbatim",
    moodFromStoredValue: input.mood.fromStoredValue,
    moodSourceLabel: input.mood.sourceLabel,
    sharedContentWords,
    punctuationPresent: OVERLAY_PUNCTUATION.filter((p) => overlay.text.includes(p)),
    twoPartShape: /[:—–-]/.test(overlay.text),
    aspectDerived: aspect.state === "derived",
    backgroundLabel: background.label,
    contrastPairId: pair?.id ?? null,
    expectedPairId,
  };

  const criterionSources: SourceRef[] = [
    ...overlay.sources,
    ...subject.sources,
    { kind: "project", id: input.planSource.project.id, path: "targetAspectRatio" },
  ];

  /**
   * THE IMAGE SLOT. A gate only names a provider it can honestly name: when this
   * build was given the env var NAMES the app's registry derives for this
   * capability, the slot is a gated-provider value naming them; when it was given
   * none, the slot is empty-with-reason and says that no build of this package
   * named one. Neither state can carry a value, and no third state exists.
   */
  const imageReason =
    "No image exists for this concept. This server has no provider connected for the thumbnail_generation capability, so nothing was " +
    "rendered, generated, fetched or substituted, and no file, preview or placeholder stands in for one. The concept above is a " +
    "specification, and the specification is all that exists.";
  const imageRequires = ["a provider wired and keyed for the thumbnail_generation capability"];
  const imageNote =
    input.imageGate.wiredProviderIds.length > 0
      ? `Slots serving this capability that have a real call() implementation today: ${input.imageGate.wiredProviderIds.join(", ")}.`
      : "No slot serving this capability has a real call() implementation today, so setting a key alone would still produce no image.";
  const image: Field<never> =
    input.imageGate.envVars.length > 0
      ? gatedProvider(imageReason, imageRequires, [...input.imageGate.envVars], { note: imageNote })
      : emptyNoInput(imageReason, imageRequires, {
          note: `${imageNote} This build of the package was given no provider environment variable name for this capability, so the slot names none.`,
        });

  return {
    id: input.id,
    index: input.index,
    rule: "R-THUMB-CONCEPT",
    overlayText,
    overlayRole: derived(overlay.roleLabel, "R-THUMB-TEXT", overlay.sources, {
      textOrigin: "rule_authored",
      note: "This app's own name for the role the overlay candidate was read for. Not the project's words.",
    }),
    overlayWordCount: derived(overlay.wordCount, "R-THUMB-TEXT", overlay.sources, {
      note: `Counted on this concept's own overlay text: ${overlay.wordCount} word(s).`,
    }),
    overlayCharCount: derived(overlay.charCount, "R-THUMB-TEXT", overlay.sources, {
      note: `Counted on this concept's own overlay text: ${overlay.charCount} character(s).`,
    }),
    subject: subjectField,
    subjectRole: derived(subject.roleLabel, "R-THUMB-SUBJECT", subject.sources, {
      textOrigin: "rule_authored",
      note: "This app's own name for the role the subject was read for. Not the project's words.",
    }),
    background: derived(`${background.label} — ${background.definition}`, "R-THUMB-BACKGROUND", storedToneRows, {
      textOrigin: "rule_authored",
      note: "An entry of this app's fixed background list, named on the concept together with the project's stored tone/style rows the choice rested on.",
    }),
    style: derived(`${style.label} — ${style.definition}`, "R-THUMB-STYLE", storedToneRows, {
      textOrigin: "rule_authored",
      note: "An entry of this app's fixed style list. Every token in it is this app's own design vocabulary.",
    }),
    composition: derived(`${composition.label} — ${composition.definition}`, "R-THUMB-COMPOSITION", [
      { kind: "project", id: input.planSource.project.id, path: "targetAspectRatio" },
    ], {
      textOrigin: "rule_authored",
      note: "An entry of this app's fixed composition list: two different frame zones, a margin token and a text block shape.",
    }),
    mood: input.mood.field,
    contrastPair: derived(`${pair?.label ?? "No pairing"} — ${pair?.definition ?? "This app's fixed coordination table gives this background no pairing."}`, "R-THUMB-CONTRAST", [
      { kind: "project", id: input.planSource.project.id, path: "targetAspectRatio" },
      ...storedToneRows,
    ], {
      textOrigin: "rule_authored",
      note: "A DECLARED ink/field pairing from this app's fixed list, chosen by the background's own tone hint. It carries no ratio and no measurement.",
    }),
    aspect,
    criteria: scoreThumbnailConcept(ctx, criterionSources),
    tokens: ctx.tokens,
    image,
    authoredBy: "rule_specification",
    revisedFrom: input.revisedFrom,
    revision: input.revision,
    note:
      "A specification for a thumbnail, produced by this app's own rules from this project's own rows. It is not a picture: the image slot " +
      "on this concept is an absence naming the provider it would need.",
  };
}

/** The concept count: never padded up to the minimum, never beyond the brief's maximum. */
export function conceptCountFor(ladders: Ladder): number {
  const distinct = Math.max(ladders.overlay.length, ladders.subject.length, 1);
  return Math.max(THUMBNAIL_CONCEPT_MINIMUM, Math.min(THUMBNAIL_CONCEPT_MAXIMUM, Math.max(distinct, SUBJECT_ROLE_LADDER_MINIMUM)));
}

/**
 * The app's own subject-role ladder is longer than any single project's row count;
 * a project with very few rows still gets the brief's minimum number of concepts
 * by varying the four design ladders, which is stated on the plan rather than
 * hidden (see the notes).
 */
export const SUBJECT_ROLE_LADDER_MINIMUM = 5;

export function buildThumbnailPlan(input: BuildThumbnailPlanInput): ThumbnailPlan {
  const ladders = buildThumbnailLadders(input.source, input.keywords);
  const mood = resolveMood(input.source);
  const count = conceptCountFor(ladders);
  const concepts: ThumbnailConcept[] = [];
  for (let i = 0; i < count; i += 1) {
    concepts.push(
      buildConcept({
        planSource: input.source,
        index: i + 1,
        ladders,
        tokens: {
          aspectId:
            input.source.project.targetAspectRatio === "NINE_SIXTEEN"
              ? "nine_sixteen"
              : input.source.project.targetAspectRatio === "SIXTEEN_NINE"
                ? "sixteen_nine"
                : null,
          overlayIndex: (i % ladders.overlay.length) + 1,
          subjectIndex: (i % ladders.subject.length) + 1,
          styleIndex: (i % THUMBNAIL_STYLES.length) + 1,
          backgroundIndex: (i % THUMBNAIL_BACKGROUNDS.length) + 1,
          compositionIndex: (i % THUMBNAIL_COMPOSITIONS.length) + 1,
          variation: 0,
          subjectZone: THUMBNAIL_COMPOSITIONS[i % THUMBNAIL_COMPOSITIONS.length]!.subjectZone,
          textZone: THUMBNAIL_COMPOSITIONS[i % THUMBNAIL_COMPOSITIONS.length]!.textZone,
          marginToken: THUMBNAIL_COMPOSITIONS[i % THUMBNAIL_COMPOSITIONS.length]!.marginToken,
          textBlockShape: THUMBNAIL_COMPOSITIONS[i % THUMBNAIL_COMPOSITIONS.length]!.textBlockShape,
          separation: THUMBNAIL_BACKGROUNDS[i % THUMBNAIL_BACKGROUNDS.length]!.separation,
          depthToken: THUMBNAIL_BACKGROUNDS[i % THUMBNAIL_BACKGROUNDS.length]!.depthToken,
          toneHint: THUMBNAIL_BACKGROUNDS[i % THUMBNAIL_BACKGROUNDS.length]!.toneHint,
          typography: THUMBNAIL_STYLES[i % THUMBNAIL_STYLES.length]!.typography,
          strokeToken: THUMBNAIL_STYLES[i % THUMBNAIL_STYLES.length]!.strokeToken,
          paletteToken: THUMBNAIL_STYLES[i % THUMBNAIL_STYLES.length]!.paletteToken,
          keying: THUMBNAIL_STYLES[i % THUMBNAIL_STYLES.length]!.keying,
          moodToken: mood.token,
        },
        mood,
        imageGate: input.imageGate,
        revisedFrom: null,
        revision: 0,
        id: `thumb-concept-${i + 1}`,
      }),
    );
  }

  const notes: string[] = [
    `Every concept here is a SPECIFICATION produced by this app's own rules from this project's own rows. No image exists for any of ` +
      "them, none was rendered or substituted, and the image slot on each concept says so and names the provider it would need.",
    THUMBNAIL_CRITERIA_DECLARATION.criteriaAreNotIndependent,
    `The concepts' overlay texts and subjects come from one ladder of this project's own stored phrases (${ladders.overlay.length} overlay ` +
      `candidate(s), ${ladders.subject.length} subject candidate(s)), so where a project offers fewer phrases than the plan has concepts, ` +
      "more than one concept reuses the same overlay text or subject, and the ladder positions on each concept say exactly which.",
    "The background, style and composition of a concept are entries of fixed lists in this app's own source file, taken by the concept's " +
      "own ladder position. They are this app's own design vocabulary, not observations about a picture.",
  ];
  if (ladders.overlayDroppedTooLong > 0) {
    notes.push(
      `${ladders.overlayDroppedTooLong} candidate(s) from this project's own text were dropped as overlay texts because they are longer ` +
        `than the ${OVERLAY_WORD_BOUND}-word bound. They were dropped, not shortened: shortening would be this app editing the project's words.`,
    );
  }
  if (ladders.candidatesDropped > 0) {
    notes.push(
      `${ladders.candidatesDropped} ladder candidate(s) read word for word the same as one already in the ladder were dropped rather than listed twice.`,
    );
  }
  if (concepts.length < THUMBNAIL_CONCEPT_MINIMUM) {
    notes.push(
      `This plan holds ${concepts.length} concept(s), which is below the ${THUMBNAIL_CONCEPT_MINIMUM} the brief asks for. No concept was ` +
        "invented to reach the minimum: this project's own rows did not offer enough distinct material.",
    );
  }

  return {
    kind: "thumbnail_concepts",
    rule: "R-THUMB-CONCEPT",
    countRule: "R-THUMB-COUNT",
    criterionRule: "R-THUMB-CRITERION",
    controlRule: "R-THUMB-CONTROL",
    recordRule: "R-THUMB-RECORD",
    modelRule: "R-THUMB-MODEL-PATH",
    declaration: THUMBNAIL_CRITERIA_DECLARATION,
    concepts,
    totalConcepts: concepts.length,
    minimumRequested: THUMBNAIL_CONCEPT_MINIMUM,
    maximumAllowed: THUMBNAIL_CONCEPT_MAXIMUM,
    meetsMinimum: concepts.length >= THUMBNAIL_CONCEPT_MINIMUM,
    withinMaximum: concepts.length <= THUMBNAIL_CONCEPT_MAXIMUM,
    criterionIds: [...THUMBNAIL_CRITERION_IDS],
    criterionCount: THUMBNAIL_CRITERION_IDS.length,
    overlayLadder: ladders.overlay,
    subjectLadder: ladders.subject,
    ladders: {
      background: [...THUMBNAIL_BACKGROUNDS],
      style: [...THUMBNAIL_STYLES],
      composition: [...THUMBNAIL_COMPOSITIONS],
      contrastPair: [...THUMBNAIL_CONTRAST_PAIRS],
    },
    ladderDrops: {
      overlayTextsDropped: ladders.overlayDroppedTooLong,
      candidatesDropped: ladders.candidatesDropped,
    },
    controls: [...THUMBNAIL_CONTROLS],
    imageAbsence: {
      rule: "R-THUMB-IMAGE-ABSENCE",
      capability: input.imageGate.capability,
      statement:
        "No image exists for any concept in this plan. This server has no provider connected for the thumbnail_generation capability, so " +
        "nothing was rendered, generated, fetched or substituted — and no grey box, stock photograph, placeholder or stand-in is shown in " +
        "the place of one. What exists is the specification, and the specification is what this plan carries.",
      envVars: [...input.imageGate.envVars],
      wiredProviderIds: [...input.imageGate.wiredProviderIds],
      requirement: input.imageGate.requirement,
      notSubstituted:
        "The concepts below name a background, a style, a composition and a contrast pairing as DECLARED tokens of this app's own design " +
        "vocabulary. None of them is a picture, and none of them may be read as a description of one that was produced.",
    },
    records: {
      rule: "R-THUMB-RECORD",
      model: "Thumbnail (prisma/schema.prisma)",
      written: false,
      reportedStatus: null,
      refusedStatuses: [...REFUSED_THUMBNAIL_STATUSES],
      reason:
        "No Thumbnail row is written for any concept in this plan, so no generation status is recorded or reported for one. A row would " +
        "describe an image at an Asset row, and no image was produced. This app will not write a progress status (PENDING, QUEUED, RUNNING) " +
        "for work that is not happening, and will not write SUCCEEDED for an outcome no provider gave.",
    },
    modelPath: buildThumbnailsModelPath(input.modelPath),
    notes,
  };
}

/* ------------------------------------------------------------------ */
/* The seven controls                                                  */
/* ------------------------------------------------------------------ */

export const THUMBNAIL_CONTROL_IDS = [
  "regenerate",
  "change_text",
  "change_background",
  "change_subject",
  "change_style",
  "change_composition",
  "upscale",
] as const;

export type ThumbnailControlId = (typeof THUMBNAIL_CONTROL_IDS)[number];

export interface ThumbnailControlDefinition {
  id: ThumbnailControlId;
  /** This app's label for the control. */
  label: string;
  /** What it operates on, in this app's own words. */
  about: string;
  /** "specification" = it moves a ladder of the specification. "provider" = it cannot run here. */
  operates: "specification" | "provider";
  rule: PublishingRuleId;
  /** The ladder it advances; null for the provider-gated control. */
  ladder: "variation" | "overlayText" | "background" | "subject" | "style" | "composition" | null;
  /** The registry capability the control needs, when it needs one. */
  capability: string | null;
}

/**
 * The seven controls the brief asks for. SIX operate on the specification; UPSCALE
 * cannot, and is carried as a provider-gated refusal rather than as a control that
 * appears to do something (see R-THUMB-UPSCALE). No control here is decorative.
 */
export const THUMBNAIL_CONTROLS: readonly ThumbnailControlDefinition[] = [
  {
    id: "regenerate",
    label: "Regenerate",
    about:
      "Advances the concept's variation position, which shifts its background, style and composition to the next entry of each of this " +
      "app's fixed lists. It refuses once the ladders would cycle back to this concept's own assignment.",
    operates: "specification",
    rule: "R-THUMB-CONTROL",
    ladder: "variation",
    capability: null,
  },
  {
    id: "change_text",
    label: "Change the overlay text",
    about:
      "Advances the concept's overlay text to the next candidate in this project's own text ladder, and counts the words and characters of " +
      "the new text again.",
    operates: "specification",
    rule: "R-THUMB-CONTROL",
    ladder: "overlayText",
    capability: null,
  },
  {
    id: "change_background",
    label: "Change the background",
    about: "Advances the concept's background to the next entry of this app's fixed background list, and re-declares the contrast pairing that entry's tone hint selects.",
    operates: "specification",
    rule: "R-THUMB-CONTROL",
    ladder: "background",
    capability: null,
  },
  {
    id: "change_subject",
    label: "Change the subject",
    about: "Advances the concept's dominant subject to the next candidate in this project's own subject ladder, and re-counts every criterion that rests on it.",
    operates: "specification",
    rule: "R-THUMB-CONTROL",
    ladder: "subject",
    capability: null,
  },
  {
    id: "change_style",
    label: "Change the style",
    about: "Advances the concept's style to the next entry of this app's fixed style list, and re-counts the criteria that count its typography, outline, palette and keying tokens.",
    operates: "specification",
    rule: "R-THUMB-CONTROL",
    ladder: "style",
    capability: null,
  },
  {
    id: "change_composition",
    label: "Change the composition",
    about: "Advances the concept's composition to the next entry of this app's fixed composition list, and re-counts the criteria that count its zones, its margin token and its block shape.",
    operates: "specification",
    rule: "R-THUMB-CONTROL",
    ladder: "composition",
    capability: null,
  },
  {
    id: "upscale",
    label: "Upscale",
    about:
      "Cannot run here. Enlarging an image needs a provider this server has none of, and it needs an image, which no concept has. Pressing " +
      "it returns a refusal naming the capability and the environment variables the registry derives for it — it never reports that " +
      "anything was enlarged.",
    operates: "provider",
    rule: "R-THUMB-UPSCALE",
    ladder: null,
    capability: "upscaling",
  },
];

export function thumbnailControlDefinition(id: ThumbnailControlId): ThumbnailControlDefinition {
  const found = THUMBNAIL_CONTROLS.find((c) => c.id === id);
  if (!found) throw new Error(`thumbnailControlDefinition(): unknown control "${id}"`);
  return found;
}

export interface ThumbnailCandidateMove {
  candidateId: string;
  /** The candidate moved to/from, as it reads. */
  label: string;
  /**
   * Whose characters `label` carries: `source_verbatim` when it is the project's
   * own text (an overlay text or a subject read from a row) or a provider's own
   * answer, `rule_authored` when it is one of this app's own design tokens. Declared
   * here so the surface carries the characters correctly instead of guessing.
   */
  textOrigin: "source_verbatim" | "rule_authored";
  sources: SourceRef[];
}

export interface ThumbnailChangeRecord {
  controlId: ThumbnailControlId;
  rule: PublishingRuleId;
  /** What changed, in this app's own words. */
  what: string;
  /** Which part of the specification moved. */
  field: "variation" | "overlayText" | "background" | "subject" | "style" | "composition";
  from: ThumbnailCandidateMove;
  to: ThumbnailCandidateMove;
  conceptIdFrom: string;
  conceptIdTo: string;
  /** A plain statement that what changed is the specification, not a picture. */
  note: string;
  at: string;
}

export interface ThumbnailControlRefusal {
  reason: string;
  requires: string[];
  /** Env var NAMES only, when the refusal is a provider gate. */
  envVars: string[];
}

export interface ThumbnailControlOutcome {
  control: ThumbnailControlId;
  controlLabel: string;
  rule: PublishingRuleId;
  status: "applied" | "refused_no_input" | "refused_gated";
  /** The new, fully traced concept. Null on a refusal — never a copy of the old one. */
  concept: ThumbnailConcept | null;
  change: ThumbnailChangeRecord | null;
  refusal: ThumbnailControlRefusal | null;
}

export interface ApplyThumbnailControlInput {
  plan: ThumbnailPlan;
  conceptId: string;
  control: ThumbnailControlId;
  /** The upscale gate's own facts, derived by the caller from the app's registry. */
  upscaleGate: { capability: string; envVars: readonly string[]; wiredProviderIds: readonly string[]; requirement: string };
  /** Injection point for tests; defaults to now. */
  now?: Date;
  /**
   * The source rows, so a controlled concept is re-derived from the same rows the
   * plan was built from. Required for a specification control.
   */
  source: PublishingSource;
  keywords: KeywordPlan;
  imageGate: ThumbnailImageGateInput;
}

/**
 * Applies one control. A specification control returns a NEW concept derived from
 * scratch with one ladder advanced, plus the record of what moved. A control with
 * nothing to advance refuses and names the missing input; upscale always refuses
 * with the provider gate.
 */
export function applyThumbnailControl(input: ApplyThumbnailControlInput): ThumbnailControlOutcome {
  const def = thumbnailControlDefinition(input.control);
  const at = (input.now ?? new Date()).toISOString();
  const base = input.plan.concepts.find((c) => c.id === input.conceptId) ?? null;
  const refuse = (reason: string, requires: string[], envVars: string[] = []): ThumbnailControlOutcome => ({
    control: def.id,
    controlLabel: def.label,
    rule: def.rule,
    status: envVars.length > 0 ? "refused_gated" : "refused_no_input",
    concept: null,
    change: null,
    refusal: { reason, requires, envVars },
  });

  if (base === null) {
    return refuse(
      `This plan carries no concept with the id "${input.conceptId}", so this control has nothing to operate on. No concept was produced ` +
        "and nothing was changed.",
      ["a concept id that this plan's own concept list carries"],
    );
  }

  if (def.operates === "provider") {
    const gate = input.upscaleGate;
    return {
      control: def.id,
      controlLabel: def.label,
      rule: def.rule,
      status: "refused_gated",
      concept: null,
      change: null,
      refusal: {
        reason:
          "Upscale did not run and nothing was enlarged. Enlarging a thumbnail needs an image, and no image exists for any concept in this " +
          "plan because no image provider is connected here — so there is nothing to enlarge and no file was produced. " +
          (gate.wiredProviderIds.length > 0
            ? `Slots serving this capability that have a real call() implementation today: ${gate.wiredProviderIds.join(", ")}.`
            : "No slot serving this capability has a real call() implementation today, so setting a key alone would still enlarge nothing."),
        requires: ["an image for this concept, and a provider wired and keyed for the upscaling capability"],
        envVars: [...gate.envVars],
      },
    };
  }

  // The ladders come from the PLAN the user is looking at, so a revision can never
  // advance a ladder the plan does not carry. The project's rows are still needed
  // to derive the new concept's own values (see buildConcept).
  const ladders: Ladder = {
    overlay: input.plan.overlayLadder,
    subject: input.plan.subjectLadder,
    overlayDroppedTooLong: input.plan.ladderDrops.overlayTextsDropped,
    candidatesDropped: input.plan.ladderDrops.candidatesDropped,
  };
  const definition = thumbnailControlDefinition(def.id);
  const nextTokens: ThumbnailTokens = { ...base.tokens };
  let field: ThumbnailChangeRecord["field"];
  let fromMove: ThumbnailCandidateMove;
  let toMove: ThumbnailCandidateMove;
  let what: string;

  const overlayMove = (index: number): ThumbnailCandidateMove => {
    const candidate = ladders.overlay[index - 1]!;
    return { candidateId: candidate.id, label: candidate.text, textOrigin: "source_verbatim", sources: candidate.sources };
  };
  const subjectMove = (index: number): ThumbnailCandidateMove => {
    const candidate = ladders.subject[index - 1]!;
    return { candidateId: candidate.id, label: candidate.text, textOrigin: "source_verbatim", sources: candidate.sources };
  };
  const specMove = (
    entries: readonly { id: string; label: string }[],
    index: number,
  ): ThumbnailCandidateMove => {
    const entry = entries[index - 1]!;
    return {
      candidateId: entry.id,
      label: entry.label,
      textOrigin: "rule_authored",
      sources: [{ kind: "project", id: input.source.project.id, path: "targetAspectRatio" }],
    };
  };

  switch (definition.ladder) {
    case "overlayText": {
      if (ladders.overlay.length <= 1) {
        return refuse(
          `There is nothing to change the overlay text to: this project's own stored text offers ${ladders.overlay.length} overlay ` +
            `candidate(s) within the ${OVERLAY_WORD_BOUND}-word bound, so advancing the ladder would return the text the concept already ` +
            "carries. Nothing was produced.",
          ["a second phrase in this project's own stored text that fits the overlay word bound"],
        );
      }
      fromMove = overlayMove(nextTokens.overlayIndex);
      nextTokens.overlayIndex = (nextTokens.overlayIndex % ladders.overlay.length) + 1;
      toMove = overlayMove(nextTokens.overlayIndex);
      field = "overlayText";
      what =
        `The overlay text moved to candidate ${nextTokens.overlayIndex} of ${ladders.overlay.length} in this project's own text ladder, ` +
        "read for the next role in the ladder. The concept's words, its word and character counts and every criterion that counts them were " +
        "derived again from the project's own rows.";
      break;
    }
    case "subject": {
      if (ladders.subject.length <= 1) {
        return refuse(
          `There is nothing to change the subject to: this project's own rows offer ${ladders.subject.length} subject candidate(s), so ` +
            "advancing the ladder would return the subject the concept already carries. Nothing was produced.",
          ["a second row of this project that one of this app's fixed subject roles can read"],
        );
      }
      fromMove = subjectMove(nextTokens.subjectIndex);
      nextTokens.subjectIndex = (nextTokens.subjectIndex % ladders.subject.length) + 1;
      toMove = subjectMove(nextTokens.subjectIndex);
      field = "subject";
      what =
        `The dominant subject moved to candidate ${nextTokens.subjectIndex} of ${ladders.subject.length} in this project's own subject ` +
        "ladder, and every criterion that rests on the subject — the one-subject count, the zone comparison and the overlap with the " +
        "overlay text — was derived again.";
      break;
    }
    case "background": {
      fromMove = specMove(THUMBNAIL_BACKGROUNDS, nextTokens.backgroundIndex);
      nextTokens.backgroundIndex = (nextTokens.backgroundIndex % THUMBNAIL_BACKGROUNDS.length) + 1;
      toMove = specMove(THUMBNAIL_BACKGROUNDS, nextTokens.backgroundIndex);
      field = "background";
      what =
        `The background moved to entry ${nextTokens.backgroundIndex} of ${THUMBNAIL_BACKGROUNDS.length} in this app's fixed background ` +
        "list, and the contrast pairing was re-declared from the new entry's own tone hint by this app's fixed coordination table.";
      break;
    }
    case "style": {
      fromMove = specMove(THUMBNAIL_STYLES, nextTokens.styleIndex);
      nextTokens.styleIndex = (nextTokens.styleIndex % THUMBNAIL_STYLES.length) + 1;
      toMove = specMove(THUMBNAIL_STYLES, nextTokens.styleIndex);
      field = "style";
      what =
        `The style moved to entry ${nextTokens.styleIndex} of ${THUMBNAIL_STYLES.length} in this app's fixed style list, and the criteria ` +
        "that count its typography, outline, palette and keying tokens were derived again.";
      break;
    }
    case "composition": {
      fromMove = specMove(THUMBNAIL_COMPOSITIONS, nextTokens.compositionIndex);
      nextTokens.compositionIndex = (nextTokens.compositionIndex % THUMBNAIL_COMPOSITIONS.length) + 1;
      toMove = specMove(THUMBNAIL_COMPOSITIONS, nextTokens.compositionIndex);
      field = "composition";
      what =
        `The composition moved to entry ${nextTokens.compositionIndex} of ${THUMBNAIL_COMPOSITIONS.length} in this app's fixed composition ` +
        "list, so the subject's zone, the overlay's zone, the margin token and the text block shape are all the new entry's own.";
      break;
    }
    case "variation": {
      if (nextTokens.variation >= THUMBNAIL_COMPOSITIONS.length - 1) {
        return refuse(
          `There is nothing further to regenerate: this concept is at variation ${nextTokens.variation} and this app's fixed design lists ` +
            `hold ${THUMBNAIL_COMPOSITIONS.length} entries each, so advancing once more would return the assignment this concept already ` +
            "carries. Nothing was produced rather than repeating a concept already on the plan.",
          ["a longer fixed design list in this app's own source file, or a different starting position for this concept"],
        );
      }
      const shift = nextTokens.variation + 1;
      nextTokens.variation = shift;
      nextTokens.backgroundIndex = ((base.tokens.backgroundIndex - 1 + shift) % THUMBNAIL_BACKGROUNDS.length) + 1;
      nextTokens.styleIndex = ((base.tokens.styleIndex - 1 + shift) % THUMBNAIL_STYLES.length) + 1;
      nextTokens.compositionIndex = ((base.tokens.compositionIndex - 1 + shift) % THUMBNAIL_COMPOSITIONS.length) + 1;
      fromMove = {
        candidateId: `${THUMBNAIL_BACKGROUNDS[base.tokens.backgroundIndex - 1]!.id}+${THUMBNAIL_STYLES[base.tokens.styleIndex - 1]!.id}+${THUMBNAIL_COMPOSITIONS[base.tokens.compositionIndex - 1]!.id}`,
        label: `variation ${base.tokens.variation}`,
        textOrigin: "rule_authored",
        sources: [{ kind: "project", id: input.source.project.id, path: "targetAspectRatio" }],
      };
      toMove = {
        candidateId: `${THUMBNAIL_BACKGROUNDS[nextTokens.backgroundIndex - 1]!.id}+${THUMBNAIL_STYLES[nextTokens.styleIndex - 1]!.id}+${THUMBNAIL_COMPOSITIONS[nextTokens.compositionIndex - 1]!.id}`,
        label: `variation ${shift}`,
        textOrigin: "rule_authored",
        sources: [{ kind: "project", id: input.source.project.id, path: "targetAspectRatio" }],
      };
      field = "variation";
      what =
        `The concept moved to variation ${shift}: its background, style and composition each advanced ${shift} position(s) in this app's ` +
        "fixed design lists, while its overlay text and its subject — the project's own words — are unchanged.";
      break;
    }
    default: {
      return refuse(
        `This app has no ladder to advance for the control "${def.id}", so nothing was produced. This is a defect in the control, not a state ` +
          "of this project.",
        ["a control whose ladder this app can advance"],
      );
    }
  }

  const mood = resolveMood(input.source);
  const revision = base.revision + 1;
  const conceptId = `${base.id}-rev${revision}-${def.id}-${nextTokens.variation}${nextTokens.overlayIndex}${nextTokens.subjectIndex}${nextTokens.backgroundIndex}${nextTokens.styleIndex}${nextTokens.compositionIndex}`;
  const concept = buildConcept({
    planSource: input.source,
    index: base.index,
    ladders,
    tokens: { ...nextTokens, moodToken: mood.token },
    mood,
    imageGate: input.imageGate,
    revisedFrom: base.id,
    revision,
    id: conceptId,
  });

  return {
    control: def.id,
    controlLabel: def.label,
    rule: def.rule,
    status: "applied",
    concept,
    change: {
      controlId: def.id,
      rule: def.rule,
      what,
      field,
      from: fromMove,
      to: toMove,
      conceptIdFrom: base.id,
      conceptIdTo: conceptId,
      note:
        "The change is to the SPECIFICATION above and to nothing else: no image was produced, none was changed, and none exists for this " +
        "concept. The new concept was derived from this project's own rows by the same rules as the original, so its criteria and its image " +
        "absence were derived again rather than carried over.",
      at,
    },
    refusal: null,
  };
}
