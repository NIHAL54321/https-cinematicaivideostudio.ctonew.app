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
      "The licence record of every asset on this project, and its own origin row: the stock provider, image or video generation, or voiceover row that records where the asset came from. An asset whose licence row this app does not hold is reported as unknown and unverified — never as usable.",
  },
  screening: {
    title: "Content screening",
    basis:
      "Seven risk areas, each screened by a named rule over this project's own text, and each reporting what no capability in this app can examine. A flag names the row, the field, the exact character span, the characters themselves and what a person has to check. These are flags for a person, not findings: read the statement below before reading any of them.",
  },
  absent: {
    title: "The data this product does not have",
    basis:
      "The package's own declaration, carried in the package's data and shown here unchanged. This app writes no value of its own in this section.",
  },
  quality: {
    title: "Quality check",
    basis:
      "Each named check below reads this project's own rows and, where one exists, the produced file. Every one reports pass, fail, or not measured, " +
      "with the measurement that produced it; the score below is arithmetic over the measured checks only.",
  },
  thumbnails: {
    title: "Thumbnail concepts",
    basis:
      "Every concept here is a SPECIFICATION for a thumbnail, produced by this app's own rules from this project's own rows: an overlay " +
      "text and a dominant subject read out of the project's own stored words, a background, a style, a composition and a contrast pairing " +
      "taken from fixed lists in this app's own source file, a mood token read from a value the project stores, and the frame's aspect " +
      "derived from the project's own stored target shape. No image exists for any of them, none was rendered or substituted, and the image " +
      "slot on each concept says so and names the provider it would need. The nine criteria are counts of named tokens of the specification, " +
      "not measurements of a picture.",
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

/**
 * P7-6 — the screening section's own words.
 *
 * These sentences are the reason the section cannot be read as approval. They are
 * phrase-scanned by the honesty audit like every other sentence this app writes
 * (see ./audit), so the wording that says "not clearance" can never be softened by
 * a later edit without the check failing.
 */
export const SCREENING_COPY = {
  statementLabel: "What these flags are",
  notAPassLabel: "What a rule that found nothing means",
  notScreenedLabel: "What “not screened” means",
  clearanceLabel: "Cleared for publication",
  humanReviewLabel: "A person must review these flags",
  areasLabel: "Risk areas screened",
  flaggedAreasLabel: "Areas that raised at least one flag",
  flagsLabel: "Flags raised in total",
  quietAreasLabel: "Areas where the rule matched nothing",
  notScreenedAreasLabel: "Areas reported as not screened",
  licenceLimitsLabel: "What the licence data these rules read does not tell you",
  sectionHeading: "Screening flags, not legal clearance",
  sectionBody:
    "A flag here means a pattern matched this project's own words and a person should look at it. It does not mean the video infringes anything, and it does not mean it does not. This app has not reviewed the video, has not checked any right or permission, and has not cleared any part of the video for publication.",
  notScreenedBody:
    "The parts of these areas that need a model are reported as not screened — no capability, with what would be needed named. Read that line on every area: it is why a quiet rule must never be read as a pass.",
  reviewBody:
    "Take every flag to a person who can check it — with the video, its audio and its assets in front of them. Keep their notes with the project. Nothing here replaces that review, and nothing here is legal advice.",
  flagMatchedLabel: "Characters the rule matched",
  flagWhyLabel: "Why this rule fired",
  flagCheckLabel: "What a person must check",
  flagWhereLabel: "Where the rule read it",
  flagSpanLabel: "Character span",
  areaRuleLabel: "Rule that screened this area",
  areaReadsLabel: "What the rule read",
  areaCharactersLabel: "Characters read",
  areaFieldsLabel: "Fields read",
  areaStatusLabel: "This rule's result",
  areaFlagsLabel: "Flags in this area",
  areaFlagsNotListedLabel: "Occurrences beyond the listed flags",
  areaPatternLabel: "Pattern that matched",
  areaQuietLabel: "If this area raised no flag",
  capabilityLabel: "The part no capability in this app examines",
  capabilityRequirementLabel: "What that part would need",
  capabilityCannotLabel: "What this app cannot determine about this area",
  notScreenedRequires: "a content-moderation capability wired to a provider, which this app does not have",
  olderVersionReason:
    "This saved package was built before this app carried a screening section, so it holds no screening areas at all. Nothing is shown rather than a screening result being invented for it.",
  olderVersionRequires: ["a package built by this version of the app, which carries the screening plan"],
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
/**
 * The project's own title, and why it travels as a DECLARED QUOTATION rather than
 * as a bare string of this app's.
 *
 * The title is the project's own characters, so the view may not print it as a
 * sentence this app wrote: if it did, a project whose own title carries a phrase
 * this app's prose may not use would fail the view's own check through no fault of
 * its own — which is exactly the blank page this block fixes. So it is built
 * through the same ./quotation mechanism as every other quoted value in the
 * product, with the row it was read from, and this app's own template around it is
 * the placeholder alone: no character of the value is this app's wording.
 *
 * The two `from` lines say WHERE the characters were read, and they differ by
 * case because the two callers read different things — the stored package's own
 * value, or the project's title column on this page.
 */
export const PROJECT_TITLE_COPY = {
  fromStoredPackage:
    "the stored package's own Project title value, which that package records as read from this project's title column",
  fromProjectRow: "this project's own title column (Project.title), read by this page",
  note:
    "The characters above are this project's own title, taken from the row named under “Derived from”. This app's template for the value is the placeholder alone, so none of these characters is this app's wording and this app makes no claim in them.",
  /** Shown instead of a title when the stored package carries none to read. */
  noStoredTitle:
    "The stored package carries no project title value that this page can read, so no title is shown here. The value is not guessed from the project's name on this page either, because the package's own title is what the rest of this page was derived under.",
  noStoredTitleRequires: ["a stored package whose Project title value is derived from a row"],
} as const;
/**
 * THE STATE THE PAGE SHOWS WHEN ITS OWN CHECK FAILS.
 *
 * A failed check used to surface as a blank page with no explanation — the least
 * honest outcome available, because a reader cannot tell a broken page from an
 * empty one. This copy is the replacement: it says the view failed this product's
 * own honesty check, names the path each failed check was found at, and states
 * plainly that nothing is shown rather than showing it unchecked.
 *
 * What this state deliberately does NOT do is reprint the content that failed. The
 * paths are locations (object keys and array indices), never the characters that
 * were refused — so the state cannot present as a finding the very text that was
 * refused a place on the page. It also carries no project content at all: no
 * section, no value, no version row.
 */
export const VIEW_AUDIT_FAILURE_COPY = {
  chip: "Honesty check failed",
  title: "This page failed its own honesty check, so it shows nothing",
  body:
    "Before this page renders, the view it builds is read by this product's own honesty check: every value has to name a rule and the row it came from, and no text this app wrote may carry a claim this product cannot support. This time the view did not pass. So there are no chapters, no description, no keywords, no tags, no hashtags, no pinned comment, no titles and no licence rows on this page. This page shows nothing rather than showing those unchecked.",
  pathsLabel: "The checks that failed, by the path each was found at",
  countsLabel: "Inspected by the check",
  checkedAtLabel: "Checked at",
  note:
    "This block is a statement about this page's own check and about nothing else. It is not a finding about the project, its text, its assets or its licence rows: none of those were shown, and nothing here may be read as a statement about them.",
  requiresLabel: "What a passing view needs",
  requires: [
    "a view whose every value carries a rule, a source row and a stated text origin",
    "text this app wrote that carries no claim this product cannot support",
  ],
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
  licenceAssetId: "Asset row",
  originTable: "Origin row",
  originProvider: "Provider named on the origin row",
  originModel: "Model named on the origin row",
  externalAssetId: "Provider's own asset id",
  sourcePageUrl: "Provider's page for this asset",
  licenceLimits: "What this asset's licence record does not tell you",
  licenceLimitsReport: "What asset licence records do not tell you",
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
  /* P7-8 — the provider's own values, and what the screen refused to carry. */
  providerValueLabels: {
    description: "Description the provider returned, verbatim",
    tag: "Tag the provider returned, verbatim",
    hashtag: "Hashtag the provider returned, verbatim",
  } as Record<"description" | "tag" | "hashtag", string>,
  providerValueNote:
    "Written by the provider named above and recorded character for character. This app did not write these characters, and it does " +
    "not present them as one of its own derived values: the description, keywords and tags this package derives are listed in " +
    "their own sections and none of them is a model's.",
  screenScreenedLabel: "Provider values the screen inspected",
  screenWithheldLabel: "Provider values the screen withheld",
  screenStatementLabel: "What the screen is",
  /**
   * P7-8 — a stored package written BEFORE the screen existed carries none of the
   * screen's keys. That is rendered as a declared ABSENCE naming the format the
   * package was stored in, never as "0 inspected, 0 withheld" — which would read as
   * a screen that ran and found nothing. No metric name and no promise appears here.
   */
  screenAbsentLabel: "What the provider screen did in this package",
  screenAbsentReason: (format: string) =>
    `This package was written in format ${format}, which predates this app's provider screen, so no value in it was screened by ` +
    "that rule and this app cannot report a screen result for it. Rebuild the package to screen the provider's own answer and to " +
    "record, verbatim, anything the screen declined to carry.",
  screenAbsentRequires: ["a package built in this build's own format, whose provider answer passed the screen"],
  screenAbsentNote:
    "This is a declared absence, not a result: it does not say a provider returned nothing, and it does not say anything was screened.",
  withheldHeading:
    "Withheld — the provider's own text this package does not use",
  withheldValueLabel: (kind: string) => `Withheld ${kind} — the provider's own text, not carried`,
  withheldPhraseLabel: "The provider's own characters that triggered the screen",
  withheldNote:
    "This is the provider's own text, kept character for character so nothing is hidden, and marked here as withheld. It is NOT one " +
    "of this package's values and it is not presented as this app's wording or as a claim this product makes.",
  withheldPhraseNote:
    "The provider's own characters that the screen matched, recorded verbatim so a reader can see exactly what triggered it. This " +
    "app does not repeat them as its own wording.",
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
  /**
   * The same job for a WHOLE-VALUE COPY — a value whose entire text is one of the
   * project's own rows. There is no unhighlighted remainder here, so saying so is
   * the point: this app added no character at all, and the template below proves
   * it by being a bare placeholder.
   */
  wholeValueAuthorship:
    "This value is one of this project's own rows, copied in full and character for character: this app wrote none of it and adds no wording of its own to it. Its own template for the value is the placeholder alone, so there is nothing of this app's inside it — the characters are attributed under “Derived from” below.",
  /** The chip for a whole-value copy of a project row. */
  wholeValueChip: "A copy of the project's own text",
  /**
   * A provider's own characters are a third party's, not the project's, so a
   * surface must not describe them as the project's. Same marking, different
   * sentence.
   */
  providerChip: "A provider's own characters, recorded verbatim",
  providerAuthorship:
    "The highlighted characters are a provider's own answer, recorded verbatim and attributed under “Derived from” below: this app wrote none of them and makes no claim in them.",
  /**
   * One line under a list whose items are the project's own phrases (the keyword
   * buckets), rather than a chip on every row: the list is long, and the claim is
   * about the whole list.
   */
  markedListNote:
    "Every highlighted phrase in this list is this project's own text, copied character for character. This app wrote none of these phrases; it only counted where they occur.",
} as const;

/* ------------------------------------------------------------------ */
/* P7-4 — the thumbnail concepts section's own words                   */
/* ------------------------------------------------------------------ */

/**
 * Composed around the thumbnail plan's own data, so the surface writes no sentence
 * about a criterion that the plan's data does not already carry. Some of this copy
 * deliberately says what a value is NOT, because the image slot on every concept is
 * an absence and the criteria are checks on a specification.
 */
export const THUMBNAIL_COPY = {
  criterionLabelSuffix: "— count of named tokens",
  criterionScoreWord: "of",
  criterionScaleWord: "named tokens present",
  criterionVerdictsLabel: "The five named tokens counted on this criterion",
  criterionVerdictYes: "present",
  criterionVerdictNo: "not present",
  criterionNotALabel: "What this criterion is not",
  criterionFeatureSourceLabel: "Where the named tokens come from",
  declarationLabel: "How a criterion is produced",
  declarationNotLabel: "What a criterion is not",
  declarationScaleLabel: "The scale a criterion is on",
  declarationIndependenceLabel: "The nine numbers on a concept",
  declarationSpecificationLabel: "What these criteria are counted on",
  overlayTextLabel: "Overlay text",
  overlayRoleLabel: "The role the overlay text was read for",
  overlayWordCountLabel: "Overlay words",
  overlayCharCountLabel: "Overlay characters",
  subjectLabel: "Dominant subject",
  subjectRoleLabel: "The role the subject was read for",
  backgroundLabel: "Background specification",
  styleLabel: "Style specification",
  compositionLabel: "Composition specification",
  moodLabel: "Mood token",
  moodDeclaredLabel: "The stored value the mood was read against",
  contrastPairLabel: "Contrast pairing (declared)",
  aspectLabel: "Frame aspect",
  imageLabel: "The image",
  imageNotShownLabel: "What is standing in for an image here",
  tokensLabel: "The concept's declared tokens",
  conceptAuthoredByLabel: "Who wrote this specification",
  revisedFromLabel: "Revised from",
  conceptRuleNote:
    "A specification, produced by this app's own rules from this project's own rows. It is not a picture, and no picture exists for it.",
  ladderLabel: "The project's own overlay-text candidates",
  ladderWordCountLabel: "Words in this candidate",
  ladderRoleLabel: "The role it was read for",
  subjectLadderLabel: "The project's own subject candidates",
  countLabel: "Concepts in this package",
  minimumLabel: "The minimum the brief asks for",
  maximumLabel: "The maximum the brief asks for",
  meetsMinimumLabel: "The minimum is met",
  withinMaximumLabel: "Within the maximum",
  criteriaPerConceptLabel: "Criteria counted on every concept",
  imagesProducedLabel: "Images produced for these concepts",
  imagesProducedNote:
    "Counted by walking this plan's own concept list and counting the concepts whose image slot holds a value, so this number is the " +
    "measurement itself rather than a statement about it.",
  imageAbsenceLabel: "The image slot on every concept",
  imageNotSubstitutedLabel: "What is not standing in for an image",
  imageEnvLabel: "Provider environment variable it would need",
  imageWiredLabel: "Slots with a real call() implementation today",
  imageRequirementLabel: "What the app's provider registry says about enabling it",
  imageRequirementNone: "This build named no provider requirement for the image slot, so none is printed here.",
  recordLabel: "The Thumbnail record this app does not write",
  recordWrittenLabel: "A row was written",
  recordStatusLabel: "The generation status reported",
  recordStatusNone: "None — no row exists to report a status from",
  recordStatusesLabel: "Statuses this app refuses to write for a concept with no image",
  recordReasonLabel: "Why no row is written",
  controlsLabel: "The controls this package carries",
  controlOperatesLabel: "What it operates on",
  controlRuleLabel: "Rule it applies",
  controlCapabilityLabel: "Capability it would need",
  controlNoCapability: "None — it operates on the specification",
  olderVersionReason:
    "This saved version of the package was built before the thumbnail concepts existed, so it carries no concepts, no criteria and no " +
    "controls. Nothing is shown in their place: build a new version from this project's own rows and this section will carry them.",
  modelPathLabel: "Model-authored concepts (thumbnail_generation capability)",
  modelRequestFieldsLabel: "Fields the app's request builder would send",
  modelAttemptLabel: "What the app's AI orchestrator answered for this build",
  modelAttemptNone: "No attempt was recorded for this build.",
  modelProviderConceptsLabel: "Concepts a provider returned, verbatim",
  modelProviderConceptsNone:
    "None. No concept in this package was returned by a provider, and no concept is presented as though one was.",
  controlPanelTitle: "Thumbnail controls",
  controlPanelIntro:
    "Six of these seven controls operate on the SPECIFICATION and return a new concept derived from this project's own rows by the same " +
    "rules as the one above, with one named ladder advanced. The seventh cannot operate here: upscaling needs a provider and needs an image, " +
    "and no image exists.",
  controlPanelIdle:
    "Nothing has been pressed yet, so nothing has changed. Choosing a control and pressing it sends one request; the answer below says " +
    "exactly what moved, or exactly why nothing was produced.",
  controlChoiceLabel: "The concept to change",
  controlSelectLabel: "The control to apply",
  controlRunLabel: "Apply this control",
  controlBusyLabel: "Applying…",
  controlFailureNote:
    "The request failed, so no change is claimed. Nothing was produced and nothing was altered.",
  controlAppliedTitle: "The control was applied to the specification",
  controlAppliedNote:
    "The concept below is the revised one. It was derived again from this project's own rows, so its criteria and its image slot were " +
    "counted again rather than carried over. What changed is the specification; no image exists and nothing was produced by a provider.",
  controlRefusedTitle: "The control refused, and nothing was produced",
  controlRefusedNote:
    "This is the honest answer for this control on this concept: it had nothing to work from, or it needs a provider this server has none " +
    "of. No concept was returned, and the concept above is unchanged.",
  controlRefusedRequiresLabel: "What would be needed",
  controlRefusedEnvLabel: "Provider environment variable it would need",
  changeLabels: {
    control: "The control that ran",
    what: "What changed",
    field: "The part of the specification that moved",
    from: "From",
    to: "To",
    note: "What this change is",
    rule: "Rule applied",
    conceptFrom: "The concept it was derived from",
  },
  changeSectionTitle: "What the control changed",
  revisionSectionTitle: "The revised concept",
  refusalSectionTitle: "The control's refusal",
} as const;

/**
 * P7-5 — THE QUALITY CHECKER'S OWN WORDS.
 *
 * Every sentence the quality section renders lives here, and none of it may claim
 * that the video is good, that it will be received in any particular way, or that a
 * check which was not measured passed. The three states are named exactly as the
 * plan names them.
 */
export const CHECK_STATE_LABEL = {
  pass: "Pass",
  fail: "Fail",
  not_measured: "Not measured",
} as const;

export const QUALITY_COPY = {
  sectionBasis:
    "Every named check in this plan has a real measurement path, and the score is computed only from the checks that were actually measured. " +
    "Each check reports one of three states — pass, fail, or not measured — and every state carries the measurement sentence that produced it: " +
    "the input that was read, the value that was computed, the threshold, and where that threshold comes from. A check with no input is NOT MEASURED " +
    "and names the input it is missing; it is never reported as a pass and never counted as one.",
  scoreLabel: "The score",
  scoreBasisLabel: "What this score is over",
  scoreArithmeticLabel: "The arithmetic",
  scoreNotLabel: "What this score is not",
  scoreNoValueNote:
    "There is no score on this page, and that is the honest answer rather than a zero: a score would need at least one check that was really measured.",
  countsLabel: "Checks in the plan",
  measuredLabel: "Checks measured",
  passedLabel: "Checks that passed",
  failedLabel: "Checks that failed",
  notMeasuredLabel: "Checks not measured",
  weightLabel: "Declared weight",
  weightsTotalLabel: "The declared weights sum to",
  declarationLabel: "How a check reports",
  declarationNotALabel: "What not measured does not mean",
  declarationMeasuredLabel: "Where a measurement may come from",
  fileMeasurementLabel: "The produced-file measurement",
  loudnessMeasurementLabel: "The loudness measurement",
  timelineLabel: "The timeline these checks compare against",
  declaredTargetLabel: "The declared delivery target",
  declaredTargetNone:
    "No export job on this project declares a resolution that matches an export preset, so no delivery target was declared. The checks that compare a " +
    "measurement with a declared target say so instead of choosing one.",
  areaLabel: "Area",
  stateLabel: "State",
  measurementLabel: "The measurement behind this state",
  thresholdLabel: "The threshold it was compared with",
  thresholdSourceLabel: "Where that threshold comes from",
  readsLabel: "The input this check reads",
  missingInputLabel: "Missing input",
  missingInputsLabel: "What would make this check measurable",
  ruleLabel: "Rule applied",
  areaChecksLabel: "Checks in this area",
  areaMeasuredLabel: "Measured",
  areaNotMeasuredLabel: "Not measured",
  areaWeightLabel: "Weight of this area",
  areaWeightMeasuredLabel: "Weight measured in this area",
  notMeasuredNote:
    "NOT MEASURED is not a pass and not a failure: it means the input this check reads does not exist on this project, and the line above names it. " +
    "Nothing on this page fills a missing input with a plausible number.",
  olderVersionReason:
    "This saved package was built before the quality checker existed, so it carries no checks and no score. Build a new version to see them.",
  olderVersionRequires: ["a package built with the quality checker, which this version of the app has"],
} as const;
