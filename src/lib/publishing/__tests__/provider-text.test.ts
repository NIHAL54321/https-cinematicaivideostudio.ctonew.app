/**
 * P7-8 — THE HONESTY TRAP AT THE PROVIDER BOUNDARY, WRITTEN AS A TEST.
 *
 * The trap, stated once: a model's answer is text THIS APP DID NOT WRITE. A model
 * that answers "guaranteed ranking", or that attaches a monthly-search figure to a
 * title, must never become an unmarked claim of this publishing package, and the
 * honesty audit must not be weakened to accommodate model text.
 *
 * THE MECHANISM THIS FILE PROVES (`src/lib/publishing/provider-text.ts`): a
 * provider's value is WITHHELD — it is not carried as one of the package's values
 * at all, and it is recorded verbatim in a `withheld` record naming the provider,
 * the matched characters and the reason. The page shows it only inside that record,
 * marked as the provider's own text that this product declines to use.
 *
 * WHY WITHHOLDING RATHER THAN QUOTE-AND-KEEP: the audit DOES exempt a third party's
 * declared characters (`provider_verbatim`), and that is the right rule — but a
 * value carried that way still sits in the package as one of its title options,
 * where a reader, an export or a downstream consumer takes it for the studio's own
 * proposal. Withholding makes "not an unmarked claim" true by construction.
 *
 * AND THE AUDIT UNDERNEATH IS UNCHANGED. The plant below flips the declaration on
 * one withheld record — the same characters in the same place — and the audit
 * refuses it, which is what proves the exemption is conditional on the declaration
 * rather than on the text. The same file proves an APP-AUTHORED sentence carrying a
 * claim is still refused, and that the app's own refusal reason carries no claim of
 * its own.
 */
import { describe, expect, test } from "bun:test";
import type { AiResult } from "@/lib/ai";
import { BANNED_CLAIMS, FORBIDDEN_METRIC_KEY, auditPublishingPackage } from "../audit";
import { buildPublishingPackage, PUBLISHING_PACKAGE_FORMAT } from "../package";
import {
  METRIC_SHAPED_TEXT,
  PROVIDER_SCREEN_STATEMENT,
  WITHHELD_CLAIM_REASON,
  WITHHELD_METRIC_REASON,
  screenProviderText,
} from "../provider-text";
import { TITLE_COPY } from "../studio-copy";
import { buildCreatorStudioView } from "../studio-view";
import { TITLE_MODEL_REQUEST_FIELDS, outcomeFromAiResult, seoGenerationRouterRequest } from "../titles-model";
import { buildTitlesModelPath } from "../titles";
import { buildKeywordPlan } from "../keywords";
import { NOW, richSource } from "./fixtures";

const OPTS = { now: NOW, modelCopyEnvNames: ["OPENAI_API_KEY"] as string[] };

/* ------------------------------------------------------------------ */
/* Fixtures — a provider's answer, of the shape the adapter parses     */
/* ------------------------------------------------------------------ */

/**
 * A model's answer to the SEO task. Two of its values are things this product
 * must not carry: a promise of a ranking, and a monthly-search figure. The rest
 * are ordinary and are carried.
 */
const SEO_ANSWER: Record<string, unknown> = {
  title: "The Fall of Carthage: guaranteed ranking in seven days",
  titles: ["How Rome and Carthage Fought Over the Sea", "Carthage: 12,000 monthly searches for this story"],
  description: "A plain account of the war between Rome and Carthage, told in the order the sources give it.",
  tags: ["carthage", "keyword difficulty", "rome"],
  hashtags: ["#carthage", "#guaranteed history"],
};

/** The provider's answer as the orchestrator would hand it over. */
function answer(seo: Record<string, unknown>): AiResult {
  return {
    status: "ok",
    capability: "seo_generation",
    taskType: "SEO",
    provider: "openai",
    model: "gpt-4o",
    resultText: JSON.stringify(seo),
    outputRefs: { seo },
    attempts: [{ provider: "openai", model: "gpt-4o", status: "ok", latencyMs: 812, at: NOW.toISOString() }],
    requiredEnv: [],
  };
}

/** Every string this package actually CARRIES from the provider's answer. */
function carriedTexts(outcome: ReturnType<typeof outcomeFromAiResult>): string[] {
  return [...outcome.titles.map((t) => t.text), ...(outcome.providerValues ?? []).map((v) => v.text)];
}

/** The banned claims present in a string, using the audit's own list. */
function claimsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_CLAIMS.filter((phrase) => lower.includes(phrase));
}

/** The metric-shaped key names present in a string, using the audit's own pattern. */
function metricKeyIn(text: string): string[] {
  return FORBIDDEN_METRIC_KEY.test(text) ? [text] : [];
}

function packageWith(outcome: ReturnType<typeof outcomeFromAiResult>) {
  return buildPublishingPackage(richSource(), {
    ...OPTS,
    titlesModelPath: { outcome, envVars: ["OPENAI_API_KEY"] },
  });
}

function viewOf(pkg: ReturnType<typeof packageWith>) {
  return buildCreatorStudioView({
    projectId: pkg.projectId,
    package: pkg,
    version: 1,
    savedPackageId: "saved_1",
    payloadBytes: 2048,
    versions: [
      {
        id: "saved_1",
        version: 1,
        derivedAt: pkg.derivedAt,
        sourceFingerprint: pkg.sourceFingerprint,
        counts: { chapters: 0, scenes: 0, assets: 0, keywords: 0, tags: 0, hashtags: 0, emptyFields: 0 },
      },
    ],
    reAudit: null,
  });
}

/* ------------------------------------------------------------------ */
/* 1. The screen itself                                                */
/* ------------------------------------------------------------------ */

describe("P7-8 the screen — a claim and an unsourced number are refused, each with its own reason", () => {
  test("a claim in a provider's own words is refused, and the record names the provider's own characters", () => {
    const verdict = screenProviderText("The Fall of Carthage: guaranteed ranking in seven days");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable: the screen accepted a claim");
    // The characters that triggered it are the PROVIDER's, declared as such.
    expect(verdict.matched).toEqual({ textOrigin: "provider_verbatim", phrase: "guaranteed" });
    expect(verdict.reason).toBe(WITHHELD_CLAIM_REASON);
    // The app's own sentence repeats no claim of its own.
    expect(claimsIn(verdict.reason)).toEqual([]);
    expect(verdict.reason).not.toContain("guaranteed");
  });

  test("a number about search demand in a provider's words is refused as data this product has no source for", () => {
    const verdict = screenProviderText("Carthage: 12,000 monthly searches, low difficulty for the phrase");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("unreachable: the screen accepted an unsourced number");
    expect(verdict.matched.textOrigin).toBe("provider_verbatim");
    expect(verdict.matched.phrase).toBe("monthly searches");
    expect(verdict.reason).toBe(WITHHELD_METRIC_REASON);
    expect(verdict.reason.length).toBeGreaterThan(0);
  });

  test("the metric screen is not vacuous: each of its shapes bites on its own fixture", () => {
    const fixtures: [RegExp, string][] = [
      [/\bsearch\s+volume\b/i, "800 search volume"],
      [/\bkeyword\s+difficulty\b/i, "low keyword difficulty"],
      [/\bseo\s+score\b/i, "an seo score of 92"],
      [/\b(?:kd|sv|msv)\s*[:=]\s*\d/i, "sv: 1200"],
      [/\b\d[\d,.]*\s*(?:searches|impressions|clicks|visits)\b/i, "12,000 impressions"],
    ];
    for (const [pattern, probe] of fixtures) {
      expect(pattern.test(probe)).toBe(true);
      expect(screenProviderText(`A title carrying ${probe}`).ok).toBe(false);
    }
    // …and the list is the one the module publishes, not a copy of it.
    expect(METRIC_SHAPED_TEXT.length).toBeGreaterThanOrEqual(5);
  });

  test("an ordinary value passes: the screen is a phrase-and-shape gate, not a filter on style", () => {
    expect(screenProviderText("How Rome and Carthage Fought Over the Sea")).toEqual({ ok: true });
  });
});

/* ------------------------------------------------------------------ */
/* 2. THE PLANT — through the app's real path, into the package        */
/* ------------------------------------------------------------------ */

describe("P7-8 THE PLANT — a model's claim never becomes a value of this package", () => {
  test("what the model returned is split into what is carried and what is withheld, verbatim", () => {
    const outcome = outcomeFromAiResult(answer(SEO_ANSWER));

    // CARRIED: only the values with no claim and no unsourced figure.
    expect(outcome.titles.map((t) => t.text)).toEqual(["How Rome and Carthage Fought Over the Sea"]);
    expect(outcome.providerValues?.map((v) => v.kind)).toEqual(["description", "tag", "tag", "hashtag"]);
    expect(outcome.providerValues?.map((v) => v.text)).toEqual([
      SEO_ANSWER.description,
      "carthage",
      "rome",
      "#carthage",
    ]);

    // THE INVARIANT, over every carried string: no claim this product refuses to
    // make, and no metric-shaped key or figure.
    for (const text of carriedTexts(outcome)) {
      expect(claimsIn(text)).toEqual([]);
      expect(metricKeyIn(text)).toEqual([]);
      expect(screenProviderText(text)).toEqual({ ok: true });
    }

    // WITHHELD: the promise, the unsourced figure, and the two values that carry them.
    expect(outcome.withheld ?? []).toHaveLength(4);
    const promise = outcome.withheld!.find((w) => w.text.includes("guaranteed"))!;
    expect(promise.textOrigin).toBe("provider_verbatim");
    expect(promise.text).toBe(SEO_ANSWER.title); // character for character
    expect(promise.matched.phrase).toBe("guaranteed");
    expect(promise.disposition).toBe("withheld_not_used");
    expect(promise.reason).toBe(WITHHELD_CLAIM_REASON);
    expect(promise.providerId).toBe("openai");
    expect(promise.model).toBe("gpt-4o");
    expect(promise.at).toBe(NOW.toISOString());
    // The withheld record is NOT one of the package's values: it lives in its own list.
    expect(outcome.titles.map((t) => t.text)).not.toContain(SEO_ANSWER.title);
    expect((outcome.providerValues ?? []).map((v) => v.text)).not.toContain(SEO_ANSWER.title);

    // The figure, screened as data rather than as a claim.
    const figure = outcome.withheld!.find((w) => w.text.includes("12,000"))!;
    expect(figure.reason).toBe(WITHHELD_METRIC_REASON);
    expect(figure.matched.phrase).toBe("monthly searches");

    // The counts the page shows.
    expect(outcome.screen?.rule).toBe("R-SEO-PROVIDER-SCREEN");
    expect(outcome.screen?.screened).toBe(9);
    expect(outcome.screen?.withheld).toBe(4);
    expect(outcome.screen?.statement).toBe(PROVIDER_SCREEN_STATEMENT);
  });

  test("through the package: withheld is counted, the package audits clean, and the count is not a claim about the answer", () => {
    const pkg = packageWith(outcomeFromAiResult(answer(SEO_ANSWER)));
    expect(pkg.format).toBe(PUBLISHING_PACKAGE_FORMAT);
    expect(pkg.block).toBe("P7-1..P7-8");
    expect(pkg.summary.titlesFromProvider).toBe(1);
    expect(pkg.summary.providerValuesWithheld).toBe(4);
    expect(pkg.summary.providerValuesCarried).toBe(4);

    // The package's own audit accepts it — because the provider's characters are
    // DECLARED as the provider's and are not carried as this app's values.
    const audit = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: ["OPENAI_API_KEY"] });
    expect(audit.ok).toBe(true);
  });

  test("THE DECLARATION IS LOAD-BEARING: flip it on one withheld record and the same characters are a violation", () => {
    const pkg = packageWith(outcomeFromAiResult(answer(SEO_ANSWER)));
    expect(auditPublishingPackage(pkg, { now: NOW }).ok).toBe(true);

    // Same characters, same place — but no longer declared as the provider's.
    const undeclared = structuredClone(pkg) as unknown as { titles: { modelPath: { withheld: { textOrigin: string }[] } } };
    undeclared.titles.modelPath.withheld[0].textOrigin = "rule_authored";
    const bad = auditPublishingPackage(undeclared, { now: NOW });
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.kind === "banned_claim")).toBe(true);
  });

  test("an APP-authored sentence that makes a claim is still refused — the audit was not weakened for model text", () => {
    const pkg = packageWith(outcomeFromAiResult(answer(SEO_ANSWER)));
    const tampered = structuredClone(pkg) as unknown as { titles: { modelPath: { authoredByModel: string } } };
    tampered.titles.modelPath.authoredByModel = `${tampered.titles.modelPath.authoredByModel} A fully guaranteed result.`;
    const bad = auditPublishingPackage(tampered, { now: NOW });
    expect(bad.ok).toBe(false);
    expect(bad.violations.some((v) => v.kind === "banned_claim")).toBe(true);
  });

  test("the page marks the provider's text as the provider's, and the withheld claim as withheld", () => {
    const pkg = packageWith(outcomeFromAiResult(answer(SEO_ANSWER)));
    const view = viewOf(pkg);
    expect(view.kind).toBe("package");
    if (view.kind !== "package") throw new Error("the view failed its own audit");
    const titles = view.sections.find((s) => s.id === "titles")!;

    // The provider's carried description is rendered as a DECLARED whole-value copy
    // — this app's own template is the placeholder alone, so no word of ours is in it.
    const description = titles.values.find((v) => v.label.startsWith(TITLE_COPY.providerValueLabels.description))!;
    expect(description.textOrigin).toBe("provider_verbatim");
    expect(description.value).toBe(SEO_ANSWER.description);
    expect(description.templateText).toBe("{PROJECT_TEXT}");
    expect(description.fragments[0]?.textOrigin).toBe("provider_verbatim");

    // The withheld claim is on the page under its own label, marked withheld, and
    // rendered in exactly the same declared way.
    const withheldText = titles.values.find((v) => v.label === TITLE_COPY.withheldValueLabel("title"))!;
    expect(withheldText.value).toBe(SEO_ANSWER.title);
    expect(withheldText.textOrigin).toBe("provider_verbatim");
    expect(withheldText.note).toContain(WITHHELD_CLAIM_REASON);
    const withheldPhrase = titles.values.find((v) => v.label === TITLE_COPY.withheldPhraseLabel)!;
    expect(withheldPhrase.value).toBe("guaranteed");

    // The screen's own counts and statement are on the page too.
    expect(titles.values.some((v) => v.label === TITLE_COPY.screenScreenedLabel && v.value === 9)).toBe(true);
    expect(titles.values.some((v) => v.label === TITLE_COPY.screenWithheldLabel && v.value === 4)).toBe(true);
    expect(
      titles.values.some((v) => v.label === TITLE_COPY.screenStatementLabel && v.value === PROVIDER_SCREEN_STATEMENT),
    ).toBe(true);
    // …and no value of the package is presented as a model-written TITLE it did not write.
    expect(titles.values.filter((v) => v.value === SEO_ANSWER.title).length).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The other honest states, unchanged                               */
/* ------------------------------------------------------------------ */

describe("P7-8 the other states — gated reads as gated, rejected reads as rejected", () => {
  test("unkeyed: gated, naming OPENAI_API_KEY, nothing attempted, nothing withheld, nothing claimed", () => {
    const unkeyed: AiResult = {
      status: "not_connected",
      capability: "seo_generation",
      taskType: "SEO",
      error: "no provider is both wired and configured for seo_generation",
      requiredEnv: ["OPENAI_API_KEY"],
      attempts: [],
    };
    const outcome = outcomeFromAiResult(unkeyed);
    expect(outcome.status).toBe("not_connected");
    expect(outcome.nothingAttempted).toBe(true);
    expect(outcome.attempt).toBeNull();
    expect(outcome.titles).toEqual([]);
    expect(outcome.providerValues).toEqual([]);
    expect(outcome.withheld).toEqual([]);
    expect(outcome.screen).toEqual({
      rule: "R-SEO-PROVIDER-SCREEN",
      screened: 0,
      withheld: 0,
      statement: PROVIDER_SCREEN_STATEMENT,
    });

    const path = buildTitlesModelPath({ outcome, envVars: ["OPENAI_API_KEY"] });
    expect(path.state.state).toBe("gated_provider");
    expect(path.state.envVars).toEqual(["OPENAI_API_KEY"]);
    expect(path.modelTitles).toEqual([]);
    // The screen's statement travels even when there was nothing to screen — it
    // says what the screen IS, and it claims nothing about any answer.
    expect(path.screen.screened).toBe(0);
    expect(path.screen.statement).toBe(PROVIDER_SCREEN_STATEMENT);
  });

  test("reached and rejected: the provider's own answer travels verbatim and nothing is carried or withheld", () => {
    const body = '{"error":{"message":"Incorrect API key provided: <redacted-key-fragment>.","code":"invalid_api_key"}}';
    const rejected: AiResult = {
      status: "failed",
      capability: "seo_generation",
      taskType: "SEO",
      error: `OpenAI returned no answer text (http 401). Nothing was invented to fill the gap.`,
      requiredEnv: ["OPENAI_API_KEY"],
      attempts: [
        {
          provider: "openai",
          model: "gpt-4o",
          status: "failed",
          latencyMs: 143,
          at: NOW.toISOString(),
          error: `http 401: ${body}`,
        },
      ],
    };
    const outcome = outcomeFromAiResult(rejected);
    expect(outcome.status).toBe("failed");
    expect(outcome.nothingAttempted).toBe(false); // it WAS attempted
    expect(outcome.titles).toEqual([]);
    expect(outcome.withheld).toEqual([]); // the app cannot withhold what nobody wrote
    expect(outcome.screen?.screened).toBe(0);
    // The provider's own rejection, character for character, under the attempt.
    expect(outcome.attempt?.providerAnswer?.text).toBe(`http 401: ${body}`);
    expect(outcome.attempt?.providerAnswer?.textOrigin).toBe("provider_verbatim");
    expect(outcome.attempt?.providerAnswer?.providerId).toBe("openai");
    expect(outcome.attempt?.status).toBe("failed");
    expect(viewOf(packageWith(outcome)).kind).toBe("package");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The join: the app's own request is the one the adapter serves    */
/* ------------------------------------------------------------------ */

describe("P7-8 the join — the plan describes the request this app really builds", () => {
  test("the declared request field names are exactly the fields the builder sends", () => {
    const source = richSource();
    const task = seoGenerationRouterRequest(source, buildKeywordPlan(source));
    expect(task.capability).toBe("seo_generation");
    expect(Object.keys(task.payload)).toEqual([...TITLE_MODEL_REQUEST_FIELDS]);
    expect(task.payload.title).toBe(source.project.title);
    expect(String(task.payload.transcript).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 5. A stored package that predates the screen is still readable      */
/* ------------------------------------------------------------------ */

describe("P7-8 backwards — a v5 payload renders with the screen's own absence declared", () => {
  test("the absent screen is stated as an absence naming the format, never as a screen result of zero", () => {
    const pkg = buildPublishingPackage(richSource(), OPTS);
    const older = structuredClone(pkg) as unknown as {
      format: string;
      block: string;
      titles: { modelPath: Record<string, unknown> };
    };
    // What a v5 payload looks like: the same package, written before P7-8 existed.
    older.format = "cavs.publishing-package/v5";
    older.block = "P7-1..P7-6";
    delete older.titles.modelPath.providerValues;
    delete older.titles.modelPath.withheld;
    delete older.titles.modelPath.screen;

    // Still audits clean — the format is not a gate on reading.
    expect(auditPublishingPackage(older, { now: NOW, expectedEnvNames: ["OPENAI_API_KEY"] }).ok).toBe(true);

    const view = viewOf(older as unknown as ReturnType<typeof packageWith>);
    expect(view.kind).toBe("package");
    if (view.kind !== "package") throw new Error("a stored older package must still render");
    const titles = view.sections.find((s) => s.id === "titles")!;
    const absent = titles.values.find((v) => v.label === TITLE_COPY.screenAbsentLabel)!;
    expect(absent.state).toBe("empty_no_input");
    expect(absent.value).toBeNull();
    expect(String(absent.reason)).toContain("cavs.publishing-package/v5");
    expect(absent.requires.length).toBeGreaterThan(0);
    // The distinction that matters: it is NOT reported as a screen that ran and found
    // nothing, and no withheld record is invented.
    expect(titles.values.some((v) => v.label === TITLE_COPY.screenScreenedLabel)).toBe(false);
    expect(titles.values.some((v) => v.label === TITLE_COPY.screenWithheldLabel)).toBe(false);
    expect(titles.values.some((v) => v.label === TITLE_COPY.withheldHeading)).toBe(false);
  });
});
