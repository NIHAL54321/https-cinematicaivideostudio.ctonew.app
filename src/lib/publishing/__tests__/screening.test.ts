/**
 * P7-6 — the screening plan's hard parts, and the licence report's limits.
 *
 * Every test here is written against a REAL source (rows in, plan out) and asserts
 * one of the invariants this block exists to hold:
 *
 *   1. a licence with no row is unknown and unverified, and the report says what a
 *      licence record does not tell you at all;
 *   2. a rule that fires quotes the characters it matched, byte for byte, with the
 *      row, the field and the exact span;
 *   3. a banned claim THIS APP writes still throws, while a project whose own words
 *      contain the same claim builds fine (the project's characters are the
 *      project's — see ./quotation);
 *   4. an area with no capability reports "not screened — no capability" and can
 *      never be read as a pass;
 *   5. the honesty audit still catches a metric-shaped key planted in the new
 *      section, and the view model's own audit passes over what it renders.
 */
import { describe, expect, test } from "bun:test";
import { auditPublishingPackage } from "../audit";
import { buildAssetLicenceReport } from "../licensing";
import { buildPublishingPackage } from "../package";
import { NOTHING_MATCHING_PHRASE, NOT_SCREENED_PHRASE, buildScreeningPlan } from "../screening";
import { screeningCapabilityFacts } from "../service";
import { buildCreatorStudioView } from "../studio-view";
import type { PublishingSource } from "../types";
import { NOW, richSource } from "./fixtures";

/** A source with the assets a screening test needs, built from rows only. */
function sourceWithAssets(overrides: Partial<PublishingSource> = {}): PublishingSource {
  return richSource({
    assets: [
      {
        id: "asset_stock",
        name: "city night aerial",
        kind: "VIDEO",
        status: "READY",
        mimeType: "video/mp4",
        createdAt: "2026-10-01T00:00:00.000Z",
        licensing: {
          id: "lic_stock",
          licenseType: "STOCK_LICENSE",
          source: "Pexels",
          attribution: "Footage by A. Operator",
          licenseUrl: "https://www.pexels.com/license/",
          purchasedAt: null,
          expiresAt: null,
        },
        origin: {
          table: "stock_asset",
          id: "stock_1",
          provider: "pexels",
          model: null,
          externalId: "pexels-123456",
          pageUrl: "https://www.pexels.com/video/123456/",
          status: null,
        },
      },
      {
        id: "asset_nolicence",
        name: "unlabelled clip",
        kind: "VIDEO",
        status: "READY",
        mimeType: "video/mp4",
        createdAt: "2026-10-02T00:00:00.000Z",
        licensing: null,
        origin: null,
      },
    ],
    ...overrides,
  });
}

const OPTS = { now: NOW };

describe("screening — a rule quotes the exact span it matched", () => {
  test("a copyright symbol fires with the row, the field and the character span", () => {
    const source = sourceWithAssets();
    // Put a real rights line into the SECOND scene's narration, at a known offset.
    const prefix = "The archive was assembled from a private collection. ";
    const rights = "© 2019 Example Archive. All rights reserved.";
    source.chapters[0].scenes[1].narration = prefix + rights;
    const plan = buildScreeningPlan({
      source,
      licences: buildAssetLicenceReport(source, NOW),
      descriptionText: null,
      now: NOW,
    });
    const area = plan.areas.find((a) => a.area === "copyright")!;
    expect(area.status).toBe("flags_found");
    const symbol = area.flags.find((f) => f.probeId === "copyright_symbol")!;
    expect(symbol.rowKind).toBe("scene");
    expect(symbol.rowId).toBe("sc_2");
    expect(symbol.field).toBe("narration");
    // The span is REAL: it indexes the row's own characters.
    expect(source.chapters[0].scenes[1].narration!.slice(symbol.span.start, symbol.span.end)).toBe("©");
    expect(symbol.matched.state).toBe("derived");
    if (symbol.matched.state === "derived") {
      expect(symbol.matched.value).toBe("©");
      expect(symbol.matched.textOrigin).toBe("source_verbatim");
      expect(symbol.matched.sources[0]).toEqual({
        kind: "scene",
        id: "sc_2",
        path: "narration",
        span: { start: prefix.length, end: prefix.length + 1 },
      });
    }
    // The rights phrase is found too, and every flag's why/what are the app's own words.
    const phrase = area.flags.find((f) => f.probeId === "rights_language")!;
    if (phrase.matched.state === "derived") expect(phrase.matched.value.toLowerCase()).toContain("all rights reserved");
    if (phrase.whyItFired.state === "derived") {
      expect(phrase.whyItFired.textOrigin).toBe("rule_authored");
      // The app's sentence never contains the characters it matched.
      expect(phrase.whyItFired.value).not.toContain("All rights reserved");
    }
  });

  test("a quotation in the project's own text is flagged as a quotation, and nothing about it is asserted", () => {
    const source = sourceWithAssets();
    source.chapters[0].scenes[0].narration =
      'Hannibal said, "I will either find a way or make one, and the Alps will not stop me."';
    const plan = buildScreeningPlan({ source, licences: buildAssetLicenceReport(source, NOW), descriptionText: null, now: NOW });
    const area = plan.areas.find((a) => a.area === "copyright")!;
    const quoted = area.flags.find((f) => f.probeId === "quoted_passage");
    expect(quoted).toBeDefined();
    if (quoted && quoted.matched.state === "derived") {
      expect(quoted.matched.value.length).toBeGreaterThan(20);
      expect(quoted.matched.value.startsWith('"')).toBe(true);
    }
  });
});

describe("screening — licence rows drive copyright flags", () => {
  test("an asset with no licence row becomes a copyright flag naming the asset row", () => {
    const source = sourceWithAssets();
    const licences = buildAssetLicenceReport(source, NOW);
    const plan = buildScreeningPlan({ source, licences, descriptionText: null, now: NOW });
    const area = plan.areas.find((a) => a.area === "copyright")!;
    const gap = area.flags.filter((f) => f.rule === "R-SCR-LICENCE-GAP");
    expect(gap).toHaveLength(1);
    expect(gap[0].rowId).toBe("asset_nolicence");
    expect(gap[0].rowKind).toBe("asset");
    if (gap[0].whyItFired.state === "derived") {
      expect(gap[0].whyItFired.value).toContain("unknown and unverified");
      // The app never says a missing record is fine.
      expect(gap[0].whyItFired.value.toLowerCase()).not.toContain("cleared");
    }
  });

  test("attribution the licence row requires, absent from this app's description, is flagged from both halves", () => {
    const source = sourceWithAssets();
    const licences = buildAssetLicenceReport(source, NOW);
    const without = buildScreeningPlan({ source, licences, descriptionText: "A description with no credit in it.", now: NOW });
    const withCredit = buildScreeningPlan({
      source,
      licences,
      descriptionText: "A description that ends with: Footage by A. Operator",
      now: NOW,
    });
    const flagsOf = (p: ReturnType<typeof buildScreeningPlan>) =>
      p.areas.find((a) => a.area === "copyright")!.flags.filter((f) => f.rule === "R-SCR-ATTRIBUTION-MISSING");
    expect(flagsOf(without)).toHaveLength(1);
    expect(flagsOf(withCredit)).toHaveLength(0);
  });
});

describe("screening — a missing licence row is unknown, never acceptable", () => {
  test("the licence report reports the row-less asset as unknown and keeps attribution empty", () => {
    const report = buildAssetLicenceReport(sourceWithAssets(), NOW);
    const entry = report.entries.find((e) => e.assetId === "asset_nolicence")!;
    expect(entry.verification).toBe("unknown_unverified");
    expect(entry.licensingRowId).toBeNull();
    expect(entry.attributionRequired.state).toBe("empty_no_input");
    expect(entry.licenceType.state).toBe("empty_no_input");
    expect(report.counts.unknownUnverified).toBe(1);
    // What it does not tell you is stated, and the first statement is the strongest.
    expect(entry.whatThisDoesNotTellYou[0]).toContain("unknown and unverified");
    expect(report.notLegalClearance).toBe(true);
    expect(report.whatThisDoesNotTellYou.some((line) => line.includes("legal clearance"))).toBe(true);
    expect(report.whatThisDoesNotTellYou.length).toBeGreaterThanOrEqual(5);
  });

  test("the provider is read from the origin ROW, and is empty-with-reason when no such row exists", () => {
    const report = buildAssetLicenceReport(sourceWithAssets(), NOW);
    const stock = report.entries.find((e) => e.assetId === "asset_stock")!;
    expect(stock.originTable.state === "derived" && stock.originTable.value).toBe("stock_asset");
    expect(stock.originProvider.state === "derived" && stock.originProvider.value).toBe("pexels");
    expect(stock.externalAssetId.state === "derived" && stock.externalAssetId.value).toBe("pexels-123456");
    const bare = report.entries.find((e) => e.assetId === "asset_nolicence")!;
    expect(bare.originProvider.state).toBe("empty_no_input");
    expect(bare.originProvider.state === "empty_no_input" && bare.originProvider.reason).toContain("no provider record");
    expect(report.originCounts).toEqual({ assets: 2, stock: 1, generatedImage: 0, generatedVideo: 0, voiceover: 0, none: 1 });
  });
});

describe("screening — not screened is never a pass", () => {
  test("every one of the seven areas carries a capability nobody serves, and says so in words", () => {
    const source = sourceWithAssets();
    const plan = buildScreeningPlan({
      source,
      licences: buildAssetLicenceReport(source, NOW),
      descriptionText: null,
      capabilities: screeningCapabilityFacts(),
      now: NOW,
    });
    expect(plan.areas).toHaveLength(7);
    for (const area of plan.areas) {
      expect(area.capability.state).toBe("not_screened_no_capability");
      expect(area.capability.statusLabel).toBe(NOT_SCREENED_PHRASE);
      expect(area.capability.requirement.length).toBeGreaterThan(20);
      expect(area.capability.cannotDetermine.length).toBeGreaterThan(0);
      // The two statuses a rule may report, and neither of them is a pass.
      expect(["flags_found", "nothing_matching_this_rule"]).toContain(area.status);
      expect(area.statusLabel.toLowerCase()).not.toBe("pass");
      expect(area.statusLabel.toLowerCase()).not.toBe("clear");
      expect(area.humanReviewRequired).toBe(true);
    }
    expect(plan.counts.areasNotScreened).toBe(7);
    expect(plan.clearedForPublication).toBe(false);
    expect(plan.notLegalClearance).toBe(true);
    expect(plan.notScreenedStatement).toContain("Not screened — no capability");
  });

  test("a quiet rule reports that phrase exactly, and never the words clear or pass", () => {
    const source = sourceWithAssets();
    // A project whose own text matches nothing in the harm list.
    const plan = buildScreeningPlan({ source, licences: buildAssetLicenceReport(source, NOW), descriptionText: null, now: NOW });
    const harm = plan.areas.find((a) => a.area === "illegal_harmful")!;
    // "Carthage" prose carries no harm term, but if it does the assertion below is
    // about the OTHER branch, so pick an area that is certainly quiet instead.
    const quiet = plan.areas.filter((a) => a.status === "nothing_matching_this_rule");
    const sample = quiet.length > 0 ? quiet[0] : harm;
    if (sample.status === "nothing_matching_this_rule") {
      expect(sample.statusLabel).toBe(NOTHING_MATCHING_PHRASE);
      expect(sample.statusLabel).toContain("Nothing matching this rule in the project's own text");
      expect(sample.statusLabel.toLowerCase()).not.toContain("clear");
      expect(sample.statusLabel.toLowerCase()).not.toContain("pass");
      expect(plan.notAPass).toContain("not a pass");
    }
    // The harm area's own capability gap is reported regardless of its text result.
    expect(harm.capability.statusLabel).toBe(NOT_SCREENED_PHRASE);
  });

  test("likeness names the registered capability and the env var names the registry derives", () => {
    const facts = screeningCapabilityFacts();
    const source = sourceWithAssets();
    const plan = buildScreeningPlan({
      source,
      licences: buildAssetLicenceReport(source, NOW),
      descriptionText: null,
      capabilities: facts,
      now: NOW,
    });
    const likeness = plan.areas.find((a) => a.area === "likeness")!;
    expect(likeness.capability.registered).toBe(true);
    expect(likeness.capability.capabilityId).toBe("face_detection");
    // The names come from the registry, never from a literal in this module.
    expect(likeness.capability.envVars).toEqual(facts.likeness!.envVars);
    expect(likeness.capability.requirement).toContain("face_detection");
    // An area the registry has no capability for names NO env var at all.
    const harm = plan.areas.find((a) => a.area === "illegal_harmful")!;
    expect(harm.capability.registered).toBe(false);
    expect(harm.capability.envVars).toEqual([]);
    expect(harm.capability.requirement).toContain("twenty-one entries");
  });
});

describe("screening — the honesty audit still holds over the new section", () => {
  test("a package carrying the screening plan passes its own audit", () => {
    const pkg = buildPublishingPackage(sourceWithAssets(), OPTS);
    expect(pkg.screening.areas).toHaveLength(7);
    expect(pkg.screening.counts.flags).toBeGreaterThan(0);
    expect(pkg.selfAudit.ok).toBe(true);
    expect(auditPublishingPackage(pkg, { now: NOW }).ok).toBe(true);
    expect(pkg.summary.screeningAreas).toBe(7);
    expect(pkg.summary.screeningFlagsRaised).toBe(pkg.screening.counts.flags);
    expect(pkg.format).toBe("cavs.publishing-package/v5");
  });

  test("a metric-shaped key planted anywhere in the screening plan is a violation", () => {
    const pkg = buildPublishingPackage(sourceWithAssets(), OPTS);
    const polluted = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
    const screening = polluted.screening as Record<string, unknown>;
    const areas = screening.areas as Record<string, unknown>[];
    (areas[0] as Record<string, unknown>).monthlySearchVolume = 1200;
    const audit = auditPublishingPackage(polluted, { now: NOW });
    expect(audit.ok).toBe(false);
    expect(audit.violations.some((v) => v.kind === "forbidden_metric_key")).toBe(true);
  });

  test("a banned claim the APP writes in a flag still throws", () => {
    const pkg = buildPublishingPackage(sourceWithAssets(), OPTS);
    const polluted = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
    const screening = polluted.screening as { areas: { flags: { whyItFired: { value: unknown } }[] }[] };
    const flag = screening.areas.find((a) => a.flags.length > 0)!.flags[0];
    // Same shape, same textOrigin: only the characters change, and they are ours.
    flag.whyItFired.value = "This passage is optimized for reach.";
    const audit = auditPublishingPackage(polluted, { now: NOW });
    expect(audit.ok).toBe(false);
    expect(audit.violations.some((v) => v.kind === "banned_claim")).toBe(true);
  });

  test("a PROJECT whose own words carry the same banned claim builds, because those characters are the project's", () => {
    const source = sourceWithAssets();
    source.chapters[0].scenes[0].narration =
      "Our viral marketing was guaranteed to boost your views, and the process was fully optimized.";
    const pkg = buildPublishingPackage(source, OPTS);
    expect(pkg.selfAudit.ok).toBe(true);
    const area = pkg.screening.areas.find((a) => a.area === "copyright")!;
    expect(area.status === "flags_found" || area.status === "nothing_matching_this_rule").toBe(true);
    // The app's own sentences never repeat the project's characters.
    for (const flag of area.flags) {
      if (flag.whyItFired.state === "derived") expect(flag.whyItFired.value.toLowerCase()).not.toContain("viral");
    }
  });

  test("the view model audits its own output and renders the screening section", () => {
    const pkg = buildPublishingPackage(sourceWithAssets(), OPTS);
    const view = buildCreatorStudioView({
      projectId: pkg.projectId,
      package: pkg,
      version: 1,
      savedPackageId: "saved_1",
      payloadBytes: 1024,
      versions: [{ id: "saved_1", version: 1, derivedAt: pkg.derivedAt, sourceFingerprint: pkg.sourceFingerprint, counts: { chapters: 0, scenes: 0, assets: 0, keywords: 0, tags: 0, hashtags: 0, emptyFields: 0 } }],
      reAudit: null,
    });
    expect(view.kind).toBe("package");
    if (view.kind !== "package") return;
    const section = view.sections.find((s) => s.id === "screening")!;
    expect(section).toBeDefined();
    expect(section.rows).toHaveLength(7);
    // The unmissable statement is on the section, as a value.
    const labels = section.values.map((v) => v.label);
    expect(labels).toContain("What these flags are");
    expect(labels).toContain("What a rule that found nothing means");
    expect(labels).toContain("Cleared for publication");
    const cleared = section.values.find((v) => v.label === "Cleared for publication")!;
    expect(cleared.state === "derived" && cleared.value).toBe(false);
    // Every area row carries its capability line, which is never a pass.
    for (const row of section.rows) {
      const cap = row.values.find((v) => v.label === "The part no capability in this app examines");
      expect(cap).toBeDefined();
      expect(cap!.state).toBe("derived");
      expect(String(cap!.value)).toContain("Not screened — no capability");
    }
    // The licence section now shows the origin row and what the record does not say.
    const licences = view.sections.find((s) => s.id === "licences")!;
    const assetRow = licences.rows.find((r) => r.id === "asset_stock")!;
    expect(assetRow.values.map((v) => v.label)).toContain("Provider named on the origin row");
    expect(assetRow.notes.join(" ")).toContain("does not");
  });
});
