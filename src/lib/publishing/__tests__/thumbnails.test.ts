/**
 * P7-4 — the thumbnail concept engine. These are the properties the brief is
 * honoured through, asserted one by one against the plan the app really builds:
 *
 *  - the count is the brief's (5–10) whenever this project's own rows offer
 *    material, and ZERO when they offer none — never padded, never invented;
 *  - every value on a concept is a `Field` with a rule id in the catalogue and a
 *    real source row, and the overlay text and subject are the project's own
 *    characters at the ladder position the concept names;
 *  - an overlay candidate over the word bound is DROPPED and COUNTED, never
 *    shortened (shortening would be this app editing the project's words);
 *  - the nine criteria are counts (0–5) of NAMED tokens of the specification, each
 *    with the measurement behind it and a `notA`, and the plan declares on its own
 *    data that nine numbers are not nine independent measurements and not
 *    measurements of a picture;
 *  - no ratio, pixel, percentage or score-shaped number about an image exists
 *    anywhere in the specification: the contrast pairings carry ink/field tokens;
 *  - the aspect is derived from the project's own stored shape (16:9 long-form,
 *    9:16 Shorts), and says why it is absent when that column says nothing;
 *  - each of the six specification controls returns a NEW concept re-derived from
 *    the same rows with exactly one named ladder advanced, plus a change record
 *    naming the field, the from→to values (each with its own declared text origin),
 *    the rule and the concept ids — and leaves the plan it operated on untouched;
 *  - the refusals refuse: a control with nothing to advance, a control with no
 *    concept to operate on, and UPSCALE, which names the `upscaling` capability and
 *    the env var NAMES the registry derives, and produces no concept and no change;
 *  - the image slot is a gated-provider value naming the caller's registry-derived
 *    names, or empty-with-reason when the build named none, and NO Thumbnail row is
 *    ever written — the statuses that would report non-existent work are refused;
 *  - only an `ok` answer that really carried text produces a provider concept.
 *
 * The model-backed path's registry facts are read from the app's own
 * `upscaleGateFacts()` (./thumbnails-model) rather than written out here, so this
 * file cannot assert a name the registry does not derive.
 */
import { describe, expect, test } from "bun:test";
import { auditPublishingPackage } from "../audit";
import { buildKeywordPlan } from "../keywords";
import { buildPublishingPackage, PUBLISHING_PACKAGE_FORMAT } from "../package";
import { PUBLISHING_RULES } from "../rules";
import type { Field } from "../provenance";
import { upscaleGateFacts } from "../thumbnails-model";
import {
  applyThumbnailControl,
  buildThumbnailLadders,
  buildThumbnailPlan,
  buildThumbnailsModelPath,
  conceptCountFor,
  isThumbnailControlId,
  OVERLAY_CHAR_BOUND,
  OVERLAY_SHORT_WORDS,
  OVERLAY_WORD_BOUND,
  REFUSED_THUMBNAIL_STATUSES,
  THUMBNAIL_CONCEPT_MAXIMUM,
  THUMBNAIL_CONCEPT_MINIMUM,
  THUMBNAIL_CONTRAST_PAIRS,
  THUMBNAIL_CONTROL_IDS,
  THUMBNAIL_CRITERIA,
  THUMBNAIL_CRITERION_IDS,
  THUMBNAIL_MODEL_REQUEST_FIELDS,
  type ModelThumbnailConcept,
  type ThumbnailConcept,
  type ThumbnailControlId,
  type ThumbnailCriterionId,
  type ThumbnailImageGateInput,
  type ThumbnailPlan,
  type ThumbnailsModelOutcome,
} from "../thumbnails";
import { emptySource, NOW, richSource } from "./fixtures";
import type { PublishingSource } from "../types";

/**
 * The names a caller would hand in, derived in production from the app's registry
 * (see `thumbnailImageGateFacts()`); this file uses two fixed ones so a failure
 * shows which name travelled where.
 */
const GATE_NAMES = ["OPENAI_API_KEY", "STABILITY_API_KEY"];
const GATE_WITH_NAMES: ThumbnailImageGateInput = {
  capability: "thumbnail_generation",
  envVars: GATE_NAMES,
  wiredProviderIds: [],
  requirement: "A server operator enables it by setting the server-side env vars OPENAI_API_KEY or STABILITY_API_KEY (names only).",
};
const GATE_WITHOUT_NAMES: ThumbnailImageGateInput = {
  ...GATE_WITH_NAMES,
  envVars: [],
  requirement: "No build of this package named a provider environment variable for thumbnails, so this package names none.",
};

function planFor(source: PublishingSource = richSource(), gate: ThumbnailImageGateInput = GATE_WITH_NAMES): ThumbnailPlan {
  return buildThumbnailPlan({
    source,
    keywords: buildKeywordPlan(source),
    imageGate: gate,
    modelPath: { outcome: null, envVars: gate.envVars },
    now: NOW,
  });
}

/** A project whose whole stored text is one short phrase. */
function thinSource(): PublishingSource {
  const source = emptySource();
  source.project.title = "Carthage";
  return source;
}

/** A project with no text at all: no title, no description, no script, no rows. */
function textlessSource(): PublishingSource {
  const source = emptySource();
  source.project.title = "";
  return source;
}

const LONG_PHRASE = "How Hannibal crossed the Alps with elephants and won the war in Italy";

function verdict(concept: ThumbnailConcept, id: ThumbnailCriterionId, featureId: string): boolean {
  const criterion = concept.criteria.find((c) => c.id === id);
  const feature = criterion?.features.find((f) => f.id === featureId);
  if (!feature) throw new Error(`no verdict ${id}.${featureId} on concept ${concept.id}`);
  return feature.present;
}

/**
 * RECOMPUTED HERE, NOT TRUSTED. Every verdict below is derived from the concept's
 * own declared tokens and its own carried counts, so a criterion that stopped
 * counting the specification it describes would fail this rather than agree with
 * itself. Used on the plan's concepts AND on the concepts the controls return.
 */
function assertCriteriaFollowTheSpecification(concept: ThumbnailConcept): void {
  const t = concept.tokens;
  const words = concept.overlayWordCount.state === "derived" ? concept.overlayWordCount.value : -1;
  const chars = concept.overlayCharCount.state === "derived" ? concept.overlayCharCount.value : -1;
  const zonesDiffer = t.subjectZone !== t.textZone;

  expect(verdict(concept, "visual_hierarchy", "zones_differ")).toBe(zonesDiffer);
  expect(verdict(concept, "visual_hierarchy", "wide_margin")).toBe(t.marginToken === "wide");
  expect(verdict(concept, "visual_hierarchy", "field_separated")).toBe(t.separation !== "flat_field");
  expect(verdict(concept, "visual_hierarchy", "block_shape_declared")).toBe(t.textBlockShape !== "stacked_words");
  expect(verdict(concept, "dominant_subject", "subject_zone_clear")).toBe(zonesDiffer);
  expect(verdict(concept, "dominant_subject", "subject_sourced")).toBe(concept.subject.state === "derived" && concept.subject.sources.length > 0);
  expect(verdict(concept, "curiosity", "short_overlay")).toBe(words <= OVERLAY_SHORT_WORDS);
  expect(verdict(concept, "emotional_appeal", "palette_range_declared")).toBe(t.paletteToken !== "mono_tone");
  expect(verdict(concept, "emotional_appeal", "soft_field_declared")).toBe(t.separation === "soft_falloff");
  expect(verdict(concept, "mobile_readability", "word_count_within_bound")).toBe(words <= OVERLAY_SHORT_WORDS);
  expect(verdict(concept, "mobile_readability", "char_count_within_bound")).toBe(chars <= OVERLAY_CHAR_BOUND);
  expect(verdict(concept, "mobile_readability", "wide_margin")).toBe(t.marginToken === "wide");
  expect(verdict(concept, "contrast", "no_zone_overlap")).toBe(zonesDiffer);
  expect(verdict(concept, "bold_typography", "heavy_family")).toBe(t.typography !== "body_serif");
  expect(verdict(concept, "bold_typography", "outline_declared")).toBe(t.strokeToken !== "none");
  expect(verdict(concept, "bold_typography", "one_line_block")).toBe(t.textBlockShape === "one_line");
  expect(verdict(concept, "bold_typography", "palette_not_mono")).toBe(t.paletteToken !== "mono_tone");
  expect(verdict(concept, "minimal_text", "word_count_within_bound")).toBe(words <= OVERLAY_SHORT_WORDS);
  expect(verdict(concept, "minimal_text", "char_count_within_bound")).toBe(chars <= OVERLAY_CHAR_BOUND);
  expect(verdict(concept, "minimal_text", "block_shape_not_stacked")).toBe(t.textBlockShape !== "stacked_words");
  expect(verdict(concept, "clear_story", "aspect_declared")).toBe(concept.aspect.state === "derived");

  for (const criterion of concept.criteria) {
    expect(criterion.score).toBe(criterion.features.filter((f) => f.present).length);
    expect(criterion.scoreIsTheFeatureCount).toBe(true);
  }
}

function controlInput(plan: ThumbnailPlan, source: PublishingSource, conceptId: string, control: ThumbnailControlId) {
  const facts = upscaleGateFacts();
  return {
    plan,
    conceptId,
    control,
    upscaleGate: { capability: facts.capability, envVars: facts.envVars, wiredProviderIds: facts.wiredProviderIds, requirement: facts.requirement },
    source,
    keywords: buildKeywordPlan(source),
    imageGate: GATE_WITH_NAMES,
    now: NOW,
  };
}

/* ------------------------------------------------------------------ */
/* The brief's count, from the project's own material                  */
/* ------------------------------------------------------------------ */

describe("P7-4 thumbnail concepts — the brief's count, from the project's own material", () => {
  test("a data-rich project gets the brief's count, inside its bounds, and every concept is traced", () => {
    const plan = planFor();
    expect(plan.kind).toBe("thumbnail_concepts");
    expect(plan.totalConcepts).toBeGreaterThanOrEqual(THUMBNAIL_CONCEPT_MINIMUM);
    expect(plan.totalConcepts).toBeLessThanOrEqual(THUMBNAIL_CONCEPT_MAXIMUM);
    expect(plan.minimumRequested).toBe(THUMBNAIL_CONCEPT_MINIMUM);
    expect(plan.maximumAllowed).toBe(THUMBNAIL_CONCEPT_MAXIMUM);
    expect(plan.meetsMinimum).toBe(true);
    expect(plan.withinMaximum).toBe(true);
    expect(plan.concepts).toHaveLength(plan.totalConcepts);
    expect(plan.totalConcepts).toBe(conceptCountFor(buildThumbnailLadders(richSource(), buildKeywordPlan(richSource()))));
    // Concept ids and positions are real: unique, and 1..n in order.
    expect(new Set(plan.concepts.map((c) => c.id)).size).toBe(plan.totalConcepts);
    plan.concepts.forEach((concept, i) => {
      expect(concept.index).toBe(i + 1);
      expect(concept.rule).toBe("R-THUMB-CONCEPT");
      expect(concept.authoredBy).toBe("rule_specification");
      expect(concept.note.length).toBeGreaterThan(0);
      expect(concept.revision).toBe(0);
      expect(concept.revisedFrom).toBeNull();
    });
    // The brief's own nine criteria are carried, not assumed.
    expect(plan.criterionIds).toEqual([...THUMBNAIL_CRITERION_IDS]);
    expect(plan.criterionCount).toBe(THUMBNAIL_CRITERIA.length);
    // The fixed lists a concept chooses from are on the plan, and each background's
    // text zone is a different zone from its subject's — the arrangement token.
    expect(plan.ladders.composition.length).toBeGreaterThan(0);
    for (const composition of plan.ladders.composition) {
      expect(composition.subjectZone).not.toBe(composition.textZone);
    }
  });

  test("concepts inside the ladder bounds: the count never exceeds the brief's maximum on a long ladder", () => {
    const source = richSource();
    for (let i = 1; i <= 12; i += 1) {
      source.chapters.push({
        id: `ch_extra_${i}`,
        scriptId: "scr_rich",
        order: 10 + i,
        title: `Chapter ${i} of the long campaign`,
        summary: null,
        scenes: [
          {
            id: `sc_extra_${i}`,
            order: 1,
            title: `Scene ${i} on the road`,
            narration: `Narration ${i} on the road to Rome.`,
            durationSeconds: 60,
            status: "READY",
          },
        ],
      });
    }
    const plan = planFor(source);
    expect(plan.totalConcepts).toBe(THUMBNAIL_CONCEPT_MAXIMUM);
    expect(plan.withinMaximum).toBe(true);
    expect(plan.meetsMinimum).toBe(true);
    // Every concept still sits on a real ladder position.
    for (const concept of plan.concepts) {
      expect(concept.tokens.overlayIndex).toBeGreaterThanOrEqual(1);
      expect(concept.tokens.overlayIndex).toBeLessThanOrEqual(plan.overlayLadder.length);
      expect(concept.tokens.subjectIndex).toBeGreaterThanOrEqual(1);
      expect(concept.tokens.subjectIndex).toBeLessThanOrEqual(plan.subjectLadder.length);
    }
  });

  test("a project with a single row of its own still gets the minimum by varying the design lists, and says so", () => {
    const source = thinSource();
    const plan = planFor(source);
    expect(plan.overlayLadder).toHaveLength(1);
    expect(plan.subjectLadder).toHaveLength(1);
    expect(plan.totalConcepts).toBe(THUMBNAIL_CONCEPT_MINIMUM);
    expect(plan.meetsMinimum).toBe(true);
    expect(plan.withinMaximum).toBe(true);
    // Every concept reuses that one phrase, which the plan states rather than hides.
    for (const concept of plan.concepts) {
      expect(concept.overlayText.state === "derived" && concept.overlayText.value).toBe("Carthage");
      expect(concept.overlayText.sources[0]?.kind).toBe("project");
      expect(concept.overlayText.sources[0]?.path).toBe("title");
    }
    expect(plan.notes.some((n) => n.includes("reuses the same overlay text"))).toBe(true);
    // …and the candidates the ladder dropped are counted, with the reason.
    expect(plan.ladderDrops.candidatesDropped).toBeGreaterThanOrEqual(1);
    expect(plan.notes.some((n) => n.includes("read word for word the same"))).toBe(true);
  });

  test("a project with NO text at all gets no concept: the plan names the empty ladder instead of inventing one", () => {
    const source = textlessSource();
    const ladders = buildThumbnailLadders(source, buildKeywordPlan(source));
    const plan = planFor(source);
    expect(plan.overlayLadder).toEqual([]);
    expect(plan.subjectLadder).toEqual([]);
    expect(conceptCountFor(ladders)).toBe(0);
    expect(plan.totalConcepts).toBe(0);
    expect(plan.concepts).toEqual([]);
    expect(plan.meetsMinimum).toBe(false);
    expect(plan.withinMaximum).toBe(true);
    expect(plan.notes.some((n) => n.includes("This plan therefore carries") && n.includes("NO concept"))).toBe(true);
    expect(plan.notes.some((n) => n.includes("below the") && n.includes("No concept was invented to reach the minimum"))).toBe(true);
    // The image absence and the record are still carried: there is LESS to show,
    // not a different set of rules.
    expect(plan.imageAbsence.capability).toBe("thumbnail_generation");
    expect(plan.records.written).toBe(false);
    expect(plan.records.reportedStatus).toBeNull();
    // And the whole package still builds and passes its own audit — a thin project
    // is a state, not an error.
    const pkg = buildPublishingPackage(source, { now: NOW, thumbnailImageGate: GATE_WITH_NAMES });
    expect(pkg.selfAudit.ok).toBe(true);
    expect(pkg.summary.thumbnailConcepts).toBe(0);
    expect(pkg.summary.thumbnailImagesProduced).toBe(0);
  });

  test("a project whose only phrase is too long for an overlay loses it: no concept from it, and the drop is counted", () => {
    const source = textlessSource();
    source.project.title = LONG_PHRASE;
    const plan = planFor(source);
    expect(plan.ladderDrops.overlayTextsDropped).toBeGreaterThanOrEqual(1);
    // The phrase is still in the SUBJECT ladder, character for character: it was
    // dropped from one role, never shortened.
    expect(plan.subjectLadder.some((c) => c.text === LONG_PHRASE)).toBe(true);
    expect(plan.overlayLadder.some((c) => c.text === LONG_PHRASE)).toBe(false);
    for (const concept of plan.concepts) {
      expect(concept.overlayWordCount.state === "derived" && concept.overlayWordCount.value).toBeLessThanOrEqual(OVERLAY_WORD_BOUND);
      expect(concept.overlayText.state === "derived" && concept.overlayText.value).not.toBe(LONG_PHRASE);
    }
    const dropNote = plan.notes.find((n) => n.includes("were dropped as overlay texts"));
    expect(dropNote).toBeDefined();
    expect(dropNote).toContain("not shortened");
  });

  test("the same rows yield the same plan — the concepts are deterministic", () => {
    const a = planFor();
    const b = planFor();
    expect(a.concepts.map((c) => c.id)).toEqual(b.concepts.map((c) => c.id));
    expect(a.concepts.map((c) => c.tokens)).toEqual(b.concepts.map((c) => c.tokens));
    expect(a.ladderDrops).toEqual(b.ladderDrops);
  });
});

/* ------------------------------------------------------------------ */
/* Provenance: no value without a rule and a source                     */
/* ------------------------------------------------------------------ */

describe("P7-4 thumbnail concepts — no value without a rule and a source", () => {
  test("every value on every concept is a Field with a catalogue rule and a real source row", () => {
    const plan = planFor();
    for (const concept of plan.concepts) {
      const fields: [string, Field<unknown>][] = [
        ["overlayText", concept.overlayText],
        ["overlayRole", concept.overlayRole],
        ["overlayWordCount", concept.overlayWordCount],
        ["overlayCharCount", concept.overlayCharCount],
        ["subject", concept.subject],
        ["subjectRole", concept.subjectRole],
        ["background", concept.background],
        ["style", concept.style],
        ["composition", concept.composition],
        ["mood", concept.mood],
        ["contrastPair", concept.contrastPair],
        ["aspect", concept.aspect],
        ["image", concept.image],
      ];
      for (const [key, field] of fields) {
        if (field.state === "derived") {
          expect(PUBLISHING_RULES[field.rule]).toBeDefined();
          expect(field.sources.length).toBeGreaterThan(0);
          for (const source of field.sources) {
            expect(source.kind.length).toBeGreaterThan(0);
            expect(source.id.length).toBeGreaterThan(0);
          }
          if (typeof field.value === "string") {
            expect(["source_verbatim", "rule_authored", "template_filled", "provider_verbatim"]).toContain(field.textOrigin ?? "");
          } else {
            expect(field.textOrigin).toBeNull();
          }
        } else {
          // The other two states cannot carry a value, and each says why and what
          // would fill it — checked with the concept's name so a failure is readable.
          expect(`${key}:${field.state}`).toBe(`${key}:${field.state}`);
          expect(field.value).toBeNull();
          expect(field.rule).toBeNull();
          expect(field.sources).toEqual([]);
          expect(field.reason.length).toBeGreaterThan(0);
          expect(field.requires.length).toBeGreaterThan(0);
        }
      }
      // The project's own words are declared as the project's own, character for
      // character, and this app's own vocabulary is declared as this app's.
      expect(concept.overlayText.state === "derived" && concept.overlayText.textOrigin).toBe("source_verbatim");
      expect(concept.subject.state === "derived" && concept.subject.textOrigin).toBe("source_verbatim");
      for (const field of [concept.overlayRole, concept.subjectRole, concept.background, concept.style, concept.composition, concept.contrastPair]) {
        expect(field.state).toBe("derived");
        expect(field.textOrigin).toBe("rule_authored");
      }
      expect(concept.tokens.moodToken === null || typeof concept.tokens.moodToken === "string").toBe(true);
    }
    for (const id of [plan.rule, plan.countRule, plan.criterionRule, plan.controlRule, plan.recordRule, plan.modelRule]) {
      expect(PUBLISHING_RULES[id]).toBeDefined();
    }
  });

  test("the overlay text and the subject are this project's own characters, at the ladder position the concept names", () => {
    const plan = planFor();
    for (const concept of plan.concepts) {
      const overlay = plan.overlayLadder[concept.tokens.overlayIndex - 1]!;
      const subject = plan.subjectLadder[concept.tokens.subjectIndex - 1]!;
      expect(overlay).toBeDefined();
      expect(subject).toBeDefined();
      expect(concept.overlayText.state === "derived" && concept.overlayText.value).toBe(overlay.text);
      expect(concept.subject.state === "derived" && concept.subject.value).toBe(subject.text);
      // The counts are counts OF that text, and the rule that carries the text is
      // the rule that carries its counts.
      expect(concept.overlayWordCount.state === "derived" && concept.overlayWordCount.value).toBe(overlay.wordCount);
      expect(concept.overlayCharCount.state === "derived" && concept.overlayCharCount.value).toBe(overlay.text.length);
      expect(concept.overlayText.state === "derived" && concept.overlayText.rule).toBe("R-THUMB-TEXT");
      expect(concept.overlayWordCount.state === "derived" && concept.overlayWordCount.rule).toBe("R-THUMB-TEXT");
      expect(concept.overlayCharCount.state === "derived" && concept.overlayCharCount.rule).toBe("R-THUMB-TEXT");
      expect(concept.subject.state === "derived" && concept.subject.rule).toBe("R-THUMB-SUBJECT");
      // The source row the concept names is the row the ladder read it from.
      expect(concept.overlayText.sources[0]?.id).toBe(overlay.sources[0]?.id);
      expect(concept.subject.sources[0]?.id).toBe(subject.sources[0]?.id);
      // The subject's row family is named on the ladder entry it came from.
      expect(["project", "script", "chapter", "scene", "keyword"]).toContain(subject.sourceKind);
    }
    for (const candidate of [...plan.overlayLadder, ...plan.subjectLadder]) {
      expect(candidate.textOrigin).toBe("source_verbatim");
      expect(candidate.text.length).toBeGreaterThan(0);
      expect(candidate.sources.length).toBeGreaterThan(0);
      expect(candidate.roleLabel.length).toBeGreaterThan(0);
      expect(candidate.roleId.length).toBeGreaterThan(0);
      expect(candidate.from.length).toBeGreaterThan(0);
    }
    for (const candidate of plan.overlayLadder) {
      expect(candidate.wordCount).toBeLessThanOrEqual(OVERLAY_WORD_BOUND);
    }
  });

  test("the vocabulary values name this app's own tokens, and their rules are the catalogue's", () => {
    const plan = planFor();
    const concept = plan.concepts[0]!;
    expect(concept.background.state === "derived" && concept.background.rule).toBe("R-THUMB-BACKGROUND");
    expect(concept.style.state === "derived" && concept.style.rule).toBe("R-THUMB-STYLE");
    expect(concept.composition.state === "derived" && concept.composition.rule).toBe("R-THUMB-COMPOSITION");
    expect(concept.contrastPair.state === "derived" && concept.contrastPair.rule).toBe("R-THUMB-CONTRAST");
    expect(concept.aspect.state === "derived" && concept.aspect.rule).toBe("R-THUMB-ASPECT");
    expect(concept.mood.state === "derived" && concept.mood.rule).toBe("R-THUMB-MOOD");
    // Each value is one of the entries of the fixed list the plan carries, and the
    // list is on the plan so a reader can check the choice.
    expect(plan.ladders.background.some((b) => concept.background.state === "derived" && concept.background.value.startsWith(b.label))).toBe(true);
    expect(plan.ladders.style.some((s) => concept.style.state === "derived" && concept.style.value.startsWith(s.label))).toBe(true);
    expect(plan.ladders.composition.some((c) => concept.composition.state === "derived" && concept.composition.value.startsWith(c.label))).toBe(true);
    expect(plan.ladders.contrastPair.some((p) => concept.contrastPair.state === "derived" && concept.contrastPair.value.startsWith(p.label))).toBe(true);
  });

  test("the aspect is the project's own stored shape: 16:9 long-form, 9:16 Shorts, and empty with a reason when it says nothing", () => {
    const long = planFor(richSource());
    expect(long.concepts.length).toBeGreaterThan(0);
    for (const concept of long.concepts) {
      expect(concept.aspect.state).toBe("derived");
      expect(concept.aspect.state === "derived" && concept.aspect.value).toBe("16:9");
      expect(concept.aspect.state === "derived" && concept.aspect.rule).toBe("R-THUMB-ASPECT");
      expect(concept.aspect.sources[0]?.path).toBe("targetAspectRatio");
      expect(concept.tokens.aspectId).toBe("sixteen_nine");
    }

    const shortsSource = richSource();
    shortsSource.project.targetAspectRatio = "NINE_SIXTEEN";
    const shorts = planFor(shortsSource);
    expect(shorts.concepts.length).toBeGreaterThan(0);
    for (const concept of shorts.concepts) {
      expect(concept.aspect.state === "derived" && concept.aspect.value).toBe("9:16");
      expect(concept.tokens.aspectId).toBe("nine_sixteen");
    }

    const unshaped = richSource();
    unshaped.project.targetAspectRatio = "FOUR_THREE";
    const unknown = planFor(unshaped);
    expect(unknown.concepts.length).toBeGreaterThan(0);
    for (const concept of unknown.concepts) {
      expect(concept.aspect.state).toBe("empty_no_input");
      expect(concept.tokens.aspectId).toBeNull();
      if (concept.aspect.state !== "derived") {
        expect(concept.aspect.reason).toContain("targetAspectRatio");
        // The unrecognised stored value itself is not reprinted as if it were a shape.
        expect(concept.aspect.reason).not.toContain("FOUR_THREE");
      }
      // And the criterion that counts the aspect says so, rather than passing.
      expect(verdict(concept, "clear_story", "aspect_declared")).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* The nine criteria: counts of named tokens, not measurements          */
/* ------------------------------------------------------------------ */

describe("P7-4 thumbnail concepts — the nine criteria are counts of named tokens", () => {
  test("nine criteria per concept, in the requested order, five named verdicts each, each score the count of its own verdicts", () => {
    const plan = planFor();
    for (const concept of plan.concepts) {
      expect(concept.criteria.map((c) => c.id)).toEqual([...THUMBNAIL_CRITERION_IDS]);
      for (const criterion of concept.criteria) {
        const definition = THUMBNAIL_CRITERIA.find((d) => d.id === criterion.id)!;
        expect(criterion.label).toBe(definition.label);
        expect(criterion.features.map((f) => f.id)).toEqual(definition.features.map((f) => f.id));
        expect(criterion.maxScore).toBe(5);
        expect(criterion.score).toBe(criterion.features.filter((f) => f.present).length);
        expect(criterion.score).toBeGreaterThanOrEqual(0);
        expect(criterion.score).toBeLessThanOrEqual(5);
        expect(criterion.scoreIsTheFeatureCount).toBe(true);
        expect(criterion.rule).toBe("R-THUMB-CRITERION");
        expect(criterion.sources.length).toBeGreaterThan(0);
        expect(criterion.about).toBe(definition.about);
        expect(criterion.notA).toBe(definition.notA);
        expect(criterion.featureSource).toBe(definition.featureSource);
        expect(new Set(criterion.features.map((f) => f.label)).size).toBe(5);
        for (const feature of criterion.features) {
          expect(typeof feature.present).toBe("boolean");
          // Every verdict says how it was measured, so no number is bare.
          expect(feature.measured.length).toBeGreaterThan(0);
          expect(feature.label.length).toBeGreaterThan(0);
        }
      }
      // The numbers are recomputed from the concept's own declared tokens here.
      assertCriteriaFollowTheSpecification(concept);
    }
  });

  test("the criteria and the plan's own declaration say what those nine numbers are and are not", () => {
    const plan = planFor();
    expect(THUMBNAIL_CRITERIA).toHaveLength(9);
    expect(THUMBNAIL_CRITERION_IDS).toHaveLength(9);
    for (const definition of THUMBNAIL_CRITERIA) {
      // A count of five named things, said in the definition itself.
      expect(definition.about.startsWith("How many of five named ")).toBe(true);
      expect(definition.features).toHaveLength(5);
      expect(definition.featureSource.length).toBeGreaterThan(0);
      expect(definition.label.length).toBeGreaterThan(0);
      // Each one carries its own "notA", and each disclaims a measurement that
      // does not exist in this product.
      expect(definition.notA).toMatch(/no image|no frame|not a measurement|measured no image|measures nothing|no measurement|no data/i);
    }
    // Nine distinct sentences: nothing shared by accident.
    expect(new Set(THUMBNAIL_CRITERIA.map((c) => c.about)).size).toBe(9);
    expect(new Set(THUMBNAIL_CRITERIA.map((c) => c.notA)).size).toBe(9);

    const declaration = plan.declaration;
    expect(declaration.scale).toContain("0 to 5");
    expect(declaration.statement).toContain("count of five named tokens or wordings");
    expect(declaration.statement).toContain("0 to 5");
    // NOT nine independent measurements…
    expect(declaration.criteriaAreNotIndependent).toContain("not nine independent measurements");
    // …and NOT measurements of a picture.
    expect(declaration.specificationNotPicture).toContain("No image exists");
    expect(declaration.whatACriterionIsNot).toMatch(/not a measurement/);
    // The plan states it on its own notes too, not only in a definition.
    expect(plan.notes).toContain(declaration.criteriaAreNotIndependent);
  });
});

/* ------------------------------------------------------------------ */
/* No numeric claim about an image                                      */
/* ------------------------------------------------------------------ */

describe("P7-4 thumbnail concepts — no numeric claim about an image anywhere", () => {
  /** A ratio, a pixel count, a percentage, or a score-shaped number. */
  const NUMERIC_IMAGE_SHAPES = [
    /(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/,
    /\d+(?:\.\d+)?\s*(?:px|pixels?|dpi|pt)\b/i,
    /\d+(?:\.\d+)?\s*(?:%|percent)/i,
    /\d+\s*\/\s*(?:10|100)\b/,
    /\bscore\b\s*[:=]?\s*\d/i,
  ];

  function stringsIn(node: unknown, out: string[] = []): string[] {
    if (typeof node === "string") {
      out.push(node);
      return out;
    }
    if (Array.isArray(node)) {
      for (const item of node) stringsIn(item, out);
      return out;
    }
    if (typeof node === "object" && node !== null) {
      for (const value of Object.values(node as Record<string, unknown>)) stringsIn(value, out);
    }
    return out;
  }

  test("nothing a concept specifies carries a ratio, a pixel count, a percentage or a score about an image", () => {
    const plan = planFor();
    // The ONE ratio-shaped string the brief asks for is the frame's own aspect,
    // which is the project's stored target shape — a shape, not a measurement of
    // anything. So the aspect Field ITSELF is exempt (its value, which is "16:9",
    // and its note, which explains which stored value produced it), and nothing
    // else in the specification is.
    const exempt = plan.concepts.flatMap((c) =>
      c.aspect.state === "derived" ? [c.aspect.value, c.aspect.note ?? "", c.tokens.aspectId ?? ""] : [],
    );
    // The exemption is not hiding an accident: the frame's own shape really is the
    // one ratio-shaped string here, and it really is on the aspect.
    expect(exempt.some((text) => NUMERIC_IMAGE_SHAPES[0]!.test(text))).toBe(true);

    const scanned = stringsIn(plan.concepts);
    expect(scanned.length).toBeGreaterThan(100);
    const offenders = scanned.filter(
      (text) => !exempt.includes(text) && NUMERIC_IMAGE_SHAPES.some((shape) => shape.test(text)),
    );
    expect(offenders).toEqual([]);

    // The contrast criterion's own verdicts are the likeliest place for a ratio to
    // creep in, so they are scanned on their own as well.
    for (const concept of plan.concepts) {
      const contrast = concept.criteria.find((c) => c.id === "contrast")!;
      for (const feature of contrast.features) {
        expect(NUMERIC_IMAGE_SHAPES.some((shape) => shape.test(feature.measured))).toBe(false);
      }
    }
  });

  test("the contrast pairings carry ink and field TOKENS only, and the concept states which", () => {
    const plan = planFor();
    for (const concept of plan.concepts) {
      const pair = THUMBNAIL_CONTRAST_PAIRS.find(
        (p) => concept.contrastPair.state === "derived" && concept.contrastPair.value.startsWith(p.label),
      );
      expect(pair).toBeDefined();
      expect(["near_white_ink", "near_black_ink"]).toContain(pair!.inkToken);
      expect(["darkest_declared_tone", "lightest_declared_tone"]).toContain(pair!.fieldToken);
      // The value is the pairing's label and its definition, and nothing else.
      expect(concept.contrastPair.state === "derived" && concept.contrastPair.value).toBe(`${pair!.label} — ${pair!.definition}`);
      // The pairing this concept carries is the one the fixed table gives for the
      // background's own tone hint — not a judgement about an image.
      expect(concept.tokens.toneHint.length).toBeGreaterThan(0);
    }
    for (const pair of THUMBNAIL_CONTRAST_PAIRS) {
      for (const text of [pair.label, pair.definition, pair.inkToken, pair.fieldToken, pair.id]) {
        for (const shape of NUMERIC_IMAGE_SHAPES) expect(shape.test(text)).toBe(false);
      }
    }
    for (const background of plan.ladders.background) {
      for (const text of [background.label, background.definition]) {
        for (const shape of NUMERIC_IMAGE_SHAPES) expect(shape.test(text)).toBe(false);
      }
    }
    for (const style of plan.ladders.style) {
      for (const text of [style.label, style.definition]) {
        for (const shape of NUMERIC_IMAGE_SHAPES) expect(shape.test(text)).toBe(false);
      }
    }
  });

  test("the package carrying these concepts still audits clean, and its counts are measurements of its own list", () => {
    const pkg = buildPublishingPackage(richSource(), { now: NOW, thumbnailImageGate: GATE_WITH_NAMES });
    expect(pkg.format).toBe(PUBLISHING_PACKAGE_FORMAT);
    expect(pkg.thumbnails.totalConcepts).toBe(pkg.summary.thumbnailConcepts);
    expect(pkg.summary.thumbnailCriteriaPerConcept).toBe(9);
    // Zero, because it counted the concepts' own image slots rather than assuming.
    expect(pkg.summary.thumbnailImagesProduced).toBe(0);
    const audit = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: GATE_NAMES });
    expect(audit.violations).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  test("the guard rails bite on the concepts too: a metric-shaped key or a banned claim fails the audit", () => {
    const pkg = buildPublishingPackage(richSource(), { now: NOW, thumbnailImageGate: GATE_WITH_NAMES });
    const withMetric = structuredClone(pkg) as unknown as typeof pkg;
    (withMetric.thumbnails.concepts[0] as unknown as Record<string, unknown>).searchVolume = 1200;
    const metric = auditPublishingPackage(withMetric, { now: NOW });
    expect(metric.ok).toBe(false);
    expect(metric.violations.some((v) => v.kind === "forbidden_metric_key")).toBe(true);

    const withClaim = structuredClone(pkg) as unknown as typeof pkg;
    const background = withClaim.thumbnails.concepts[0].background;
    expect(background.state).toBe("derived");
    (background as { value: string }).value = "Guaranteed viral growth for your channel";
    const claim = auditPublishingPackage(withClaim, { now: NOW });
    expect(claim.ok).toBe(false);
    expect(claim.violations.some((v) => v.kind === "banned_claim")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The controls                                                         */
/* ------------------------------------------------------------------ */

const CONTROL_MOVES = [
  { control: "regenerate", field: "variation", token: "variation" },
  { control: "change_text", field: "overlayText", token: "overlayIndex" },
  { control: "change_background", field: "background", token: "backgroundIndex" },
  { control: "change_subject", field: "subject", token: "subjectIndex" },
  { control: "change_style", field: "style", token: "styleIndex" },
  { control: "change_composition", field: "composition", token: "compositionIndex" },
] as const;

function ladderLengthFor(plan: ThumbnailPlan, token: string): number {
  if (token === "overlayIndex") return plan.overlayLadder.length;
  if (token === "subjectIndex") return plan.subjectLadder.length;
  if (token === "backgroundIndex") return plan.ladders.background.length;
  if (token === "styleIndex") return plan.ladders.style.length;
  return plan.ladders.composition.length;
}

describe("P7-4 thumbnail concepts — the six specification controls", () => {
  test("the seven the brief asks for are carried: six operate on the specification, upscale cannot", () => {
    const plan = planFor();
    expect(plan.controls.map((c) => c.id)).toEqual([...THUMBNAIL_CONTROL_IDS]);
    expect(plan.controls).toHaveLength(7);
    for (const control of plan.controls) {
      expect(control.label.length).toBeGreaterThan(0);
      expect(control.about.length).toBeGreaterThan(0);
      expect(PUBLISHING_RULES[control.rule]).toBeDefined();
    }
    const specification = plan.controls.filter((c) => c.operates === "specification");
    expect(specification).toHaveLength(6);
    // Six controls, six different ladders, one each: no control is decorative.
    expect(new Set(specification.map((c) => c.ladder)).size).toBe(6);
    for (const control of specification) {
      expect(control.ladder).not.toBeNull();
      expect(control.capability).toBeNull();
    }
    const upscale = plan.controls.find((c) => c.id === "upscale")!;
    expect(upscale.operates).toBe("provider");
    expect(upscale.capability).toBe("upscaling");
    expect(upscale.ladder).toBeNull();
  });

  test("each of the six returns a NEW concept, re-derived with one ladder advanced, and a change record", () => {
    const source = richSource();
    const plan = planFor(source);
    const base = plan.concepts[0]!;
    const frozen = JSON.stringify(plan);

    for (const move of CONTROL_MOVES) {
      const outcome = applyThumbnailControl(controlInput(plan, source, base.id, move.control));
      expect(outcome.status).toBe("applied");
      expect(outcome.control).toBe(move.control);
      expect(outcome.rule).toBe("R-THUMB-CONTROL");
      expect(outcome.refusal).toBeNull();

      const concept = outcome.concept;
      expect(concept).not.toBeNull();
      const next = concept as ThumbnailConcept;
      // A NEW concept: a different id, the same position, one revision on.
      expect(next.id).not.toBe(base.id);
      expect(next.revisedFrom).toBe(base.id);
      expect(next.revision).toBe(base.revision + 1);
      expect(next.index).toBe(base.index);
      expect(next.authoredBy).toBe("rule_specification");
      // RE-DERIVED from the same rows by the same rules: the project's own text is
      // still the project's own, and every criterion was counted again.
      expect(next.overlayText.state).toBe("derived");
      expect(next.overlayText.textOrigin).toBe("source_verbatim");
      expect(next.subject.state).toBe("derived");
      expect(next.subject.sources.length).toBeGreaterThan(0);
      assertCriteriaFollowTheSpecification(next);

      // ONE ladder advanced by exactly one position; every other ladder is untouched.
      const before = base.tokens as unknown as Record<string, number>;
      const after = next.tokens as unknown as Record<string, number>;
      if (move.token === "variation") {
        expect(after.variation).toBe(before.variation! + 1);
        expect(after.overlayIndex).toBe(before.overlayIndex);
        expect(after.subjectIndex).toBe(before.subjectIndex);
        expect(after.backgroundIndex).toBe((before.backgroundIndex! % plan.ladders.background.length) + 1);
        expect(after.styleIndex).toBe((before.styleIndex! % plan.ladders.style.length) + 1);
        expect(after.compositionIndex).toBe((before.compositionIndex! % plan.ladders.composition.length) + 1);
      } else {
        const ladder = ladderLengthFor(plan, move.token);
        expect(after[move.token]).toBe((before[move.token]! % ladder) + 1);
        expect(after.variation).toBe(before.variation);
        for (const other of ["overlayIndex", "subjectIndex", "backgroundIndex", "styleIndex", "compositionIndex"]) {
          if (other === move.token) continue;
          expect(after[other]).toBe(before[other]);
        }
      }

      // The change record names the field, the rule, both concepts and the time —
      // and every from→to value declares where its own characters came from.
      const change = outcome.change!;
      expect(change).not.toBeNull();
      expect(change.controlId).toBe(move.control);
      expect(change.rule).toBe(outcome.rule);
      expect(change.field).toBe(move.field);
      expect(change.conceptIdFrom).toBe(base.id);
      expect(change.conceptIdTo).toBe(next.id);
      expect(change.at).toBe(NOW.toISOString());
      expect(change.what.length).toBeGreaterThan(0);
      expect(change.from.candidateId).not.toBe(change.to.candidateId);
      for (const side of [change.from, change.to]) {
        expect(side.label.length).toBeGreaterThan(0);
        expect(["source_verbatim", "rule_authored"]).toContain(side.textOrigin);
        expect(side.sources.length).toBeGreaterThan(0);
        for (const ref of side.sources) expect(ref.id.length).toBeGreaterThan(0);
      }
      if (move.field === "overlayText" || move.field === "subject") {
        // The project's own words, and they really are the ladder's own characters.
        expect(change.from.textOrigin).toBe("source_verbatim");
        expect(change.to.textOrigin).toBe("source_verbatim");
        const ladder = move.field === "overlayText" ? plan.overlayLadder : plan.subjectLadder;
        expect(change.from.label).toBe(ladder[before[move.token]! - 1]!.text);
        expect(change.to.label).toBe(ladder[after[move.token]! - 1]!.text);
      } else {
        // This app's own design tokens, declared as this app's own.
        expect(change.from.textOrigin).toBe("rule_authored");
        expect(change.to.textOrigin).toBe("rule_authored");
        if (move.field !== "variation") {
          const entries = plan.ladders[move.field];
          expect(change.from.candidateId).toBe(entries[before[move.token]! - 1]!.id);
          expect(change.to.candidateId).toBe(entries[after[move.token]! - 1]!.id);
        }
      }
      // What changed is the specification, and the record says so in those words.
      expect(change.note).toContain("SPECIFICATION");
      expect(change.note).toContain("no image");
    }

    // NOTHING WAS WRITTEN: the plan the user is looking at is untouched, so no
    // concept, criterion or record was mutated in place.
    expect(JSON.stringify(plan)).toBe(frozen);
  });

  test("a control operates only on the id it was given: the other concepts are untouched", () => {
    const source = richSource();
    const plan = planFor(source);
    const outcome = applyThumbnailControl(controlInput(plan, source, plan.concepts[2]!.id, "change_style"));
    expect(outcome.status).toBe("applied");
    expect(outcome.concept?.id).not.toBe(plan.concepts[2]!.id);
    expect(outcome.concept?.revisedFrom).toBe(plan.concepts[2]!.id);
    expect(outcome.concept?.index).toBe(plan.concepts[2]!.index);
    expect(outcome.change?.conceptIdFrom).toBe(plan.concepts[2]!.id);
  });
});

/* ------------------------------------------------------------------ */
/* The refusals                                                         */
/* ------------------------------------------------------------------ */

describe("P7-4 thumbnail concepts — the controls refuse rather than pretend", () => {
  test("change_text refuses when this project's own text offers only one overlay candidate", () => {
    const source = thinSource();
    const plan = planFor(source);
    const outcome = applyThumbnailControl(controlInput(plan, source, plan.concepts[0]!.id, "change_text"));
    expect(outcome.status).toBe("refused_no_input");
    expect(outcome.concept).toBeNull();
    expect(outcome.change).toBeNull();
    const refusal = outcome.refusal!;
    expect(refusal.reason).toContain(`within the ${OVERLAY_WORD_BOUND}-word bound`);
    expect(refusal.reason).toContain("Nothing was produced");
    expect(refusal.requires.length).toBeGreaterThan(0);
    expect(refusal.requires.join(" ")).toContain("second phrase");
    // A refusal that needs no provider claims no provider env var.
    expect(refusal.envVars).toEqual([]);
  });

  test("change_subject refuses when this project's own rows offer only one subject", () => {
    const source = thinSource();
    const plan = planFor(source);
    const outcome = applyThumbnailControl(controlInput(plan, source, plan.concepts[0]!.id, "change_subject"));
    expect(outcome.status).toBe("refused_no_input");
    expect(outcome.concept).toBeNull();
    expect(outcome.refusal?.reason).toContain("Nothing was produced");
    expect(outcome.refusal?.requires.join(" ")).toContain("second row");
    expect(outcome.refusal?.envVars).toEqual([]);
  });

  test("a control on a concept id this plan does not carry refuses, and produces nothing", () => {
    const source = richSource();
    const plan = planFor(source);
    const frozen = JSON.stringify(plan);
    for (const id of ["no-such-concept", ""]) {
      const outcome = applyThumbnailControl(controlInput(plan, source, id, "regenerate"));
      expect(outcome.status).toBe("refused_no_input");
      expect(outcome.concept).toBeNull();
      expect(outcome.change).toBeNull();
      expect(outcome.refusal?.reason).toContain(id);
      expect(outcome.refusal?.requires.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(plan)).toBe(frozen);
  });

  test("a control id this app does not carry REFUSES instead of throwing", () => {
    const source = richSource();
    const plan = planFor(source);
    const frozen = JSON.stringify(plan);
    const outcome = applyThumbnailControl({
      ...controlInput(plan, source, plan.concepts[0]!.id, "regenerate"),
      control: "make_it_viral" as ThumbnailControlId,
    });
    // A thrown error would reach the surface as a crash; a refusal names the id.
    expect(outcome.status).toBe("refused_no_input");
    expect(outcome.concept).toBeNull();
    expect(outcome.change).toBeNull();
    expect(outcome.refusal?.reason).toContain("make_it_viral");
    expect(outcome.refusal?.requires.length).toBeGreaterThan(0);
    expect(outcome.refusal?.envVars).toEqual([]);
    expect(JSON.stringify(plan)).toBe(frozen);
    // The guard the request boundary uses is the app's own control list, so a
    // seven-id list and the ids that reach it cannot drift apart.
    for (const id of THUMBNAIL_CONTROL_IDS) expect(isThumbnailControlId(id)).toBe(true);
    expect(isThumbnailControlId("make_it_viral")).toBe(false);
    expect(isThumbnailControlId("")).toBe(false);
    expect(isThumbnailControlId("UPSCALE")).toBe(false);
  });

  test("upscale refuses: the upscaling capability, the registry's env var NAMES, no concept and no change", () => {
    const source = richSource();
    const plan = planFor(source);
    const frozen = JSON.stringify(plan);
    const base = plan.concepts[0]!;
    const facts = upscaleGateFacts();
    expect(facts.capability).toBe("upscaling");

    const outcome = applyThumbnailControl({
      ...controlInput(plan, source, base.id, "upscale"),
      upscaleGate: facts,
    });
    expect(outcome.control).toBe("upscale");
    expect(outcome.status).toBe("refused_gated");
    expect(outcome.concept).toBeNull();
    expect(outcome.change).toBeNull();

    const refusal = outcome.refusal!;
    // The env var names are the ones the app's own registry derives for the
    // capability — read from the registry in this test, never written out here.
    expect(refusal.envVars).toEqual(facts.envVars);
    expect(refusal.envVars.length).toBeGreaterThan(0);
    for (const name of refusal.envVars) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(refusal.reason).toContain("nothing was enlarged");
    // The refusal states THIS APP'S code fact and names the capability through
    // the plan's own gate — it makes no static claim about the server's keys.
    expect(refusal.reason).toContain("this plan carries its image as an absence");
    expect(refusal.reason).toMatch(/no slot serving the thumbnail_generation capability/);
    expect(refusal.requires.join(" ")).toContain("image");
    // The control it refused on is the one gated on `upscaling`.
    expect(plan.controls.find((c) => c.id === "upscale")?.capability).toBe(facts.capability);
    // It enlarged nothing and wrote nothing: the plan is byte-for-byte unchanged and
    // no record state was created.
    expect(JSON.stringify(plan)).toBe(frozen);
    expect(plan.records.written).toBe(false);
    expect(plan.records.reportedStatus).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* The image slot: an absence, never a placeholder                      */
/* ------------------------------------------------------------------ */

describe("P7-4 thumbnail concepts — the image slot is an absence, never a placeholder", () => {
  test("given registry-derived names, every image slot is gated and names exactly those", () => {
    const plan = planFor(richSource(), GATE_WITH_NAMES);
    expect(plan.concepts.length).toBeGreaterThan(0);
    for (const concept of plan.concepts) {
      expect(concept.image.state).toBe("gated_provider");
      expect(concept.image.value).toBeNull();
      expect(concept.image.rule).toBeNull();
      expect(concept.image.sources).toEqual([]);
      if (concept.image.state === "gated_provider") expect(concept.image.envVars).toEqual(GATE_NAMES);
      if (concept.image.state !== "derived") {
        expect(concept.image.reason).toContain("No image exists");
        expect(concept.image.reason).toContain("no file, preview or placeholder");
        expect(concept.image.requires.length).toBeGreaterThan(0);
        // The note names the registry's own fact: no slot is wired, so a key alone
        // would still produce no image.
        expect(concept.image.note).toContain("No slot serving this capability has a real call() implementation today");
      }
    }
    expect(plan.imageAbsence.envVars).toEqual(GATE_NAMES);
    expect(plan.imageAbsence.capability).toBe("thumbnail_generation");
    expect(plan.imageAbsence.rule).toBe("R-THUMB-IMAGE-ABSENCE");
    expect(plan.imageAbsence.statement).toContain("No image exists");
    expect(plan.imageAbsence.notSubstituted.length).toBeGreaterThan(0);
    expect(plan.imageAbsence.requirement.length).toBeGreaterThan(0);
  });

  test("given no names at all, every image slot is empty with a reason and names no provider", () => {
    const plan = planFor(richSource(), GATE_WITHOUT_NAMES);
    expect(plan.concepts.length).toBeGreaterThan(0);
    for (const concept of plan.concepts) {
      expect(concept.image.state).toBe("empty_no_input");
      expect(concept.image.value).toBeNull();
      expect(concept.image.rule).toBeNull();
      expect(concept.image.sources).toEqual([]);
      if (concept.image.state !== "derived") {
        expect(concept.image.reason).toContain("No image exists");
        expect(concept.image.requires.length).toBeGreaterThan(0);
        // The slot says it was given no name, rather than printing one nobody derived.
        expect(concept.image.note).toContain("was given no provider environment variable name for this capability");
      }
      expect("envVars" in concept.image).toBe(false);
    }
    expect(plan.imageAbsence.envVars).toEqual([]);
    expect(plan.imageAbsence.wiredProviderIds).toEqual([]);
  });

  test("no Thumbnail row is written, and the statuses that would report non-existent work are refused by name", () => {
    const plan = planFor();
    expect(plan.records.rule).toBe("R-THUMB-RECORD");
    expect(plan.records.model).toContain("Thumbnail");
    expect(plan.records.model).toContain("prisma/schema.prisma");
    expect(plan.records.written).toBe(false);
    expect(plan.records.reportedStatus).toBeNull();
    expect(plan.records.refusedStatuses).toEqual([...REFUSED_THUMBNAIL_STATUSES]);
    // The progress statuses are named explicitly: a PENDING row would report work
    // that is not happening.
    for (const status of ["PENDING", "QUEUED", "RUNNING", "SUCCEEDED"]) {
      expect(plan.records.refusedStatuses).toContain(status);
    }
    expect(plan.records.reason).toContain("No Thumbnail row is written");
    expect(plan.records.reason).toContain("progress status");
    // And no concept carries an image in any state other than an absence.
    for (const concept of plan.concepts) expect(concept.image.state).not.toBe("derived");
  });
});

/* ------------------------------------------------------------------ */
/* The model-backed path                                                */
/* ------------------------------------------------------------------ */

describe("P7-4 thumbnail concepts — the model-backed path is gated, never faked", () => {
  const providerConcept: ModelThumbnailConcept = {
    id: "model-concept-1",
    text: "Whichever words the provider returned",
    imageRef: "https://provider.example/nothing-is-fetched-from-this.png",
    textOrigin: "provider_verbatim",
    providerId: "replicate",
    model: "some/model",
    source: "provider_response",
  };
  const okOutcome: ThumbnailsModelOutcome = {
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
    concepts: [providerConcept],
    requiredEnv: [],
    nothingAttempted: false,
    orchestratorMessage: null,
  };

  test("unkeyed, the gate names the registry's env vars, carries no concept, and says no model wrote one", () => {
    const path = buildThumbnailsModelPath({ outcome: null, envVars: GATE_NAMES });
    expect(path.capability).toBe("thumbnail_generation");
    expect(path.rule).toBe("R-THUMB-MODEL-PATH");
    expect(path.state.state).toBe("gated_provider");
    expect(path.state.state === "gated_provider" && path.state.envVars).toEqual(GATE_NAMES);
    expect(path.providerConcepts).toEqual([]);
    expect(path.attempt).toBeNull();
    expect(path.authoredByModel).toBe(
      "No concept in this package was written by a model. Every concept above was produced by this app's own rules from this project's own rows.",
    );
    // The request this app would send is the app's own builder, field name by field name.
    expect(path.requestFieldNames).toEqual([...THUMBNAIL_MODEL_REQUEST_FIELDS]);
    expect(path.requestBuilder).toContain("src/lib/publishing/thumbnails-model.ts");
    // A build that named no variable is empty-with-reason rather than gated on a
    // name nobody derived.
    const bare = buildThumbnailsModelPath({ outcome: null, envVars: [] });
    expect(bare.state.state).toBe("empty_no_input");
    expect(bare.providerConcepts).toEqual([]);
  });

  test("asked and not reachable, the state is still gated and no concept is claimed", () => {
    const outcome: ThumbnailsModelOutcome = {
      status: "not_connected",
      attempt: null,
      concepts: [],
      requiredEnv: ["OPENAI_API_KEY"],
      nothingAttempted: true,
      orchestratorMessage: "not reached",
    };
    const path = buildThumbnailsModelPath({ outcome, envVars: ["OPENAI_API_KEY"] });
    expect(path.state.state).toBe("gated_provider");
    expect(path.providerConcepts).toEqual([]);
    expect(path.authoredByModel).toContain("No concept in this package was written by a model.");
    expect(path.orchestratorMessage).toBe("not reached");
    // Its own answer is recorded as it came back, and no name is printed that the
    // caller did not derive: with the orchestrator naming nothing either, the state
    // is empty-with-reason rather than gated on a variable nobody derived.
    const noNames = buildThumbnailsModelPath({ outcome: { ...outcome, requiredEnv: [] }, envVars: [] });
    expect(noNames.state.state).toBe("empty_no_input");
    expect(noNames.state.state === "empty_no_input" && noNames.state.reason).toContain("no provider environment variable was");
    // When the orchestrator DID name the variables it needs, those names are the
    // gate — they came from the app's own registry, not from a literal here.
    const fromOrchestrator = buildThumbnailsModelPath({ outcome, envVars: [] });
    expect(fromOrchestrator.state.state).toBe("gated_provider");
    expect(fromOrchestrator.state.state === "gated_provider" && fromOrchestrator.state.envVars).toEqual(["OPENAI_API_KEY"]);
    expect(fromOrchestrator.providerConcepts).toEqual([]);
  });

  test("ONLY an accepted answer that really carried text produces a provider concept", () => {
    const path = buildThumbnailsModelPath({ outcome: okOutcome, envVars: GATE_NAMES });
    expect(path.state.state).toBe("derived");
    expect(path.state.state === "derived" && path.state.value).toBe(1);
    expect(path.providerConcepts).toHaveLength(1);
    expect(path.providerConcepts[0]!.providerId).toBe("replicate");
    expect(path.providerConcepts[0]!.textOrigin).toBe("provider_verbatim");
    expect(path.providerConcepts[0]!.source).toBe("provider_response");
    expect(path.authoredByModel).toContain("replicate");
    expect(path.authoredByModel).toContain("kept separate");
    expect(path.attempt?.providerId).toBe("replicate");
  });

  test("an accepted answer that carried nothing is not a concept, and is not narrated as a rejection", () => {
    const empty = buildThumbnailsModelPath({ outcome: { ...okOutcome, concepts: [] }, envVars: GATE_NAMES });
    expect(empty.providerConcepts).toEqual([]);
    expect(empty.state.state).toBe("empty_no_input");
    expect(empty.state.state === "empty_no_input" && empty.state.reason).toContain("carried no concept text");
    // The sentence must not argue with itself: "did not come back accepted (ok)" is
    // what a missing branch produces, and it would be a false claim about a provider.
    expect(empty.state.state === "empty_no_input" && empty.state.reason).not.toContain("did not come back accepted");
    expect(empty.authoredByModel).toContain("No concept in this package was written by a model.");

    const failed = buildThumbnailsModelPath({ outcome: { ...okOutcome, status: "failed", concepts: [] }, envVars: GATE_NAMES });
    expect(failed.providerConcepts).toEqual([]);
    expect(failed.state.state).toBe("empty_no_input");
    expect(failed.state.state === "empty_no_input" && failed.state.reason).toContain("did not come back accepted (failed)");
    expect(failed.authoredByModel).toContain("No concept in this package was written by a model.");
  });

  test("the gated path reaches the package, and the package still audits clean with the names it was given", () => {
    const pkg = buildPublishingPackage(richSource(), { now: NOW, thumbnailImageGate: GATE_WITH_NAMES });
    expect(pkg.thumbnails.modelPath.providerConcepts).toEqual([]);
    expect(pkg.thumbnails.modelPath.state.state).not.toBe("derived");
    expect(pkg.thumbnails.modelPath.authoredByModel).toContain("No concept in this package was written by a model.");
    expect(pkg.summary.thumbnailConcepts).toBe(pkg.thumbnails.totalConcepts);
    const audit = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: GATE_NAMES });
    expect(audit.ok).toBe(true);
    // …and a name the registry does not derive is caught, because the gates on this
    // package name exactly the names the build was handed.
    const wrong = auditPublishingPackage(pkg, { now: NOW, expectedEnvNames: ["SOME_OTHER_KEY"] });
    expect(wrong.ok).toBe(false);
    expect(wrong.violations.some((v) => v.kind === "env_name_mismatch")).toBe(true);
  });
});
