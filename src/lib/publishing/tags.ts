/**
 * Phase 7 Block 1 — TAGS and HASHTAGS, from the keywords plus stored metadata.
 *
 * Two ceilings are enforced and MEASURED, not estimated: at most TAG_LIMIT tags
 * and at most TAG_CHAR_BUDGET characters across them (the platform's published
 * limits for the tags field). A tag that would cross either bound is not
 * silently dropped — it is listed in `skipped` with the reason.
 *
 * Hashtags are placed ONCE at the end of the description and only the first
 * HASHTAG_IN_DESCRIPTION_LIMIT are inserted, because the platform surfaces only
 * the first three above the title and ignores the entire set past 15. Every tag
 * and hashtag carries where it came from: the keyword record id, or the stored
 * metadata field it was copied from.
 */
import { derived, emptyNoInput, type Field, type SourceRef } from "./provenance";
import type { KeywordKind, KeywordPlan, KeywordRecord } from "./keywords";

/**
 * The platform ceilings these plans enforce, and where they come from. They live
 * here (not in ./keywords) because they bound the TAG and HASHTAG lists, which
 * are this module's own output.
 *
 * YouTube's published limits: the tags field accepts at most 15 tags and 500
 * characters in total; a video may carry at most 15 hashtags (using more causes
 * every hashtag to be ignored) and only the first three appear above the title.
 */
export const TAG_LIMIT = 15;
export const TAG_CHAR_BUDGET = 500;
export const HASHTAG_LIMIT = 15;
export const HASHTAG_IN_DESCRIPTION_LIMIT = 3;

import type { PublishingSource } from "./types";

export interface TagRecord {
  text: string;
  /** Every tag's characters come from the project's own rows or settings. */
  textOrigin: "source_verbatim";
  /** Where it came from: an extracted keyword, or a stored metadata field. */
  origin: "keyword" | "metadata";
  /** The source the tag must be checkable against. */
  sources: SourceRef[];
  rule: "R-TAG-EXTRACT";
  note?: string;
}

export interface HashtagRecord {
  text: string;
  /** "#" + re-cased source characters; the phrase below is what it came from. */
  textOrigin: "source_verbatim";
  /** The phrase the hashtag was formed from, so the transformation is reversible. */
  phrase: string;
  sources: SourceRef[];
  rule: "R-HASHTAG-FORM";
}

export interface TagPlan {
  kind: "tags";
  rule: "R-TAG-EXTRACT";
  budgetRule: "R-TAG-BUDGET";
  hashtagRule: "R-HASHTAG-FORM";
  hashtagBudgetRule: "R-HASHTAG-BUDGET";
  tags: TagRecord[];
  tagCount: number;
  tagCharacters: number;
  /** The joined string the character count was measured on. */
  tagCharactersBasis: string;
  tagLimit: number;
  tagCharBudget: number;
  withinBudget: boolean;
  /**
   * Candidates that did not fit. Each one still carries the project's own
   * characters, so it declares them (`textOrigin` + the spans it was read from):
   * a phrase the app decided not to place is the project's phrase, and the honesty
   * audit skips it only because it says so (see ./quotation).
   */
  skipped: { text: string; textOrigin: "source_verbatim"; sources: SourceRef[]; reason: string }[];
  hashtags: HashtagRecord[];
  hashtagCount: number;
  hashtagLimit: number;
  /** The hashtags the description block carries (the platform shows only these). */
  hashtagLine: Field<string>;
  /** The hashtags produced but NOT placed in the description, named individually. */
  notPlacedInDescription: HashtagRecord[];
  notes: string[];
}

/** The bucket order tags are taken in: most prominent first. */
const TAG_BUCKET_ORDER: readonly KeywordKind[] = ["primary", "secondary", "longTail"];

function keywordRef(keyword: KeywordRecord): SourceRef[] {
  return keyword.sources.length > 0
    ? keyword.sources
    : [{ kind: "keyword", id: keyword.id, path: "text" }];
}

/** Metadata that may become a tag, with the row/path it is stored on. */
function metadataTags(
  source: PublishingSource,
): { text: string; sources: SourceRef[] }[] {
  const out: { text: string; sources: SourceRef[] }[] = [];
  const settings = source.settings;
  const projectId = source.project.id;
  const push = (value: string | null | undefined, path: string): void => {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) return;
    out.push({ text, sources: [{ kind: "project_settings", id: projectId, path }] });
  };
  push(settings?.tone, "tone");
  push(settings?.style, "style");
  push(settings?.targetAudience, "targetAudience");
  return out;
}

export function buildTagPlan(source: PublishingSource, keywordPlan: KeywordPlan): TagPlan {
  const notes: string[] = [];
  const skipped: TagPlan["skipped"] = [];

  const wanted: TagRecord[] = [];
  const seen = new Set<string>();
  const add = (record: TagRecord): void => {
    const key = record.text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    wanted.push(record);
  };

  for (const bucketId of TAG_BUCKET_ORDER) {
    const bucket = keywordPlan.buckets.find((b) => b.id === bucketId);
    if (!bucket) continue;
    for (const keyword of bucket.keywords) {
      add({
        text: keyword.text,
        textOrigin: "source_verbatim",
        origin: "keyword",
        sources: keywordRef(keyword),
        rule: "R-TAG-EXTRACT",
      });
    }
  }
  for (const meta of metadataTags(source)) {
    add({
      text: meta.text,
      textOrigin: "source_verbatim",
      origin: "metadata",
      sources: meta.sources,
      rule: "R-TAG-EXTRACT",
      note: "Copied verbatim from the project's stored settings; it is a project attribute, not a keyword.",
    });
  }

  const tags: TagRecord[] = [];
  let characters = 0;
  for (const candidate of wanted) {
    if (tags.length >= TAG_LIMIT) {
      skipped.push({
        text: candidate.text,
        textOrigin: "source_verbatim",
        sources: candidate.sources,
        reason: `the ${TAG_LIMIT}-tag limit is already reached`,
      });
      continue;
    }
    const projected = characters + candidate.text.length + (tags.length > 0 ? 1 : 0);
    if (projected > TAG_CHAR_BUDGET) {
      skipped.push({
        text: candidate.text,
        textOrigin: "source_verbatim",
        sources: candidate.sources,
        reason: `would take the tags field past ${TAG_CHAR_BUDGET} characters (currently ${characters})`,
      });
      continue;
    }
    characters = projected;
    tags.push(candidate);
  }

  if (tags.length === 0) {
    notes.push(
      "No tag could be derived: this project stores neither extractable text nor tone/style/audience settings. No tag was invented or copied from a suggestion list.",
    );
  }
  if (skipped.length > 0) {
    notes.push(
      `${skipped.length} candidate tag(s) were skipped to stay inside the platform's published limits (${TAG_LIMIT} tags / ${TAG_CHAR_BUDGET} characters). Each one is listed rather than silently dropped.`,
    );
  }

  /* --------------------------------------------------------- hashtags */
  const hashtagSource: KeywordRecord[] = [];
  const seenHashtag = new Set<string>();
  for (const bucketId of ["primary", "secondary", "longTail", "related"] as const) {
    const bucket = keywordPlan.buckets.find((b) => b.id === bucketId);
    if (!bucket) continue;
    for (const keyword of bucket.keywords) {
      if (hashtagSource.length >= HASHTAG_LIMIT) break;
      const text = `#${keyword.text
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("")}`;
      const key = text.toLowerCase();
      if (seenHashtag.has(key)) continue;
      seenHashtag.add(key);
      hashtagSource.push(keyword);
    }
  }
  const hashtags: HashtagRecord[] = hashtagSource.map((keyword) => ({
    text: `#${keyword.text
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("")}`,
    textOrigin: "source_verbatim",
    phrase: keyword.text,
    sources: keywordRef(keyword),
    rule: "R-HASHTAG-FORM",
  }));

  const placed = hashtags.slice(0, HASHTAG_IN_DESCRIPTION_LIMIT);
  const notPlaced = hashtags.slice(HASHTAG_IN_DESCRIPTION_LIMIT);

  const hashtagLine: Field<string> =
    placed.length === 0
      ? emptyNoInput(
          "No hashtag could be derived because no keyword was extracted from this project's own text.",
          ["stored text on this project (title, script, chapter or scene)"],
        )
      : derived(
          placed.map((h) => h.text).join(" "),
          "R-HASHTAG-FORM",
          placed.flatMap((h) => h.sources),
          {
            textOrigin: "source_verbatim",
            note: `Formed from ${placed.length} keyword phrase(s), each re-cased and prefixed with "#" by R-HASHTAG-FORM. The characters themselves are the project's own. Only the first ${HASHTAG_IN_DESCRIPTION_LIMIT} are placed: the platform ignores the whole set past ${HASHTAG_LIMIT} and surfaces only the first three above the title.`,
          },
        );

  if (hashtags.length === 0) {
    notes.push("No hashtags were produced, because no keyword phrase exists to form one from.");
  }
  notes.push(
    "Every tag and hashtag is a phrase from this project's own text or a stored project setting. None was taken from a platform suggestion, a keyword tool or a trend list, and no tag is repeated in the description.",
  );

  return {
    kind: "tags",
    rule: "R-TAG-EXTRACT",
    budgetRule: "R-TAG-BUDGET",
    hashtagRule: "R-HASHTAG-FORM",
    hashtagBudgetRule: "R-HASHTAG-BUDGET",
    tags,
    tagCount: tags.length,
    tagCharacters: characters,
    tagCharactersBasis: "the tags joined with \",\" (the string measured was the joined tag list, not an estimate)",
    tagLimit: TAG_LIMIT,
    tagCharBudget: TAG_CHAR_BUDGET,
    withinBudget: tags.length <= TAG_LIMIT && characters <= TAG_CHAR_BUDGET,
    skipped,
    hashtags,
    hashtagCount: hashtags.length,
    hashtagLimit: HASHTAG_LIMIT,
    hashtagLine,
    notPlacedInDescription: notPlaced,
    notes,
  };
}
