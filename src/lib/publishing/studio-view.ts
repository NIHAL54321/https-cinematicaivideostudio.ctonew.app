/**
 * Phase 7 Block 2 — THE CREATOR STUDIO VIEW MODEL.
 *
 * Pure: a stored package in, a render-ready view out. No React, no database, no
 * fetch — so the surface's own rules are unit-testable, and the page can only
 * render what this module produced.
 *
 * WHY THIS IS THE HONESTY BACKSTOP, NOT A DECORATION
 * The page has to satisfy the same invariants as the package it shows: every
 * value carries the rule that produced it and the row it read, or says which
 * input is missing; nothing the page writes may contain a banned claim; and no
 * key shaped like a market metric may exist anywhere in what it renders. Rather
 * than trusting a review to hold that, `buildCreatorStudioView` runs the
 * package's OWN honesty audit (./audit) over its output and THROWS if anything
 * fails. So:
 *
 *   - a value on the page that claims to be derived but names no rule, or a rule
 *     outside `PUBLISHING_RULES`, or no source row, cannot be rendered;
 *   - an empty or gated value with no reason, or with no named missing input,
 *     cannot be rendered;
 *   - a banned claim in the app's own copy (./studio-copy) cannot be rendered;
 *   - a metric-shaped key cannot exist in the view at all.
 *
 * Every `StudioValue` is therefore deliberately FIELD-SHAPED (`state`, `value`,
 * `rule`, `sources`, `textOrigin`, `reason`, `requires`, `envVars`) and carries
 * presentation extras beside those keys. Text copied from the project's own rows
 * keeps its `textOrigin: "source_verbatim"`, so the audit skips it exactly as it
 * does inside a package — a user's own words are the user's, even if they contain
 * a phrase this app's own prose may not use.
 */
import { auditPublishingPackage, type AuditResult } from "./audit";
import type { ChapterPlanView } from "./chapters";
import type { DescriptionPlan } from "./description";
import type { AssetLicenceReport } from "./licensing";
import type { PublishingPackage } from "./package";
import type { PinnedComment } from "./pinned-comment";
import { explainRule } from "./rules";
import type { Field, SourceRef, TextOrigin } from "./provenance";
import { ABSENT_MARKET_DATA } from "./keywords";
import type { SavedPackageSummary } from "./service";
import {
  AUDIT_COPY,
  LICENCE_COPY,
  LICENCE_ROW_EMPTY_NOTE,
  SECTION_COPY,
  START_EMPTY_HINT,
  STATE_CHIP,
  STATE_LEGEND,
  STATE_LEGEND_TITLE,
  SUMMARY_COPY,
  VALUE_LABELS,
} from "./studio-copy";

/** The three states, spelled the same way the package spells them. */
export type StudioValueState = "derived" | "empty_no_input" | "gated_provider";

/**
 * One value on the page. Field-shaped on purpose: the audit checks it exactly
 * like a value inside a package.
 */
export interface StudioValue {
  state: StudioValueState;
  label: string;
  /** The value itself, unchanged from the package (never re-worded here). */
  value: string | number | boolean | null;
  rule: string | null;
  sources: SourceRef[];
  textOrigin: TextOrigin | null;
  reason: string | null;
  requires: string[];
  envVars: string[];
  note: string | null;
  /** How a non-string value is shown. Scanned as this app's own text. */
  display: string | null;
  /** Resolved from the rule catalogue, so the rule id is readable in place. */
  ruleWhat: string | null;
  /** The chip this page puts on the value. */
  stateLabel: string;
}

/** Text shown verbatim from a row, with no rule claim attached to it. */
export interface StudioText {
  value: string;
  textOrigin: "source_verbatim";
  sources?: SourceRef[];
}

export interface StudioRow {
  id: string;
  kind: "chapter" | "scene" | "keyword_group" | "keyword" | "tag" | "hashtag" | "asset" | "version";
  label: string;
  values: StudioValue[];
  texts: StudioText[];
  notes: string[];
  /** Rows nested under this one (a chapter's scenes). */
  children?: StudioRow[];
  /** Why this row shows no value, when it shows none. */
  reason: string | null;
}

export interface StudioGroup {
  id: string;
  label: string;
  reason: string | null;
  items: { id: string; value: string; textOrigin: "source_verbatim"; detail: string; rule: string | null }[];
}

export interface StudioSection {
  id: string;
  title: string;
  basis: string;
  values: StudioValue[];
  rows: StudioRow[];
  groups: StudioGroup[];
  notes: string[];
  /** Why the section holds nothing, and what it would need. Never null without a reason. */
  emptyReason: string | null;
  emptyRequires: string[];
}

export interface StudioAuditView {
  label: string;
  ok: boolean;
  violationCount: number;
  inspectedKeys: number;
  inspectedStrings: number;
  checkedAt: string;
  violations: { path: string; kind: string; detail: string }[];
}

export interface StudioView {
  kind: "package";
  projectId: string;
  projectTitle: string;
  savedPackageId: string;
  version: number;
  versionCount: number;
  derivedAt: string;
  payloadBytes: number;
  sections: StudioSection[];
  /** The package's own declaration of the data this product does not have. */
  absentData: typeof ABSENT_MARKET_DATA;
  /** The package's own list of what it deliberately does not contain. */
  notInThisPackage: PublishingPackage["honesty"]["notInThisPackage"];
  honestyStatement: string;
  /** The check the package ran on itself at build time. */
  selfAudit: StudioAuditView;
  /** The same check, re-run on the stored bytes when this page read them. */
  reAudit: StudioAuditView | null;
  legend: { title: string; lines: string[]; chips: { id: StudioValueState; label: string }[] };
  fieldStates: { label: string; value: number }[];
  versionRows: StudioRow[];
  stateChips: typeof STATE_CHIP;
}

export interface StudioEmptyView {
  kind: "empty";
  projectId: string;
  projectTitle: string;
  title: string;
  body: string;
  requires: string[];
  versionRows: StudioRow[];
}

export type CreatorStudioView = StudioView | StudioEmptyView;

/* ------------------------------------------------------------------ */
/* Field -> StudioValue                                                */
/* ------------------------------------------------------------------ */

function ruleWhatFor(rule: string | null): string | null {
  if (!rule) return null;
  try {
    return explainRule(rule).what;
  } catch {
    return null;
  }
}

function displayOf(value: unknown): string | null {
  if (typeof value === "string") return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value === null ? null : JSON.stringify(value);
}

/** One package value, rendered with its state, its rule and its source. */
export function studioValue<T>(label: string, field: Field<T>): StudioValue {
  const base = {
    label,
    sources: field.sources,
    note: field.note ?? null,
    display: null as string | null,
  };
  if (field.state === "derived") {
    return {
      ...base,
      state: "derived",
      value: field.value as string | number | boolean,
      rule: field.rule,
      textOrigin: field.textOrigin,
      reason: null,
      requires: [],
      envVars: [],
      display: displayOf(field.value),
      ruleWhat: ruleWhatFor(field.rule),
      stateLabel: STATE_CHIP.derived,
    };
  }
  if (field.state === "empty_no_input") {
    return {
      ...base,
      state: "empty_no_input",
      value: null,
      rule: null,
      textOrigin: null,
      reason: field.reason,
      requires: field.requires,
      envVars: [],
      ruleWhat: null,
      stateLabel: STATE_CHIP.empty_no_input,
    };
  }
  return {
    ...base,
    state: "gated_provider",
    value: null,
    rule: null,
    textOrigin: null,
    reason: field.reason,
    requires: field.requires,
    envVars: field.envVars,
    ruleWhat: null,
    stateLabel: STATE_CHIP.gated_provider,
  };
}

/** An empty page value, built where the package has no Field to copy. */
export function studioEmpty(label: string, reason: string, requires: string[], note?: string): StudioValue {
  return studioValue(label, {
    state: "empty_no_input",
    value: null,
    rule: null,
    sources: [],
    textOrigin: null,
    reason,
    requires,
    ...(note ? { note } : {}),
  });
}

/** Text shown verbatim from a row. No rule is claimed for it. */
export function studioText(value: string, sources?: SourceRef[]): StudioText {
  return sources && sources.length > 0 ? { value, textOrigin: "source_verbatim", sources } : { value, textOrigin: "source_verbatim" };
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function summarySection(pkg: PublishingPackage, version: { version: number; payloadBytes: number }): StudioSection {
  const s = pkg.summary;
  const fields = s.fields;
  const counts: { label: string; value: number }[] = [
    { label: "Chapters", value: s.chapters },
    { label: "Scenes", value: s.scenes },
    { label: "Scenes with no stored duration", value: s.scenesWithoutDuration },
    { label: "Description sections included", value: s.descriptionSectionsIncluded },
    { label: "Description sections left out", value: s.descriptionSectionsOmitted },
    { label: "Description characters", value: s.descriptionCharacters },
    { label: "Keywords", value: s.keywords },
    { label: "Tags", value: s.tags },
    { label: "Hashtags", value: s.hashtags },
    { label: "Assets", value: s.assets },
    { label: "Assets with a licence row", value: s.licenceRowsVerified },
    { label: "Assets with no licence row", value: s.licenceRowsUnknown },
    { label: "Values derived", value: fields.derived },
    { label: "Values withdrawn for a missing input", value: fields.emptyNoInput },
    { label: "Values gated on a provider", value: fields.gatedProvider },
    { label: "Values counted in total", value: fields.total },
  ];
  return {
    id: "package",
    title: SECTION_COPY.package.title,
    basis: SECTION_COPY.package.basis,
    values: [
      studioValue(VALUE_LABELS.projectTitle, pkg.projectTitle),
      studioValue(VALUE_LABELS.sourceFingerprint, {
        state: "derived",
        value: pkg.sourceFingerprint,
        rule: pkg.fingerprintRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "package.sourceFingerprint" }],
        textOrigin: "rule_authored",
        note: "Recomputed from the rows this package was derived from; see the rule for what it covers.",
      }),
      studioValue(VALUE_LABELS.version, {
        state: "derived",
        value: version.version,
        rule: pkg.countsRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "package.version" }],
        textOrigin: null,
        note: "The saved version number of the package shown on this page. Builds append; nothing is overwritten.",
      }),
      studioValue(VALUE_LABELS.payloadBytes, {
        state: "derived",
        value: version.payloadBytes,
        rule: pkg.countsRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "package.payload" }],
        textOrigin: null,
        note: "Measured on the stored bytes when this page read them, not estimated.",
      }),
    ],
    rows: counts.map((c) => ({
      id: `count-${c.label}`,
      kind: "version" as const,
      label: c.label,
      values: [
        studioValue(c.label, {
          state: "derived",
          value: c.value,
          rule: pkg.countsRule,
          sources: [{ kind: "project", id: pkg.projectId, path: "package.summary" }],
          textOrigin: null,
          note: "A count walked from this package's own contents when it was built.",
        }),
      ],
      texts: [],
      notes: [],
      reason: null,
    })),
    groups: [],
    notes: [],
    emptyReason: null,
    emptyRequires: [],
  };
}

function chapterRow(chapter: ChapterPlanView["entries"][number]): StudioRow {
  const values: StudioValue[] = [
    studioValue(VALUE_LABELS.chapterTitle, chapter.title),
    studioValue(VALUE_LABELS.chapterSummary, chapter.summary),
    studioValue("Start (seconds)", chapter.startSeconds),
    studioValue("Start in the chapter block", chapter.startTimecode),
    studioValue("Length (seconds)", chapter.durationSeconds),
  ];
  const sceneRows: StudioRow[] = chapter.scenes.map((scene) => ({
    id: scene.sceneId,
    kind: "scene" as const,
    label: `Scene ${scene.order}`,
    values: [
      studioValue(VALUE_LABELS.sceneTitle, scene.title),
      studioValue("Scene length (seconds)", scene.durationSeconds),
      studioValue(VALUE_LABELS.sceneNarration, scene.narration),
    ],
    texts: [studioText(`Scene row ${scene.sceneId} · status ${scene.status}`)],
    notes: [],
    reason: null,
  }));
  return {
    id: chapter.chapterId,
    kind: "chapter",
    label: `Chapter ${chapter.index}`,
    values,
    texts: [studioText(`Chapter row ${chapter.chapterId} · order ${chapter.order} · script row ${chapter.scriptId}`)],
    notes: sceneRows.length === 0 ? ["This chapter has no scene rows, so it has no length to sum."] : [],
    children: sceneRows,
    reason: null,
  };
}

function chaptersSection(pkg: PublishingPackage): StudioSection {
  const c = pkg.chapters;
  return {
    id: "chapters",
    title: SECTION_COPY.chapters.title,
    basis: SECTION_COPY.chapters.basis,
    values: [
      studioValue(VALUE_LABELS.chapterBlock, c.block),
      c.coveredSeconds === null || c.coveredHuman === null
        ? studioEmpty(
            VALUE_LABELS.coverage,
            c.block.state === "empty_no_input" ? c.block.reason : "No chapter on this project has a length that could be summed, so no timed span is shown.",
            c.block.state === "empty_no_input" ? c.block.requires : ["Scene rows on this project with durationSeconds set"],
            START_EMPTY_HINT,
          )
        : studioValue(VALUE_LABELS.coverage, {
            state: "derived",
            value: c.coveredHuman,
            rule: c.timingRule,
            sources: c.entries.flatMap((e) => e.durationSeconds.sources),
            textOrigin: "rule_authored",
            note: "The summed length of every chapter in this package.",
          }),
      studioValue(VALUE_LABELS.timingBasis, {
        state: "derived",
        value: c.timingBasis,
        rule: c.timingRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "chapters[].scenes[].durationSeconds" }],
        textOrigin: "rule_authored",
        note: "The stated basis for every timing in this section.",
      }),
      studioValue("Timings available", {
        state: "derived",
        value: c.timingsAvailable,
        rule: c.timingRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "chapters[].scenes[].durationSeconds" }],
        textOrigin: null,
        note: "False when any scene on this project has no stored duration, in which case every timing in this package was withdrawn.",
      }),
    ],
    rows: c.entries.map(chapterRow),
    groups: [],
    notes: c.notes,
    emptyReason: c.entries.length === 0 ? (c.block.state === "empty_no_input" ? c.block.reason : null) : null,
    emptyRequires: c.entries.length === 0 && c.block.state === "empty_no_input" ? c.block.requires : [],
  };
}

function descriptionSection(pkg: PublishingPackage): StudioSection {
  const d: DescriptionPlan = pkg.description;
  return {
    id: "description",
    title: SECTION_COPY.description.title,
    basis: SECTION_COPY.description.basis,
    values: [
      studioValue(VALUE_LABELS.descriptionText, d.text),
      studioValue("Description length (characters)", {
        state: "derived",
        value: d.characterCount,
        rule: d.assembleRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "description.text" }],
        textOrigin: null,
        note: "Measured on the assembled description above.",
      }),
      studioValue("Published description limit (characters)", {
        state: "derived",
        value: d.characterLimit,
        rule: d.assembleRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "description.characterLimit" }],
        textOrigin: null,
        note: "The platform's published maximum for a description.",
      }),
      studioValue("Within the published limit", {
        state: "derived",
        value: d.withinLimit,
        rule: d.assembleRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "description.characterCount" }],
        textOrigin: null,
        note: "The measured length compared with the published limit above.",
      }),
    ],
    rows: d.sections.map((section) => ({
      id: section.id,
      kind: "keyword" as const,
      label: section.label,
      values: [studioValue(section.label, section.text)],
      texts: [studioText(`Included in the assembled description: ${section.included}`)],
      notes: [],
      reason: null,
    })),
    groups: [],
    notes: [...d.notes, ...d.omitted.map((o) => `${o.label} is left out: ${o.reason}`)],
    emptyReason: d.includedSections.length === 0 ? "No description section on this project has an input, so the assembled description is empty." : null,
    emptyRequires: d.includedSections.length === 0 ? d.omitted.flatMap((o) => o.requires) : [],
  };
}

function keywordsSection(pkg: PublishingPackage): StudioSection {
  const k = pkg.keywords;
  return {
    id: "keywords",
    title: SECTION_COPY.keywords.title,
    basis: SECTION_COPY.keywords.basis,
    values: [
      studioValue("Phrases taken from this project's text", {
        state: "derived",
        value: k.totalKeywords,
        rule: k.bucketRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "keywords.buckets" }],
        textOrigin: null,
        note: "The number of phrases this package carries, across every grouping.",
      }),
      studioValue("Text fields read as the corpus", {
        state: "derived",
        value: k.corpus.documents,
        rule: k.rule,
        sources: [{ kind: "project", id: pkg.projectId, path: "keywords.corpus" }],
        textOrigin: null,
        note: "One document per stored text field on this project, counted when the package was built.",
      }),
      studioValue("Occurrence weight formula", {
        state: "derived",
        value: k.sourceWeightFormula,
        rule: k.weightRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "keywords.sourceWeightFormula" }],
        textOrigin: "rule_authored",
        note: "The stated formula behind every sourceWeight on a keyword.",
      }),
    ],
    rows: [],
    groups: k.buckets.map((bucket) => ({
      id: bucket.id,
      label: bucket.label,
      reason: bucket.reason,
      items: bucket.keywords.map((kw) => ({
        id: kw.id,
        value: kw.text,
        textOrigin: "source_verbatim" as const,
        detail: `occurs ${kw.occurrences}× in this project's own text · source weight ${kw.sourceWeight} · ${kw.tokenCount} token(s)`,
        rule: kw.rule,
      })),
    })),
    notes: k.notes,
    emptyReason: k.totalKeywords === 0 ? (k.buckets[0]?.reason ?? "This project's text produced no keyword.") : null,
    emptyRequires: k.totalKeywords === 0 ? ["stored text on this project (title, description, script, chapter or scene)"] : [],
  };
}

function tagsSection(pkg: PublishingPackage): StudioSection {
  const t = pkg.tags;
  return {
    id: "tags",
    title: SECTION_COPY.tags.title,
    basis: SECTION_COPY.tags.basis,
    values: [
      t.tagCount === 0
        ? studioEmpty(
            VALUE_LABELS.tagLine,
            "No tag could be taken from this project's text or its stored settings, so the tag line is empty and nothing is written into it.",
            ["stored text on this project (title, description, chapters, scenes) or a stored tone / style / audience"],
          )
        : studioValue(VALUE_LABELS.tagLine, {
            state: "derived",
            value: t.tags.map((x) => x.text).join(", "),
            rule: t.rule,
            sources: t.tags.flatMap((x) => x.sources),
            textOrigin: "template_filled",
            note: "The phrases are this project's own, in the order the rule takes them; the separating commas are this app's, and no other character is added.",
          }),
      studioValue(VALUE_LABELS.tagCount, {
        state: "derived",
        value: t.tagCount,
        rule: t.budgetRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "tags.tags" }],
        textOrigin: null,
        note: "Counted from this package's own tag list.",
      }),
      studioValue("Tag characters", {
        state: "derived",
        value: t.tagCharacters,
        rule: t.budgetRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "tags.tagCharacters" }],
        textOrigin: null,
        note: t.tagCharactersBasis,
      }),
      studioValue("Published tag budget", {
        state: "derived",
        value: `${t.tagLimit} tags / ${t.tagCharBudget} characters`,
        rule: t.budgetRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "tags.tagLimit" }],
        textOrigin: "rule_authored",
        note: "The platform's published limits this app budgets against.",
      }),
      studioValue("Within the tag budget", {
        state: "derived",
        value: t.withinBudget,
        rule: t.budgetRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "tags.withinBudget" }],
        textOrigin: null,
        note: "The measured counts above compared with the published limits.",
      }),
    ],
    rows: t.tags.map((tag) => ({
      id: tag.text,
      kind: "tag" as const,
      label: tag.text,
      values: [],
      texts: [],
      notes: [],
      reason: null,
    })),
    groups: [],
    notes: [...t.notes, ...t.skipped.map((s) => `"${s.text}" was not placed: ${s.reason}`)],
    emptyReason: t.tagCount === 0 ? "No tag could be taken from this project's text or its stored settings, so the tag line is empty." : null,
    emptyRequires: t.tagCount === 0 ? ["stored text on this project (title, description, chapters, scenes) or a stored tone / style / audience"] : [],
  };
}

function hashtagsSection(pkg: PublishingPackage): StudioSection {
  const t = pkg.tags;
  return {
    id: "hashtags",
    title: SECTION_COPY.hashtags.title,
    basis: SECTION_COPY.hashtags.basis,
    values: [
      studioValue(VALUE_LABELS.hashtagLine, t.hashtagLine),
      studioValue("Hashtags produced", {
        state: "derived",
        value: t.hashtagCount,
        rule: t.hashtagBudgetRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "tags.hashtags" }],
        textOrigin: null,
        note: "Counted from this package's own hashtag list.",
      }),
      studioValue("Hashtag limit applied here", {
        state: "derived",
        value: t.hashtagLimit,
        rule: t.hashtagBudgetRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "tags.hashtagLimit" }],
        textOrigin: null,
        note: "The platform's published limit this app produces against.",
      }),
    ],
    rows: t.hashtags.map((h) => ({
      id: h.text,
      kind: "hashtag" as const,
      label: h.text,
      values: [],
      texts: [],
      notes: [],
      reason: null,
    })),
    groups: [],
    notes: [
      ...t.notes,
      ...t.notPlacedInDescription.map((h) => `${h.text} is produced and not placed in the description.`),
    ],
    emptyReason: t.hashtagCount === 0 ? "No keyword phrase exists to form a hashtag from, so no hashtag was produced." : null,
    emptyRequires: t.hashtagCount === 0 ? ["at least one keyword phrase taken from this project's text"] : [],
  };
}

function pinnedCommentSection(pkg: PublishingPackage): StudioSection {
  const p: PinnedComment = pkg.pinnedComment;
  return {
    id: "pinned_comment",
    title: SECTION_COPY.pinnedComment.title,
    basis: SECTION_COPY.pinnedComment.basis,
    values: [
      studioValue(VALUE_LABELS.pinnedCommentText, p.text),
      studioValue(VALUE_LABELS.pinnedCommentTheme, p.topicPhrase),
      studioValue(VALUE_LABELS.pinnedCommentTemplate, {
        state: "derived",
        value: p.templateText,
        rule: p.rule,
        sources: p.quotes.length > 0 ? p.quotes : [{ kind: "project", id: pkg.projectId, path: "pinnedComment.templateId" }],
        textOrigin: "rule_authored",
        note: `Template ${p.templateId}, shown with its placeholders so the substitution above can be checked against it.`,
      }),
      studioValue(VALUE_LABELS.pinnedCommentAuthorship, {
        state: "derived",
        value: p.authorship,
        rule: p.rule,
        sources: [{ kind: "project", id: pkg.projectId, path: "pinnedComment.authorship" }],
        textOrigin: "rule_authored",
        note: "The comment is written by one of this app's own fixed templates. No model wrote it, and no model was asked to.",
      }),
    ],
    rows: [],
    groups: [],
    notes: p.notes,
    emptyReason: p.text.state === "empty_no_input" ? p.text.reason : null,
    emptyRequires: p.text.state === "empty_no_input" ? p.text.requires : [],
  };
}

function licencesSection(pkg: PublishingPackage): StudioSection {
  const l: AssetLicenceReport = pkg.assetLicences;
  return {
    id: "licences",
    title: SECTION_COPY.licences.title,
    basis: SECTION_COPY.licences.basis,
    values: [
      studioValue(VALUE_LABELS.licenceStatement, {
        state: "derived",
        value: l.statement,
        rule: l.rule,
        sources: [{ kind: "project", id: pkg.projectId, path: "assetLicences.statement" }],
        textOrigin: "rule_authored",
        note: LICENCE_COPY.notClearance,
      }),
      studioValue("Assets reported", {
        state: "derived",
        value: l.counts.assets,
        rule: l.rule,
        sources: [{ kind: "project", id: pkg.projectId, path: "assetLicences.entries" }],
        textOrigin: null,
        note: "Counted from the asset rows on this project that are not deleted.",
      }),
      studioValue(VALUE_LABELS.licenceCounts, {
        state: "derived",
        value: `${l.counts.verifiedRow} with a licence row / ${l.counts.unknownUnverified} without`,
        rule: l.unknownRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "assetLicences.counts" }],
        textOrigin: "rule_authored",
        note: "An asset with no licence row is reported unknown and unverified; this app never treats a missing record as permission.",
      }),
      studioValue("Licence rows stating an expiry in the past", {
        state: "derived",
        value: l.counts.expired,
        rule: l.expiryRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "assetLicences.counts.expired" }],
        textOrigin: null,
        note: "Counted by comparing each stored expiry with the moment this package was derived.",
      }),
      studioValue("Licence rows stating that attribution is required", {
        state: "derived",
        value: l.counts.attributionRequired,
        rule: l.attributionRule,
        sources: [{ kind: "project", id: pkg.projectId, path: "assetLicences.counts.attributionRequired" }],
        textOrigin: null,
        note: "Counted by this app's own rule over the attribution column, and only for assets that have a row at all.",
      }),
      studioValue("This is legal clearance", {
        state: "derived",
        value: !l.notLegalClearance,
        rule: l.rule,
        sources: [{ kind: "project", id: pkg.projectId, path: "assetLicences.notLegalClearance" }],
        textOrigin: null,
        note: "False, and the package states it in its own data: this report is licence data, not clearance.",
      }),
    ],
    rows: l.entries.map((entry) => ({
      id: entry.assetId,
      kind: "asset" as const,
      label: entry.name,
      values: [
        studioValue(VALUE_LABELS.licenceVerification, {
          state: "derived",
          value: entry.verification === "verified_row" ? LICENCE_COPY.verifiedLabel : LICENCE_COPY.unknownLabel,
          rule: entry.verification === "verified_row" ? l.rule : l.unknownRule,
          sources:
            entry.licensingRowId !== null
              ? [{ kind: "licensing", id: entry.licensingRowId, path: "id" }]
              : [{ kind: "asset", id: entry.assetId, path: "licensing" }],
          textOrigin: "rule_authored",
          note:
            entry.verification === "verified_row"
              ? "A LicensingMetadata row was read for this asset."
              : LICENCE_COPY.unknownEntryNote,
        }),
        studioValue(VALUE_LABELS.licenceProvider, entry.provider),
        studioValue(VALUE_LABELS.licenceType, entry.licenceType),
        studioValue(VALUE_LABELS.licenceAttributionRequired, entry.attributionRequired),
        studioValue(VALUE_LABELS.licenceAttributionText, entry.attributionText),
        studioValue(VALUE_LABELS.licenceUrl, entry.licenceUrl),
        studioValue(VALUE_LABELS.licencePurchasedAt, entry.purchasedAt),
        studioValue(VALUE_LABELS.licenceExpiresAt, entry.expiresAt),
        studioValue(VALUE_LABELS.licenceExpired, entry.expired),
      ],
      texts:
        entry.licensingRowId !== null
          ? [
              studioText(`Asset row ${entry.assetId} · kind ${entry.kind} · status ${entry.status}`),
              studioText(`Licence row ${entry.licensingRowId}`),
            ]
          : [studioText(`Asset row ${entry.assetId} · kind ${entry.kind} · status ${entry.status} · no licence row exists for it`)],
      notes: entry.notes,
      reason: null,
    })),
    groups: [],
    notes: l.notes,
    emptyReason: l.entries.length === 0 ? (l.notes[0] ?? "This project has no assets, so there is no licence data to report.") : null,
    emptyRequires: l.entries.length === 0 ? ["an asset attached to this project through this app's own media paths"] : [],
  };
}

/**
 * The section that shows the package's own declaration of the data this product
 * does not have. Each missing metric becomes an EMPTY value naming exactly what
 * is absent — the app writes no value of its own in this section, and the
 * declaration itself is rendered unchanged from `honesty.absentData`.
 */
function absentDataSection(pkg: PublishingPackage): StudioSection {
  return {
    id: "absent",
    title: SECTION_COPY.absent.title,
    basis: SECTION_COPY.absent.basis,
    values: [
      studioValue("The package's own statement", {
        state: "derived",
        value: pkg.honesty.absentData.statement,
        rule: "R-KW-NO-MARKET-DATA",
        sources: [{ kind: "project", id: pkg.projectId, path: "package.honesty.absentData" }],
        textOrigin: "rule_authored",
        note: "Carried in the package's own data and shown here unchanged. This is the only place on this page where the kinds of data this product lacks are named, and a user can read the declaration itself rather than a summary of it.",
      }),
      ...pkg.honesty.absentData.absent.map((a, i) =>
        studioValue(`Absent data ${i + 1}`, {
          state: "empty_no_input",
          value: null,
          rule: null,
          sources: [],
          textOrigin: null,
          reason: `This product holds no value of this kind: ${a}. Nothing here is estimated, sampled or substituted.`,
          requires: [a],
        }),
      ),
    ],
    rows: [],
    groups: [],
    notes: [],
    emptyReason: null,
    emptyRequires: [],
  };
}

function fieldStatesSection(pkg: PublishingPackage): { label: string; value: number }[] {
  const f = pkg.summary.fields;
  return [
    { label: "Values counted by the package's own check", value: f.total },
    { label: "Derived from a row by a named rule", value: f.derived },
    { label: "Withdrawn because an input is missing", value: f.emptyNoInput },
    { label: "Gated on a provider this server cannot reach", value: f.gatedProvider },
  ];
}

function auditView(label: string, audit: {
  ok: boolean;
  violationCount: number;
  inspectedKeys: number;
  inspectedStrings: number;
  checkedAt: string;
  /** Absent on the package's own stored `selfAudit`, which records no list. */
  violations?: readonly { path: string; kind: string; detail: string }[];
}): StudioAuditView {
  return {
    label,
    ok: audit.ok,
    violationCount: audit.violationCount,
    inspectedKeys: audit.inspectedKeys,
    inspectedStrings: audit.inspectedStrings,
    checkedAt: audit.checkedAt,
    violations: (audit.violations ?? []).map((v) => ({ path: v.path, kind: v.kind, detail: v.detail })),
  };
}

function versionRows(versions: readonly SavedPackageSummary[], shownVersion: number | null): StudioRow[] {
  return versions.map((v) => ({
    id: v.id,
    kind: "version" as const,
    label: `Version ${v.version}${v.version === shownVersion ? " (shown above)" : ""}`,
    values: [],
    texts: [
      studioText(`Built ${v.derivedAt} · ${v.counts.chapters} chapter(s) · ${v.counts.scenes} scene(s) · ${v.counts.assets} asset(s)`),
      studioText(`Source fingerprint ${v.sourceFingerprint}`),
    ],
    notes: [],
    reason: null,
  }));
}

/** The section the page shows when nothing has been saved for the project. */
export function buildEmptyCreatorStudioView(input: {
  projectId: string;
  projectTitle: string;
  versions: readonly SavedPackageSummary[];
}): StudioEmptyView {
  const view: StudioEmptyView = {
    kind: "empty",
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    title: "No package has been saved for this project yet",
    body:
      "Nothing is shown on this page about chapters, description, keywords, tags, hashtags, the pinned comment or asset licences, because this project has no saved package to show. Build one and it is derived from this project's own rows, saved as a version, and shown here.",
    requires: ["a saved publishing package for this project"],
    versionRows: versionRows(input.versions, null),
  };
  assertCreatorStudioViewHonest(view);
  return view;
}

/**
 * Runs the package's own honesty audit over anything this page is about to
 * render and THROWS if it fails. Exported so the check is testable: a value
 * with no rule, a rule outside the catalogue, a derived value with no source, an
 * empty value with no reason, a banned claim in the app's own copy, or a
 * metric-shaped key anywhere in the view all fail here rather than reaching a
 * user.
 */
export function assertCreatorStudioViewHonest(view: unknown): AuditResult {
  const audit = auditPublishingPackage(view);
  if (!audit.ok) {
    throw new Error(
      `creator studio view failed the publishing honesty audit with ${audit.violationCount} violation(s): ` +
        audit.violations
          .slice(0, 6)
          .map((v) => `${v.path} (${v.kind})`)
          .join("; "),
    );
  }
  return audit;
}

export interface BuildStudioViewInput {
  projectId: string;
  package: PublishingPackage;
  version: number;
  savedPackageId: string;
  payloadBytes: number;
  versions: readonly SavedPackageSummary[];
  reAudit: AuditResult | null;
  /** When true (tests only) the audit of the view is skipped. */
  skipAudit?: boolean;
}

/**
 * Builds the view, then runs the package's own honesty audit over it. Throws if
 * anything the page would render breaks an invariant, so a misleading or
 * unbacked value cannot reach a user.
 */
export function buildCreatorStudioView(input: BuildStudioViewInput): StudioView {
  const pkg = input.package;
  const absent = absentDataSection(pkg);
  const view: StudioView = {
    kind: "package",
    projectId: input.projectId,
    projectTitle: input.package.projectTitle.state === "derived" ? String(input.package.projectTitle.value) : input.package.projectId,
    savedPackageId: input.savedPackageId,
    version: input.version,
    versionCount: input.versions.length,
    derivedAt: pkg.derivedAt,
    payloadBytes: input.payloadBytes,
    sections: [
      summarySection(pkg, { version: input.version, payloadBytes: input.payloadBytes }),
      chaptersSection(pkg),
      descriptionSection(pkg),
      keywordsSection(pkg),
      tagsSection(pkg),
      hashtagsSection(pkg),
      pinnedCommentSection(pkg),
      licencesSection(pkg),
      absent,
    ],
    absentData: pkg.honesty.absentData,
    notInThisPackage: pkg.honesty.notInThisPackage,
    honestyStatement: pkg.honesty.statement,
    selfAudit: auditView(AUDIT_COPY.buildTimeLabel, pkg.selfAudit),
    reAudit: input.reAudit ? auditView(AUDIT_COPY.readTimeLabel, input.reAudit) : null,
    legend: {
      title: STATE_LEGEND_TITLE,
      lines: [...STATE_LEGEND],
      chips: [
        { id: "derived" as StudioValueState, label: STATE_CHIP.derived },
        { id: "empty_no_input" as StudioValueState, label: STATE_CHIP.empty_no_input },
        { id: "gated_provider" as StudioValueState, label: STATE_CHIP.gated_provider },
      ],
    },
    fieldStates: fieldStatesSection(pkg),
    versionRows: versionRows(input.versions, input.version),
    stateChips: STATE_CHIP,
  };

  // The page carries the package's own declaration and its own omission list, so
  // both are rendered as the package's data rather than restated by the app.
  if (!input.skipAudit) assertCreatorStudioViewHonest(view);

  return view;
}

export { LICENCE_ROW_EMPTY_NOTE, START_EMPTY_HINT, SUMMARY_COPY, VALUE_LABELS, SECTION_COPY, AUDIT_COPY, LICENCE_COPY };
