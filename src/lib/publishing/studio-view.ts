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
import { explainRule, type PublishingRuleId } from "./rules";
import { derived, emptyNoInput, gatedProvider, type Field, type SourceRef, type TextOrigin } from "./provenance";
import type { TagPlan } from "./tags";
import { quotation, quotedFragment, type QuotedFragment } from "./quotation";
import { ABSENT_MARKET_DATA } from "./keywords";
import type { SavedPackageSummary } from "./service";
import type { TitleOption, TitlePlan } from "./titles";
import type {
  ThumbnailConcept,
  ThumbnailControlOutcome,
  ThumbnailCriterion,
  ThumbnailPlan,
} from "./thumbnails";
import {
  AUDIT_COPY,
  LICENCE_COPY,
  LICENCE_ROW_EMPTY_NOTE,
  PROJECT_TITLE_COPY,
  SECTION_COPY,
  START_EMPTY_HINT,
  STATE_CHIP,
  STATE_LEGEND,
  STATE_LEGEND_TITLE,
  SUMMARY_COPY,
  THUMBNAIL_COPY,
  TITLE_COPY,
  VALUE_LABELS,
  VIEW_AUDIT_FAILURE_COPY,
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
  /**
   * For a template-filled value: the TEMPLATE, with its placeholders. It is
   * scanned as this app's own text, so a template carrying a banned claim fails
   * the audit even though the filled title (the project's own words) does not.
   */
  templateText: string | null;
  /**
   * When this value is a SENTENCE this app wrote with the project's own characters
   * inside it, the characters substituted into `templateText`, each attributed to
   * the row it was read from — the declaration ./audit verifies before it exempts
   * the sentence from the banned-claims scan (see ./quotation). Empty on every
   * value that quotes nothing.
   */
  fragments?: QuotedFragment[];
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
  kind:
    | "chapter"
    | "scene"
    | "keyword_group"
    | "keyword"
    | "tag"
    | "hashtag"
    | "asset"
    | "version"
    | "title"
    | "title_category"
    | "title_axis"
    | "thumbnail_concept"
    | "thumbnail_criterion"
    | "thumbnail_control"
    | "thumbnail_ladder";
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
  /** Sentences exempted because they were a VERIFIED quotation (see ./quotation). */
  quotedSentences: number;
  /** The fragments those quotations declared. */
  quotedFragments: number;
  /** Template-filled values that declared no fragments, so they were SCANNED. */
  unverifiedTemplateFills: number;
  checkedAt: string;
  violations: { path: string; kind: string; detail: string }[];
}

export interface StudioView {
  kind: "package";
  projectId: string;
  /**
   * The project's own title, as a DECLARED QUOTATION rather than as a string of
   * this app's — see `projectTitleValue`. A bare string here would be read as a
   * sentence this app wrote, and a project whose own title carries a phrase this
   * app's prose may not use would fail the view's own check and render nothing.
   */
  projectTitle: StudioValue;
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
  /**
   * P7-4: what the interactive control panel needs — the controls this package
   * carries and the concepts they may be applied to. Null when the package has no
   * thumbnail plan (an older version) or no concept to operate on.
   */
  thumbnailControls: StudioThumbnailControlsPanel | null;
  stateChips: typeof STATE_CHIP;
}

export interface StudioEmptyView {
  kind: "empty";
  projectId: string;
  /** The project's own title as a declared quotation; see `projectTitleValue`. */
  projectTitle: StudioValue;
  title: string;
  body: string;
  requires: string[];
  versionRows: StudioRow[];
}
/**
 * One failed check: WHERE in the view it was found and WHAT kind of check it was —
 * a location, never the characters that failed it. See `auditFailedView`.
 */
export interface StudioAuditFailure {
  path: string;
  kind: string;
}
/**
 * THE VIEW A FAILED CHECK LEAVES IN PLACE OF A PAGE.
 *
 * The view model runs the package's own honesty audit over its own output before
 * anything is rendered. When that check fails, the honest outcome is not a blank
 * page — a reader cannot tell a broken page from an empty one — and it is
 * certainly not the unchecked view. It is this: a state that says the view failed
 * the check, names the path of every failure, and states plainly that nothing is
 * shown rather than showing it unchecked.
 *
 * It deliberately carries NO project content: no section, no value, no version
 * row, not even the project title. A state that refuses content cannot itself
 * present content as a finding. For the same reason each failure is a `path` and a
 * `kind` and not the audit's `detail` sentence: a detail names the offending
 * characters (…contains the banned claim "…"), so reprinting it here would put
 * back on the page exactly the text the check refused a place to. The paths are
 * object keys and array indices only, which is also why this state is itself
 * auditable — the suite asserts it passes the same check (`studio-view.test.ts`),
 * rather than the builder re-deriving a constant on every request.
 */
export interface StudioAuditFailedView {
  kind: "audit_failed";
  projectId: string;
  title: string;
  body: string;
  note: string;
  requires: string[];
  violations: StudioAuditFailure[];
  violationCount: number;
  inspectedKeys: number;
  inspectedStrings: number;
  checkedAt: string;
}

export type CreatorStudioView = StudioView | StudioEmptyView | StudioAuditFailedView;

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
  // A value that carries a quotation (./quotation) carries its declaration here
  // too: the sentence is exempt from the phrase scan only because the template it
  // was filled from and the fragments substituted into it travel with it, so the
  // audit can check the substitution rather than trust the producer.
  const quoted = field as { templateText?: string; fragments?: QuotedFragment[] };
  const base = {
    label,
    sources: field.sources,
    note: field.note ?? null,
    display: null as string | null,
    templateText: quoted.templateText ?? null,
    fragments: quoted.fragments ?? [],
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

/**
 * THE PROJECT'S OWN TITLE, CARRIED AS A DECLARED QUOTATION.
 *
 * The title is the project's own characters, so it may not sit in the view as a
 * bare string: the audit reads a bare string as a sentence THIS APP wrote, and a
 * project whose own title carries a phrase this app's prose may not use would then
 * fail the view's own check and render nothing at all. That was a real defect: a
 * real project whose own title carried two phrases this app bans in its own prose
 * had a blank Creator Studio page, with the serving log's only explanation being
 * `projectTitle (banned_claim)`.
 *
 * So the title is built through the same mechanism as every other quoted value in
 * this product (./quotation): this app's own template, which here is the
 * placeholder ALONE — no word of ours is added to the project's title — plus the
 * characters substituted into it, attributed to the row they were read from. The
 * audit verifies that declaration character for character before it exempts the
 * value, so the exemption is not a weaker rule applied to the title: it is the
 * same rule, with the title's characters declared as the project's own.
 *
 * `from` says which of the two callers read the characters (the stored package's
 * value, or the project's title column on this page), because the two are not the
 * same act and the source must be nameable either way.
 */
export const PROJECT_TITLE_PLACEHOLDER = "{PROJECT_TITLE}";
export function projectTitleValue(input: { projectId: string; title: string; from: string }): StudioValue {
  const quote = quotation(PROJECT_TITLE_PLACEHOLDER, [
    quotedFragment({
      placeholder: PROJECT_TITLE_PLACEHOLDER,
      text: input.title,
      sources: [{ kind: "project", id: input.projectId, path: "title" }],
      from: input.from,
    }),
  ]);
  return studioValue(
    VALUE_LABELS.projectTitle,
    derived(quote.text, "R-DESC-TITLE", [{ kind: "project", id: input.projectId, path: "title" }], {
      textOrigin: "template_filled",
      templateText: quote.templateText,
      fragments: quote.fragments,
      note: PROJECT_TITLE_COPY.note,
    }),
  );
}
/** The project's title the stored package carries, or null when it carries none. */
function storedProjectTitle(pkg: PublishingPackage): string | null {
  const field = pkg.projectTitle;
  if (field.state !== "derived") return null;
  return typeof field.value === "string" && field.value.trim().length > 0 ? field.value : null;
}
/** The package's project title as a quotation, or an empty value saying why none is shown. */
function storedProjectTitleValue(pkg: PublishingPackage): StudioValue {
  const title = storedProjectTitle(pkg);
  if (title === null) {
    return studioEmpty(
      VALUE_LABELS.projectTitle,
      PROJECT_TITLE_COPY.noStoredTitle,
      [...PROJECT_TITLE_COPY.noStoredTitleRequires],
    );
  }
  return projectTitleValue({ projectId: pkg.projectId, title, from: PROJECT_TITLE_COPY.fromStoredPackage });
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
      storedProjectTitleValue(pkg),
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

/**
 * A row whose headline is this app's own words and whose CONTENT is the project's
 * own characters, declared as such: the phrase sits in a value that carries the
 * `source_verbatim` origin and the row it was read from, so a project phrase this
 * app's own prose may not use never lands in a sentence this app wrote.
 */
function declaredPhraseRow(input: {
  id: string;
  kind: StudioRow["kind"];
  label: string;
  valueLabel: string;
  phrase: string;
  rule: PublishingRuleId;
  sources: SourceRef[];
  note: string;
  reason?: string | null;
}): StudioRow {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    values: [
      studioValue(
        input.valueLabel,
        derived(input.phrase, input.rule, input.sources, { textOrigin: "source_verbatim", note: input.note }),
      ),
    ],
    texts: [],
    notes: [],
    reason: input.reason ?? null,
  };
}

/**
 * The tag line: the project's own phrases with this app's own separators. It is a
 * QUOTATION (see ./quotation) — the separators are the app's, each phrase is the
 * project's and is declared with the row it was read from — so a project whose own
 * words carry a phrase this app's prose may not use still builds and still renders.
 */
function tagLineValue(t: TagPlan): Field<string> {
  const placeholders = t.tags.map((_, i) => `{TAG_${i + 1}}`);
  const quote = quotation(
    placeholders.join(", "),
    t.tags.map((tag, i) =>
      quotedFragment({
        placeholder: placeholders[i],
        text: tag.text,
        sources: tag.sources,
        from: "a phrase this package took from the project's own stored text by R-TAG-EXTRACT",
      }),
    ),
  );
  return derived(quote.text, t.rule, t.tags.flatMap((tag) => tag.sources), {
    textOrigin: "template_filled",
    templateText: quote.templateText,
    fragments: quote.fragments,
    note: "The phrases are this project's own, in the order the rule takes them; the separating commas are this app's, and no other character is added.",
  });
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
        : studioValue(VALUE_LABELS.tagLine, tagLineValue(t)),
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
    rows: [
      ...t.tags.map((tag, i) =>
        declaredPhraseRow({
          id: `tag-${i + 1}`,
          kind: "tag",
          label: `Tag ${i + 1}`,
          valueLabel: VALUE_LABELS.tagPhrase,
          phrase: tag.text,
          rule: tag.rule,
          sources: tag.sources,
          note: "A phrase taken from this project's own stored text, character for character.",
        }),
      ),
      ...t.skipped.map((skipped, i) =>
        declaredPhraseRow({
          id: `tag-skipped-${i + 1}`,
          kind: "tag",
          label: `Tag candidate ${i + 1} — not placed`,
          valueLabel: VALUE_LABELS.tagPhrase,
          phrase: skipped.text,
          rule: t.rule,
          sources: skipped.sources,
          note: "A phrase taken from this project's own stored text. It is declared rather than quoted in this app's sentence, and the reason it did not fit is below.",
          reason: skipped.reason,
        }),
      ),
    ],
    groups: [],
    notes: [
      ...t.notes,
      ...(t.skipped.length > 0
        ? [
            "Every candidate phrase that did not fit is listed above as its own row, with the limit that excluded it. Nothing was dropped silently.",
          ]
        : []),
    ],
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
    rows: t.hashtags.map((h, i) =>
      declaredPhraseRow({
        id: `hashtag-${i + 1}`,
        kind: "hashtag",
        label: `Hashtag ${i + 1}`,
        valueLabel: VALUE_LABELS.hashtagText,
        phrase: h.text,
        rule: h.rule,
        sources: h.sources,
        note: "The characters are this project's own phrase, re-cased and prefixed with \u201c#\u201d by this app's rule.",
        reason: t.notPlacedInDescription.some((notPlaced) => notPlaced.text === h.text)
          ? "Produced and NOT placed in the description: the platform surfaces only the first three hashtags above the title."
          : null,
      }),
    ),
    groups: [],
    notes: [
      ...t.notes,
      ...(t.notPlacedInDescription.length > 0
        ? [
            "Hashtags this app produces and does not place in the description are listed above with that stated on the row itself.",
          ]
        : []),
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

/* ------------------------------------------------------------------ */
/* P7-3 — the titles section                                           */
/* ------------------------------------------------------------------ */

/** A value this app writes, with the rule and the rows it rests on. */
function authoredValue(label: string, value: string, rule: string, sources: SourceRef[], note?: string): StudioValue {
  return {
    state: "derived",
    label,
    value,
    rule,
    sources,
    textOrigin: "rule_authored",
    reason: null,
    requires: [],
    envVars: [],
    note: note ?? null,
    display: null,
    templateText: null,
    ruleWhat: ruleWhatFor(rule),
    stateLabel: STATE_CHIP.derived,
  };
}

/** A count this app measured on the package's own contents. */
function countValue(label: string, value: number, rule: string, sources: SourceRef[], note: string): StudioValue {
  return {
    state: "derived",
    label,
    value,
    rule,
    sources,
    textOrigin: null,
    reason: null,
    requires: [],
    envVars: [],
    note,
    display: String(value),
    templateText: null,
    ruleWhat: ruleWhatFor(rule),
    stateLabel: STATE_CHIP.derived,
  };
}

/**
 * A value that carries the brief's own name for a category as a DECLARED label,
 * with the disclaimer the audit requires beside it. See audit.ts for the single,
 * narrow, counted exemption this pair is the only user of.
 */
type DeclaredCategoryValue = StudioValue & { specCategoryName: string; specCategoryDisclaimer: string };

/** One title, with its template, its category and its six axis rows. */
function titleRow(option: TitleOption, planSources: SourceRef[]): StudioRow {
  const sources = option.sources.length > 0 ? option.sources : planSources;
  const textValue: StudioValue = {
    state: "derived",
    label: TITLE_COPY.titleTextLabel,
    value: option.text,
    rule: option.rule,
    sources,
    textOrigin: "template_filled",
    reason: null,
    requires: [],
    envVars: [],
    note: option.note,
    display: null,
    // The template, so the audit scans the app's own words rather than the
    // project's, and so a reader can check the substitution. The fragments are the
    // project's own characters, declared with the row each was read from, so the
    // audit VERIFIES the substitution instead of taking it on trust.
    templateText: option.templateText,
    fragments: option.fragments,
    ruleWhat: ruleWhatFor(option.rule),
    stateLabel: STATE_CHIP.derived,
  };
  const axisRows: StudioRow[] = option.axes.map((axis) => {
    // A verdict that names one of the title's own words carries that word as a
    // DECLARED QUOTATION (see ./quotation) instead of interpolating it into this
    // app's sentence — the P7-3b defect was exactly that interpolation. It is
    // rendered as its own value here, attributed and marked as the project's own
    // characters, so the distinction is visible on the page and not only in the data.
    const quoteValues: StudioValue[] = axis.features
      .filter((feature) => feature.measuredQuote !== null)
      .map((feature) => {
        const quote = feature.measuredQuote as NonNullable<typeof feature.measuredQuote>;
        return studioValue(
          `${feature.label} — ${VALUE_LABELS.measuredQuote}`,
          derived(
            quote.text,
            axis.rule,
            quote.fragments.flatMap((fragment) => fragment.sources),
            {
              textOrigin: "template_filled",
              templateText: quote.templateText,
              fragments: quote.fragments,
              note: VALUE_LABELS.measuredQuoteNote,
            },
          ),
        );
      });
    return {
      id: `${option.id}-${axis.id}`,
      kind: "title_axis" as const,
      label: `${axis.label} ${TITLE_COPY.axisLabelSuffix}`,
      values: [
        authoredValue(
          `${axis.label} ${TITLE_COPY.axisLabelSuffix}`,
          `${axis.score} ${TITLE_COPY.scoreWord} ${axis.maxScore} ${TITLE_COPY.scoreScaleWord}`,
          axis.rule,
          axis.sources.length > 0 ? axis.sources : sources,
          `${axis.about} ${TITLE_COPY.axisVerdictsLabel}: ` +
            axis.features
              .map((f) => `${f.label} — ${f.present ? TITLE_COPY.axisVerdictYes : TITLE_COPY.axisVerdictNo} (${f.measured})`)
              .join(" · ") +
            ` ${axis.notA} ${axis.featureSource}`,
        ),
        ...quoteValues,
      ],
      texts: [],
      notes: [],
      reason: null,
    };
  });
  return {
    id: option.id,
    kind: "title",
    label: `${option.categoryLabel} · ${option.templateId}`,
    values: [
      textValue,
      authoredValue(
        TITLE_COPY.titleCategoryLabel,
        option.categoryLabel,
        "R-TITLE-CATEGORY",
        sources,
        `The category this template belongs to. Its definition and what it does not claim are stated once on the category above.`,
      ),
      authoredValue(TITLE_COPY.titleAuthoredByLabel, option.authoredBy, option.rule, sources, TITLE_COPY.titleRuleNote),
    ],
    texts: [],
    notes: [],
    children: axisRows,
    reason: null,
  };
}

function titleCategoryRow(category: TitlePlan["categories"][number], planSources: SourceRef[]): StudioRow {
  const values: StudioValue[] = [
    authoredValue(
      TITLE_COPY.categoryDefinitionLabel,
      category.definition,
      category.rule,
      planSources,
      "What the wording pattern of this category means. It is a description of phrasing, not a claim about the video's reception.",
    ),
    countValue(
      TITLE_COPY.categoryTitlesLabel,
      category.titles.length,
      "R-TITLE-COUNT",
      planSources,
      "Counted from this category's own list below.",
    ),
    authoredValue(
      TITLE_COPY.categoryPromiseLabel,
      category.promises,
      category.rule,
      planSources,
      "Stated on every category, including the ones whose wording sounds most like a promise.",
    ),
  ];
  if (category.specCategoryName !== null) {
    // The declared label, and the disclaimer that must sit beside it. The pair is
    // what the honesty audit looks for: the label is exempt from the phrase scan
    // ONLY because it is short, sentence-free, and accompanied by this statement
    // (which is itself scanned like every other sentence this app writes).
    const labelValue: DeclaredCategoryValue = {
      state: "derived",
      label: TITLE_COPY.categorySpecNameLabel,
      value: category.specCategoryName,
      rule: category.rule,
      sources: planSources,
      textOrigin: "rule_authored",
      reason: null,
      requires: [],
      envVars: [],
      note: TITLE_COPY.categorySpecNameNote,
      display: null,
      templateText: null,
      ruleWhat: ruleWhatFor(category.rule),
      stateLabel: STATE_CHIP.derived,
      specCategoryName: category.specCategoryName,
      specCategoryDisclaimer: category.specCategoryDisclaimer ?? "",
    };
    values.push(labelValue);
    values.push(
      authoredValue(
        TITLE_COPY.categorySpecDisclaimerLabel,
        category.specCategoryDisclaimer ?? "",
        category.rule,
        planSources,
        "The statement that sits with the declared name above, and the reason this app can carry that name without claiming anything about it.",
      ),
    );
  }
  return {
    id: `title-category-${category.id}`,
    kind: "title_category",
    label: category.label,
    values,
    texts: [],
    notes: category.reason ? [category.reason] : [],
    children: category.titles.map((t) => titleRow(t, planSources)),
    reason: category.reason,
  };
}

function titlesSection(pkg: PublishingPackage): StudioSection {
  const plan: TitlePlan | undefined = pkg.titles;
  const planSources: SourceRef[] = [{ kind: "project", id: pkg.projectId, path: "titles" }];
  if (!plan) {
    return {
      id: "titles",
      title: SECTION_COPY.titles.title,
      basis: SECTION_COPY.titles.basis,
      values: [],
      rows: [],
      groups: [],
      notes: [],
      emptyReason: TITLE_COPY.olderVersionReason,
      emptyRequires: ["a package built with the title engine, which this version of the app has"],
    };
  }
  const empty = plan.categories.filter((c) => c.titles.length === 0);
  const values: StudioValue[] = [
    countValue(
      TITLE_COPY.countLabel,
      plan.totalTitles,
      plan.countRule,
      planSources,
      "The length of this plan's own title list, counted when the package was built. Nothing is estimated or padded.",
    ),
    countValue(
      TITLE_COPY.minimumLabel,
      plan.minimumRequested,
      plan.countRule,
      planSources,
      "The number of title options the brief asks for. It is compared with the count above, not assumed.",
    ),
    {
      state: "derived",
      label: TITLE_COPY.meetsMinimumLabel,
      value: plan.meetsMinimum,
      rule: plan.countRule,
      sources: planSources,
      textOrigin: null,
      reason: null,
      requires: [],
      envVars: [],
      note:
        `${plan.totalTitles} title option(s) carried against the minimum of ${plan.minimumRequested}. ` +
        "A project whose own text fills fewer templates says so below rather than being padded with a title the rules did not produce.",
      display: String(plan.meetsMinimum),
      templateText: null,
      ruleWhat: ruleWhatFor(plan.countRule),
      stateLabel: STATE_CHIP.derived,
    },
    countValue(
      TITLE_COPY.categoriesLabel,
      plan.categories.length,
      plan.categoryRule,
      planSources,
      "The six categories the brief asks for, each with its own definition of the wording pattern it means.",
    ),
    countValue(
      TITLE_COPY.categoriesEmptyLabel,
      empty.length,
      plan.categoryRule,
      planSources,
      empty.length === 0
        ? "Every category the brief asks for holds at least one title from this project's own text."
        : "These categories hold nothing because this project's text did not fill their templates: " +
          empty.map((c) => c.label).join(", ") +
          ". See each category's own reason.",
    ),
    authoredValue(
      TITLE_COPY.duplicatesLabel,
      String(plan.duplicatesDropped),
      plan.countRule,
      planSources,
      "Template results that read word for word the same as a title already listed. Each was dropped rather than listed twice.",
    ),
    authoredValue(
      TITLE_COPY.whoWroteLabel,
      plan.modelPath.authoredByModel,
      plan.rule,
      planSources,
      "Every title listed below is a fixed template of this app's with this project's own words substituted in. No model wrote a title in this package unless a provider really answered — see the model path below.",
    ),
    authoredValue(TITLE_COPY.heuristicLabel, plan.heuristic.statement, plan.scoreRule, planSources, plan.heuristic.scale),
    authoredValue(TITLE_COPY.notAMeasurementLabel, plan.heuristic.whatAScoreIsNot, plan.scoreRule, planSources),
    authoredValue(TITLE_COPY.scaleLabel, plan.heuristic.scale, plan.scoreRule, planSources),
    authoredValue(TITLE_COPY.independenceLabel, plan.heuristic.axesAreNotIndependent, plan.scoreRule, planSources),
    studioValue(TITLE_COPY.modelPathLabel, plan.modelPath.state),
    authoredValue(
      TITLE_COPY.modelRequestBuilderLabel,
      plan.modelPath.requestBuilder,
      plan.modelPath.rule,
      planSources,
      "The one place the app builds the request for this capability. The field names beside it are the ones that builder sends.",
    ),
    authoredValue(
      TITLE_COPY.modelRequestFieldsLabel,
      plan.modelPath.requestFieldNames.join(", "),
      plan.modelPath.rule,
      planSources,
      "Read from the app's own request builder, so this list cannot describe a request the app does not make.",
    ),
  ];

  const attempt = plan.modelPath.attempt;
  if (plan.modelPath.orchestratorMessage) {
    values.push(
      authoredValue(
        TITLE_COPY.modelAttemptLabel,
        plan.modelPath.orchestratorMessage,
        plan.modelPath.rule,
        planSources,
        "The app's own AI orchestrator's sentence about this capability on this build. It is this app's wording, not a provider's.",
      ),
    );
  } else if (!attempt) {
    values.push(
      authoredValue(
        TITLE_COPY.modelAttemptLabel,
        TITLE_COPY.modelAttemptNone,
        plan.modelPath.rule,
        planSources,
        "Nothing was recorded for this build, and this line does not claim an attempt that did not happen.",
      ),
    );
  }
  if (attempt) {
    values.push(
      authoredValue(
        "Attempt recorded on this plan",
        `${attempt.status} · provider ${attempt.providerId ?? "(none)"} · model ${attempt.model ?? "(none)"} · ` +
          `${attempt.latencyMs === null ? "latency not reported" : `${attempt.latencyMs} ms`} · ${attempt.at}`,
        plan.modelPath.rule,
        planSources,
        "The orchestrator's own record of the single attempt it made, when it made one.",
      ),
    );
    if (attempt.providerAnswer) {
      // The provider's own characters, declared as such. This app adds nothing
      // to them and the honesty audit does not phrase-scan them.
      values.push({
        state: "derived",
        label: "The provider's own answer",
        value: attempt.providerAnswer.text,
        rule: plan.modelPath.rule,
        sources: planSources,
        textOrigin: "provider_verbatim",
        reason: null,
        requires: [],
        envVars: [],
        note: `Returned by ${attempt.providerAnswer.providerId}${attempt.providerAnswer.model ? ` (${attempt.providerAnswer.model})` : ""} at ${attempt.providerAnswer.at}. Recorded character for character.`,
        display: null,
        templateText: null,
        ruleWhat: ruleWhatFor(plan.modelPath.rule),
        stateLabel: STATE_CHIP.derived,
      });
    }
  }
  if (plan.modelPath.modelTitles.length > 0) {
    values.push(
      authoredValue(
        TITLE_COPY.modelTitlesLabel,
        String(plan.modelPath.modelTitles.length),
        plan.modelPath.rule,
        planSources,
        "Titles a provider really returned, recorded verbatim and attributed to the provider and model that returned them.",
      ),
    );
  } else {
    values.push(
      authoredValue(
        TITLE_COPY.modelTitlesLabel,
        TITLE_COPY.modelTitlesNone,
        plan.modelPath.rule,
        planSources,
      ),
    );
  }

  return {
    id: "titles",
    title: SECTION_COPY.titles.title,
    basis: SECTION_COPY.titles.basis,
    values,
    rows: plan.categories.map((c) => titleCategoryRow(c, planSources)),
    groups: [],
    notes: plan.notes,
    emptyReason: plan.totalTitles === 0 ? "This project's own text filled none of the title templates, so this plan carries no title." : null,
    emptyRequires:
      plan.totalTitles === 0 ? ["stored text on this project that at least one of the plan's fixed templates can use"] : [],
  };
}

/**
 * The section that shows the package's own declaration of the data this product
 * does not have. Each missing metric becomes an EMPTY value naming exactly what
 * is absent — the app writes no value of its own in this section, and the
 * declaration itself is rendered unchanged from `honesty.absentData`.
 */
/* ------------------------------------------------------------------ */
/* P7-4 — the thumbnail concepts section                               */
/* ------------------------------------------------------------------ */

/** One control, as the surface shows it. Every word here comes from the plan. */
export interface StudioThumbnailControlView {
  id: string;
  label: string;
  about: string;
  operates: "specification" | "provider";
  rule: string;
  ruleWhat: string | null;
  capability: string | null;
  needsProvider: boolean;
}

/**
 * What the interactive control panel needs from the view: the control list, the
 * concepts it may be applied to, and the app's own words for the panel. The panel
 * lives in the client component because a control is a request; the view supplies
 * everything it says.
 */
export interface StudioThumbnailControlsPanel {
  sectionId: "thumbnails";
  panelTitle: string;
  intro: string;
  idleNote: string;
  choiceLabel: string;
  selectLabel: string;
  runLabel: string;
  busyLabel: string;
  failureNote: string;
  conceptIds: string[];
  defaultConceptId: string | null;
  controls: StudioThumbnailControlView[];
}

/** A boolean this app measured on the plan's own contents. */
function boolValue(label: string, value: boolean, rule: string, sources: SourceRef[], note: string): StudioValue {
  return {
    state: "derived",
    label,
    value,
    rule,
    sources,
    textOrigin: null,
    reason: null,
    requires: [],
    envVars: [],
    note,
    display: String(value),
    templateText: null,
    ruleWhat: ruleWhatFor(rule),
    stateLabel: STATE_CHIP.derived,
  };
}

/** The concept's declared tokens, in one readable line. No image is described by it. */
function tokenSummary(t: ThumbnailConcept["tokens"]): string {
  return (
    `subject zone: ${t.subjectZone} · overlay zone: ${t.textZone} · margin token: ${t.marginToken} · text block shape: ${t.textBlockShape} · ` +
    `background separation: ${t.separation} · background depth: ${t.depthToken} · background tone hint: ${t.toneHint} · ` +
    `typography: ${t.typography} · outline token: ${t.strokeToken} · palette token: ${t.paletteToken} · keying: ${t.keying} · ` +
    `mood token: ${t.moodToken ?? "(none)"} · variation: ${t.variation}`
  );
}

function thumbnailCriterionRow(concept: ThumbnailConcept, criterion: ThumbnailCriterion, fallback: SourceRef[]): StudioRow {
  const sources = criterion.sources.length > 0 ? criterion.sources : fallback;
  return {
    id: `${concept.id}-${criterion.id}`,
    kind: "thumbnail_criterion" as const,
    label: criterion.label,
    values: [
      authoredValue(
        `${criterion.label} ${THUMBNAIL_COPY.criterionLabelSuffix}`,
        `${criterion.score} ${THUMBNAIL_COPY.criterionScoreWord} ${criterion.maxScore} ${THUMBNAIL_COPY.criterionScaleWord}`,
        criterion.rule,
        sources,
        `${criterion.about} ${THUMBNAIL_COPY.criterionVerdictsLabel}: ` +
          criterion.features
            .map((f) => `${f.label} — ${f.present ? THUMBNAIL_COPY.criterionVerdictYes : THUMBNAIL_COPY.criterionVerdictNo} (${f.measured})`)
            .join(" · "),
      ),
      authoredValue(THUMBNAIL_COPY.criterionNotALabel, criterion.notA, criterion.rule, sources),
      authoredValue(THUMBNAIL_COPY.criterionFeatureSourceLabel, criterion.featureSource, criterion.rule, sources),
    ],
    texts: [],
    notes: [],
    children: [],
    reason: null,
  };
}

function thumbnailConceptRow(concept: ThumbnailConcept, fallback: SourceRef[]): StudioRow {
  const sources = concept.subject.state === "derived" && concept.subject.sources.length > 0 ? concept.subject.sources : fallback;
  const values: StudioValue[] = [
    studioValue(THUMBNAIL_COPY.overlayTextLabel, concept.overlayText),
    studioValue(THUMBNAIL_COPY.overlayRoleLabel, concept.overlayRole),
    studioValue(THUMBNAIL_COPY.overlayWordCountLabel, concept.overlayWordCount),
    studioValue(THUMBNAIL_COPY.overlayCharCountLabel, concept.overlayCharCount),
    studioValue(THUMBNAIL_COPY.subjectLabel, concept.subject),
    studioValue(THUMBNAIL_COPY.subjectRoleLabel, concept.subjectRole),
    studioValue(THUMBNAIL_COPY.backgroundLabel, concept.background),
    studioValue(THUMBNAIL_COPY.styleLabel, concept.style),
    studioValue(THUMBNAIL_COPY.compositionLabel, concept.composition),
    studioValue(THUMBNAIL_COPY.moodLabel, concept.mood),
    studioValue(THUMBNAIL_COPY.contrastPairLabel, concept.contrastPair),
    studioValue(THUMBNAIL_COPY.aspectLabel, concept.aspect),
    studioValue(
      THUMBNAIL_COPY.tokensLabel,
      derived(tokenSummary(concept.tokens), "R-THUMB-CONCEPT", sources, {
        textOrigin: "rule_authored",
        note:
          "Every token in this line is this app's own design vocabulary, taken from a fixed list in this app's own source file. The line " +
          "describes a specification, not a picture.",
      }),
    ),
    studioValue(THUMBNAIL_COPY.imageLabel, concept.image),
    authoredValue(THUMBNAIL_COPY.conceptAuthoredByLabel, concept.authoredBy, "R-THUMB-CONCEPT", sources, THUMBNAIL_COPY.conceptRuleNote),
  ];
  if (concept.revisedFrom) {
    values.push(
      authoredValue(
        THUMBNAIL_COPY.revisedFromLabel,
        concept.revisedFrom,
        "R-THUMB-CONTROL",
        sources,
        "The concept this one was derived from by a control, which advanced one of this app's ladders by one position.",
      ),
    );
  }
  return {
    id: concept.id,
    kind: "thumbnail_concept" as const,
    label: `Concept ${concept.index}`,
    values,
    texts: [],
    notes: [],
    children: concept.criteria.map((criterion) => thumbnailCriterionRow(concept, criterion, sources)),
    reason: null,
  };
}

/** The section that shows the concepts, their criteria and what is not here. */
function thumbnailsSection(pkg: PublishingPackage): StudioSection {
  const plan: ThumbnailPlan | undefined = pkg.thumbnails;
  const planSources: SourceRef[] = [{ kind: "project", id: pkg.projectId, path: "thumbnails" }];
  if (!plan) {
    return {
      id: "thumbnails",
      title: SECTION_COPY.thumbnails.title,
      basis: SECTION_COPY.thumbnails.basis,
      values: [],
      rows: [],
      groups: [],
      notes: [],
      emptyReason: THUMBNAIL_COPY.olderVersionReason,
      emptyRequires: ["a package built with the thumbnail concept engine, which this version of the app has"],
    };
  }

  const imageAbsence = plan.imageAbsence;
  const records = plan.records;
  const imagesProduced = plan.concepts.filter((c) => c.image.state === "derived").length;
  const envPhrase = imageAbsence.envVars.length > 0 ? imageAbsence.envVars.join(", ") : THUMBNAIL_COPY.imageRequirementNone;

  const values: StudioValue[] = [
    countValue(THUMBNAIL_COPY.countLabel, plan.totalConcepts, plan.countRule, planSources, "The length of this plan's own concept list, counted when the package was built. Nothing is estimated or padded."),
    countValue(THUMBNAIL_COPY.minimumLabel, plan.minimumRequested, plan.countRule, planSources, "The number of concepts the brief asks for as a minimum. It is compared with the count above, not assumed."),
    boolValue(
      THUMBNAIL_COPY.meetsMinimumLabel,
      plan.meetsMinimum,
      plan.countRule,
      planSources,
      `${plan.totalConcepts} concept(s) carried against the minimum of ${plan.minimumRequested}. A project whose own rows offer less than this says so in the plan's own notes rather than being padded.`,
    ),
    countValue(THUMBNAIL_COPY.maximumLabel, plan.maximumAllowed, plan.countRule, planSources, "The number of concepts the brief asks for as a maximum."),
    boolValue(THUMBNAIL_COPY.withinMaximumLabel, plan.withinMaximum, plan.countRule, planSources, `${plan.totalConcepts} concept(s) carried against the maximum of ${plan.maximumAllowed}.`),
    countValue(
      THUMBNAIL_COPY.criteriaPerConceptLabel,
      plan.criterionCount,
      plan.criterionRule,
      planSources,
      "The nine criteria the brief asks for, counted from this plan's own criterion list. Each concept below carries a count for every one of them.",
    ),
    countValue(THUMBNAIL_COPY.imagesProducedLabel, imagesProduced, plan.rule, planSources, THUMBNAIL_COPY.imagesProducedNote),
    authoredValue(THUMBNAIL_COPY.declarationLabel, plan.declaration.statement, plan.criterionRule, planSources, plan.declaration.scale),
    authoredValue(THUMBNAIL_COPY.declarationSpecificationLabel, plan.declaration.specificationNotPicture, plan.criterionRule, planSources),
    authoredValue(THUMBNAIL_COPY.declarationNotLabel, plan.declaration.whatACriterionIsNot, plan.criterionRule, planSources),
    authoredValue(THUMBNAIL_COPY.declarationScaleLabel, plan.declaration.scale, plan.criterionRule, planSources),
    authoredValue(THUMBNAIL_COPY.declarationIndependenceLabel, plan.declaration.criteriaAreNotIndependent, plan.criterionRule, planSources),
    authoredValue(THUMBNAIL_COPY.imageAbsenceLabel, imageAbsence.statement, imageAbsence.rule, planSources),
    authoredValue(THUMBNAIL_COPY.imageNotSubstitutedLabel, imageAbsence.notSubstituted, imageAbsence.rule, planSources),
    authoredValue(THUMBNAIL_COPY.imageEnvLabel, envPhrase, imageAbsence.rule, planSources, "The names are the ones the app's own provider registry derives for this capability, read from the registry rather than written here."),
    authoredValue(
      THUMBNAIL_COPY.imageWiredLabel,
      imageAbsence.wiredProviderIds.length > 0 ? imageAbsence.wiredProviderIds.join(", ") : "None",
      imageAbsence.rule,
      planSources,
      "Read from the app's own provider registry: which of the slots serving this capability has a real call() implementation today.",
    ),
    authoredValue(THUMBNAIL_COPY.imageRequirementLabel, imageAbsence.requirement, imageAbsence.rule, planSources),
    authoredValue(THUMBNAIL_COPY.recordLabel, records.model, records.rule, planSources),
    boolValue(THUMBNAIL_COPY.recordWrittenLabel, records.written, records.rule, planSources, "A boolean read from the plan's own record state, which no code writes as anything else."),
    authoredValue(THUMBNAIL_COPY.recordStatusLabel, records.reportedStatus ?? THUMBNAIL_COPY.recordStatusNone, records.rule, planSources),
    authoredValue(THUMBNAIL_COPY.recordStatusesLabel, records.refusedStatuses.join(", "), records.rule, planSources, "The statuses this app will not write for a concept that produced no image. A progress status would report work that is not happening."),
    authoredValue(THUMBNAIL_COPY.recordReasonLabel, records.reason, records.rule, planSources),
    studioValue(THUMBNAIL_COPY.criteriaPerConceptLabel, derived(plan.criterionCount, plan.criterionRule, planSources, { note: "The count of criteria on this plan, from this plan's own criterion list." })),
    studioValue(THUMBNAIL_COPY.modelPathLabel, plan.modelPath.state),
    authoredValue(THUMBNAIL_COPY.controlRuleLabel, plan.modelPath.requestBuilder, plan.modelPath.rule, planSources),
    authoredValue(
      THUMBNAIL_COPY.modelRequestFieldsLabel,
      plan.modelPath.requestFieldNames.join(", "),
      plan.modelPath.rule,
      planSources,
      "Read from the app's own request builder for this capability, so this list cannot describe a request the app does not make.",
    ),
  ];

  const attempt = plan.modelPath.attempt;
  if (plan.modelPath.orchestratorMessage) {
    values.push(
      authoredValue(
        THUMBNAIL_COPY.modelAttemptLabel,
        plan.modelPath.orchestratorMessage,
        plan.modelPath.rule,
        planSources,
        "The app's own AI orchestrator's sentence about this capability on this build. It is this app's wording, not a provider's.",
      ),
    );
  } else if (!attempt) {
    values.push(authoredValue(THUMBNAIL_COPY.modelAttemptLabel, THUMBNAIL_COPY.modelAttemptNone, plan.modelPath.rule, planSources));
  }
  if (attempt) {
    values.push(
      authoredValue(
        "Attempt recorded on this plan",
        `${attempt.status} · provider ${attempt.providerId ?? "(none)"} · model ${attempt.model ?? "(none)"} · ` +
          `${attempt.latencyMs === null ? "latency not reported" : `${attempt.latencyMs} ms`} · ${attempt.at}`,
        plan.modelPath.rule,
        planSources,
      ),
    );
    if (attempt.providerAnswer) {
      values.push({
        state: "derived",
        label: "The provider's own answer",
        value: attempt.providerAnswer.text,
        rule: plan.modelPath.rule,
        sources: planSources,
        textOrigin: "provider_verbatim",
        reason: null,
        requires: [],
        envVars: [],
        note: `Returned by ${attempt.providerAnswer.providerId}${attempt.providerAnswer.model ? ` (${attempt.providerAnswer.model})` : ""} at ${attempt.providerAnswer.at}. Recorded character for character.`,
        display: null,
        templateText: null,
        ruleWhat: ruleWhatFor(plan.modelPath.rule),
        stateLabel: STATE_CHIP.derived,
      });
    }
  }
  values.push(
    plan.modelPath.providerConcepts.length > 0
      ? authoredValue(
          THUMBNAIL_COPY.modelProviderConceptsLabel,
          String(plan.modelPath.providerConcepts.length),
          plan.modelPath.rule,
          planSources,
          plan.modelPath.authoredByModel,
        )
      : authoredValue(
          THUMBNAIL_COPY.modelProviderConceptsLabel,
          THUMBNAIL_COPY.modelProviderConceptsNone,
          plan.modelPath.rule,
          planSources,
          plan.modelPath.authoredByModel,
        ),
  );

  const rows: StudioRow[] = plan.concepts.map((concept) => thumbnailConceptRow(concept, planSources));
  for (const control of plan.controls) {
    rows.push({
      id: `thumbnail-control-${control.id}`,
      kind: "thumbnail_control" as const,
      label: control.label,
      values: [
        authoredValue(THUMBNAIL_COPY.controlOperatesLabel, control.operates, control.rule, planSources),
        authoredValue(THUMBNAIL_COPY.controlRuleLabel, control.rule, control.rule, planSources),
        authoredValue(
          THUMBNAIL_COPY.controlCapabilityLabel,
          control.capability ?? THUMBNAIL_COPY.controlNoCapability,
          control.rule,
          planSources,
          "Read from the plan's own control list, which is written in this app's source file.",
        ),
      ],
      texts: [],
      notes: [control.about],
      children: [],
      reason: null,
    });
  }

  const ladderRows: StudioRow[] = plan.overlayLadder.map((candidate, i) => ({
    id: `thumbnail-ladder-${candidate.id}-${i + 1}`,
    kind: "thumbnail_ladder" as const,
    label: `${i + 1}. ${(candidate.id ?? "").replace(/^cand-/, "")}`,
    values: [
      studioValue(THUMBNAIL_COPY.overlayTextLabel, derived(candidate.text, "R-THUMB-TEXT", candidate.sources, { textOrigin: "source_verbatim", note: candidate.from })),
      studioValue(
        THUMBNAIL_COPY.ladderWordCountLabel,
        derived(candidate.wordCount, "R-THUMB-TEXT", candidate.sources, { note: `Counted on this candidate's own text: ${candidate.wordCount} word(s).` }),
      ),
      studioValue(THUMBNAIL_COPY.ladderRoleLabel, derived(candidate.roleLabel, "R-THUMB-TEXT", candidate.sources, { textOrigin: "rule_authored" })),
    ],
    texts: [],
    notes: [],
    children: [],
    reason: null,
  }));

  return {
    id: "thumbnails",
    title: SECTION_COPY.thumbnails.title,
    basis: SECTION_COPY.thumbnails.basis,
    values,
    rows: [...rows, ...ladderRows],
    groups: [],
    notes: plan.notes,
    emptyReason:
      plan.totalConcepts === 0
        ? "This project's own rows produced no concept at all, so this plan carries none and nothing is shown in their place."
        : null,
    emptyRequires: plan.totalConcepts === 0 ? ["a project row whose own stored text one of this plan's ladders can read"] : [],
  };
}

/** The control panel's own data: the controls, the concepts and the app's words. */
function thumbnailControlsPanel(pkg: PublishingPackage): StudioThumbnailControlsPanel | null {
  const plan: ThumbnailPlan | undefined = pkg.thumbnails;
  if (!plan || plan.totalConcepts === 0) return null;
  return {
    sectionId: "thumbnails",
    panelTitle: THUMBNAIL_COPY.controlPanelTitle,
    intro: THUMBNAIL_COPY.controlPanelIntro,
    idleNote: THUMBNAIL_COPY.controlPanelIdle,
    choiceLabel: THUMBNAIL_COPY.controlChoiceLabel,
    selectLabel: THUMBNAIL_COPY.controlSelectLabel,
    runLabel: THUMBNAIL_COPY.controlRunLabel,
    busyLabel: THUMBNAIL_COPY.controlBusyLabel,
    failureNote: THUMBNAIL_COPY.controlFailureNote,
    conceptIds: plan.concepts.map((concept) => concept.id),
    defaultConceptId: plan.concepts[0]?.id ?? null,
    controls: plan.controls.map((control) => ({
      id: control.id,
      label: control.label,
      about: control.about,
      operates: control.operates,
      rule: control.rule,
      ruleWhat: ruleWhatFor(control.rule),
      capability: control.capability,
      needsProvider: control.capability !== null,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* The answer a control gives                                          */
/* ------------------------------------------------------------------ */

/**
 * WHAT A CONTROL'S ANSWER LOOKS LIKE ON THE PAGE.
 *
 * A control is a request, so its answer is built by the same view module as the
 * page and passes the same honesty audit: the revised concept is rendered as a
 * traced concept, the change is rendered as a traced record, and a refusal is
 * rendered as a non-derived value whose reason and requirement are the control's
 * own. Nothing here can report a change an image did not undergo, because no
 * branch of this file produces an image, a file or a success of any kind.
 */
export interface ThumbnailControlResultView {
  kind: "thumbnail_control_result";
  projectId: string;
  controlId: string;
  controlLabel: string;
  status: ThumbnailControlOutcome["status"];
  title: string;
  note: string;
  rule: string;
  sections: StudioSection[];
}

export type ThumbnailControlResult = ThumbnailControlResultView | StudioAuditFailedView;

function thumbnailChangeSection(outcome: ThumbnailControlOutcome): StudioSection {
  const change = outcome.change!;
  const fromField: Field<string> = derived(change.from.label, change.rule, change.from.sources, {
    textOrigin: change.from.textOrigin,
    note: `The candidate this part of the specification moved from (${change.from.candidateId}).`,
  });
  const toField: Field<string> = derived(change.to.label, change.rule, change.to.sources, {
    textOrigin: change.to.textOrigin,
    note: `The candidate this part of the specification moved to (${change.to.candidateId}).`,
  });
  return {
    id: "thumbnail_change",
    title: THUMBNAIL_COPY.changeSectionTitle,
    basis: change.note,
    values: [
      authoredValue(THUMBNAIL_COPY.changeLabels.control, outcome.controlLabel, change.rule, change.to.sources, change.what),
      authoredValue(THUMBNAIL_COPY.changeLabels.field, change.field, change.rule, change.to.sources),
      studioValue(THUMBNAIL_COPY.changeLabels.from, fromField),
      studioValue(THUMBNAIL_COPY.changeLabels.to, toField),
      authoredValue(THUMBNAIL_COPY.changeLabels.conceptFrom, change.conceptIdFrom, change.rule, change.to.sources),
      authoredValue(THUMBNAIL_COPY.changeLabels.rule, change.rule, change.rule, change.to.sources),
      authoredValue(THUMBNAIL_COPY.changeLabels.note, change.note, change.rule, change.to.sources),
    ],
    rows: [],
    groups: [],
    notes: [],
    emptyReason: null,
    emptyRequires: [],
  };
}

function thumbnailRefusalSection(outcome: ThumbnailControlOutcome): StudioSection {
  const refusal = outcome.refusal!;
  const field: Field<never> =
    refusal.envVars.length > 0
      ? gatedProvider(refusal.reason, refusal.requires, refusal.envVars, {
          note: "This is the control's own refusal. Nothing was produced, and the concept it names is unchanged.",
        })
      : emptyNoInput(refusal.reason, refusal.requires, {
          note: "This is the control's own refusal. Nothing was produced, and the concept it names is unchanged.",
        });
  const sources: SourceRef[] = [{ kind: "request", id: `control:${outcome.control}` }];
  return {
    id: "thumbnail_refusal",
    title: THUMBNAIL_COPY.refusalSectionTitle,
    basis: THUMBNAIL_COPY.controlRefusedNote,
    values: [
      studioValue(outcome.controlLabel, field),
      authoredValue(THUMBNAIL_COPY.changeLabels.rule, outcome.rule, outcome.rule, sources),
      authoredValue(THUMBNAIL_COPY.controlRefusedRequiresLabel, refusal.requires.join(" · "), outcome.rule, sources),
    ],
    rows: [],
    groups: [],
    notes: [],
    emptyReason: null,
    emptyRequires: [],
  };
}

/**
 * Builds the view for one control's answer and runs the package's own honesty
 * audit over it, exactly as the page does. A failure returns the honest failure
 * state instead of an unchecked view.
 */
export function buildThumbnailControlResultView(input: {
  projectId: string;
  outcome: ThumbnailControlOutcome;
  skipAudit?: boolean;
}): ThumbnailControlResult {
  const outcome = input.outcome;
  const planSources: SourceRef[] = [{ kind: "project", id: input.projectId, path: "thumbnails" }];
  const applied = outcome.status === "applied" && outcome.concept !== null && outcome.change !== null;
  const view: ThumbnailControlResultView = {
    kind: "thumbnail_control_result",
    projectId: input.projectId,
    controlId: outcome.control,
    controlLabel: outcome.controlLabel,
    status: outcome.status,
    title: applied ? THUMBNAIL_COPY.controlAppliedTitle : THUMBNAIL_COPY.controlRefusedTitle,
    note: applied ? THUMBNAIL_COPY.controlAppliedNote : THUMBNAIL_COPY.controlRefusedNote,
    rule: outcome.rule,
    sections: applied
      ? [
          {
            id: "thumbnail_revision",
            title: THUMBNAIL_COPY.revisionSectionTitle,
            basis: THUMBNAIL_COPY.conceptRuleNote,
            values: [],
            rows: [thumbnailConceptRow(outcome.concept as ThumbnailConcept, planSources)],
            groups: [],
            notes: [],
            emptyReason: null,
            emptyRequires: [],
          },
          thumbnailChangeSection(outcome),
        ]
      : [thumbnailRefusalSection(outcome)],
  };
  if (input.skipAudit) return view;
  return auditedOrFailed(view);
}

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
  /** Absent on a package stored before the quotation rule (P7-3b). */
  quotedSentences?: number;
  quotedFragments?: number;
  unverifiedTemplateFills?: number;
  /** Absent on the package's own stored `selfAudit`, which records no list. */
  violations?: readonly { path: string; kind: string; detail: string }[];
}): StudioAuditView {
  return {
    label,
    ok: audit.ok,
    violationCount: audit.violationCount,
    inspectedKeys: audit.inspectedKeys,
    inspectedStrings: audit.inspectedStrings,
    quotedSentences: audit.quotedSentences ?? 0,
    quotedFragments: audit.quotedFragments ?? 0,
    unverifiedTemplateFills: audit.unverifiedTemplateFills ?? 0,
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
}): StudioEmptyView | StudioAuditFailedView {
  const view: StudioEmptyView = {
    kind: "empty",
    projectId: input.projectId,
    projectTitle: projectTitleValue({
      projectId: input.projectId,
      title: input.projectTitle,
      from: PROJECT_TITLE_COPY.fromProjectRow,
    }),
    title: "No package has been saved for this project yet",
    body:
      "Nothing is shown on this page about chapters, description, keywords, tags, hashtags, the pinned comment or asset licences, because this project has no saved package to show. Build one and it is derived from this project's own rows, saved as a version, and shown here.",
    requires: ["a saved publishing package for this project"],
    versionRows: versionRows(input.versions, null),
  };
  return auditedOrFailed(view);
}
/**
 * THE VIEW A FAILED CHECK LEAVES BEHIND — built from the audit's own result and
 * this app's fixed copy, and from nothing else.
 *
 * Each failure is carried as its PATH and its KIND. The audit's `detail` sentence
 * is deliberately dropped: it names the offending characters, and this state
 * exists precisely because those characters may not be shown. A location is not a
 * claim; a reprint would be one.
 */
export function auditFailedView(input: { projectId: string; audit: AuditResult }): StudioAuditFailedView {
  return {
    kind: "audit_failed",
    projectId: input.projectId,
    title: VIEW_AUDIT_FAILURE_COPY.title,
    body: VIEW_AUDIT_FAILURE_COPY.body,
    note: VIEW_AUDIT_FAILURE_COPY.note,
    requires: [...VIEW_AUDIT_FAILURE_COPY.requires],
    violations: input.audit.violations.map((violation) => ({ path: violation.path, kind: violation.kind })),
    violationCount: input.audit.violationCount,
    inspectedKeys: input.audit.inspectedKeys,
    inspectedStrings: input.audit.inspectedStrings,
    checkedAt: input.audit.checkedAt,
  };
}
/**
 * The view when it passes its own check, and the honest failure state when it does
 * not. It does NOT throw: throwing is what produced a blank page with no
 * explanation, which is the least honest outcome available. Nothing unchecked is
 * ever returned — the two possible results are the audited view and the state that
 * shows nothing.
 *
 * The state it falls back to is not re-audited per request, because it is built
 * from compiled-in copy plus locations, never from the view that failed; the suite
 * asserts instead that it passes the same audit (`studio-view.test.ts`). A state
 * that could itself fail the check would be able to reproduce the very blank page
 * it exists to prevent.
 */
function auditedOrFailed<T extends { projectId: string }>(built: T): T | StudioAuditFailedView {
  const audit = auditPublishingPackage(built);
  return audit.ok ? built : auditFailedView({ projectId: built.projectId, audit });
}

/**
 * Runs the package's own honesty audit over anything this page is about to
 * render and THROWS if it fails. Exported so the check is testable: a value
 * with no rule, a rule outside the catalogue, a derived value with no source, an
 * empty value with no reason, a banned claim in the app's own copy, or a
 * metric-shaped key anywhere in the view all fail here rather than reaching a
 * user.
 *
 * The two BUILDERS do not call this. They use `auditedOrFailed`, which returns the
 * same verdict as a value instead of an exception: a throw on a live request is a
 * blank page with no explanation, which is the least honest outcome available. This
 * remains the guard the build-time tests reach for, where an exception is exactly
 * what a test wants.
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
 * Builds the view, then runs the package's own honesty audit over it. Returns the
 * audited view when it passes and the honest failure state (`audit_failed`) when it
 * does not, so a misleading or unbacked value cannot reach a user and a failed
 * check cannot leave a blank page with no explanation. See `auditedOrFailed`.
 */
export function buildCreatorStudioView(input: BuildStudioViewInput): StudioView | StudioAuditFailedView {
  const pkg = input.package;
  const absent = absentDataSection(pkg);
  const view: StudioView = {
    kind: "package",
    projectId: input.projectId,
    projectTitle: storedProjectTitleValue(pkg),
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
      titlesSection(pkg),
      thumbnailsSection(pkg),
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
    thumbnailControls: thumbnailControlsPanel(pkg),
    stateChips: STATE_CHIP,
  };

  // The page carries the package's own declaration and its own omission list, so
  // both are rendered as the package's data rather than restated by the app.
  if (!input.skipAudit) return auditedOrFailed(view);
  return view;
}

export { LICENCE_ROW_EMPTY_NOTE, START_EMPTY_HINT, SUMMARY_COPY, VALUE_LABELS, SECTION_COPY, AUDIT_COPY, LICENCE_COPY };
