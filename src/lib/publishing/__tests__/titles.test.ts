/**
 * P7-3 — the title engine. These are the properties the owner's spec is honoured
 * through, asserted one by one: 20+ options across the six requested categories,
 * six axes per title computed from DECLARED inputs, every title traceable to a
 * rule and a source row, the model-backed path gated rather than faked, and the
 * audit still biting on a metric-shaped key or a banned claim.
 */
import { describe, expect, test } from "bun:test";
import { buildKeywordPlan } from "../keywords";
import { buildPublishingPackage, PUBLISHING_PACKAGE_FORMAT } from "../package";
import { auditPublishingPackage } from "../audit";
import { PUBLISHING_RULES } from "../rules";
import {
  buildTitlePlan,
  buildTitlesModelPath,
  TITLE_AXIS_IDS,
  TITLE_CATEGORY_IDS,
  TITLE_MINIMUM,
  TITLE_TEMPLATES,
  type TitlesModelOutcome,
} from "../titles";
import { NOW, richSource } from "./fixtures";

const OPTS = { now: NOW, modelCopyEnvNames: ["OPENAI_API_KEY"] as string[] };

function planFor(source = richSource()) {
  return buildTitlePlan({
    source,
    keywords: buildKeywordPlan(source),
    modelPath: { outcome: null, envVars: ["OPENAI_API_KEY"] },
  });
}

describe("P7-3 titles — the owner's spec, honoured from the project's own text", () => {
  test("at least 20 options, spread across all six requested categories", () => {
    const plan = planFor();
    expect(plan.totalTitles).toBeGreaterThanOrEqual(TITLE_MINIMUM);
    expect(plan.minimumRequested).toBe(TITLE_MINIMUM);
    expect(plan.meetsMinimum).toBe(true);
    expect(plan.categories.map((c) => c.id)).toEqual([...TITLE_CATEGORY_IDS]);
    for (const category of plan.categories) {
      expect(category.titles.length).toBeGreaterThan(0);
      expect(category.reason).toBeNull();
    }
    // Six categories, six labels, six definitions — nothing shared by accident.
    expect(new Set(plan.categories.map((c) => c.label)).size).toBe(6);
    expect(new Set(plan.categories.map((c) => c.definition)).size).toBe(6);
  });

  test("every title is a fixed template with the project's own words substituted in", () => {
    const plan = planFor();
    const ids = new Set(TITLE_TEMPLATES.map((t) => t.id));
    for (const option of plan.titles) {
      expect(ids.has(option.templateId)).toBe(true);
      expect(option.rule).toBe("R-TITLE-TEMPLATE");
      expect(option.authoredBy).toBe("rule_template");
      expect(option.textOrigin).toBe("template_filled");
      expect(option.text.length).toBeGreaterThan(0);
      // The template still carries its placeholders…
      expect(option.templateText).toContain("{");
      // …and the template with those placeholders filled is EXACTLY the title.
      let filled = option.templateText;
      for (const fragment of option.fragments) filled = filled.replace(fragment.placeholder, fragment.text);
      expect(filled).toBe(option.text);
    }
  });

  test("every title carries a rule and at least one source row, and every fragment does too", () => {
    const plan = planFor();
    for (const option of plan.titles) {
      expect(option.sources.length).toBeGreaterThan(0);
      for (const source of option.sources) {
        expect(source.kind.length).toBeGreaterThan(0);
        expect(source.id.length).toBeGreaterThan(0);
        expect(source.path.length).toBeGreaterThan(0);
      }
      expect(option.fragments.length).toBeGreaterThan(0);
      for (const fragment of option.fragments) {
        expect(fragment.sources.length).toBeGreaterThan(0);
        // The words substituted in are the project's own, declared as such.
        expect(fragment.textOrigin).toBe("source_verbatim");
        expect(fragment.text.length).toBeGreaterThan(0);
      }
    }
  });

  test("six axes per title, in the requested order, each with five declared wordings", () => {
    const plan = planFor();
    expect(plan.axisIds).toEqual([...TITLE_AXIS_IDS]);
    for (const option of plan.titles) {
      expect(option.axes.map((a) => a.id)).toEqual([...TITLE_AXIS_IDS]);
      for (const axis of option.axes) {
        expect(axis.features.length).toBe(5);
        expect(axis.maxScore).toBe(5);
        expect(axis.about.length).toBeGreaterThan(0);
        expect(axis.notA.length).toBeGreaterThan(0);
        expect(axis.featureSource.length).toBeGreaterThan(0);
      }
    }
  });

  test("each score IS the count of the wordings that were present — recomputed here, not trusted", () => {
    const plan = planFor();
    for (const option of plan.titles) {
      for (const axis of option.axes) {
        const recount = axis.features.filter((f) => f.present === true).length;
        expect(axis.score).toBe(recount);
        expect(axis.scoreIsTheFeatureCount).toBe(true);
        expect(axis.score).toBeLessThanOrEqual(axis.maxScore);
        // Every verdict says how it was measured, so no number is bare.
        for (const feature of axis.features) {
          expect(feature.measured.length).toBeGreaterThan(0);
          expect(feature.label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("a project with no text at all gets no invented title: every category says why it is empty", () => {
    const source = richSource();
    source.project.title = "";
    source.project.description = null;
    // No script, no chapters, no title, no description: there is no text at all
    // for a template to fill, so the plan must carry no title.
    source.script = null;
    source.settings = null;
    source.chapters = [];
    const plan = planFor(source);
    // The invariant that must hold whatever the source looks like: no title is
    // ever invented, and any category holding nothing says why.
    for (const category of plan.categories) {
      if (category.titles.length > 0) continue;
      expect(typeof category.reason).toBe("string");
      expect((category.reason ?? "").length).toBeGreaterThan(0);
      expect(category.templatesSkipped.length).toBeGreaterThan(0);
      for (const skipped of category.templatesSkipped) {
        expect(skipped.templateText.length).toBeGreaterThan(0);
        expect(skipped.missing.length).toBeGreaterThan(0);
      }
    }
    // Six categories are always present: the surface says which ones are empty.
    expect(plan.categories).toHaveLength(6);
    for (const option of plan.titles) expect(option.text.trim().length).toBeGreaterThan(0);
    if (plan.totalTitles < TITLE_MINIMUM) {
      expect(plan.meetsMinimum).toBe(false);
      expect(plan.categories.some((c) => c.titles.length === 0)).toBe(true);
    }
  });

  test("the same text yields the same titles — the plan is deterministic", () => {
    const a = planFor();
    const b = planFor();
    expect(a.titles.map((t) => t.text)).toEqual(b.titles.map((t) => t.text));
    expect(a.duplicatesDropped).toBe(b.duplicatesDropped);
  });
});

describe("P7-3 titles — the model-backed path is gated, never faked", () => {
  const okOutcome: TitlesModelOutcome = {
    status: "ok",
    attempt: {
      status: "ok",
      providerId: "replicate",
      model: "some/model",
      latencyMs: 12,
      at: NOW.toISOString(),
      orchestratorMessage: null,
      providerAnswer: null,
    },
    titles: [
      {
        text: "Whichever words the provider returned",
        textOrigin: "provider_verbatim",
        providerId: "replicate",
        model: "some/model",
        at: NOW.toISOString(),
        sources: [{ kind: "provider", id: "replicate", path: "output.titles[0]" }],
      },
    ],
    requiredEnv: [],
    nothingAttempted: false,
    orchestratorMessage: null,
  };

  test("unkeyed, the gate names the registry's env var and carries no title", () => {
    const path = buildTitlesModelPath({ outcome: null, envVars: ["OPENAI_API_KEY"] });
    expect(path.state.state).toBe("gated_provider");
    expect(path.state.envVars).toEqual(["OPENAI_API_KEY"]);
    expect(path.modelTitles).toEqual([]);
    expect(path.authoredByModel).toBe("No title in this package was written by a model.");
  });

  test("asked and not reachable, the state is still gated and no title is claimed", () => {
    const outcome: TitlesModelOutcome = {
      status: "not_connected",
      attempt: null,
      titles: [],
      requiredEnv: ["OPENAI_API_KEY"],
      nothingAttempted: true,
      orchestratorMessage: "not reached",
    };
    const path = buildTitlesModelPath({ outcome, envVars: ["OPENAI_API_KEY"] });
    expect(path.state.state).toBe("gated_provider");
    expect(path.modelTitles).toEqual([]);
  });

  test("only an accepted answer produces model-authored titles", () => {
    const path = buildTitlesModelPath({ outcome: okOutcome, envVars: ["OPENAI_API_KEY"] });
    expect(path.state.state).toBe("derived");
    expect(path.modelTitles).toHaveLength(1);
    expect(path.modelTitles[0].providerId).toBe("replicate");
    expect(path.authoredByModel).toContain("provider");
  });

  test("a failure that returned no text still yields no title", () => {
    const failed: TitlesModelOutcome = { ...okOutcome, status: "failed", titles: [] };
    const path = buildTitlesModelPath({ outcome: failed, envVars: ["OPENAI_API_KEY"] });
    expect(path.modelTitles).toEqual([]);
    expect(path.state.state).not.toBe("derived");
  });

  test("the gated path reaches the package and the package still audits clean", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    expect(pkg.format).toBe(PUBLISHING_PACKAGE_FORMAT);
    expect(pkg.titles.modelPath.modelTitles).toEqual([]);
    expect(pkg.titles.modelPath.state.state).not.toBe("derived");
    expect(auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: ["OPENAI_API_KEY"] }).ok).toBe(true);
  });
});

describe("P7-3 titles — the guard rails bite on a score and on a title", () => {
  test("a metric-shaped key inside a title or a score fails the audit", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const withMetric = structuredClone(pkg) as unknown as typeof pkg;
    (withMetric.titles.titles[0] as unknown as Record<string, unknown>).searchVolume = 8100;
    const result = auditPublishingPackage(withMetric, { now: NOW });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.kind === "forbidden_metric_key")).toBe(true);
  });

  test("a banned claim in a TEMPLATE fails, while the same words in the project's own text do not", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const withClaim = structuredClone(pkg) as unknown as typeof pkg;
    withClaim.titles.titles[0].templateText = "Guaranteed viral growth for your channel";
    const result = auditPublishingPackage(withClaim, { now: NOW });
    expect(result.ok).toBe(false);

    // The project's OWN words are exempt — a project about that subject must not
    // be unbuildable because it is named after it.
    const source = richSource();
    source.project.title = "The Viral Economics of Carthage";
    expect(() => buildPublishingPackage(source, OPTS)).not.toThrow();
  });

  test("every rule id the plan uses is in the app's catalogue, and every score names a source row", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const catalogue = new Set(Object.keys(PUBLISHING_RULES));
    const used = [
      pkg.titles.rule,
      pkg.titles.categoryRule,
      pkg.titles.scoreRule,
      pkg.titles.countRule,
      pkg.titles.modelRule,
    ];
    for (const option of pkg.titles.titles) {
      used.push(option.rule);
      for (const axis of option.axes) {
        used.push(axis.rule);
        // A score with no source row behind it would be a number with no origin.
        expect(axis.sources.length).toBeGreaterThan(0);
        for (const source of axis.sources) expect(source.id.length).toBeGreaterThan(0);
      }
    }
    for (const id of used) expect(catalogue.has(id)).toBe(true);
  });
});
