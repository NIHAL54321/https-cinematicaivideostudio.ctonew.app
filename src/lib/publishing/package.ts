/**
 * Phase 7 Block 1 — THE PUBLISHING PACKAGE.
 *
 * One project in, one derived, traceable package out. Everything in it comes
 * from rows this app really has, and every value says how it was derived
 * (rule id + source) or which input is missing. Nothing here is model-authored:
 * the AI-authored parts of a publishing package (titles, thumbnail concepts,
 * copy) are P7-2 and are declared ABSENT in `honesty.notInThisPackage` rather
 * than faked.
 *
 * The package AUDITS ITSELF before it is returned. If any of the honesty
 * invariants fail — a metric-shaped key, a rule-authored sentence containing a
 * banned claim, a derived value with no rule or no source — building throws, so
 * a misleading package cannot exist, let alone be saved.
 *
 * `sourceFingerprint` is a deterministic hash of the rows the package was built
 * from, so a saved package can be shown to belong to a specific source state.
 */
import { auditPublishingPackage, PublishingHonestyError, type AuditResult, type AuditViolation } from "./audit";
import { buildChapters, type ChapterPlanView } from "./chapters";
import { buildDescription, type DescriptionPlan } from "./description";
import { buildKeywordPlan, ABSENT_MARKET_DATA, type KeywordPlan } from "./keywords";
import { buildAssetLicenceReport, type AssetLicenceReport } from "./licensing";
import { buildPinnedComment, type PinnedComment } from "./pinned-comment";
import { derived, fieldStats, fnv1a64, type Field } from "./provenance";
import { buildTagPlan, type TagPlan } from "./tags";
import type { PublishingSource } from "./types";

export const PUBLISHING_PACKAGE_FORMAT = "cavs.publishing-package/v1";

/** What this block does NOT contain, named individually. */
export interface NotInThisPackageEntry {
  id: "titles" | "thumbnail_concepts" | "quality_checker" | "safety_screening" | "creator_studio_workspace";
  label: string;
  block: string;
  /** True when producing it needs a model/provider that is not connected here. */
  needsProvider: boolean;
  /** Env var NAMES only, derived from the app's provider registry by the caller. */
  envVars: string[];
  reason: string;
}

export interface PublishingPackageSummary {
  chapters: number;
  scenes: number;
  scenesWithoutDuration: number;
  descriptionSectionsIncluded: number;
  descriptionSectionsOmitted: number;
  descriptionCharacters: number;
  keywords: number;
  tags: number;
  hashtags: number;
  assets: number;
  licenceRowsVerified: number;
  licenceRowsUnknown: number;
  fields: { total: number; derived: number; emptyNoInput: number; gatedProvider: number };
}

export interface PublishingHonesty {
  statement: string;
  /** The market data this product does not have, and did not use. */
  absentData: typeof ABSENT_MARKET_DATA;
  /** The parts of Phase 7 that are not in this package, and why. */
  notInThisPackage: NotInThisPackageEntry[];
  /** Every rule id this package can emit, so a consumer can resolve them. */
  ruleCatalogue: string;
}

export interface PublishingPackage {
  format: typeof PUBLISHING_PACKAGE_FORMAT;
  kind: "publishing_package";
  block: "P7-1";
  projectId: string;
  projectTitle: Field<string>;
  derivedAt: string;
  sourceFingerprint: string;
  fingerprintRule: "R-PKG-SOURCE-FINGERPRINT";
  countsRule: "R-PKG-COUNTS";
  summary: PublishingPackageSummary;
  chapters: ChapterPlanView;
  description: DescriptionPlan;
  pinnedComment: PinnedComment;
  keywords: KeywordPlan;
  tags: TagPlan;
  assetLicences: AssetLicenceReport;
  honesty: PublishingHonesty;
  selfAudit: {
    ok: boolean;
    violationCount: number;
    inspectedKeys: number;
    inspectedStrings: number;
    checkedAt: string;
  };
}

export interface PublishingPackageOptions {
  /** Injection point for tests; defaults to now. */
  now?: Date;
  /**
   * Provider env var NAMES (never values) that a model-authored copy step would
   * need. The CALLER derives these from the app's own provider registry — this
   * module never invents a variable name and never reads process.env.
   */
  modelCopyEnvNames?: readonly string[];
  /** Set false only in tests of the audit itself. */
  selfAudit?: boolean;
}

const HONESTY_STATEMENT =
  "Every value in this package is either derived from this project's own rows — with the rule and the source row named on the value — or deliberately empty and saying which input is missing. " +
  "No value was written by a language model, and none was invented to fill a gap. There is no search-volume, difficulty, competition, trend or estimated-traffic data anywhere in this product, and no such value exists in this package.";

function notInThisPackage(envNames: readonly string[]): NotInThisPackageEntry[] {
  const envPhrase = envNames.length > 0 ? ` it would need the provider env var(s) ${envNames.join(" / ")}` : "";
  return [
    {
      id: "titles",
      label: "Generated titles",
      block: "P7-2",
      needsProvider: true,
      envVars: [...envNames],
      reason:
        `This package carries the project's OWN title (R-DESC-TITLE) and nothing else. A list of alternative titles would be authored text, which belongs to P7-2, so it is not in this block and no placeholder list is printed.${envPhrase ? ` Where a model-authored title list is built,${envPhrase}.` : ""}`,
    },
    {
      id: "thumbnail_concepts",
      label: "Thumbnail concepts",
      block: "P7-2",
      needsProvider: true,
      envVars: [...envNames],
      reason:
        "Thumbnail concepts belong to P7-2 and are image/design work, not text derived from this project's rows. Nothing here describes, renders or scores a thumbnail.",
    },
    {
      id: "quality_checker",
      label: "Quality check + score",
      block: "P7-3",
      needsProvider: false,
      envVars: [],
      reason:
        "The 17-point quality check and its 0–100 score belong to P7-3. This package carries no quality score of any kind, because a score computed here would be a number with no measurement behind it.",
    },
    {
      id: "safety_screening",
      label: "Content-safety and content-quality screening",
      block: "P7-4",
      needsProvider: false,
      envVars: [],
      reason:
        "Screening flags belong to P7-4. This package carries the licence DATA (assetLicences) that P7-4 will screen against, and it makes no safety or clearance claim of its own.",
    },
    {
      id: "creator_studio_workspace",
      label: "Creator Studio workspace",
      block: "P7-5",
      needsProvider: false,
      envVars: [],
      reason: "The surface that shows this package to a user is P7-5. This block builds and persists the package only.",
    },
  ];
}

/** The deterministic fingerprint of every row that fed this package. */
export function sourceFingerprint(source: PublishingSource): string {
  const parts: string[] = [
    "publishing-package",
    PUBLISHING_PACKAGE_FORMAT,
    source.project.id,
    source.project.title,
    source.project.description ?? "",
    source.project.targetAspectRatio ?? "",
    source.project.targetDurationSeconds === null ? "" : String(source.project.targetDurationSeconds),
    source.project.updatedAt,
  ];
  const settings = source.settings;
  parts.push(
    settings
      ? [
          settings.seoDefaultsDescription ?? "",
          settings.language ?? "",
          settings.tone ?? "",
          settings.style ?? "",
          settings.targetAudience ?? "",
        ].join("\u001f")
      : "no-settings",
  );
  const script = source.script;
  parts.push(
    script
      ? [script.id, script.title ?? "", script.logline ?? "", script.language ?? "", script.tone ?? "", script.style ?? "", script.targetAudience ?? ""].join("\u001f")
      : "no-script",
  );
  for (const chapter of [...source.chapters].sort((a, b) => a.order - b.order)) {
    parts.push(["chapter", chapter.id, String(chapter.order), chapter.title, chapter.summary ?? ""].join("\u001f"));
    for (const scene of [...chapter.scenes].sort((a, b) => a.order - b.order)) {
      parts.push(
        [
          "scene",
          scene.id,
          String(scene.order),
          scene.title ?? "",
          scene.narration ?? "",
          scene.durationSeconds === null ? "" : String(scene.durationSeconds),
          scene.status,
        ].join("\u001f"),
      );
    }
  }
  for (const asset of [...source.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    parts.push(["asset", asset.id, asset.name, asset.kind, asset.status, asset.createdAt].join("\u001f"));
    parts.push(
      asset.licensing
        ? [
            "licensing",
            asset.licensing.id,
            asset.licensing.licenseType,
            asset.licensing.source ?? "",
            asset.licensing.attribution ?? "",
            asset.licensing.licenseUrl ?? "",
            asset.licensing.purchasedAt ?? "",
            asset.licensing.expiresAt ?? "",
          ].join("\u001f")
        : "no-licensing-row",
    );
  }
  return fnv1a64(parts);
}

/**
 * Builds the whole package. Throws `PublishingHonestyError` if the result fails
 * its own honesty audit — a package that could mislead must not be produced.
 */
export function buildPublishingPackage(
  source: PublishingSource,
  opts: PublishingPackageOptions = {},
): PublishingPackage {
  const derivedAt = opts.now ?? new Date();
  const derivedAtIso = derivedAt.toISOString();

  const chapters = buildChapters(source);
  const keywords = buildKeywordPlan(source);
  const tags = buildTagPlan(source, keywords);
  const description = buildDescription(source, chapters, tags);
  const pinnedComment = buildPinnedComment(source, chapters, keywords);
  const assetLicences = buildAssetLicenceReport(source, derivedAt);

  const projectTitle: Field<string> = derived(
    source.project.title,
    "R-DESC-TITLE",
    [{ kind: "project", id: source.project.id, path: "title" }],
    { textOrigin: "source_verbatim", note: "The project's own title column." },
  );

  const core: Omit<PublishingPackage, "summary" | "honesty" | "selfAudit"> = {
    format: PUBLISHING_PACKAGE_FORMAT,
    kind: "publishing_package",
    block: "P7-1",
    projectId: source.project.id,
    projectTitle,
    derivedAt: derivedAtIso,
    sourceFingerprint: sourceFingerprint(source),
    fingerprintRule: "R-PKG-SOURCE-FINGERPRINT",
    countsRule: "R-PKG-COUNTS",
    chapters,
    description,
    pinnedComment,
    keywords,
    tags,
    assetLicences,
  };

  const stats = fieldStats(core);
  const summary: PublishingPackageSummary = {
    chapters: chapters.chapterCount,
    scenes: chapters.sceneCount,
    scenesWithoutDuration: chapters.scenesWithoutDuration,
    descriptionSectionsIncluded: description.includedSections.length,
    descriptionSectionsOmitted: description.omitted.length,
    descriptionCharacters: description.characterCount,
    keywords: keywords.totalKeywords,
    tags: tags.tagCount,
    hashtags: tags.hashtagCount,
    assets: assetLicences.counts.assets,
    licenceRowsVerified: assetLicences.counts.verifiedRow,
    licenceRowsUnknown: assetLicences.counts.unknownUnverified,
    fields: {
      total: stats.total,
      derived: stats.derived,
      emptyNoInput: stats.emptyNoInput,
      gatedProvider: stats.gatedProvider,
    },
  };

  const honesty: PublishingHonesty = {
    statement: HONESTY_STATEMENT,
    absentData: ABSENT_MARKET_DATA,
    notInThisPackage: notInThisPackage(opts.modelCopyEnvNames ?? []),
    ruleCatalogue: "src/lib/publishing/rules.ts (PUBLISHING_RULES) — every rule id emitted above resolves there, with what it does and the basis it rests on.",
  };

  const body = { ...core, summary, honesty };

  const audit: AuditResult = opts.selfAudit === false
    ? { ok: true, violationCount: 0, inspectedKeys: 0, inspectedStrings: 0, checkedAt: derivedAtIso, violations: [] }
    : auditPublishingPackage(body, { now: derivedAt });

  if (!audit.ok) throw new PublishingHonestyError(audit.violations);

  return {
    ...body,
    selfAudit: {
      ok: audit.ok,
      violationCount: audit.violationCount,
      inspectedKeys: audit.inspectedKeys,
      inspectedStrings: audit.inspectedStrings,
      checkedAt: audit.checkedAt,
    },
  };
}

/** Re-runs the audit on a package that came back from storage. */
export function auditStoredPackage(pkg: unknown, opts: { now?: Date } = {}): AuditResult {
  return auditPublishingPackage(pkg, opts);
}

export type { AuditViolation };
