/**
 * Phase 7 Block 3 — THE TITLE ENGINE.
 *
 * WHAT IT PRODUCES: at least 20 title options for one project, spread across the
 * six categories the brief asks for, each scored on the six axes the brief asks
 * for. Everything here is derived from the project's OWN rows — its title, its
 * description, its script, its chapters and scenes, and the keyword phrases this
 * same package extracted from that text. Nothing is fetched, nothing is guessed,
 * and no model writes a title.
 *
 * THE THREE THINGS THIS MODULE REFUSES TO DO, stated before the code:
 *
 *  1. NO SEARCH OR PERFORMANCE NUMBER. There is no search volume, difficulty,
 *     competition, trend or estimated-traffic value anywhere in this product, so
 *     a title carries no such number and no key of that shape. See ./audit,
 *     which fails the whole build if one can be found.
 *
 *  2. NO SCORE THAT CAN BE READ AS A MARKET PREDICTION. Each of the six axes is
 *     a COUNT of five named wordings of the title that are present, out of five.
 *     The wordings are a fixed in-file list per axis and the record carries the
 *     per-wording verdicts it counted, so the number can be recomputed by hand
 *     from what the record says. It is a description of the title's wording. It
 *     is not a measurement of any audience and not a prediction. The plan says
 *     so in its own data (`heuristic`) and the surface renders that declaration
 *     rather than a summary of it.
 *
 *  3. NO TITLE THE RULES DID NOT PRODUCE. A title is a fixed in-file template
 *     with the project's own words substituted into it, and the option carries
 *     the template with its placeholders (`templateText`) plus every fragment's
 *     row, field and character span. A category this project cannot fill is
 *     empty and says why, and a duplicate is dropped rather than re-listed.
 *
 * THE "VIRAL-STYLE" CATEGORY, resolved rather than papered over: the brief names
 * it, so it appears — but under a description of the actual thing it names,
 * which is a WORDING PATTERN (short, front-loaded lines that withhold the
 * payoff). The category record carries the brief's own word as a declared label
 * (`specCategoryName`) beside a one-line definition and a plain statement that
 * nothing about how the wording is received is known or promised. See ./audit
 * for the single, narrow, counted exemption that lets a NAME through while the
 * banned-claims list stays exactly as strict as it was for real claims.
 *
 * ONE INVARIANT WORTH NAMING, and now ENFORCED rather than asserted: no sentence
 * this app writes in this module embeds the project's own characters without
 * declaring them. The honesty audit scans every app-authored sentence for banned
 * claims, and a project whose own text contains one of those phrases must not
 * fail a build — so the project's words travel only inside `text`-shaped values
 * that declare their origin, and where a measurement genuinely has to name one of
 * the title's own words, the word is carried as a declared QUOTATION beside the
 * verdict (see ./quotation) rather than interpolated into the sentence. Two
 * measured lines broke this before P7-3b and are fixed here; the audit now checks
 * the substitution instead of trusting the producer. The same rule is applied to
 * a provider's own answer.
 *
 * The model-backed path is separate and honest: `modelPath` records what the
 * app's AI orchestrator actually answered for the `seo_generation` capability.
 * With no provider wired and keyed it is GATED and names the env var, and no
 * title is attributed to a model.
 */
import { derived, emptyNoInput, gatedProvider, type Field, type SourceRef, type TextOrigin } from "./provenance";
import { quotation, quotedFragment, type Quotation } from "./quotation";
import { tokenize, STOPWORDS, MIN_TOKEN_LENGTH, type KeywordPlan } from "./keywords";
import type { PublishingSource } from "./types";
import { PROVIDER_SCREEN_STATEMENT, type ProviderScreenSummary, type ProviderValueKind } from "./provider-text";

/* ------------------------------------------------------------------ */
/* Categories — the brief's six, as a fixed in-file list                */
/* ------------------------------------------------------------------ */

export const TITLE_CATEGORY_IDS = [
  "seo",
  "curiosity",
  "attention_pattern",
  "emotional",
  "educational",
  "search_focused",
] as const;

export type TitleCategoryId = (typeof TITLE_CATEGORY_IDS)[number];

/** The minimum the brief asks for. Carried in the payload and compared, never assumed. */
export const TITLE_MINIMUM = 20;

/**
 * The brief's own name for the attention-pattern category. It is a declared
 * LABEL on the category record (never app prose — see ./audit) and it is always
 * carried together with `specCategoryDisclaimer`.
 */
export const SPEC_CATEGORY_LABEL = "Viral-style";

export const SPEC_CATEGORY_DISCLAIMER =
  "This is the brief's own name for one category of wording, kept so a reader can see which requested category this is. " +
  "It names a PATTERN of phrasing and promises nothing: this product holds no data about how any wording is received, " +
  "no wording here is claimed to do anything, and no outcome is predicted here for any title in this package.";

export interface TitleCategoryDefinition {
  id: TitleCategoryId;
  /** This app's label for the category. */
  label: string;
  /** One line: the wording pattern this category means. */
  definition: string;
  /** Plain statement of what the category does not claim. */
  promises: string;
  /** The brief's own word for this category, where it has one. */
  specCategoryName: string | null;
}

export const TITLE_CATEGORIES: readonly TitleCategoryDefinition[] = [
  {
    id: "seo",
    label: "SEO",
    definition:
      "Wording that states the subject plainly and completely, so a reader sees what the video is about without interpreting anything.",
    promises:
      "A plain statement of subject. Nothing here is claimed about how findable the wording is, and this product holds no data about that.",
    specCategoryName: null,
  },
  {
    id: "curiosity",
    label: "Curiosity",
    definition:
      "Wording that defers its payoff: the subject is named, but not in the first word, and an open-ended wording holds the sentence open.",
    promises:
      "A shape of phrase. Whether it interests anyone is not measured, not known and not promised here.",
    specCategoryName: null,
  },
  {
    id: "attention_pattern",
    label: "Attention-pattern wording",
    definition:
      "Short, front-loaded lines that name the subject in as few words as possible and put the point in the first two words.",
    promises:
      "A shape of phrase, and nothing else. This category is not a prediction, not a claim about reach and not a promise about how any title is received.",
    specCategoryName: SPEC_CATEGORY_LABEL,
  },
  {
    id: "emotional",
    label: "Emotional",
    definition:
      "Wording that names stakes rather than facts: what was at risk, what was lost, and who it happened to.",
    promises:
      "A shape of phrase. It does not assert what anyone will feel, and no such measurement exists in this product.",
    specCategoryName: null,
  },
  {
    id: "educational",
    label: "Educational",
    definition:
      "Wording that offers an explanation: how something works, or the order in which it can be understood.",
    promises:
      "A shape of phrase describing the video's own explanatory framing. It claims nothing about what a viewer will learn.",
    specCategoryName: null,
  },
  {
    id: "search_focused",
    label: "Search-focused",
    definition:
      "Wording built from this project's own extracted phrases, close to the plain noun form a viewer would type.",
    promises:
      "A shape of phrase built from this project's own words. This product has no search data of any kind and claims none here.",
    specCategoryName: null,
  },
];

export function titleCategoryDefinition(id: TitleCategoryId): TitleCategoryDefinition {
  const found = TITLE_CATEGORIES.find((c) => c.id === id);
  if (!found) throw new Error(`titleCategoryDefinition(): unknown category "${id}"`);
  return found;
}

/* ------------------------------------------------------------------ */
/* Templates — the only place a title's app-authored words live         */
/* ------------------------------------------------------------------ */

export interface TitleTemplate {
  id: string;
  category: TitleCategoryId;
  /** The template, with its placeholders. This is the text the audit scans. */
  text: string;
  /** True when the template needs a Chapter.title, so it is skipped without one. */
  needsChapter?: boolean;
}

export const TITLE_TEMPLATES: readonly TitleTemplate[] = [
  /* seo */
  { id: "seo-1", category: "seo", text: "The Complete Story Of {TOPIC}" },
  { id: "seo-2", category: "seo", text: "{SUBJECT}: Everything Explained" },
  { id: "seo-3", category: "seo", text: "{TOPIC}: A Full Breakdown" },
  { id: "seo-4", category: "seo", text: "{SUBJECT}: What Happened, Start To Finish" },
  { id: "seo-5", category: "seo", text: "{CHAPTER} — The Whole Chapter" , needsChapter: true },
  /* curiosity */
  { id: "curiosity-1", category: "curiosity", text: "Why {TOPIC} Still Matters" },
  { id: "curiosity-2", category: "curiosity", text: "The Story Behind {TOPIC}" },
  { id: "curiosity-3", category: "curiosity", text: "What {TOPIC} Leaves Unanswered" },
  { id: "curiosity-4", category: "curiosity", text: "{SUBJECT}: The Part That Gets Left Out" },
  { id: "curiosity-5", category: "curiosity", text: "Before You Decide About {TOPIC}" },
  /* attention_pattern */
  { id: "attention-1", category: "attention_pattern", text: "Start Here: {TOPIC}" },
  { id: "attention-2", category: "attention_pattern", text: "{TOPIC}, In Short" },
  { id: "attention-3", category: "attention_pattern", text: "{TOPIC}: The Fast Version" },
  { id: "attention-4", category: "attention_pattern", text: "Cut To It: {SUBJECT}" },
  { id: "attention-5", category: "attention_pattern", text: "{SUBJECT} — Straight To The Point" },
  /* emotional */
  { id: "emotional-1", category: "emotional", text: "The Human Side Of {TOPIC}" },
  { id: "emotional-2", category: "emotional", text: "What Was Lost In {TOPIC}" },
  { id: "emotional-3", category: "emotional", text: "The Cost Of {TOPIC}" },
  { id: "emotional-4", category: "emotional", text: "{SUBJECT}: The Moments That Matter" },
  { id: "emotional-5", category: "emotional", text: "When {TOPIC} Was Decided" },
  /* educational */
  { id: "educational-1", category: "educational", text: "How {TOPIC} Works" },
  { id: "educational-2", category: "educational", text: "{TOPIC}, Explained Step By Step" },
  { id: "educational-3", category: "educational", text: "The Basics Of {TOPIC}, In Order" },
  { id: "educational-4", category: "educational", text: "{SUBJECT}: A Walkthrough" },
  { id: "educational-5", category: "educational", text: "Understanding {TOPIC} From The Beginning" },
  /* search_focused */
  { id: "search-1", category: "search_focused", text: "{TOPIC} Explained" },
  { id: "search-2", category: "search_focused", text: "{TOPIC}: Full Overview" },
  { id: "search-3", category: "search_focused", text: "{TOPIC}: Key Points In Order" },
  { id: "search-4", category: "search_focused", text: "{SUBJECT} Explained" },
  { id: "search-5", category: "search_focused", text: "{TOPIC}: A Complete Overview" },
];

/** The placeholders a template may use, so a fragment can never be invented. */
export const TITLE_PLACEHOLDERS = ["{SUBJECT}", "{TOPIC}", "{CHAPTER}"] as const;
export type TitlePlaceholder = (typeof TITLE_PLACEHOLDERS)[number];

/** Small words left lower-case when this app title-cases a phrase. Fixed, in-file. */
export const TITLE_SMALL_WORDS = ["a", "an", "and", "for", "in", "of", "on", "the", "to"] as const;

/** How many words a "short line" is allowed, for the two axes that count it. */
export const SHORT_LINE_WORDS = 9;
/** The character bound the clarity axis counts against. */
export const CLARITY_CHAR_BOUND = 70;
/** The word bound the clarity axis counts against. */
export const CLARITY_WORD_BOUND = 12;

/* ------------------------------------------------------------------ */
/* The six axes — fixed feature lists, each evaluated by a stated test  */
/* ------------------------------------------------------------------ */

export const TITLE_AXIS_IDS = [
  "search_relevance",
  "curiosity",
  "clarity",
  "emotional_appeal",
  "topic_relevance",
  "click_potential",
] as const;

export type TitleAxisId = (typeof TITLE_AXIS_IDS)[number];

export interface TitleAxisDefinition {
  id: TitleAxisId;
  /** The brief's own name for this axis. */
  label: string;
  /** What the axis counts, in one line. */
  about: string;
  /** The five named wordings, in fixed order. */
  features: readonly { id: string; label: string }[];
  /** What the words the axis counts are, and where the list comes from. */
  featureSource: string;
  /** Plainly, what this number is not. Rendered on the surface. */
  notA: string;
}

/** The fixed list of open-ended wordings the curiosity axis counts. In-file. */
export const CURIOSITY_OPEN_WORDS = ["still", "behind", "unanswered", "left", "out", "before", "story"] as const;
/** The fixed list of stake wordings the emotional axis counts. In-file. */
export const EMOTIONAL_STAKE_WORDS = ["cost", "costs", "lost", "human", "matters", "moments", "decided", "decide"] as const;
/** The fixed list of openings the click-potential axis counts. In-file. */
export const ATTENTION_OPENING_WORDS = [
  "why", "what", "how", "when", "who", "start", "cut", "before", "understanding", "watch", "read", "see",
] as const;
/** The fixed list of interrogative openings the curiosity axis counts. In-file. */
export const INTERROGATIVE_WORDS = ["why", "what", "how", "when", "who"] as const;

export const TITLE_AXES: readonly TitleAxisDefinition[] = [
  {
    id: "search_relevance",
    label: "Search relevance",
    about: "How much of this title's wording is phrases this package already extracted from the project's own text.",
    features: [
      { id: "listed_phrase_in_title", label: "One of this project's listed phrases appears in the title" },
      { id: "primary_phrase_in_title", label: "The project's highest-weighted listed phrase appears in the title" },
      { id: "two_listed_phrases_in_title", label: "Two or more distinct listed phrases appear in the title" },
      { id: "three_word_phrase_in_title", label: "A three-word listed phrase appears in the title" },
      { id: "primary_phrase_words_complete", label: "Every word of the highest-weighted listed phrase appears in the title" },
    ],
    featureSource:
      "The phrases are the ones this same package extracted from this project's stored text (see the Keywords section of this package). " +
      "No external word list, no search tool and no search data of any kind is consulted.",
    notA:
      "This is a count of the project's own phrases inside the title. It is not search volume, keyword difficulty, competition, trend or " +
      "estimated traffic, and it is not a prediction of how findable the title is.",
  },
  {
    id: "curiosity",
    label: "Curiosity",
    about: "How many of five named open-ended wordings of the title are present.",
    features: [
      { id: "opens_with_interrogative", label: "The title opens with why, what, how, when or who" },
      { id: "payoff_not_front_loaded", label: "The title does not begin with the project's subject phrase" },
      { id: "open_wording_present", label: "The title contains one of this app's fixed open-ended wordings" },
      { id: "short_line", label: `The title is ${SHORT_LINE_WORDS} words or fewer` },
      { id: "addresses_the_reader", label: "The title says you or your" },
    ],
    featureSource:
      "The open-ended wordings are a fixed list in the title engine's own source file (still, behind, unanswered, left, out, before, story). " +
      "A reader can check each verdict against the title's own characters.",
    notA:
      "This counts shapes in the wording. Nothing here measures what a viewer feels or does, and this axis and the click-potential axis " +
      "count overlapping shapes rather than two independent things.",
  },
  {
    id: "clarity",
    label: "Clarity",
    about: "How many of five named readability-shaped wordings of the title are present.",
    features: [
      { id: "under_character_bound", label: `The title is ${CLARITY_CHAR_BOUND} characters or fewer` },
      { id: "under_word_bound", label: `The title is ${CLARITY_WORD_BOUND} words or fewer` },
      { id: "subject_stated", label: "The project's subject phrase or its highest-weighted phrase appears verbatim" },
      { id: "every_word_in_project_text", label: "Every word of the title also occurs in this project's own stored text" },
      { id: "no_repeated_word", label: "No word of the title is repeated" },
    ],
    featureSource:
      "Each verdict is a count of characters, words, or occurrences of the project's own words, measured on the title as printed above it.",
    notA:
      "This is a count of wording shapes. It is not a readability grade, not a measure of comprehension and not a prediction of anything.",
  },
  {
    id: "emotional_appeal",
    label: "Emotional appeal",
    about: "How many of five named stake-shaped wordings of the title are present.",
    features: [
      { id: "emotional_template", label: "The title came from the brief's emotional category" },
      { id: "stake_word_present", label: "The title contains one of this app's fixed stake wordings" },
      { id: "addresses_the_reader", label: "The title says you or your" },
      { id: "subject_stated", label: "The project's subject phrase or its highest-weighted phrase appears verbatim" },
      { id: "short_line", label: `The title is ${SHORT_LINE_WORDS} words or fewer` },
    ],
    featureSource:
      "The stake wordings are a fixed list in the title engine's own source file (cost, lost, human, matters, moments, decided, decide). " +
      "Membership of the emotional category is recorded on the title itself.",
    notA:
      "This counts words in the title. It does not assert what anyone will feel, and no measurement of an audience exists in this product.",
  },
  {
    id: "topic_relevance",
    label: "Topic relevance",
    about: "How much of the title is this project's own subject matter, traced to the rows it came from.",
    features: [
      { id: "subject_phrase_present", label: "The project's own title phrase appears in the title" },
      { id: "topic_phrase_present", label: "The project's highest-weighted extracted phrase appears in the title" },
      { id: "chapter_wording_present", label: "A content word of a chapter title appears in the title" },
      { id: "every_word_in_project_text", label: "Every word of the title also occurs in this project's own stored text" },
      { id: "every_fragment_sourced", label: "Every substituted fragment carries the row, field and character span it came from" },
    ],
    featureSource:
      "The project's own words are its title, its description, its script, its chapter and scene text, and its extracted phrases. " +
      "The last of the five verdicts reports the provenance of the title's own fragments.",
    notA:
      "This measures overlap with this project's own text and nothing else. It is not a judgement of quality and not a market metric.",
  },
  {
    id: "click_potential",
    label: "Click potential",
    about: "How many of five named attention-shaped wordings of the title are present.",
    features: [
      { id: "subject_front_loaded", label: "The title begins with the subject phrase or the highest-weighted phrase" },
      { id: "two_part_shape", label: "The title has a two-part shape, set off by a colon or a dash" },
      { id: "short_line", label: `The title is ${SHORT_LINE_WORDS} words or fewer` },
      { id: "fixed_opening_word", label: "The title opens with one of this app's fixed opening wordings" },
      { id: "wording_unique_in_package", label: "No other title in this package reads word for word the same" },
    ],
    featureSource:
      "The opening wordings are a fixed list in the title engine's own source file. Uniqueness is counted against this package's own " +
      "title list, and nothing outside this package is consulted or compared.",
    notA:
      "This is the name the brief gives this axis, and it is a count of wording shapes — not a measurement of clicks, of any audience, " +
      "or of any other video. No such data exists in this product, and none is claimed here.",
  },
];

export function titleAxisDefinition(id: TitleAxisId): TitleAxisDefinition {
  const found = TITLE_AXES.find((a) => a.id === id);
  if (!found) throw new Error(`titleAxisDefinition(): unknown axis "${id}"`);
  return found;
}

/** The plan-level statement about what a score is. Rendered on the surface. */
export const TITLE_SCORE_DECLARATION = {
  statement:
    "Every axis on a title is a count of five named wordings of that title that are present, so each axis is a whole number from 0 to 5. " +
    "Each axis record carries the five verdicts it counted, so the number can be checked by re-reading the title.",
  whatAScoreIsNot:
    "A score is a description of wording, written by a fixed rule in this app's own source file. It is not a measurement of any audience, " +
    "not a search or market metric of any kind, not a comparison with any other video, and not a prediction of how the title will be " +
    "received. No data of that kind exists in this product.",
  scale: "0 to 5 — the number of that axis's five named wordings present in the title",
  axesAreNotIndependent:
    "The curiosity and click-potential axes count overlapping wordings of the same title from two different lists, and the clarity, " +
    "emotional and topic-relevance axes share some of their wordings too. Six numbers on a title are not six independent measurements " +
    "and must not be read as a profile of anything.",
} as const;

/* ------------------------------------------------------------------ */
/* Fragments                                                           */
/* ------------------------------------------------------------------ */

export interface TitleFragment {
  placeholder: TitlePlaceholder;
  /** The characters substituted into the template. */
  text: string;
  /** The project's own characters (`source_verbatim`) or a provider's own. */
  textOrigin: "source_verbatim" | "provider_verbatim";
  sources: SourceRef[];
  /** Where the characters came from, in plain words. */
  from: string;
}

/** This app's own title-casing of a phrase. Stated, not silent. */
export function titleCasePhrase(phrase: string): string {
  const words = phrase.trim().split(/\s+/);
  return words
    .map((word, i) => {
      if (word.length === 0) return word;
      const lower = word.toLowerCase();
      if (i > 0 && (TITLE_SMALL_WORDS as readonly string[]).includes(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** One fragment per placeholder, derived from the project's own rows. */
function buildFragments(source: PublishingSource, plan: KeywordPlan): Map<TitlePlaceholder, TitleFragment> {
  const fragments = new Map<TitlePlaceholder, TitleFragment>();

  const subject = source.project.title?.trim();
  if (subject) {
    fragments.set("{SUBJECT}", {
      placeholder: "{SUBJECT}",
      text: subject,
      textOrigin: "source_verbatim",
      sources: [{ kind: "project", id: source.project.id, path: "title" }],
      from: "Project.title, character for character",
    });
  }

  const primary = plan.buckets.find((b) => b.id === "primary")?.keywords[0] ?? null;
  if (primary) {
    fragments.set("{TOPIC}", {
      placeholder: "{TOPIC}",
      text: titleCasePhrase(primary.text),
      textOrigin: "source_verbatim",
      sources: primary.sources,
      from:
        `the highest-weighted phrase this package extracted from the project's own stored text (see its row, field and character spans on ` +
        `this fragment), title-cased by R-TITLE-TEMPLATE`,
    });
  }

  const chapter = [...source.chapters].sort((a, b) => a.order - b.order)[0] ?? null;
  if (chapter && chapter.title.trim()) {
    fragments.set("{CHAPTER}", {
      placeholder: "{CHAPTER}",
      text: chapter.title.trim(),
      textOrigin: "source_verbatim",
      sources: [{ kind: "chapter", id: chapter.id, path: "title" }],
      from: `Chapter.title of the project's first chapter row (order ${chapter.order}), character for character`,
    });
  }

  return fragments;
}

/* ------------------------------------------------------------------ */
/* Text measurement                                                    */
/* ------------------------------------------------------------------ */

const STOP = new Set(STOPWORDS);

/** The title's words, lower-cased, in order (all of them, stopwords included). */
export function titleWords(text: string): string[] {
  return tokenize(text).map((t) => t.text);
}

/** The title's content words — the tokens the project's own phrase rules also keep. */
export function titleContentWords(text: string): string[] {
  return tokenize(text)
    .filter((t) => !STOP.has(t.text) && t.text.replace(/[^a-z0-9]/g, "").length >= MIN_TOKEN_LENGTH)
    .map((t) => t.text);
}

/** Every content word that occurs anywhere in this project's own stored text. */
export function projectContentWords(source: PublishingSource): Set<string> {
  const out = new Set<string>();
  const push = (text: string | null | undefined): void => {
    if (typeof text !== "string" || !text.trim()) return;
    for (const word of titleContentWords(text)) out.add(word);
  };
  push(source.project.title);
  push(source.project.description);
  push(source.settings?.tone);
  push(source.settings?.style);
  push(source.settings?.targetAudience);
  push(source.script?.title);
  push(source.script?.logline);
  push(source.script?.tone);
  push(source.script?.style);
  push(source.script?.targetAudience);
  for (const chapter of source.chapters) {
    push(chapter.title);
    push(chapter.summary);
    for (const scene of chapter.scenes) {
      push(scene.title);
      push(scene.narration);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The option                                                          */
/* ------------------------------------------------------------------ */

export interface TitleAxisFeature {
  id: string;
  label: string;
  present: boolean;
  /** The measurement that produced the verdict, in this app's own words. */
  measured: string;
  /**
   * The measurement's own characters, when it cannot be stated without naming a
   * word the title carries. `measured` then refers to it ("quoted beside this
   * verdict") and this is the declaration: the project's character, with the row,
   * field and span it was read from. Null whenever the measurement needs none —
   * see ./quotation.
   */
  measuredQuote: Quotation | null;
}

export interface TitleAxisScore {
  id: TitleAxisId;
  /** The brief's own name for the axis. */
  label: string;
  score: number;
  maxScore: number;
  /** The five verdicts this score counted. Present on every axis, always five. */
  features: TitleAxisFeature[];
  /** What the axis counts and what it is not. */
  about: string;
  notA: string;
  featureSource: string;
  /** True only when `score` equals the number of the five verdicts that are true. */
  scoreIsTheFeatureCount: boolean;
  rule: "R-TITLE-SCORE";
  sources: SourceRef[];
}

export interface TitleOption {
  id: string;
  category: TitleCategoryId;
  /** This app's label for the category (see TITLE_CATEGORIES). */
  categoryLabel: string;
  /** The title itself: a fixed template with the project's own words substituted in. */
  text: string;
  textOrigin: "template_filled";
  /** The template with its placeholders, so the substitution can be checked. */
  templateText: string;
  templateId: string;
  rule: "R-TITLE-TEMPLATE";
  /** Every fragment used, with the row, field and span it was read from. */
  fragments: TitleFragment[];
  sources: SourceRef[];
  charCount: number;
  wordCount: number;
  contentWordCount: number;
  axes: TitleAxisScore[];
  /** Who wrote the words: always this app's template plus the project's own. */
  authoredBy: "rule_template";
  note: string;
}

export interface TitleCategoryView {
  id: TitleCategoryId;
  label: string;
  definition: string;
  promises: string;
  /**
   * The brief's own name for this category, where it has one. It is a NAME, not
   * a claim, and this object always carries the disclaimer that must sit beside
   * it (see ./audit).
   */
  specCategoryName: string | null;
  specCategoryDisclaimer: string | null;
  rule: "R-TITLE-CATEGORY";
  titles: TitleOption[];
  /** Why this category holds nothing, when it does. Never null without a reason. */
  reason: string | null;
  /** Templates that could not be filled, and the input each one wanted. */
  templatesSkipped: { templateId: string; templateText: string; missing: string }[];
}

/* ------------------------------------------------------------------ */
/* Axis evaluation                                                     */
/* ------------------------------------------------------------------ */

interface AxisContext {
  text: string;
  words: string[];
  contentWords: string[];
  category: TitleCategoryId;
  fragments: TitleFragment[];
  /** Phrases from this package's own keyword plan that occur in this title. */
  matchedPhrases: { id: string; text: string; tokenCount: number }[];
  /** The id of the highest-weighted listed phrase, so a measured line can name it without quoting it. */
  primaryPhraseId: string | null;
  primaryPhrase: string | null;
  subjectPhrase: string | null;
  /**
   * The title's first word, and — when the title BEGINS with one of the
   * project's own fragments — the declaration that says whose character it is.
   * Two verdicts name that word, and when it is the project's they quote it
   * through ./quotation instead of embedding it in this app's sentence.
   */
  firstWord: string | null;
  firstWordQuote: Quotation | null;
  firstWordIsProjectText: boolean;
  projectWords: Set<string>;
  chapterWords: Set<string>;
  /** Lower-cased title texts already seen in this package. */
  seenLower: Set<string>;
  duplicate: boolean;
}

function hasWord(words: readonly string[], list: readonly string[]): boolean {
  return words.some((w) => list.includes(w));
}

function phraseInTitle(titleLower: string, phrase: string): boolean {
  return ` ${titleLower} `.includes(` ${phrase} `) || titleLower.includes(phrase);
}

/** The five verdicts for one axis, each with the measurement behind it. */
function evaluateFeatures(axis: TitleAxisId, ctx: AxisContext): TitleAxisFeature[] {
  const def = titleAxisDefinition(axis);
  const titleLower = ctx.text.toLowerCase();
  const wordCount = ctx.words.length;
  const firstWord = ctx.firstWord;
  const present: Record<string, { present: boolean; measured: string; measuredQuote?: Quotation | null }> = {};
  /**
   * The measurement line for a verdict that names the title's first word. The
   * word itself is never interpolated: when it is the project's own characters it
   * is carried as a declared QUOTATION beside the verdict, and when it is one of
   * this app's own template words the sentence says so and is scanned like any
   * other sentence this app wrote.
   */
  const firstWordMeasure = (whatIsCounted: string, verdict: boolean): { measured: string; measuredQuote: Quotation | null } => {
    if (ctx.firstWordQuote) {
      return {
        measured:
          `the title's first word is quoted beside this verdict as the project's own characters; it ` +
          `${verdict ? "is" : "is not"} ${whatIsCounted}`,
        measuredQuote: ctx.firstWordQuote,
      };
    }
    if (firstWord === null) {
      return { measured: "the title holds no words, so there is no first word to judge", measuredQuote: null };
    }
    return {
      measured:
        `first word of the title: "${firstWord}" — the first word this app's own template writes, so this is this app's ` +
        `character and not the project's; it ${verdict ? "is" : "is not"} ${whatIsCounted}`,
      measuredQuote: null,
    };
  };

  switch (axis) {
    case "search_relevance": {
      const matched = ctx.matchedPhrases;
      const primary = ctx.primaryPhrase;
      const primaryId = ctx.primaryPhraseId;
      const primaryWords = primary ? primary.split(/\s+/).filter((w) => w.length > 0) : [];
      const primaryWordsComplete =
        primaryWords.length > 0 && primaryWords.every((w) => ctx.words.includes(w) || titleLower.includes(w));
      present.listed_phrase_in_title = {
        present: matched.length > 0,
        measured:
          matched.length > 0
            ? `${matched.length} listed phrase(s) occur in the title: ${matched.map((m) => m.id).join(", ")} (each id resolves in this package's Keywords section)`
            : "no phrase listed by this package occurs in the title",
      };
      present.primary_phrase_in_title = {
        present: primary !== null && phraseInTitle(titleLower, primary),
        measured:
          primary === null
            ? "this project's text produced no highest-weighted phrase, so this verdict is false"
            : `the highest-weighted listed phrase (${primaryId ?? "unidentified"}) ` +
              `${primary !== null && phraseInTitle(titleLower, primary) ? "occurs" : "does not occur"} in the title`,
      };
      present.two_listed_phrases_in_title = {
        present: matched.length >= 2,
        measured: `${matched.length} distinct listed phrase(s) occur in the title`,
      };
      present.three_word_phrase_in_title = {
        present: matched.some((m) => m.tokenCount >= 3),
        measured: matched.some((m) => m.tokenCount >= 3)
          ? `a three-word listed phrase occurs (${matched.find((m) => m.tokenCount >= 3)?.id ?? ""})`
          : "no three-word listed phrase occurs in the title",
      };
      present.primary_phrase_words_complete = {
        present: primaryWordsComplete,
        measured:
          primaryWords.length === 0
            ? "there is no highest-weighted phrase to compare word by word"
            : `${primaryWords.length} word(s) in the highest-weighted listed phrase; ` +
              `${primaryWords.filter((w) => ctx.words.includes(w) || titleLower.includes(w)).length} of them occur in the title`,
      };
      break;
    }
    case "curiosity": {
      const interrogative = hasWord(ctx.words.slice(0, 1), INTERROGATIVE_WORDS);
      const startsWithSubject =
        (ctx.subjectPhrase !== null && titleLower.startsWith(ctx.subjectPhrase.toLowerCase())) ||
        (ctx.primaryPhrase !== null && titleLower.startsWith(ctx.primaryPhrase.toLowerCase()));
      present.opens_with_interrogative = {
        present: interrogative,
        ...firstWordMeasure("one of the interrogative words this app counts (why, what, how, when, who)", interrogative),
      };
      present.payoff_not_front_loaded = {
        present: !startsWithSubject,
        measured: startsWithSubject
          ? "the title begins with the project's own subject phrase, so the payoff is not deferred"
          : "the title does not begin with the project's own subject or highest-weighted phrase",
      };
      present.open_wording_present = {
        present: hasWord(ctx.words, CURIOSITY_OPEN_WORDS),
        measured: ctx.words.filter((w) => (CURIOSITY_OPEN_WORDS as readonly string[]).includes(w)).join(", ") ||
          "none of the fixed open-ended wordings occurs in the title",
      };
      present.short_line = { present: wordCount <= SHORT_LINE_WORDS, measured: `${wordCount} word(s); the bound is ${SHORT_LINE_WORDS}` };
      present.addresses_the_reader = {
        present: ctx.words.some((w) => w === "you" || w === "your" || w === "yours"),
        measured: ctx.words.some((w) => w === "you" || w === "your" || w === "yours")
          ? "the title addresses the reader directly"
          : "the title does not address the reader",
      };
      break;
    }
    case "clarity": {
      const repeated = ctx.words.find((w, i) => ctx.words.indexOf(w) !== i) ?? null;
      const subjectStated =
        (ctx.subjectPhrase !== null && titleLower.includes(ctx.subjectPhrase.toLowerCase())) ||
        (ctx.primaryPhrase !== null && phraseInTitle(titleLower, ctx.primaryPhrase));
      const missing = ctx.contentWords.filter((w) => !ctx.projectWords.has(w));
      present.under_character_bound = {
        present: ctx.text.length <= CLARITY_CHAR_BOUND,
        measured: `${ctx.text.length} character(s); the bound is ${CLARITY_CHAR_BOUND}`,
      };
      present.under_word_bound = {
        present: wordCount <= CLARITY_WORD_BOUND,
        measured: `${wordCount} word(s); the bound is ${CLARITY_WORD_BOUND}`,
      };
      present.subject_stated = {
        present: subjectStated,
        measured: subjectStated
          ? "the project's subject phrase or highest-weighted phrase appears verbatim in the title"
          : "neither the project's subject phrase nor its highest-weighted phrase appears in the title",
      };
      present.every_word_in_project_text = {
        present: missing.length === 0,
        measured:
          missing.length === 0
            ? `every content word of the title occurs in this project's own text (${ctx.contentWords.length} word(s) checked)`
            : `${missing.length} of the title's ${ctx.contentWords.length} content word(s) do not occur in this project's own text`,
      };
      present.no_repeated_word = {
        present: repeated === null,
        measured:
          repeated === null
            ? "no word of the title occurs twice"
            : `the word at position ${ctx.words.indexOf(repeated) + 1} of the title occurs more than once`,
      };
      break;
    }
    case "emotional_appeal": {
      const stakes = ctx.words.filter((w) => (EMOTIONAL_STAKE_WORDS as readonly string[]).includes(w));
      const subjectStated =
        (ctx.subjectPhrase !== null && titleLower.includes(ctx.subjectPhrase.toLowerCase())) ||
        (ctx.primaryPhrase !== null && phraseInTitle(titleLower, ctx.primaryPhrase));
      const reader = ctx.words.some((w) => w === "you" || w === "your");
      present.emotional_template = {
        present: ctx.category === "emotional",
        measured: `this title came from the category "${ctx.category}"`,
      };
      present.stake_word_present = {
        present: stakes.length > 0,
        measured: stakes.length > 0 ? `stake wordings present: ${stakes.join(", ")}` : "no stake wording from the fixed list occurs in the title",
      };
      present.addresses_the_reader = {
        present: reader,
        measured: reader ? "the title addresses the reader directly" : "the title does not address the reader",
      };
      present.subject_stated = {
        present: subjectStated,
        measured: subjectStated
          ? "the project's subject phrase or highest-weighted phrase appears verbatim in the title"
          : "neither the project's subject phrase nor its highest-weighted phrase appears in the title",
      };
      present.short_line = { present: wordCount <= SHORT_LINE_WORDS, measured: `${wordCount} word(s); the bound is ${SHORT_LINE_WORDS}` };
      break;
    }
    case "topic_relevance": {
      const subjectPresent = ctx.subjectPhrase !== null && titleLower.includes(ctx.subjectPhrase.toLowerCase());
      const topicPresent = ctx.primaryPhrase !== null && phraseInTitle(titleLower, ctx.primaryPhrase);
      const chapterHitAt = ctx.contentWords.findIndex((w) => ctx.chapterWords.has(w));
      const missing = ctx.contentWords.filter((w) => !ctx.projectWords.has(w));
      const sourced = ctx.fragments.every((f) => f.sources.length > 0);
      present.subject_phrase_present = {
        present: subjectPresent,
        measured: subjectPresent
          ? "the project's own title appears in the title, character for character"
          : "the project's own title does not appear in the title",
      };
      present.topic_phrase_present = {
        present: topicPresent,
        measured:
          ctx.primaryPhrase === null
            ? "there is no highest-weighted extracted phrase for this project"
            : `the highest-weighted extracted phrase ${topicPresent ? "occurs" : "does not occur"} in the title`,
      };
      present.chapter_wording_present = {
        present: chapterHitAt >= 0,
        measured:
          chapterHitAt >= 0
            ? `a content word of a chapter title occurs in the title, at word position ${chapterHitAt + 1} of the title`
            : "no content word of a chapter title occurs in the title",
      };
      present.every_word_in_project_text = {
        present: missing.length === 0,
        measured:
          missing.length === 0
            ? `every content word of the title occurs in this project's own text (${ctx.contentWords.length} word(s) checked)`
            : `${missing.length} of the title's ${ctx.contentWords.length} content word(s) do not occur in this project's own text`,
      };
      present.every_fragment_sourced = {
        present: sourced,
        measured: sourced
          ? `all ${ctx.fragments.length} substituted fragment(s) carry the row, field and span they came from`
          : "at least one substituted fragment carries no source row",
      };
      break;
    }
    case "click_potential": {
      const frontLoaded =
        (ctx.subjectPhrase !== null && titleLower.startsWith(ctx.subjectPhrase.toLowerCase())) ||
        (ctx.primaryPhrase !== null && titleLower.startsWith(ctx.primaryPhrase.toLowerCase()));
      const twoPart = /[:—–-]/.test(ctx.text);
      const opening = hasWord(ctx.words.slice(0, 1), ATTENTION_OPENING_WORDS);
      present.subject_front_loaded = {
        present: frontLoaded,
        measured: frontLoaded
          ? "the title begins with the project's subject phrase or its highest-weighted phrase"
          : "the title does not begin with the project's subject phrase or its highest-weighted phrase",
      };
      present.two_part_shape = {
        present: twoPart,
        measured: twoPart ? "the title carries a colon or a dash" : "the title carries no colon and no dash",
      };
      present.short_line = { present: wordCount <= SHORT_LINE_WORDS, measured: `${wordCount} word(s); the bound is ${SHORT_LINE_WORDS}` };
      present.fixed_opening_word = {
        present: opening,
        ...firstWordMeasure("one of this app's fixed opening wordings", opening),
      };
      present.wording_unique_in_package = {
        present: !ctx.duplicate,
        measured: ctx.duplicate
          ? "another title in this package reads word for word the same, so this option was kept once"
          : "no other title in this package reads word for word the same",
      };
      break;
    }
    default: {
      throw new Error(`evaluateFeatures(): unhandled axis "${String(axis)}"`);
    }
  }

  return def.features.map((f) => {
    const verdict = present[f.id];
    if (!verdict) throw new Error(`evaluateFeatures(): axis ${axis} has no verdict for feature ${f.id}`);
    return {
      id: f.id,
      label: f.label,
      present: verdict.present,
      measured: verdict.measured,
      measuredQuote: verdict.measuredQuote ?? null,
    };
  });
}

/** Scores one title on all six axes. The score is the count of true verdicts. */
export function scoreTitle(ctx: AxisContext, sources: SourceRef[]): TitleAxisScore[] {
  return TITLE_AXIS_IDS.map((axisId) => {
    const def = titleAxisDefinition(axisId);
    const features = evaluateFeatures(axisId, ctx);
    const score = features.filter((f) => f.present).length;
    return {
      id: axisId,
      label: def.label,
      score,
      maxScore: def.features.length,
      features,
      about: def.about,
      notA: def.notA,
      featureSource: def.featureSource,
      scoreIsTheFeatureCount: score === features.filter((f) => f.present).length,
      rule: "R-TITLE-SCORE" as const,
      sources,
    };
  });
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export type TitleModelStatus = "ok" | "not_connected" | "failed" | "rate_limited" | "timeout";

/** The narrow request fields the app's own builder would send. Declared here. */
export const TITLE_MODEL_REQUEST_FIELDS = ["transcript", "title", "keywords", "videoType", "language"] as const;

/**
 * A provider's own answer, character for character. It is NOT this app's prose
 * and it is declared as such (`textOrigin`), so the honesty audit does not
 * phrase-scan it — the same treatment the project's own words get, for the same
 * reason. Nothing else in this module ever embeds a provider's characters inside
 * a sentence of this app's own.
 */
export interface ProviderAnswer {
  textOrigin: "provider_verbatim";
  text: string;
  providerId: string;
  model: string | null;
  at: string;
}

export interface TitleModelAttempt {
  status: TitleModelStatus;
  providerId: string | null;
  model: string | null;
  latencyMs: number | null;
  at: string;
  /** The app's own orchestrator's sentence about this attempt. Our words, scanned. */
  orchestratorMessage: string | null;
  /** The provider's own answer, when it answered. Verbatim, and declared so. */
  providerAnswer: ProviderAnswer | null;
}

/** A title a provider really returned. Only such a title may be named as such. */
export interface ModelTitle {
  id: string;
  text: string;
  textOrigin: "provider_verbatim";
  providerId: string;
  model: string | null;
  /** P7-8: WHEN the provider answered — the attempt's own timestamp. */
  at?: string;
  /** P7-8: where in the provider's answer this title was read from. */
  sources?: SourceRef[];
  source: "provider_response";
}

/**
 * P7-8 — a value from the SAME provider answer that is not a title: the
 * description, a tag or a hashtag. It is the provider's own characters, declared
 * as such, and it is kept in its own list rather than merged into this app's
 * derived description, keywords or tags — so no surface can present a model's
 * words as one of the app's derived values.
 */
export interface ProviderAuthoredValue {
  id: string;
  kind: "description" | "tag" | "hashtag";
  text: string;
  textOrigin: "provider_verbatim";
  providerId: string;
  model: string | null;
  /** When the provider answered — the orchestrator's own timestamp for its attempt. */
  at: string;
  sources: SourceRef[];
}

/**
 * P7-8 — a value the provider returned and this app REFUSED TO CARRY, recorded
 * verbatim so nothing is hidden. See ./provider-text for the mechanism and why it
 * exists: a model's claim must not become an unmarked claim of this package.
 *
 * `text` and `matched.phrase` are the PROVIDER's characters and are declared so
 * (`textOrigin` sits on the record and on `matched`, under the quoted slot keys
 * `text` and `phrase` — see ./quotation). `reason` is THIS APP's sentence and is
 * phrase-scanned like all of this app's prose.
 */
export interface WithheldProviderValue {
  id: string;
  kind: ProviderValueKind;
  textOrigin: "provider_verbatim";
  text: string;
  matched: { textOrigin: "provider_verbatim"; phrase: string };
  providerId: string;
  model: string | null;
  at: string;
  /** What this app did with it: nothing. It is not one of this package's values. */
  disposition: "withheld_not_used";
  reason: string;
}

/** What the orchestrator answered. Built by titles-model.ts; mapped here. */
export interface TitlesModelOutcome {
  status: TitleModelStatus;
  attempt: TitleModelAttempt | null;
  titles: ModelTitle[];
  /**
   * P7-8: the SAME provider answer's description / tags / hashtags, verbatim and
   * declared as the provider's own characters. Kept in their own list so they are
   * never merged into this app's derived description, keywords or tags.
   */
  providerValues?: ProviderAuthoredValue[];
  /** P7-8: what the screen refused to carry, recorded verbatim with its reason. */
  withheld?: WithheldProviderValue[];
  /** P7-8: the screen's own counts and statement. */
  screen?: ProviderScreenSummary;
  /** The orchestrator's own derived env var NAMES, when it returned any. */
  requiredEnv: string[];
  /** True when nothing was attempted because no provider is wired and keyed. */
  nothingAttempted: boolean;
  /** The orchestrator's own sentence about its answer. Our words, never a provider's. */
  orchestratorMessage: string | null;
}

export interface TitlesModelPath {
  capability: "seo_generation";
  capabilityLabel: string;
  rule: "R-TITLE-MODEL-PATH";
  /** The app's own request builder, so the call can be found and read. */
  requestBuilder: string;
  /** The request's own field names, declared by that builder. */
  requestFieldNames: string[];
  /** Env var NAMES only, derived by the app's provider registry. Never values. */
  envVars: string[];
  /** The state of the model-authored title list in THIS package. */
  state: Field<number>;
  /** Provider-returned titles, verbatim. Empty today — never a placeholder list. */
  modelTitles: ModelTitle[];
  /**
   * P7-8: the same provider answer's description / tags / hashtags, verbatim and
   * attributed to the provider and model that returned them. Never merged into
   * this app's derived description or keyword lists.
   */
  providerValues: ProviderAuthoredValue[];
  /**
   * P7-8: what the screen refused to carry, verbatim with the reason — the model's
   * own claim, kept where a reader can see it and marked as withheld, never as one
   * of this package's values.
   */
  withheld: WithheldProviderValue[];
  /** P7-8: what the screen did, counted, and what it is not. */
  screen: ProviderScreenSummary;
  attempt: TitleModelAttempt | null;
  /** The orchestrator's own sentence about what it answered. */
  orchestratorMessage: string | null;
  /** Plain statement of who wrote the titles in this package. */
  authoredByModel: string;
  note: string;
}

export interface TitlePlan {
  kind: "titles";
  rule: "R-TITLE-TEMPLATE";
  categoryRule: "R-TITLE-CATEGORY";
  scoreRule: "R-TITLE-SCORE";
  countRule: "R-TITLE-COUNT";
  modelRule: "R-TITLE-MODEL-PATH";
  heuristic: typeof TITLE_SCORE_DECLARATION;
  categories: TitleCategoryView[];
  titles: TitleOption[];
  totalTitles: number;
  minimumRequested: number;
  meetsMinimum: boolean;
  axisIds: TitleAxisId[];
  axisCount: number;
  duplicatesDropped: number;
  modelPath: TitlesModelPath;
  notes: string[];
}

export interface TitlesModelPathInput {
  /** The orchestrator's answer, when it was asked. null only for the pure default. */
  outcome: TitlesModelOutcome | null;
  /** Env var NAMES the app's provider registry derives for the capability. */
  envVars: readonly string[];
}

/**
 * Maps the orchestrator's own answer into a Field-shaped state. Nothing here can
 * invent a title: a provider-returned title only exists when `status === "ok"`,
 * and any other answer produces a state that says so.
 */
export function buildTitlesModelPath(input: TitlesModelPathInput): TitlesModelPath {
  const envVars = [...input.envVars];
  const outcome = input.outcome;
  /**
   * P7-8: the provider's non-title values and what the screen withheld travel with
   * EVERY state, so a reader of a gated package sees "nothing was withheld" and a
   * reader of a keyed one sees exactly what the screen did. They are empty unless a
   * provider really answered — this app cannot withhold what nobody wrote.
   */
  const providerValues = outcome?.providerValues ?? [];
  const withheld = outcome?.withheld ?? [];
  const screen: ProviderScreenSummary = outcome?.screen ?? {
    rule: "R-SEO-PROVIDER-SCREEN",
    screened: 0,
    withheld: 0,
    statement: PROVIDER_SCREEN_STATEMENT,
  };
  const base = {
    capability: "seo_generation" as const,
    capabilityLabel: "SEO and title generation",
    rule: "R-TITLE-MODEL-PATH" as const,
    requestBuilder: "seoGenerationRouterRequest() — src/lib/publishing/titles-model.ts",
    requestFieldNames: [...TITLE_MODEL_REQUEST_FIELDS],
    envVars,
    providerValues,
    withheld,
    screen,
  };

  if (!outcome) {
    return {
      ...base,
      state: envVars.length === 0 ? emptyNoInput(
        "The model-authored title list was not asked for in this build, and this build named no provider environment variable for it, " +
          "so the state is empty rather than gated on a variable that was not derived.",
        ["a build that asks the app's AI orchestrator for the seo_generation capability and names the variables the registry derives"],
      ) : gatedProvider(
        "The model-authored title list was not asked for in this build, so this package claims nothing about a provider for it. " +
          "Every title above was produced by this app's fixed templates from this project's own rows.",
        ["a build that asks the AI orchestrator for the seo_generation capability"],
        envVars,
        { note: "No provider was asked for this capability, and no title in this package is attributed to a model." },
      ),
      modelTitles: [],
      attempt: null,
      orchestratorMessage: null,
      authoredByModel: "No title in this package was written by a model.",
      note:
        "The rule-derived titles above are produced without any provider. This entry records the model-backed path's state only.",
    };
  }

  if (outcome.status === "ok" && outcome.titles.length > 0) {
    const provider = outcome.titles[0]?.providerId ?? "unknown";
    const model = outcome.titles[0]?.model ?? null;
    const answeredAt = outcome.attempt?.at ?? outcome.titles[0]?.at ?? "unknown-time";
    return {
      ...base,
      state: derived(
        outcome.titles.length,
        "R-TITLE-MODEL-PATH",
        [{ kind: "request", id: `seo_generation:${provider}:${answeredAt}` }],
        {
          note:
            `A provider really answered: ${provider}${model ? ` (${model})` : ""} returned ${outcome.titles.length} title(s), ` +
            "recorded verbatim below and named as provider-authored." +
            (withheld.length > 0
              ? ` ${withheld.length} further value(s) from the same answer were withheld by this package's screen and are listed, ` +
                "with their reasons, beside the provider's answer."
              : ""),
        },
      ),
      modelTitles: outcome.titles,
      attempt: outcome.attempt,
      orchestratorMessage: outcome.orchestratorMessage,
      authoredByModel:
        `The ${outcome.titles.length} title(s) listed as provider-authored were written by ${provider}` +
        `${model ? ` (${model})` : ""} at ${answeredAt} and are recorded exactly as they were returned. ` +
        (providerValues.length > 0
          ? `The same answer supplied ${providerValues.length} further value(s) — description, tags, hashtags — kept in their own ` +
            "list and attributed to the same provider and model; none of them was merged into this app's derived description or keywords. "
          : "") +
        "Every other title in this package was produced by this app's own templates from this project's rows.",
      note: "A provider answered for this capability, so the model-backed list is real and is kept separate from the rule-derived titles.",
    };
  }

  if (outcome.status === "ok") {
    // The provider answered, and this package carries none of its titles as a value.
    // That is not the gated state and must not be reported as one: a provider WAS
    // reached and DID answer. Everything it returned is in `withheld`, with reasons.
    const provider = outcome.attempt?.providerId ?? withheld[0]?.providerId ?? "unknown";
    const model = outcome.attempt?.model ?? withheld[0]?.model ?? null;
    const answeredAt = outcome.attempt?.at ?? withheld[0]?.at ?? "unknown-time";
    return {
      ...base,
      state: derived(
        0,
        "R-TITLE-MODEL-PATH",
        [{ kind: "request", id: `seo_generation:${provider}:${answeredAt}` }],
        {
          note:
            `A provider really answered (${provider}${model ? ` (${model})` : ""} at ${answeredAt}) and the title list it returned ` +
            `could not be carried: ${withheld.length} value(s) were withheld by this package's screen and are listed with their reasons. ` +
            "The count above is the number of provider-authored titles this package actually carries — zero — and it is not a " +
            "statement about the provider's answer.",
        },
      ),
      modelTitles: [],
      attempt: outcome.attempt,
      orchestratorMessage: outcome.orchestratorMessage,
      authoredByModel:
        `No title in this package is carried as model-written. ${provider}${model ? ` (${model})` : ""} answered and every value it ` +
        "returned was withheld by this package's screen, so nothing it wrote is presented as a value of this package. Every title " +
        "above was produced by this app's own templates from this project's rows.",
      note:
        "A provider answered and this package carries nothing of its answer as a value. The withheld records below hold what it wrote, " +
        "character for character, marked as withheld.",
    };
  }

  if (outcome.status === "not_connected" || outcome.nothingAttempted) {
    const gateVars = envVars.length > 0 ? envVars : outcome.requiredEnv;
    if (gateVars.length === 0) {
      return {
        ...base,
        state: emptyNoInput(
          "The app's own AI orchestrator was asked for the seo_generation capability and no provider environment variable was derived " +
            "for it by this build, so the state is empty rather than gated on a variable name nobody derived.",
          ["a provider serving the seo_generation capability whose enabling environment variable the registry derives"],
        ),
        modelTitles: [],
        attempt: outcome.attempt,
        orchestratorMessage: outcome.orchestratorMessage,
        authoredByModel: "No title in this package was written by a model.",
        note: "Every title above is rule-derived; the model-backed path produced none, and no name is printed that the registry did not derive.",
      };
    }
    return {
      ...base,
      state: gatedProvider(
        "The app's own AI orchestrator was asked for the seo_generation capability and its answer was not_connected: it could not reach " +
          "a provider for it, so no request was attempted and no model-authored title exists. Nothing was simulated — this state is what " +
          "that call returned, and the environment variable names below are the ones the app's provider registry derives for the capability.",
        ["a provider wired and keyed for the seo_generation capability"],
        envVars.length > 0 ? envVars : outcome.requiredEnv,
        { note: "The app's own AI orchestrator was asked, and its own answer is recorded on this plan as it came back." },
      ),
      modelTitles: [],
      attempt: outcome.attempt,
      orchestratorMessage: outcome.orchestratorMessage,
      authoredByModel: "No title in this package was written by a model.",
      note:
        "Every title above is rule-derived. The model-backed path is gated on a provider this server cannot reach, and it says so " +
        "rather than printing a list that looks generated.",
    };
  }

  // An attempt that reached a provider and was not accepted, or any other
  // non-ok answer. The list is empty and the reason is the provider's own.
  const attempt = outcome.attempt;
  return {
    ...base,
    state: emptyNoInput(
      `The attempt to get model-authored titles did not come back accepted (${outcome.status}), so no model-authored title exists. ` +
        "The provider's own answer, where there was one, is recorded character for character on this plan's attempt, and this app adds " +
        "no interpretation to it.",
      [`a provider answer of "ok" for the seo_generation capability`],
      { note: "A rejected or failed attempt is not a title list. No title in this package is attributed to a model." },
    ),
    modelTitles: [],
    attempt,
    orchestratorMessage: outcome.orchestratorMessage,
    authoredByModel: "No title in this package was written by a model.",
    note: "The provider was reached and did not accept the request; the attempt is recorded above exactly as it was answered.",
  };
}

export interface BuildTitlePlanInput {
  source: PublishingSource;
  keywords: KeywordPlan;
  modelPath: TitlesModelPathInput;
}

/**
 * Builds the title plan. Pure: the same project text and the same orchestrator
 * answer always yield the same plan.
 */
export function buildTitlePlan(input: BuildTitlePlanInput): TitlePlan {
  const { source, keywords } = input;
  const fragments = buildFragments(source, keywords);
  const subjectPhrase = fragments.get("{SUBJECT}")?.text ?? null;
  const primaryPhrase = fragments.get("{TOPIC}")?.text ?? null;
  const projectWords = projectContentWords(source);
  const chapterWords = new Set<string>();
  for (const chapter of source.chapters) for (const word of titleContentWords(chapter.title)) chapterWords.add(word);

  // The listed phrases this package extracted, matched against each title by
  // whole-phrase occurrence. Nothing outside the package is consulted.
  const listedPhrases = keywords.keywords.map((k) => ({ id: k.id, text: k.text.toLowerCase(), tokenCount: k.tokenCount }));
  const primaryRecord = keywords.buckets.find((b) => b.id === "primary")?.keywords[0] ?? null;

  const titlesByCategory = new Map<TitleCategoryId, TitleOption[]>();
  for (const id of TITLE_CATEGORY_IDS) titlesByCategory.set(id, []);
  const skippedByCategory = new Map<TitleCategoryId, { templateId: string; templateText: string; missing: string }[]>();
  for (const id of TITLE_CATEGORY_IDS) skippedByCategory.set(id, []);

  const seen = new Set<string>();
  let duplicatesDropped = 0;
  let droppedDuplicatesInCategory = 0;

  for (const template of TITLE_TEMPLATES) {
    const category = template.category;
    const used = template.text.match(/\{SUBJECT\}|\{TOPIC\}|\{CHAPTER\}/g) ?? [];
    const missing = used.find((p) => !fragments.has(p as TitlePlaceholder));
    if (missing) {
      skippedByCategory.get(category)!.push({
        templateId: template.id,
        templateText: template.text,
        missing: `{${missing.replace(/[{}]/g, "")}} — this project has no stored value for it`,
      });
      continue;
    }

    const usedFragments = [...new Set(used)].map((p) => fragments.get(p as TitlePlaceholder)!);
    let text = template.text;
    for (const fragment of usedFragments) text = text.split(fragment.placeholder).join(fragment.text);
    // A title the template did not produce must not appear: the placeholders are
    // all resolved, or the template was skipped above.
    if (/\{[A-Z]+\}/.test(text)) {
      skippedByCategory.get(category)!.push({
        templateId: template.id,
        templateText: template.text,
        missing: "a placeholder this app does not know how to fill",
      });
      continue;
    }

    const key = text.trim().toLowerCase();
    const duplicate = seen.has(key);
    if (duplicate) {
      duplicatesDropped += 1;
      droppedDuplicatesInCategory += 1;
      continue;
    }
    seen.add(key);

    const sources = [...usedFragments.flatMap((f) => f.sources)];
    const uniqueSources: SourceRef[] = [];
    for (const ref of sources) {
      if (!uniqueSources.some((r) => r.kind === ref.kind && r.id === ref.id && r.path === ref.path && r.span?.start === ref.span?.start)) {
        uniqueSources.push(ref);
      }
    }

    const words = titleWords(text);
    const contentWords = titleContentWords(text);
    const titleLower = text.toLowerCase();
    const matchedPhrases = listedPhrases.filter((p) => phraseInTitle(titleLower, p.text));

    // The title's FIRST WORD, and whose character it is. When the title begins
    // with one of the project's own fragments, that word is the project's own
    // character: the two verdicts that name it then carry a declared quotation
    // instead of embedding it in an app-authored sentence (see ./quotation, and
    // the P7-3b defect it fixes — a project whose own text says "viral" failed
    // its own build on exactly these two lines).
    const firstWord = words[0] ?? null;
    const leadingFragment =
      firstWord === null ? null : (usedFragments.find((f) => text.toLowerCase().startsWith(f.text.toLowerCase())) ?? null);
    const firstWordQuote: Quotation | null =
      firstWord === null || leadingFragment === null
        ? null
        : quotation('first word of the title: "{WORD}"', [
            quotedFragment({
              placeholder: "{WORD}",
              text: firstWord,
              sources: leadingFragment.sources,
              from:
                `the first word of the title printed above, which is the first word of ${leadingFragment.placeholder} — ` +
                `${leadingFragment.from}`,
            }),
          ]);

    const optionIndex = (titlesByCategory.get(category)?.length ?? 0) + 1;
    const option: TitleOption = {
      id: `title-${category}-${optionIndex}`,
      category,
      categoryLabel: titleCategoryDefinition(category).label,
      text,
      textOrigin: "template_filled",
      templateText: template.text,
      templateId: template.id,
      rule: "R-TITLE-TEMPLATE",
      fragments: usedFragments,
      sources: uniqueSources,
      charCount: text.length,
      wordCount: words.length,
      contentWordCount: contentWords.length,
      axes: scoreTitle(
        {
          text,
          words,
          contentWords,
          category,
          fragments: usedFragments,
          matchedPhrases,
          primaryPhraseId: primaryRecord?.id ?? null,
          primaryPhrase,
          subjectPhrase,
          firstWord,
          firstWordQuote,
          firstWordIsProjectText: firstWordQuote !== null,
          projectWords,
          chapterWords,
          seenLower: seen,
          duplicate: false,
        },
        uniqueSources.length > 0 ? uniqueSources : [{ kind: "project", id: source.project.id, path: "title" }],
      ),
      authoredBy: "rule_template",
      note:
        `A fixed template (${template.id}) with this project's own words substituted in: ` +
        usedFragments.map((f) => `${f.placeholder} from ${f.from}`).join("; ") +
        ". No model wrote any part of this title.",
    };
    titlesByCategory.get(category)!.push(option);
  }

  const categories: TitleCategoryView[] = TITLE_CATEGORY_IDS.map((id) => {
    const def = titleCategoryDefinition(id);
    const titles = titlesByCategory.get(id) ?? [];
    const skipped = skippedByCategory.get(id) ?? [];
    return {
      id,
      label: def.label,
      definition: def.definition,
      promises: def.promises,
      specCategoryName: def.specCategoryName,
      specCategoryDisclaimer: def.specCategoryName ? SPEC_CATEGORY_DISCLAIMER : null,
      rule: "R-TITLE-CATEGORY",
      titles,
      reason:
        titles.length > 0
          ? null
          : skipped.length > 0
            ? `Nothing in this category could be produced from this project's text: ${skipped
                .map((s) => `template ${s.templateId} wanted ${s.missing}`)
                .join("; ")}. No title is written to fill the category.`
            : "No template in this category produced a title that was not already produced elsewhere in this plan.",
      templatesSkipped: skipped,
    };
  });

  const titles = categories.flatMap((c) => c.titles);
  const notes: string[] = [
    `Every title is a fixed template with this project's own words substituted in, and every option carries its template, its fragments and the row, field and span each fragment was read from. No title was written by a model and none was invented.`,
    "One of the six categories is known by a name of the brief's own choosing, and that name is kept as a declared label on the category's record, " +
      "beside a one-line definition of the wording pattern it means and a statement that it promises nothing. That name is a NAME and not a claim: " +
      "the app's rule against claims is unchanged by it, and every sentence this plan writes is still checked against that rule.",
    `A score is the count of an axis's five named wordings that are present in the title, so it is always the number of true verdicts on that axis — each verdict, and the measurement behind it, is carried beside the number.`,
    TITLE_SCORE_DECLARATION.axesAreNotIndependent,
  ];
  if (duplicatesDropped > 0) {
    notes.push(
      `${duplicatesDropped} template result(s) read word for word the same as a title already in this plan and were dropped rather than listed twice.`,
    );
  }
  if (droppedDuplicatesInCategory > 0) {
    notes.push(
      "A duplicate is dropped from the list it would have appeared in. The plan's own count is the length of the list it carries, not the number of templates.",
    );
  }
  if (titles.length < TITLE_MINIMUM) {
    notes.push(
      `This plan holds ${titles.length} title option(s), which is below the ${TITLE_MINIMUM} the brief asks for. This project's own text ` +
        "did not fill every template (see each category's reason), and no title was invented to reach the minimum.",
    );
  }

  return {
    kind: "titles",
    rule: "R-TITLE-TEMPLATE",
    categoryRule: "R-TITLE-CATEGORY",
    scoreRule: "R-TITLE-SCORE",
    countRule: "R-TITLE-COUNT",
    modelRule: "R-TITLE-MODEL-PATH",
    heuristic: TITLE_SCORE_DECLARATION,
    categories,
    titles,
    totalTitles: titles.length,
    minimumRequested: TITLE_MINIMUM,
    meetsMinimum: titles.length >= TITLE_MINIMUM,
    axisIds: [...TITLE_AXIS_IDS],
    axisCount: TITLE_AXIS_IDS.length,
    duplicatesDropped,
    modelPath: buildTitlesModelPath(input.modelPath),
    notes,
  };
}
