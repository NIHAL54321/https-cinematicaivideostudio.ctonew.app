import { describe, expect, test } from "bun:test";
import { auditPublishingPackage, PublishingHonestyError, assertPublishingPackage } from "../audit";
import { buildPublishingPackage } from "../package";
import { derived } from "../provenance";
import { emptySource, NOW, richSource } from "./fixtures";

const ENV = ["OPENAI_API_KEY"];

function goodPackage() {
  return buildPublishingPackage(richSource(), { now: NOW, modelCopyEnvNames: ENV });
}

describe("the honesty audit — the numbers this product does not have", () => {
  test("a real package audits clean, and the audit proves it walked the tree", () => {
    const pkg = goodPackage();
    const result = auditPublishingPackage(pkg, { now: NOW });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.inspectedKeys).toBeGreaterThan(100);
    expect(result.inspectedStrings).toBeGreaterThan(50);
    expect(pkg.selfAudit.ok).toBe(true);
    expect(pkg.selfAudit.violationCount).toBe(0);
  });

  test("NEGATIVE CASE: every manufactured metric key is caught, at any depth", () => {
    const metricKeys = [
      "searchVolume",
      "monthlySearches",
      "keywordDifficulty",
      "competition",
      "competitorCount",
      "estimatedTraffic",
      "traffic",
      "impressions",
      "trend",
      "popularity",
      "demand",
      "cpc",
      "sv",
      "kd",
      "msv",
      "rankingPosition",
      "seoScore",
      "keywordScore",
    ];
    for (const key of metricKeys) {
      const pkg = goodPackage() as unknown as Record<string, unknown>;
      pkg[key] = 12000;
      const result = auditPublishingPackage(pkg, { now: NOW });
      expect(result.ok).toBe(false);
      expect(result.violations.some((v) => v.kind === "forbidden_metric_key" && v.path === key)).toBe(true);
    }
  });

  test("NEGATIVE CASE: a metric smuggled INSIDE a keyword record is caught", () => {
    const pkg = goodPackage() as unknown as { keywords: { buckets: { keywords: Record<string, unknown>[] }[] } };
    const record = pkg.keywords.buckets[0].keywords[0];
    record.searchVolume = 4900;
    record.difficulty = 22;
    const result = auditPublishingPackage(pkg, { now: NOW });
    expect(result.ok).toBe(false);
    const paths = result.violations.map((v) => v.path);
    expect(paths.some((p) => p.endsWith(".searchVolume"))).toBe(true);
    expect(paths.some((p) => p.endsWith(".difficulty"))).toBe(true);
  });

  test("NEGATIVE CASE: a metric inside the honesty declaration's subtree is STILL caught", () => {
    const pkg = goodPackage() as unknown as { honesty: Record<string, unknown> };
    pkg.honesty.searchVolume = 8100;
    const result = auditPublishingPackage(pkg, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === "forbidden_metric_key")).toBe(true);
  });

  test("NEGATIVE CASE: a metric nested three levels deep in an array is caught", () => {
    const pkg = goodPackage() as unknown as { chapters: { entries: Record<string, unknown>[] } };
    pkg.chapters.entries[0].scenes[0].estimatedTraffic = 5;
    const result = auditPublishingPackage(pkg, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations[0].path).toContain("estimatedTraffic");
  });

  test("a derived value with no rule or no source is a violation", () => {
    const bad = {
      field: { state: "derived", value: "x", rule: null, sources: [], textOrigin: "source_verbatim" },
      other: { state: "derived", value: "y", rule: "R-CH-TITLE", sources: [], textOrigin: "source_verbatim" },
    };
    const result = auditPublishingPackage(bad);
    expect(result.ok).toBe(false);
    expect(result.violations.filter((v) => v.kind === "malformed_field").length).toBeGreaterThanOrEqual(2);
  });

  test("a rule id that is not in the catalogue is a violation", () => {
    const result = auditPublishingPackage({ rule: "R-MADE-UP" });
    expect(result.ok).toBe(false);
    expect(result.violations[0].kind).toBe("unknown_rule");
  });

  test("a non-derived value that carries a value is a violation", () => {
    const result = auditPublishingPackage({
      field: { state: "empty_no_input", value: "not really empty", rule: null, sources: [], reason: "r", requires: ["x"], textOrigin: null },
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.detail.includes("null value"))).toBe(true);
  });

  test("a rule-authored sentence with a banned claim is caught; the SAME words in the user's own text are not", () => {
    const ours = { text: { state: "derived", value: "This keyword set is optimized for growth.", rule: "R-PINNED-COMMENT", sources: [{ kind: "project", id: "p" }], textOrigin: "rule_authored" } };
    const theirs = { text: { state: "derived", value: "This keyword set is optimized for growth.", rule: "R-PINNED-COMMENT", sources: [{ kind: "project", id: "p" }], textOrigin: "source_verbatim" } };
    expect(auditPublishingPackage(ours).ok).toBe(false);
    expect(auditPublishingPackage(ours).violations[0].kind).toBe("banned_claim");
    expect(auditPublishingPackage(theirs).ok).toBe(true);
  });

  test("a string value that does not declare its text origin is a violation", () => {
    const result = auditPublishingPackage({
      text: { state: "derived", value: "hi", rule: "R-CH-TITLE", sources: [{ kind: "chapter", id: "c" }], textOrigin: null },
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0].kind).toBe("unlabelled_text_origin");
  });

  test("assertPublishingPackage throws a PublishingHonestyError naming the violations", () => {
    expect(() => assertPublishingPackage({ searchVolume: 1 })).toThrow(PublishingHonestyError);
    expect(() => assertPublishingPackage(goodPackage())).not.toThrow();
  });

  test("a package with no chapters at all still audits clean (the empty case is not a violation)", () => {
    const pkg = buildPublishingPackage(emptySource(), { now: NOW, modelCopyEnvNames: ENV });
    const result = auditPublishingPackage(pkg, { now: NOW });
    expect(result.ok).toBe(true);
    expect(pkg.summary.fields.emptyNoInput).toBeGreaterThan(0);
  });

  test("derived() itself refuses to make an anonymous value", () => {
    expect(() => derived("x", "R-CH-TITLE", [])).toThrow();
    expect(() => derived("x", "R-CH-TITLE", [{ kind: "chapter", id: "c" }])).toThrow();
  });
});
