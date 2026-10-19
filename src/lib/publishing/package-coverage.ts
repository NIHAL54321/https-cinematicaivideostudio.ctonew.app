/**
 * Phase 7 Block 7 — THE WORKSPACE'S OWN MAP OF THE STORED PACKAGE.
 *
 * The Creator Studio has to do what the rest of this product does: show a reader
 * the thing itself, and where it cannot, say so in words rather than leaving a
 * gap. This module is that discipline applied to the WORKSPACE as a whole. It
 * takes the stored package — the bytes the server read back, whatever format they
 * were written in — and walks it, key by key, so the surface can state two things
 * it would otherwise only assert:
 *
 *   1. which PARTS of the package the workspace shows, and the section it shows
 *      each one in (`COVERAGE_MAP` below, one entry per part);
 *   2. every part the walk found that NO section of the workspace shows. Those
 *      are returned as `uncovered` with an app-authored line about them, and the
 *      workspace renders that line. A part cannot be passed over in silence.
 *
 * WHY THE WALK IS OVER THE STORED OBJECT AND NOT OVER A LIST OF KEYS TYPED HERE.
 * `Object.entries` on the payload the server actually read means a part this
 * build's `PublishingPackage` type does not know about — a newer format, a field
 * added later, a payload written by an older build — is found and named rather
 * than ignored. A hand-typed key list would have gone stale the first time the
 * package grew, and the staleness would have been invisible.
 *
 * WHAT THIS MODULE DOES NOT CLAIM. It is a map, not a proof that every character
 * of a part appears on the page: the counts it returns are the values the walk
 * really found at that part's leaves, and each section states for itself what it
 * renders and what it withdraws — with the reason. The one claim it does make is
 * checkable and is checked: every part the walk finds is either mapped to a
 * section id that this workspace really renders, or is named as unmapped.
 */
import type { PublishingPackage } from "./package";

/** One part of the stored package, and the section of the workspace that shows it. */
export interface CoverageMapping {
  /** The part, as a dotted path inside the package (e.g. `titles.modelPath`). */
  path: string;
  /** The id of the workspace section that shows it. `null` is not used here: see `uncovered`. */
  sectionId: string;
  /** The app's own sentence about what that section does with the part. */
  note: string;
}

/**
 * ONE ENTRY PER PART THE WALK FOUND, with what the walk measured at its leaves.
 */
export interface CoverageEntry {
  path: string;
  sectionId: string;
  note: string;
  /** Values found at the leaves of this part. A measurement of the walk, not an estimate. */
  values: number;
}

/** A part the walk found that no section of the workspace shows. */
export interface UncoveredPart {
  path: string;
  values: number;
  /** The app's own line about it — the reason it is not shown, stated rather than implied. */
  statement: string;
}

export interface PackageCoverage {
  /** The mapping the workspace declares, in reading order, for the parts it found. */
  entries: CoverageEntry[];
  /** Parts the walk found with no section named for them. Empty is the state this build expects. */
  uncovered: UncoveredPart[];
  /** Every leaf value the walk found in the stored package. */
  valuesWalked: number;
  /** Leaf values that sit under a part with a section named for it. */
  valuesMapped: number;
  /** Leaf values that sit under a part with none. */
  valuesUncovered: number;
  /** The app's own sentence about what the walk found. Rendered as the package's own data. */
  statement: string;
}

/**
 * THE MAPPING. One entry per part of the package, and the section that shows it.
 *
 * Longest prefix wins (see `sectionFor`), so `titles.modelPath` is shown by the
 * model-path section while the rest of `titles` is shown by the titles section.
 * A part that is not listed here is NOT silently dropped: the walk returns it in
 * `uncovered` and the workspace renders that line.
 *
 * The ids must be ids this workspace really renders — the view's own section ids
 * or one of `WORKSPACE_CARD_IDS` (see ./studio-view). A test asserts that, so a
 * mapping can never name a section that does not exist on the page.
 */
export const COVERAGE_MAP: readonly CoverageMapping[] = [
  {
    path: "projectTitle",
    sectionId: "package",
    note: "The package section shows it as a declared quotation of this project's own title, with the row it was read from.",
  },
  {
    path: "summary",
    sectionId: "package",
    note: "Every key the package records about itself, shown in the package section as a count walked from its own contents.",
  },
  {
    path: "format",
    sectionId: "package",
    note: "The format this package was stored in. Shown by the package section beside the values derived from it.",
  },
  {
    path: "chapters",
    sectionId: "chapters",
    note: "The chapters section: the plan's own counts and one row per chapter, with its scenes, titles, stored order and summed timings.",
  },
  {
    path: "description",
    sectionId: "description",
    note: "The description section: the assembled text, its length, and every section the rules left out with the input it wanted.",
  },
  {
    path: "keywords",
    sectionId: "keywords",
    note: "The keywords section: the five named groupings of this project's own phrases, with how often each occurs in its own text.",
  },
  {
    path: "tags",
    sectionId: "tags",
    note: "The tags section: the tag line, its budget against the platform's published limit, and the phrases that did not fit.",
  },
  {
    path: "hashtags",
    sectionId: "hashtags",
    note: "The hashtags section: the hashtags placed in the description, separated from the ones produced and not placed.",
  },
  {
    path: "pinnedComment",
    sectionId: "pinned_comment",
    note: "The pinned comment section: the comment, the template it was selected from, and the topic phrase substituted into it.",
  },
  {
    path: "assetLicences",
    sectionId: "licences",
    note: "The asset licences section: one row per asset, with its licence record or the fact that no licence row exists for it, and its origin row.",
  },
  {
    path: "screening",
    sectionId: "screening",
    note: "The screening section: each area's rule, what it read, its flags with the exact characters and span they matched, and the part no capability here examines.",
  },
  {
    path: "titles.modelPath",
    sectionId: "seo_path",
    note: "The model path section: the capability the app asked for, the fields its request builder would send, what the orchestrator answered, the provider's own values, and what the screen withheld.",
  },
  {
    path: "titles",
    sectionId: "titles",
    note: "The titles section: every rule-derived option with its template, the rows it read and each fragment's span, plus the six axis counts.",
  },
  {
    path: "thumbnails",
    sectionId: "thumbnails",
    note: "The thumbnail concepts section: one traced specification per concept, its criteria counts, the seven controls, and the image slot declared absent.",
  },
  {
    path: "quality.fileMeasurement",
    sectionId: "export_state",
    note: "The video and export state section: what a probe of the produced file reported, or the measurement that was not made and the input it needs.",
  },
  {
    path: "quality.loudnessMeasurement",
    sectionId: "export_state",
    note: "The video and export state section: what the loudness pass reported, or the pass that could not run and what it needs.",
  },
  {
    path: "quality.declaredTarget",
    sectionId: "export_state",
    note: "The video and export state section: the delivery target the checks compare against, or the reason no target was declared.",
  },
  {
    path: "quality.timeline",
    sectionId: "export_state",
    note: "The video and export state section: the timeline the timing checks used, including any scene whose stored duration is missing.",
  },
  {
    path: "quality",
    sectionId: "quality",
    note: "The quality check section: all seventeen checks with their three-state results, the measurement behind each, and the arithmetic of the score.",
  },
  {
    path: "honesty.statement",
    sectionId: "honesty",
    note: "The workspace's honesty statement, printed above the sections from the package's own data rather than restated by this page.",
  },
  {
    path: "honesty.absentData",
    sectionId: "absent",
    note: "The absent-data section: the package's own declaration of the kinds of data this product does not hold, each rendered as an empty value naming it.",
  },
  {
    path: "honesty.notInThisPackage",
    sectionId: "gated",
    note: "The \"what this package does not contain\" card: each named omission with its reason and the provider environment variable it would need.",
  },
  {
    path: "honesty.ruleCatalogue",
    sectionId: "coverage",
    note: "This map: the pointer to where this package's rule ids resolve, printed here unchanged.",
  },
  {
    path: "selfAudit",
    sectionId: "audit",
    note: "The package's-own-check card: the audit the package ran on itself when it was built and the same check re-run on the stored bytes.",
  },
  {
    path: "kind",
    sectionId: "package",
    note: "What the stored object says it is. Shown by the package section as one of its own values.",
  },
  {
    path: "block",
    sectionId: "package",
    note: "The block the package records itself as belonging to. Shown by the package section.",
  },
  {
    path: "projectId",
    sectionId: "package",
    note: "The project this package was derived from. Shown by the package section, and it is how every value's sources are attributed.",
  },
  {
    path: "derivedAt",
    sectionId: "package",
    note: "When the package was derived. Shown by the package section beside the version it was saved as.",
  },
  {
    path: "sourceFingerprint",
    sectionId: "package",
    note: "The fingerprint of the rows it was derived from. Shown by the package section, with the rule that recomputes it.",
  },
  {
    path: "fingerprintRule",
    sectionId: "package",
    note: "The rule id that produced the fingerprint. Shown by the package section on the fingerprint value itself.",
  },
  {
    path: "countsRule",
    sectionId: "package",
    note: "The rule id behind the package's own counts. Shown by the package section on each count it renders.",
  },
];

/** The mapping, longest path first, so a nested part is found before its parent. */
const ORDERED_MAP: readonly CoverageMapping[] = [...COVERAGE_MAP].sort(
  (a, b) => b.path.split(".").length - a.path.split(".").length || a.path.localeCompare(b.path),
);

/**
 * Every leaf the walk found, as dotted paths, with array indices as their own
 * segments (`titles.categories.0.titles.3.value`). A leaf is a primitive, a null,
 * or an empty array: the last is a value the package really carries (an empty list
 * is a state, not a gap) and is reported at its own path.
 */
export function walkLeafPaths(root: unknown): string[][] {
  const leaves: string[][] = [];
  const visit = (node: unknown, at: string[]): void => {
    if (Array.isArray(node)) {
      if (node.length === 0) {
        leaves.push([...at, "[]"]);
        return;
      }
      node.forEach((item, i) => visit(item, [...at, String(i)]));
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) visit(value, [...at, key]);
      return;
    }
    leaves.push(at);
  };
  visit(root, []);
  return leaves;
}

/** The mapping entry whose path is the longest prefix of `segments`, or null. */
export function sectionForLeaf(segments: readonly string[]): CoverageMapping | null {
  for (const entry of ORDERED_MAP) {
    const parts = entry.path.split(".");
    if (parts.length > segments.length) continue;
    let matches = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i] !== segments[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return entry;
  }
  return null;
}

/**
 * What this workspace says about a part of the package it shows nowhere. One
 * sentence, in this app's own words, naming the part and stating that nothing in
 * it is shown — never leaving the reader to assume it was checked.
 */
export function uncoveredStatement(path: string): string {
  return (
    `No section of this workspace shows the "${path}" part of this package, so nothing in it is shown here. ` +
    "This line is what the workspace says about it instead: the part is named rather than passed over, and no other line on this page may be read as covering it."
  );
}

/**
 * Walks the stored package and returns the map the workspace renders.
 *
 * The aggregation is per MAPPED PART for the leaves a section shows, and per
 * top-level key for the leaves no section shows (a nested unmapped part is
 * reported under the part that contains it, because that is the part a reader
 * would go looking for).
 */
export function packageCoverage(pkg: unknown): PackageCoverage {
  const leaves = walkLeafPaths(pkg);
  const byPath = new Map<string, { sectionId: string; note: string; values: number }>();
  const uncovered = new Map<string, number>();

  for (const segments of leaves) {
    const mapping = sectionForLeaf(segments);
    if (mapping) {
      const found = byPath.get(mapping.path);
      if (found) found.values += 1;
      else byPath.set(mapping.path, { sectionId: mapping.sectionId, note: mapping.note, values: 1 });
      continue;
    }
    const top = segments[0] ?? "(root)";
    uncovered.set(top, (uncovered.get(top) ?? 0) + 1);
  }

  // Reading order: the order the mapping declares, so the map reads like the page.
  const entries: CoverageEntry[] = COVERAGE_MAP.filter((m) => byPath.has(m.path)).map((m) => {
    const found = byPath.get(m.path) as { sectionId: string; note: string; values: number };
    return { path: m.path, sectionId: found.sectionId, note: found.note, values: found.values };
  });

  const uncoveredParts: UncoveredPart[] = [...uncovered.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([path, values]) => ({ path, values, statement: uncoveredStatement(path) }));

  const valuesMapped = entries.reduce((sum, entry) => sum + entry.values, 0);
  const valuesUncovered = uncoveredParts.reduce((sum, part) => sum + part.values, 0);

  const total = valuesMapped + valuesUncovered;
  const found =
    `This workspace walked the stored package and found ${total} value(s) at the leaves of ${leaves.length} path(s), in ${entries.length} named part(s).`;
  const mapped =
    uncoveredParts.length === 0
      ? ` Every part the walk found has a section of this workspace named beside it below; ${valuesMapped} value(s) sit in those parts and none sits in a part without one.`
      : ` ${valuesMapped} value(s) sit in a part with a section named beside it, and ${uncoveredParts.length} part(s) have no section — each is named below with what this workspace says about it.`;
  const scope =
    " Each part is listed with the number of values the walk found at its leaves and the section that shows it, and each section states for itself what it renders and what it withdraws, with the reason.";

  return {
    entries,
    uncovered: uncoveredParts,
    valuesWalked: total,
    valuesMapped,
    valuesUncovered,
    statement: found + mapped + scope,
  };
}

/** The package's own top-level keys, as stored — the parts a reader can name. */
export function packagePartNames(pkg: unknown): string[] {
  if (typeof pkg !== "object" || pkg === null || Array.isArray(pkg)) return [];
  return Object.keys(pkg as Record<string, unknown>);
}
