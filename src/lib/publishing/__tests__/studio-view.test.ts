/**
 * Phase 7 Block 2 — the Creator Studio view model's own rules.
 *
 * These tests cover the states the page can be in: a project with real chapters,
 * scenes, keywords and assets; a project with nothing to derive from; a project
 * whose evidence is damaged (a scene with no stored duration, so the timings are
 * withdrawn); and the three licence outcomes (a row, no row at all, and a row
 * whose expiry is in the past). They also prove the two guard rails: a derived
 * value that names no rule cannot be rendered, and a key shaped like a market
 * metric cannot appear in anything the page shows.
 */
import { describe, expect, test } from "bun:test";
import { NO_CHAPTER_DATA } from "../chapters";
import { auditPublishingPackage } from "../audit";
import { buildPublishingPackage, auditStoredPackage, type PublishingPackage } from "../package";
import { PUBLISHING_RULES } from "../rules";
import { quotedCharacters, quotedSegments } from "../quoted-text";
import { VALUE_LABELS } from "../studio-copy";
import {
  assertCreatorStudioViewHonest,
  auditFailedView,
  buildCreatorStudioView,
  buildEmptyCreatorStudioView,
  PROJECT_TITLE_PLACEHOLDER,
  type StudioAuditFailedView,
  type StudioSection,
  type StudioValue,
  type StudioView,
} from "../studio-view";
import { emptySource, NOW, richSource, textOnlySource } from "./fixtures";
import type { PublishingSource } from "../types";

const ENV_NAMES = ["OPENAI_API_KEY"];

function packageFor(source: PublishingSource): PublishingPackage {
  return buildPublishingPackage(source, { now: NOW, modelCopyEnvNames: ENV_NAMES });
}

function viewFor(source: PublishingSource, versions = 1): StudioView {
  const pkg = packageFor(source);
  const view = buildCreatorStudioView({
    projectId: source.project.id,
    package: pkg,
    version: versions,
    savedPackageId: "sp_1",
    payloadBytes: 4096,
    versions: Array.from({ length: versions }, (_, i) => ({
      id: `sp_${i + 1}`,
      version: i + 1,
      derivedAt: NOW.toISOString(),
      sourceFingerprint: pkg.sourceFingerprint,
      counts: { chapters: 2, scenes: 3, assets: 2, keywords: 5, tags: 4, hashtags: 3, emptyFields: 1 },
    })),
    reAudit: auditStoredPackage(pkg, { now: NOW }),
  });
  if (view.kind !== "package") throw new Error(`expected a package view, got ${view.kind}`);
  return view;
}

function section(view: { sections: StudioSection[] }, id: string): StudioSection {
  const found = view.sections.find((s) => s.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
}

function value(sec: StudioSection, label: string): StudioValue {
  const found = [...sec.values, ...sec.rows.flatMap((r) => r.values)].find((v) => v.label === label);
  if (!found) throw new Error(`no value labelled ${label} in ${sec.id}`);
  return found;
}

function walkValues(node: unknown, out: StudioValue[] = []): StudioValue[] {
  if (Array.isArray(node)) {
    for (const item of node) walkValues(item, out);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  const obj = node as Record<string, unknown>;
  if (typeof obj.state === "string" && obj.state !== "" && "label" in obj && "value" in obj) {
    out.push(obj as unknown as StudioValue);
  }
  for (const child of Object.values(obj)) walkValues(child, out);
  return out;
}

describe("creator studio view — the page is checked by the package's own audit", () => {
  test("a rich package produces a view that passes the honesty audit", () => {
    const view = viewFor(richSource());
    const audit = assertCreatorStudioViewHonest(view);
    expect(audit.ok).toBe(true);
    expect(audit.inspectedKeys).toBeGreaterThan(100);
    expect(audit.inspectedStrings).toBeGreaterThan(50);
  });

  test("every derived value on the page names a catalogue rule and at least one source row", () => {
    const view = viewFor(richSource());
    const values = walkValues(view);
    expect(values.length).toBeGreaterThan(20);
    const derived = values.filter((v) => v.state === "derived");
    expect(derived.length).toBeGreaterThan(10);
    for (const v of derived) {
      expect(v.rule === null ? "no rule" : v.rule in PUBLISHING_RULES).toBe(true);
      expect(v.sources.length).toBeGreaterThan(0);
      if (typeof v.value === "string") expect(v.textOrigin).not.toBeNull();
    }
    for (const v of values.filter((x) => x.state !== "derived")) {
      expect(v.value).toBeNull();
      expect((v.reason ?? "").length).toBeGreaterThan(0);
      expect(v.requires.length).toBeGreaterThan(0);
    }
  });

  test("the three states are distinct and each is labelled for the user", () => {
    const view = viewFor(richSource());
    const values = walkValues(view);
    const states = new Set(values.map((v) => v.state));
    expect(states.has("derived")).toBe(true);
    expect(states.has("empty_no_input")).toBe(true);
    for (const v of values) expect(v.stateLabel.length).toBeGreaterThan(0);
    // Nothing on this page is gated today: no value in a stored package needs a
    // provider, and the gated wording is reserved for values that would.
    expect(values.every((v) => v.state !== "gated_provider")).toBe(true);
  });
});

describe("creator studio view — chapters, timings and honest degradation", () => {
  test("real chapters, start times summed from the scenes' own durations", () => {
    const view = viewFor(richSource());
    const chapters = section(view, "chapters");
    expect(chapters.rows.length).toBe(2);
    expect(chapters.rows[0].label).toBe("Chapter 1");
    expect(chapters.rows[0].id).toBe("ch_1");
    expect(chapters.rows[1].values.find((v) => v.label === "Start (seconds)")?.value).toBe(300);
    expect(chapters.rows[0].values.find((v) => v.label === "Start (seconds)")?.value).toBe(0);
    expect(chapters.rows[0].values.find((v) => v.label === "Length (seconds)")?.value).toBe(300);
    expect(value(chapters, "Timed span of all chapters").value).toBe("9m 00s");
    expect(value(chapters, "Timings available").value).toBe(true);
    // Each chapter entry points at the source row it came from.
    const chapterRow = chapters.rows[0];
    expect(chapterRow.texts.some((t) => t.value.includes("ch_1"))).toBe(true);
    expect(chapterRow.values.find((v) => v.label === "Chapter title")?.sources[0].id).toBe("ch_1");
    expect(chapterRow.values.find((v) => v.label === "Chapter title")?.sources[0].path).toBe("title");
  });

  test("scene rows carry their ids, their own durations and their own text", () => {
    const view = viewFor(richSource());
    const chapters = section(view, "chapters");
    const scenes = chapters.rows.flatMap((r) => r.children ?? []);
    expect(scenes.length).toBe(3);
    expect(scenes.map((s) => s.id)).toEqual(["sc_1", "sc_2", "sc_3"]);
    expect(chapters.rows[0].children?.length).toBe(2);
    const first = scenes[0];
    expect(first.values.find((v) => v.label === "Scene title")?.value).toBe("Hannibal crosses the Alps");
    expect(first.values.find((v) => v.label === "Scene title")?.sources[0]).toEqual({
      kind: "scene",
      id: "sc_1",
      path: "title",
    });
    const firstLength = first.values.find((v) => v.label === "Scene length (seconds)");
    expect(firstLength?.value).toBe(120);
    expect(firstLength?.rule).toBe("R-CH-TIMING");
    expect(firstLength?.sources[0].path).toBe("durationSeconds");
    expect(scenes[1].values.find((v) => v.label === "Scene length (seconds)")?.value).toBe(180);
    expect(scenes[2].values.find((v) => v.label === "Scene length (seconds)")?.value).toBe(240);
    // The scene's own status and row id are shown verbatim beside it.
    expect(first.texts.some((t) => t.value.includes("status READY"))).toBe(true);
  });

  test("a scene with no stored duration withdraws EVERY timing, naming the count", () => {
    const damaged = richSource();
    damaged.chapters[0].scenes[1].durationSeconds = null;
    const view = viewFor(damaged);
    const chapters = section(view, "chapters");
    expect(value(chapters, "Timings available").value).toBe(false);
    const block = value(chapters, "Chapter block");
    expect(block.state).toBe("empty_no_input");
    expect(block.reason).toContain("1 of 3");
    expect(block.value).toBeNull();
    expect(value(chapters, "Timed span of all chapters").state).toBe("empty_no_input");
    for (const row of chapters.rows) {
      expect(row.values.find((v) => v.label === "Start (seconds)")?.state).toBe("empty_no_input");
      expect(row.values.find((v) => v.label === "Length (seconds)")?.state).toBe("empty_no_input");
    }
    // The chapter TITLES are untouched: only the timings were withdrawn.
    expect(chapters.rows[0].values.find((v) => v.label === "Chapter title")?.value).toBe("The Second Punic War");
    expect(chapters.notes.join(" ")).toContain("1 of 3");
  });

  test("no positional label is invented for a chapter whose title is blank", () => {
    const blank = richSource();
    blank.chapters[1].title = "   ";
    const view = viewFor(blank);
    const chapters = section(view, "chapters");
    const second = chapters.rows[1].values.find((v) => v.label === "Chapter title");
    expect(second?.state).toBe("empty_no_input");
    expect(second?.value).toBeNull();
    expect(second?.reason).toContain("blank title");
    expect(value(chapters, "Chapter block").state).toBe("empty_no_input");
    expect(String(value(chapters, "Chapter block").reason)).toContain("no title");
  });
});

describe("creator studio view — the honest empty project", () => {
  test("no chapters, scenes or assets: every section says why it is empty", () => {
    const view = viewFor(emptySource());
    const chapters = section(view, "chapters");
    expect(chapters.rows.length).toBe(0);
    expect(chapters.emptyReason).toContain(NO_CHAPTER_DATA);
    expect(chapters.emptyRequires.length).toBeGreaterThan(0);

    const licences = section(view, "licences");
    expect(licences.rows.length).toBe(0);
    expect(String(licences.emptyReason)).toContain("no assets");

    const keywords = section(view, "keywords");
    // The project's own title is still text, so some phrases exist; every group
    // that ended up empty says why it is empty.
    expect(keywords.groups.every((g) => g.items.length > 0 || (g.reason ?? "").length > 0)).toBe(true);
    expect(keywords.groups.some((g) => g.items.length > 0)).toBe(true);

    const tags = section(view, "tags");
    // The project's own title is text, so tags exist; the tag LINE is shown with
    // its provenance rather than being empty here.
    expect(tags.rows.length).toBeGreaterThan(0);
    expect(value(tags, "Tag line").state).toBe("derived");
    expect(tags.rows.every((r) => r.label.length > 0)).toBe(true);

    const hashtags = section(view, "hashtags");
    expect(String(hashtags.emptyReason).length).toBeGreaterThan(0);

    const description = section(view, "description");
    expect(String(description.emptyReason).length).toBeGreaterThan(0);

    // The package's own declaration is still shown, and still says what is absent.
    const absent = section(view, "absent");
    expect(absent.values.length).toBeGreaterThan(1);
    expect(view.absentData.absent.length).toBeGreaterThan(0);
  });

  test("a text-only project derives keywords but says why the chapters are absent", () => {
    const view = viewFor(textOnlySource());
    const chapters = section(view, "chapters");
    expect(chapters.rows.length).toBe(0);
    expect(chapters.emptyReason).toContain(NO_CHAPTER_DATA);
    const keywords = section(view, "keywords");
    expect(keywords.groups.some((g) => g.items.length > 0)).toBe(true);
  });

  test("a project with no saved package gets an empty view that says exactly that", () => {
    const view = buildEmptyCreatorStudioView({ projectId: "proj_x", projectTitle: "Untitled", versions: [] });
    expect(view.kind).toBe("empty");
    expect(view.title).toContain("No package has been saved");
    expect(view.requires.length).toBe(1);
    expect(view.versionRows.length).toBe(0);
    assertCreatorStudioViewHonest(view);
  });
});

describe("creator studio view — the three licence outcomes", () => {
  test("verified row: provider, type, attribution requirement and URL all derived", () => {
    const view = viewFor(richSource());
    const licences = section(view, "licences");
    const entry = licences.rows.find((r) => r.id === "as_licensed");
    expect(entry).toBeDefined();
    const verification = entry?.values.find((v) => v.label === "Licence record");
    expect(verification?.state).toBe("derived");
    expect(verification?.rule).toBe("R-LIC-ROW");
    expect(verification?.sources[0]).toEqual({ kind: "licensing", id: "lic_1", path: "id" });
    expect(entry?.values.find((v) => v.label === "Licence provider")?.value).toBe("Pexels");
    expect(entry?.values.find((v) => v.label === "Licence type")?.value).toBe("ROYALTY_FREE");
    expect(entry?.values.find((v) => v.label === "Attribution required")?.value).toBe(true);
    expect(entry?.values.find((v) => v.label === "Licence URL")?.value).toBe("https://www.pexels.com/license/");
    expect(entry?.texts.some((t) => t.value.includes("lic_1"))).toBe(true);
  });

  test("unknown/unverified: every field empty, attribution empty rather than false", () => {
    const view = viewFor(richSource());
    const licences = section(view, "licences");
    const entry = licences.rows.find((r) => r.id === "as_unlicensed");
    expect(entry).toBeDefined();
    const verification = entry?.values.find((v) => v.label === "Licence record");
    expect(verification?.rule).toBe("R-LIC-UNKNOWN");
    expect(String(verification?.value)).toContain("unknown");
    const attribution = entry?.values.find((v) => v.label === "Attribution required");
    expect(attribution?.state).toBe("empty_no_input");
    expect(attribution?.value).not.toBe(false);
    expect(attribution?.value).toBeNull();
    for (const label of ["Licence provider", "Licence type", "Attribution text", "Licence URL", "Expires on", "Expired"]) {
      const v = entry?.values.find((x) => x.label === label);
      expect(v?.state).toBe("empty_no_input");
      expect(v?.value).toBeNull();
    }
    // The report states on its own data that it is not legal clearance.
    expect(value(licences, "This is legal clearance").value).toBe(false);
    expect(String(value(licences, "Licence rows on this project").value)).toContain("without");
    expect(String(licences.values.find((v) => v.label === "The package's statement about this data")?.value)).toContain(
      "not legal clearance",
    );
  });

  test("expired: an expiry in the past is reported expired, in the future not, null as unknown", () => {
    const past = richSource();
    past.assets[0].licensing!.expiresAt = "2025-01-01T00:00:00.000Z";
    const pastView = viewFor(past);
    const pastEntry = section(pastView, "licences").rows.find((r) => r.id === "as_licensed");
    const expired = pastEntry?.values.find((v) => v.label === "Expired");
    expect(expired?.state).toBe("derived");
    expect(expired?.value).toBe(true);
    expect(expired?.rule).toBe("R-LIC-EXPIRY");
    expect(expired?.sources[0].path).toBe("expiresAt");

    const futureView = viewFor(richSource());
    const futureEntry = section(futureView, "licences").rows.find((r) => r.id === "as_licensed");
    expect(futureEntry?.values.find((v) => v.label === "Expired")?.value).toBe(false);

    const none = richSource();
    none.assets[0].licensing!.expiresAt = null;
    const noneView = viewFor(none);
    const noExpiry = section(noneView, "licences").rows.find((r) => r.id === "as_licensed")?.values.find((v) => v.label === "Expired");
    expect(noExpiry?.state).toBe("empty_no_input");
    expect(String(noExpiry?.reason)).toContain("expiresAt");
  });
});

describe("creator studio view — what the package does not contain", () => {
  test("the omissions are the package's own list, with the provider env NAMES each would need", () => {
    const view = viewFor(richSource());
    const ids = view.notInThisPackage.map((n) => n.id);
    // The `titles` entry is gone: P7-3 builds the titles for real, so the
    // omissions list no longer claims them as a later block — and the section
    // that replaces it is asserted separately below.
    expect(ids).toEqual(["thumbnail_concepts", "quality_checker", "safety_screening", "creator_studio_workspace"]);
    const thumbnail = view.notInThisPackage.find((n) => n.id === "thumbnail_concepts");
    expect(thumbnail?.needsProvider).toBe(true);
    expect(thumbnail?.envVars).toEqual(ENV_NAMES);
    const quality = view.notInThisPackage.find((n) => n.id === "quality_checker");
    expect(quality?.needsProvider).toBe(false);
    expect(quality?.envVars).toEqual([]);
    // No value in the list is a promise or a date.
    for (const entry of view.notInThisPackage) {
      expect(entry.reason).not.toMatch(/\b(soon|shortly)\b/i);
    }
  });
});

describe("creator studio view — the guard rails actually bite", () => {
  test("a metric-shaped key ANYWHERE in the view fails the audit", () => {
    const view = viewFor(richSource());
    assertCreatorStudioViewHonest(view);
    const polluted = structuredClone(view) as unknown as { sections: StudioSection[] };
    (polluted.sections[0].values[0] as unknown as Record<string, unknown>).searchVolume = 1200;
    let thrown: unknown = null;
    try {
      assertCreatorStudioViewHonest(polluted);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).message)).toContain("forbidden_metric_key");
  });

  test("a nested metric-shaped key fails too, at any depth", () => {
    const view = viewFor(richSource());
    const polluted = structuredClone(view) as unknown as Record<string, unknown> & { sections: StudioSection[] };
    (polluted.sections[3].groups[0] as unknown as Record<string, unknown>).keywordDifficulty = 42;
    expect(() => assertCreatorStudioViewHonest(polluted)).toThrow(/forbidden_metric_key/);
  });

  test("a banned claim in the page's own words fails the audit", () => {
    const view = viewFor(richSource());
    const polluted = structuredClone(view) as unknown as { sections: StudioSection[] };
    polluted.sections[0].values[0].label = "This description is fully optimized for the algorithm";
    expect(() => assertCreatorStudioViewHonest(polluted)).toThrow(/banned_claim/);
  });

  test("a value that claims to be derived with no rule or no source fails the audit", () => {
    const view = viewFor(richSource());
    const noRule = structuredClone(view) as unknown as { sections: StudioSection[] };
    (noRule.sections[1].values[0] as unknown as Record<string, unknown>).rule = null;
    expect(() => assertCreatorStudioViewHonest(noRule)).toThrow(/malformed_field/);

    const noSource = structuredClone(view) as unknown as { sections: StudioSection[] };
    noSource.sections[1].values[0].sources = [];
    expect(() => assertCreatorStudioViewHonest(noSource)).toThrow(/malformed_field/);
  });

  test("an empty value with no reason or no named missing input fails the audit", () => {
    const view = viewFor(emptySource());
    const blank = structuredClone(view) as unknown as { sections: StudioSection[] };
    const chapters = blank.sections.find((s) => s.id === "chapters");
    const emptyVal = chapters?.values.find((v) => v.state === "empty_no_input");
    expect(emptyVal).toBeDefined();
    (emptyVal as unknown as Record<string, unknown>).reason = "";
    expect(() => assertCreatorStudioViewHonest(blank)).toThrow(/malformed_field/);

    const noRequires = structuredClone(view) as unknown as { sections: StudioSection[] };
    const chapters2 = noRequires.sections.find((s) => s.id === "chapters");
    const emptyVal2 = chapters2?.values.find((v) => v.state === "empty_no_input");
    (emptyVal2 as unknown as Record<string, unknown>).requires = [];
    expect(() => assertCreatorStudioViewHonest(noRequires)).toThrow(/malformed_field/);
  });

  test("the built view is genuinely audited — a package the view carries verbatim is scanned, and the failed check becomes a state rather than a blank page", () => {
    // The view copies the package's own omission list, so a metric-shaped key
    // smuggled into the package is caught by the check the PAGE runs — the page
    // does not trust the stored bytes it was handed.
    const source = richSource();
    const pkg = packageFor(source);
    const polluted = structuredClone(pkg) as unknown as PublishingPackage;
    (polluted.honesty.notInThisPackage[0] as unknown as Record<string, unknown>).monthlySearchVolume = 500;
    const view = buildCreatorStudioView({
      projectId: source.project.id,
      package: polluted,
      version: 1,
      savedPackageId: "sp_1",
      payloadBytes: 1,
      versions: [],
      reAudit: null,
    });
    // The guard still refuses the view: what reaches the page is not the unchecked
    // view. What it is, is a state — see the block below.
    expect(view.kind).toBe("audit_failed");
    expect(assertCreatorStudioViewHonest).toBeDefined();
    const failed = view as StudioAuditFailedView;
    expect(failed.violations.some((v) => v.kind === "forbidden_metric_key" && v.path.includes("monthlySearchVolume"))).toBe(true);
  });
});
/**
 * Phase 7 Block 3b (follow-up #3, item 2) — THE HONEST FAILURE MODE.
 *
 * When the view fails its own honesty check, the page used to render nothing at
 * all: an exception in the server component, a blank body, and no way for a reader
 * to tell a broken page from an empty one. These tests hold the replacement: the
 * `audit_failed` state names every failed path, says in this app's own words that
 * nothing is shown rather than something unchecked, carries no project content at
 * all, and passes the very check the rest of the product passes.
 */
describe("creator studio view — when the view fails its own honesty check", () => {
  test("a package the view cannot carry honestly yields the state, naming the failing path", () => {
    const source = richSource();
    const pkg = packageFor(source);
    const polluted = structuredClone(pkg) as unknown as PublishingPackage;
    (polluted.honesty.notInThisPackage[0] as unknown as Record<string, unknown>).monthlySearchVolume = 500;
    const view = buildCreatorStudioView({
      projectId: source.project.id,
      package: polluted,
      version: 1,
      savedPackageId: "sp_1",
      payloadBytes: 1,
      versions: [],
      reAudit: null,
    });
    if (view.kind !== "audit_failed") throw new Error(`expected the failure state, got ${view.kind}`);
    expect(view.projectId).toBe(source.project.id);
    expect(view.title).toContain("failed its own honesty check");
    expect(view.body).toContain("shows nothing rather than showing those unchecked");
    expect(view.violations.some((v) => v.kind === "forbidden_metric_key" && v.path.includes("monthlySearchVolume"))).toBe(true);
    expect(view.violationCount).toBeGreaterThan(0);
    expect(view.inspectedKeys).toBeGreaterThan(0);
    expect(view.checkedAt.length).toBeGreaterThan(10);
    // Nothing unchecked reaches the page: the state carries no section, no value,
    // no version row and no project content of any kind.
    const asRecord = view as unknown as Record<string, unknown>;
    for (const key of ["sections", "versionRows", "notInThisPackage", "honestyStatement", "selfAudit", "reAudit", "absentData", "fieldStates"]) {
      expect(asRecord[key], `${key} must not be carried by the failure state`).toBeUndefined();
    }
    expect(JSON.stringify(view)).not.toContain(source.project.title);
    expect(JSON.stringify(view)).not.toContain(pkg.sourceFingerprint);
    // And the state is itself held to the same check.
    expect(auditPublishingPackage(view, { now: NOW }).ok).toBe(true);
  });

  test("a banned claim in this app's own copy is named by path and never reprinted", () => {
    // The other class of failure the check exists for: this app's own sentence
    // carrying a claim it may not make. Forced through the state factory, because
    // the builder can only be reached with a real package and the copy it would
    // need to fail is this app's own fixed text.
    const source = richSource();
    const clean = viewFor(source);
    const polluted = structuredClone(clean) as unknown as StudioView;
    polluted.sections[0].notes.push("This app optimized the outcome for you.");
    const audit = auditPublishingPackage(polluted, { now: NOW });
    expect(audit.ok).toBe(false);
    const state = auditFailedView({ projectId: source.project.id, audit });
    expect(state.kind).toBe("audit_failed");
    expect(state.violations.some((v) => v.kind === "banned_claim" && v.path.includes("sections[0].notes"))).toBe(true);
    // The offending characters are not reprinted anywhere in the state — not in a
    // path, not in a detail sentence, not in this app's own copy.
    expect(JSON.stringify(state).toLowerCase()).not.toContain("optimized");
    expect(auditPublishingPackage(state, { now: NOW }).ok).toBe(true);
  });

  test("the builder returns either the audited view or the state, and never throws", () => {
    const source = richSource();
    const clean = buildCreatorStudioView({
      projectId: source.project.id,
      package: packageFor(source),
      version: 1,
      savedPackageId: "sp_1",
      payloadBytes: 1,
      versions: [],
      reAudit: null,
    });
    expect(clean.kind).toBe("package");
    expect(auditPublishingPackage(clean, { now: NOW }).ok).toBe(true);

    const pollutedPkg = structuredClone(packageFor(source)) as unknown as PublishingPackage;
    (pollutedPkg.honesty.notInThisPackage[0] as unknown as Record<string, unknown>).monthlySearchVolume = 500;
    expect(() =>
      buildCreatorStudioView({
        projectId: source.project.id,
        package: pollutedPkg,
        version: 1,
        savedPackageId: "sp_1",
        payloadBytes: 1,
        versions: [],
        reAudit: null,
      }),
    ).not.toThrow();
  });
});

/**
 * Phase 7 Block 3b (follow-up #3, item 1) — THE PROJECT'S OWN TITLE.
 *
 * The blank page this block fixes was one value: the view carried the project's
 * title as a bare string, the audit read it as a sentence THIS APP wrote, and a
 * project whose own title carries a phrase this app's prose may not use failed the
 * view's own check and rendered nothing. These tests hold the fix: the title is a
 * declared quotation — this app's template is the placeholder alone, and the
 * characters are the project's own, attributed to the row they were read from.
 */
describe("creator studio view — the project's title is the project's own characters", () => {
  test("the package view carries the title as a verified quotation, and quotes nothing else", () => {
    const source = richSource();
    const view = viewFor(source);
    const title = view.projectTitle;
    expect(title.state).toBe("derived");
    expect(title.textOrigin).toBe("template_filled");
    expect(title.label).toBe(VALUE_LABELS.projectTitle);
    expect(title.rule).toBe("R-DESC-TITLE");
    expect(title.templateText).toBe(PROJECT_TITLE_PLACEHOLDER);
    expect(title.fragments?.length).toBe(1);
    expect(title.fragments?.[0].text).toBe(source.project.title);
    expect(title.fragments?.[0].textOrigin).toBe("source_verbatim");
    expect(title.fragments?.[0].sources[0]).toEqual({ kind: "project", id: source.project.id, path: "title" });
    // The summary section shows the same characters, marked as the project's own:
    // every character of the value is a quoted fragment and none is this app's.
    const summary = section(view, "package").values[0];
    const segments = quotedSegments(summary);
    expect(segments).not.toBeNull();
    expect(quotedCharacters(segments!)).toEqual([source.project.title]);
    expect(segments!.filter((s) => s.quoted).map((s) => s.text).join("")).toBe(summary.value);
  });

  test("the empty view carries the title the same way", () => {
    const view = buildEmptyCreatorStudioView({ projectId: "proj_x", projectTitle: "Untitled", versions: [] });
    expect(view.kind).toBe("empty");
    if (view.kind !== "empty") return;
    expect(view.projectTitle.state).toBe("derived");
    expect(view.projectTitle.textOrigin).toBe("template_filled");
    expect(quotedCharacters(quotedSegments(view.projectTitle)!)).toEqual(["Untitled"]);
  });

  test("a stored package with no title to read says so instead of guessing one", () => {
    const source = richSource();
    const pkg = structuredClone(packageFor(source)) as unknown as PublishingPackage;
    pkg.projectTitle = {
      state: "empty_no_input",
      value: null,
      rule: null,
      sources: [],
      textOrigin: null,
      reason: "No title is stored on this package.",
      requires: ["a stored package whose Project title value is derived from a row"],
    };
    const view = buildCreatorStudioView({
      projectId: source.project.id,
      package: pkg,
      version: 1,
      savedPackageId: "sp_1",
      payloadBytes: 1,
      versions: [],
      reAudit: null,
    });
    if (view.kind !== "package") throw new Error(`expected a package view, got ${view.kind}`);
    expect(view.projectTitle.state).toBe("empty_no_input");
    expect(view.projectTitle.value).toBeNull();
    expect(view.projectTitle.reason).toContain("no project title value");
    // The title the view does not have is not taken from anywhere else either: the
    // value says where a title would come from and carries no characters of one.
    expect(JSON.stringify(view.projectTitle)).not.toContain(source.project.title);
  });
});
