/**
 * Phase 7 Block 1 — THE RULE CATALOGUE.
 *
 * Every derived value in a publishing package names the rule that produced it,
 * and this file is the one place those ids are resolved to what they actually
 * do. That is the difference between "provenance" and a decorative string: a
 * consumer can take `rule: "R-KW-WEIGHT"`, look it up here, and read the exact
 * weighting without reading the keyword code.
 *
 * Rules are declared here and imported by the modules that apply them, so a rule
 * id can never be printed that is not in this catalogue (the honesty audit
 * checks exactly that).
 */
import { CHAPTER_TIMECODE_BASIS } from "../export/chapters";

export const PUBLISHING_RULES = {
  /* ---------------------------------------------------------------- package */
  "R-PKG-SOURCE-FINGERPRINT": {
    what: "A deterministic FNV-1a 64-bit fingerprint over the ids and updatedAt stamps of every row the package was derived from.",
    basis: "Two packages built from the same rows carry the same fingerprint; a changed row changes it. No cryptographic claim is made — this is a change detector, not a signature.",
  },
  "R-PKG-COUNTS": {
    what: "Every count in `summary` is the length of the array it describes, or a walked count of the Fields in this package.",
    basis: "Counts are measured from this package's own contents at build time; none is stored, estimated or extrapolated.",
  },

  /* --------------------------------------------------------------- chapters */
  "R-CH-ORDER": {
    what: "Chapters in Chapter.order ascending, each chapter's scenes in Scene.order ascending.",
    basis: "The project's own stored narrative order. No chapter or scene is re-ordered, merged, split, added or dropped.",
  },
  "R-CH-TITLE": {
    what: "The chapter title is Chapter.title, character for character.",
    basis: "Chapter.title is a required column, so a chapter either has a title or the project has no chapters. A blank/whitespace title is reported empty-with-reason rather than filled with a positional label such as \"Chapter 1\".",
  },
  "R-CH-SUMMARY": {
    what: "The chapter summary is Chapter.summary, character for character.",
    basis: "Chapter.summary is optional; when it is null the summary is empty-with-reason and no summary text is written.",
  },
  "R-CH-TIMING": {
    what: "A chapter's start and duration are the sum of its scenes' Scene.durationSeconds in narrative order; chapter 1 starts at 0 s.",
    basis: "Only stored scene durations are summed. If ANY scene in the project has a null durationSeconds, no timing is emitted at all (empty-with-reason naming the count of scenes without a duration) — the arithmetic would otherwise be a guess about missing rows.",
  },
  "R-CH-BLOCK": {
    what: "The chapter block is one line per chapter, \"<timecode> <title>\", in chapter order.",
    basis: `${CHAPTER_TIMECODE_BASIS} The shape is the platform's published chapter-line format; this module makes no claim that the project meets the platform's minimums — see ./keywords and the section notes for what is and is not asserted.`,
  },

  /* ------------------------------------------------------------ description */
  "R-DESC-TITLE": {
    what: "The first description line is Project.title, character for character.",
    basis: "The project's own title column. Nothing is appended to it and no keyword is inserted into it.",
  },
  "R-DESC-SUMMARY": {
    what: "The summary paragraph is the FIRST of ProjectSettings.seoDefaults.description, Project.description, Script.logline that is a non-empty string.",
    basis: "Priority is the most specific stored text first: an explicit SEO description the user wrote, then the project's own synopsis, then the script's logline. The chosen source is named on the field; if none exists the section is omitted and all three missing inputs are named.",
  },
  "R-DESC-CHAPTERS": {
    what: "The chapter block from R-CH-BLOCK, verbatim.",
    basis: "Inserted only when the block exists; otherwise the section is omitted with the reason the block is empty.",
  },
  "R-DESC-HASHTAGS": {
    what: "The first HASHTAG_IN_DESCRIPTION_LIMIT hashtags from the hashtag plan, on one line.",
    basis: "Hashtags are placed once, at the end of the description; no hashtag is repeated and none is inserted into prose.",
  },
  "R-DESC-CTA": {
    what: "The call-to-action line is the caller's `callToAction` string, character for character.",
    basis: "This app stores no call-to-action field on a project, so nothing is invented for it. The slot is empty-with-reason unless the caller supplies the text, and when supplied the field is derived FROM THE REQUEST and says so.",
  },
  "R-DESC-ASSEMBLE": {
    what: "Sections in fixed order (title, summary, chapters, hashtags, call to action), separated by a blank line, with omitted sections leaving no placeholder text.",
    basis: "The assembled text is only the concatenation of its sections' own text plus blank lines, so the description can never contain a sentence that is not either the project's own text or the caller's call to action.",
  },

  /* ---------------------------------------------------------- pinned comment */
  "R-PINNED-COMMENT": {
    what: "The pinned comment is one of a small fixed set of templates, selected by which real structure the project has (chapters, then scenes, then neither), with the project's own derived topic phrase substituted in.",
    basis: "The comment is RULE-DERIVED, not model-authored: `authorship` is \"rule_derived\" and `aiAuthored` is false. The template id and the row ids it quotes (the chapter it names) are on the field.",
  },

  /* --------------------------------------------------------------- keywords */
  "R-KW-DOCUMENTS": {
    what: "The keyword corpus is the project's own stored text, one document per source field: Project.title, Project.description, Script.title, Script.logline, ProjectSettings.tone/style/targetAudience, every Chapter.title/summary and every Scene.title/narration.",
    basis: "Only rows of THIS project are read. No external corpus, no keyword database and no third-party service is consulted, so a keyword can always be traced to the characters inside this project that produced it.",
  },
  "R-KW-TOKEN": {
    what: "Text is lower-cased and split into tokens of letters, digits and internal apostrophes; every token keeps its character span in its document.",
    basis: "Deterministic and locale-independent, so the same text always yields the same tokens (and therefore the same keyword list) on any machine.",
  },
  "R-KW-STOPWORDS": {
    what: "A fixed, in-file stopword list is removed before phrases are formed.",
    basis: "The list is part of this file and is inspectable; it is never supplied by a service, so the keyword set cannot change without a commit.",
  },
  "R-KW-GRAMS": {
    what: "Candidate phrases are runs of 1 to 3 consecutive non-stopword tokens inside a document (word-count 1, 2 or 3); a run longer than three yields overlapping 3-token phrases plus their sub-phrases.",
    basis: "Phrases never span a stopword or a document boundary, so a phrase is always a contiguous string that really appears in the project's text.",
  },
  "R-KW-WEIGHT": {
    what: "Each occurrence is weighted by where it occurs: title 5, chapter title / scene title 3, logline / summary / topic 2, narration and other metadata 1. `sourceWeight` is the sum of the weights of a phrase's occurrences.",
    basis: "This is a measure of THIS PROJECT'S OWN TEXT ONLY — how prominently its own words are used. It is not search volume, difficulty, competition, trend or estimated traffic, and no such data exists anywhere in this product.",
  },
  "R-KW-BUCKETS": {
    what: "primary = the highest-`sourceWeight` 1–3-token phrases that ALSO occur in a title-role document (fallback: the highest-weight phrases, recorded as `basis: \"text_frequency\"`); secondary = the next highest-weight phrases; long-tail = phrases of three tokens; related = the remaining highest-weight phrases. A phrase appears in exactly one bucket, in descending sourceWeight within the bucket.",
    basis: "Bucket membership is a pure function of this project's text. The buckets are named groupings of the same extracted phrases — no phrase is invented to fill a bucket, and a bucket that cannot be filled from this project's text is empty and says so.",
  },
  "R-KW-SEMANTIC": {
    what: "`semantic` holds content tokens that occur in the SAME chapter or scene as the top primary phrase but are not already selected, most weighted first, each carrying the chapter/scene row ids it co-occurs in.",
    basis: "Co-occurrence is counted inside this project's own chapters and scenes — never in a search corpus.",
  },
  "R-KW-NO-MARKET-DATA": {
    what: "The keyword plan carries an explicit declaration that this product has no search-volume, difficulty, competition, trend or estimated-traffic data, and no such field exists on any keyword.",
    basis: "See ./audit: the package self-audits at build time and the build fails if any metric-shaped key can be found, so this declaration cannot drift away from the data.",
  },

  /* ------------------------------------------------------- tags & hashtags */
  "R-TAG-EXTRACT": {
    what: "Tags are the primary, secondary and long-tail phrases (in that order), then the stored project metadata (ProjectSettings.tone, .style, .targetAudience), de-duplicated case-insensitively, each keeping the provenance of where it came from.",
    basis: "Every tag is either a phrase extracted from the project's own text or a stored metadata value. No tag is added from a platform suggestion, a keyword tool or a list.",
  },
  "R-TAG-BUDGET": {
    what: "At most TAG_LIMIT tags, and at most TAG_CHAR_BUDGET characters in total; tags that would exceed either bound are reported as skipped rather than trimmed mid-word.",
    basis: "YouTube's published limits for the tags field: 15 tags and 500 characters in total. The character total is measured on the joined string, not estimated. Tags over the bound are LISTED as skipped — this app does not silently drop them.",
  },
  "R-HASHTAG-FORM": {
    what: "A hashtag is \"#\" followed by the phrase's tokens with the first letter of each token capitalised and all other characters lower-cased; tokens are joined with no separator.",
    basis: "A hashtag cannot contain a space, so the phrase's own tokens are joined. The transformation is stated and reversible back to its source phrase, which is recorded on every hashtag.",
  },
  "R-HASHTAG-BUDGET": {
    what: "At most HASHTAG_LIMIT hashtags are produced and at most HASHTAG_IN_DESCRIPTION_LIMIT are placed in the description; the rest are listed but not inserted.",
    basis: "YouTube's published behaviour: a video may carry up to 15 hashtags, more than 15 causes every hashtag to be ignored, and the first three listed appear above the title. This module produces at most the published limit and inserts only the ones that appear above the title.",
  },

  /* ---------------------------------------------------------- asset licences */
  "R-LIC-ROW": {
    what: "Provider/source, licence type, attribution text, licence URL, purchase date and expiry are copied from the asset's LicensingMetadata row.",
    basis: "One row per asset (LicensingMetadata.assetId is unique). A null column is reported empty-with-reason naming the column; it is never defaulted.",
  },
  "R-LIC-ATTR": {
    what: "`attributionRequired` is true when LicensingMetadata.attribution holds a non-empty string, and false when the row exists and the column is null/blank.",
    basis: "This is the app's own rule over the stored column, stated so a consumer can disagree with it. It is not legal advice and it is NOT used when no row exists.",
  },
  "R-LIC-EXPIRY": {
    what: "`expired` is true when LicensingMetadata.expiresAt is in the past at the moment the package was derived, false when it is in the future, and empty-with-reason when the column is null.",
    basis: "The comparison is against the derivation timestamp recorded on the package. A null expiry means the record does not say the licence expires — which is not the same as a licence that does not expire.",
  },
  "R-LIC-UNKNOWN": {
    what: "An asset with NO LicensingMetadata row is reported as `unknown_unverified` with every licence field empty-with-reason.",
    basis: "The single most dangerous assumption in a publishing tool is that an asset without a licence record is fine. Here it is not fine and not false: `attributionRequired` is empty, not false, and the entry says the licence is unknown and unverified.",
  },
} as const satisfies Record<string, { what: string; basis: string }>;

/** Every rule id this block can emit. */
export type PublishingRuleId = keyof typeof PUBLISHING_RULES;

/** The rule ids, as a runtime list (used by the honesty audit). */
export const PUBLISHING_RULE_IDS = Object.keys(PUBLISHING_RULES) as PublishingRuleId[];

/** Resolve a rule id to its meaning; throws for an unknown id. */
export function explainRule(id: string): { id: string; what: string; basis: string } {
  const rule = (PUBLISHING_RULES as Record<string, { what: string; basis: string }>)[id];
  if (!rule) throw new Error(`explainRule(): unknown rule id "${id}"`);
  return { id, what: rule.what, basis: rule.basis };
}
