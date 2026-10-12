/**
 * Phase 7 Block 2 — EVERY WORD THE CREATOR STUDIO PAGE ITSELF WRITES.
 *
 * The page renders two kinds of text: text that came from the project's own rows
 * (carried on the package, and shown with its provenance) and text this app
 * writes. This file is the second kind — and nothing else on the surface may
 * write prose of its own.
 *
 * That is not a style rule, it is what makes the posture testable. The view
 * model (./studio-view) runs the package's own honesty audit over its output,
 * which scans every rule-authored string for BANNED_CLAIMS — so a banned phrase
 * in this file fails a build, not a review. On top of
 * that, `studio-copy.test.ts` asserts two things this file must hold:
 *
 *   1. no string here contains a banned claim, and none promises anything about
 *      a later block or a date;
 *   2. no string here NAMES a market metric at all. The metrics this product does
 *      not have are named in exactly one place a user can see — the package's own
 *      `absentData` declaration, rendered as data — never in the app's prose.
 *
 * Present tense, what this build does. No forward promises.
 */

/** One-line page description, shown under the title. */
export const PAGE_DESCRIPTION =
  "The publishing package this project has been derived into and saved on this server: chapters with their summed timings, a description, keywords, tags, hashtags, a pinned comment and the licence data of the project's own assets. Every value here is either derived from this project's rows by a named rule or deliberately empty and saying which input is missing.";

export const PAGE_TITLE = "Creator Studio";

/** What the build action does, stated before it is pressed. */
export const BUILD_ACTION_LABEL = "Build a new version";
export const BUILD_ACTION_BUSY_LABEL = "Building…";
export const BUILD_ACTION_NOTE =
  "Builds a package from this project's current rows and saves it as a new, append-only version. An earlier version is never overwritten, and no model is called.";

/** What the build action reports, in this app's own words. */
export const BUILD_RESULT_COPY = {
  savedPrefix: "Version",
  savedSuffix: "was built from this project's rows and saved. Reload this page to read it back.",
  noVersion: "The server answered without a saved version, so nothing is claimed about this build.",
  failed: "The build request failed.",
} as const;

export const NOTHING_SAVED_TITLE = "No package has been saved for this project yet";
export const NOTHING_SAVED_BODY =
  "Nothing is shown here about chapters, description, keywords, tags, hashtags, the pinned comment or asset licences, because this project has no saved package to show. Press the button below to derive one from this project's own rows.";
export const NOTHING_SAVED_REQUIRES = "a saved publishing package for this project";

/** The three states a value on this page can be in, in the app's own words. */
export const STATE_CHIP = {
  derived: "Derived",
  empty_no_input: "Empty — input missing",
  gated_provider: "Gated — provider not connected",
} as const;

export const STATE_LEGEND_TITLE = "How to read a value here";
export const STATE_LEGEND = [
  "Derived — the value was computed from this project's own rows by one named rule. Open “Derived from” under any value to see the rule, what the rule does, and the row and field it read.",
  "Empty — input missing — the value this rule would produce has no input on this project, so the value is withdrawn and the words here name the missing input instead of filling it.",
  "Gated — provider not connected — the value would need a model or a provider this server cannot reach, so nothing is written for it and the provider environment variable it would need is named.",
] as const;

export const PROVENANCE_SUMMARY = "Derived from";
export const PROVENANCE_RULE_LABEL = "Rule";
export const PROVENANCE_SOURCES_LABEL = "Read from";
export const PROVENANCE_NOTE_LABEL = "Rule note";
export const PROVENANCE_TEMPLATE_LABEL = "Template with its placeholders";
export const PROVENANCE_ORIGIN_LABEL = "Characters";
export const PROVENANCE_REQUIRES_LABEL = "Needs";
export const PROVENANCE_ENV_LABEL = "Provider environment variable";
export const ORIGIN_PHRASE = {
  source_verbatim: "copied character for character from the project's own row",
  rule_authored: "written by the rule named here",
  template_filled: "a fixed template with the project's own text substituted in",
  provider_verbatim: "the provider's own answer, recorded character for character",
} as const;

/** Section headings and what each section is. */
export const SECTION_COPY = {
  package: {
    title: "Package",
    basis:
      "The package this page is showing, and the counts it recorded about itself when it was built.",
  },
  chapters: {
    title: "Chapters and timings",
    basis:
      "Every chapter row on this project, in its stored order, with the start and length that the chapters' own scene durations add up to.",
  },
  description: {
    title: "Description",
    basis:
      "The description this project's own text and structure compose, section by section. A section with no input on this project is listed as left out, with the input it wanted.",
  },
  titles: {
    title: "Titles",
    basis:
      "Every title here is produced by a named rule from this project's own words: each option is a fixed template with the project's own phrases " +
      "substituted in, and it carries its template with its placeholders, the rows it read, and every fragment's character span. Each title is scored " +
      "on the six axes the brief asks for, and every score is a COUNT of five named wordings of that title — a description of the wording, not a " +
      "measurement of anyone, not a comparison with any other video, and not a prediction.",
  },
  keywords: {
    title: "Keywords",
    basis:
      "Phrases taken from this project's own stored text, in five named groupings. The only numbers on a keyword are how often it occurs in this project's text and the stated weights of those occurrences.",
  },
  tags: {
    title: "Tags",
    basis:
      "The tag line, budgeted against the platform's published limit, with the phrases that did not fit listed rather than dropped.",
  },
  hashtags: {
    title: "Hashtags",
    basis:
      "Hashtags formed from this project's own phrases, with the ones this app places in the description separated from the ones it produces and does not place.",
  },
  pinnedComment: {
    title: "Pinned comment",
    basis:
      "A comment selected from a fixed set of templates by the structure this project really has, with this project's own derived topic phrase substituted in.",
  },
  licences: {
    title: "Asset licences",
    basis:
      "The licence record of every asset on this project. An asset whose licence row this app does not hold is reported as unknown and unverified — never as usable.",
  },
  absent: {
    title: "The data this product does not have",
    basis:
      "The package's own declaration, carried in the package's data and shown here unchanged. This app writes no value of its own in this section.",
  },
  gated: {
    title: "What this package does not contain",
    basis:
      "Named parts of the publishing work that this package deliberately leaves out, each with the reason it is not here and what it would need. None of them is produced by this page, and none is described as though it works.",
  },
  audit: {
    title: "The package's own check",
    basis:
      "The check the package runs over itself when it is built, and the same check re-run on the stored bytes when this page reads them back.",
  },
  versions: {
    title: "Saved versions",
    basis: "Every package saved for this project, newest first. A build adds a version; nothing is overwritten.",
  },
  fieldStates: {
    title: "Values on this page by state",
    basis: "How the values counted by the package's own check ended up.",
  },
} as const;

export const LICENCE_COPY = {
  notClearanceTitle: "What this is not",
  notClearance:
    "These are licence records read from this project's own rows. They are not legal clearance, not a permission and not advice, and this page adds no assessment of its own to them.",
  notClearanceFootnote: "Nothing on this page is a claim that a video may be published.",
  verifiedLabel: "Licence row held",
  unknownLabel: "No licence row — unknown and unverified",
  unknownEntryNote:
    "This app holds no licence row for this asset. Every licence field below is empty because no value exists for it, and whether attribution is required is unknown rather than false.",
} as const;

/** The empty-view lines that are the page's own words. */
export const EMPTY_VIEW_COPY = {
  versionsTitle: "Saved versions",
  versionsEmpty: "No version of a publishing package is stored for this project.",
  savedVersionTitle: "Saved versions",
} as const;

export const AUDIT_COPY = {
  buildTimeLabel: "Checked when the package was built",
  readTimeLabel: "Re-checked when this page read the stored bytes",
  ok: "No violation found",
  violations: "violations found",
  inspectedKeys: "object keys inspected",
  inspectedStrings: "text values inspected",
  quotedSentencesLabel: "sentences exempted as a verified quotation",
  quotedFragmentsLabel: "project characters declared inside those sentences",
  unverifiedTemplateFillsLabel: "template-filled values scanned (no quotation declared)",
  whatItChecks:
    "The check refuses a value that carries a rule outside this app's rule list, a derived value with no source row, an empty value with no reason or no named missing input, and a key shaped like a market metric. It also refuses a banned claim in text this app wrote.",
} as const;

export const SUMMARY_COPY = {
  title: "What this package holds",
  emptyFieldsLabel: "Values withdrawn for a missing input",
} as const;

export const VALUE_LABELS = {
  projectTitle: "Project title",
  derivedAt: "Derived at",
  format: "Package format",
  version: "Version",
  payloadBytes: "Stored size",
  sourceFingerprint: "Source fingerprint",
  chapterBlock: "Chapter block",
  coverage: "Timed span of all chapters",
  timingBasis: "How the timings were summed",
  descriptionText: "Assembled description",
  descriptionLength: "Description length",
  descriptionLimit: "Published description limit",
  descriptionWithinLimit: "Within the published limit",
  tagLine: "Tag line",
  tagCount: "Tags",
  tagCharacters: "Tag characters",
  tagBudget: "Published tag budget",
  withinBudget: "Within the tag budget",
  hashtagLine: "Hashtags placed in the description",
  hashtagCount: "Hashtags produced",
  hashtagLimit: "Hashtag limit applied here",
  pinnedCommentText: "Comment",
  pinnedCommentTheme: "Topic phrase in the comment",
  pinnedCommentTemplate: "Template used",
  pinnedCommentAuthorship: "Who wrote the words",
  licenceStatement: "The package's statement about this data",
  licenceCounts: "Licence rows on this project",
  chapterTitle: "Chapter title",
  chapterSummary: "Chapter summary",
  chapterStart: "Start",
  chapterLength: "Length",
  sceneTitle: "Scene title",
  sceneNarration: "Scene text",
  sceneLength: "Scene length",
  keywordOccurrences: "In this project's text",
  licenceProvider: "Licence provider",
  licenceType: "Licence type",
  licenceAttributionRequired: "Attribution required",
  licenceAttributionText: "Attribution text",
  licenceUrl: "Licence URL",
  licencePurchasedAt: "Purchased on",
  licenceExpiresAt: "Expires on",
  licenceExpired: "Expired",
  licenceVerification: "Licence record",
  licenceRowId: "Licence row",
  assetId: "Asset id",
  titleText: "Title",
  tagPhrase: "The phrase in this tag",
  hashtagText: "The hashtag",
  measuredQuote: "The characters quoted in that verdict",
  measuredQuoteLabel: "Project characters in a measurement",
  measuredQuoteNote:
    "A measurement above names a word the title itself carries. When that word is the project's own characters they are shown here as " +
    "QUOTED PROJECT TEXT — declared, attributed to the row they were read from, and never written into a sentence of this app's own. When " +
    "the word is one of this app's own template words, the measurement says so instead and nothing is quoted.",
} as const;

/** Shown when a licence column is empty on an asset that does have a row. */
export const LICENCE_ROW_EMPTY_NOTE =
  "The licence row exists and holds nothing in this column. The record does not say, which is not the same as a value of none.";

/** The chip for a part of the publishing work that is deliberately not in a package. */
export const NOT_IN_PACKAGE_CHIP = "Not in this package";
export const NOT_IN_PACKAGE_NEEDS_PROVIDER = "Would need a connected provider";
export const NOT_IN_PACKAGE_NO_PROVIDER = "Would need no provider";
export const NOT_IN_PACKAGE_BLOCK_LABEL = "Belongs to";
export const NOT_IN_PACKAGE_ENV_LABEL = "Provider environment variable it would need";

/* ------------------------------------------------------------------ */
/* P7-3 — the titles section's own words                               */
/* ------------------------------------------------------------------ */

/**
 * Composed around the title plan's own data, so the surface writes no sentence
 * about a score that the plan's data does not already carry.
 */
export const TITLE_COPY = {
  axisLabelSuffix: "— count of named wordings",
  scoreWord: "of",
  scoreScaleWord: "named wordings present",
  categoryTitlesLabel: "Titles in this category",
  categoryDefinitionLabel: "What this category means",
  categoryPromiseLabel: "What this category does not claim",
  categorySpecNameLabel: "The brief's name for this category",
  categorySpecDisclaimerLabel: "Why that name can appear here",
  categorySpecNameNote:
    "A name, kept so a reader can see which requested category this is. It sits beside the definition above and the statement below it, and it is " +
    "not a claim about the wording.",
  categoryEmptyRequires: "this project's own stored text, in a form one of this category's fixed templates can use",
  templateLabel: "Template",
  templateNoteSuffix: "shown with its placeholders, so the substitution above can be checked against it.",
  titleTextLabel: "Title",
  titleCategoryLabel: "Category",
  titleAuthoredByLabel: "Who wrote the words",
  titleRuleNote:
    "A fixed template with this project's own words substituted in. No model wrote any part of this title.",
  axisVerdictsLabel: "The five named wordings counted on this axis",
  axisVerdictYes: "present",
  axisVerdictNo: "not present",
  modelPathLabel: "Model-authored titles (seo_generation capability)",
  modelRequestFieldsLabel: "Fields the app's request builder would send",
  modelRequestBuilderLabel: "The app's request builder for that call",
  modelAttemptLabel: "What the app's AI orchestrator answered for this build",
  modelAttemptNone: "No attempt was recorded for this build.",
  modelTitlesLabel: "Titles a provider returned, verbatim",
  modelTitlesNone:
    "None. No title in this package was returned by a provider, and no title is presented as though one was.",
  heuristicLabel: "How a score is produced",
  notAMeasurementLabel: "What a score is not",
  scaleLabel: "The scale a score is on",
  independenceLabel: "The six numbers on a title",
  whoWroteLabel: "Who wrote the titles in this package",
  countLabel: "Title options in this package",
  minimumLabel: "The minimum the brief asks for",
  meetsMinimumLabel: "The minimum is met",
  categoriesLabel: "Categories the brief asks for",
  categoriesEmptyLabel: "Categories this project's text could not fill",
  duplicatesLabel: "Template results dropped as duplicates",
  olderVersionReason:
    "This saved version of the package was built before the title engine existed, so it carries no title options. Nothing is shown in " +
    "their place: build a new version from this project's own rows to derive the titles, and this section will hold them.",
} as const;

export const START_EMPTY_HINT =
  "Timings are withdrawn for the whole package when any scene on the project has no stored duration, so no chapter start is shown rather than a start computed from the scenes that do have one.";
/* ------------------------------------------------------------------ */
/* P7-3b — a quotation, shown on the page as the project's own text    */
/* ------------------------------------------------------------------ */
/**
 * The words this page uses when a value's characters are the PROJECT's, not this
 * app's. A value whose declared `textOrigin` is `template_filled` and which
 * carries fragments is a fixed template of this app's with the project's own
 * characters substituted in; `./audit` verifies the substitution against the rows
 * the value names before it exempts the value from the banned-claims scan (see
 * `./quotation`). This copy exists so that distinction is visible in the value
 * itself, not only in the provenance block underneath it.
 */
export const QUOTED_PROJECT_TEXT_COPY = {
  /** The marker chip that sits on a value whose characters are the project's. */
  chip: "Quotes the project's own text",
  /**
   * Printed directly under such a value. It has to do two jobs at once: say that
   * the highlighted characters are the project's and not this app's, AND say that
   * the unhighlighted remainder is this app's own fixed wording — otherwise a
   * reader could take the whole sentence for the project's.
   */
  authorship:
    "The highlighted characters are this project's own, character for character: this app did not write them and makes no claim in them. The unhighlighted wording around them is this app's own fixed template, and both are attributed under “Derived from” below.",
  /** Shown when the value also declares the app's own template around them. */
  templatePrefix: "This app's own template, with the placeholder those characters took the place of:",
} as const;
