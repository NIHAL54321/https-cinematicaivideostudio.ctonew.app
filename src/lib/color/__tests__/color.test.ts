import { describe, expect, test } from "bun:test";
import {
  COLOR_GRADES,
  COLOR_GRADE_IDS,
  NO_GRADE_LABEL,
  buildRenderPlan,
  colorGradeView,
  findColorGrade,
  isColorGradeId,
  listColorGradeViews,
} from "../presets";
import {
  COLOR_ASSIGNMENT_FORMAT,
  EMPTY_ASSIGNMENT,
  assignmentsEqual,
  effectiveGrade,
  normalizeAssignment,
  serializeAssignment,
} from "../assignment";

/**
 * Phase 5 Block 4 — colour catalogue + render plan + assignment model.
 * Pure modules: every assertion below is arithmetic or a literal, no IO.
 */

describe("colour catalogue", () => {
  test("exposes exactly the nine spec grades as first-class presets", () => {
    expect(COLOR_GRADES.length).toBe(9);
    expect([...COLOR_GRADE_IDS]).toEqual([
      "cinematic",
      "filmic",
      "moody",
      "vibrant",
      "atmospheric",
      "rich",
      "color-accurate",
      "sdr-rec709",
      "hdr",
    ]);
    const ids = COLOR_GRADES.map((g) => g.id);
    expect(new Set(ids).size).toBe(9);
  });

  test("every grade carries real, inspectable parameters and a plain-language description", () => {
    for (const grade of COLOR_GRADES) {
      expect(grade.name.length).toBeGreaterThan(2);
      // Plain language: a sentence a human reads, not a token list.
      expect(grade.description.length).toBeGreaterThan(80);
      expect(grade.useWhen.length).toBeGreaterThan(40);
      expect(Number.isFinite(grade.contrast)).toBe(true);
      expect(Number.isFinite(grade.saturation)).toBe(true);
      expect(Number.isFinite(grade.temperatureK)).toBe(true);
      expect(Number.isFinite(grade.tint)).toBe(true);
      for (const v of [grade.curves.shadows, grade.curves.midtones, grade.curves.highlights]) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
      // Lift/gamma/gain present for all three channels, neutral lift = 0.5.
      expect(grade.lgg.lift.r).toBeGreaterThan(0);
      expect(grade.lgg.gamma.g).toBeGreaterThan(0);
      expect(grade.lgg.gain.b).toBeGreaterThan(0);
      expect(grade.lutEquivalent.length).toBeGreaterThan(10);
    }
  });

  test("every grade declares a real delivery target (display / transfer / nits)", () => {
    for (const grade of COLOR_GRADES) {
      const t = grade.target;
      expect(["SDR", "HDR"]).toContain(t.display);
      expect(["Rec.709", "Rec.2020"]).toContain(t.standard);
      expect(t.peakNits).toBeGreaterThan(0);
      expect(t.referenceWhiteNits).toBeGreaterThan(0);
      expect(t.bitDepth).toBeGreaterThanOrEqual(8);
      if (t.display === "HDR") {
        expect(t.transfer).toBe("PQ (SMPTE ST 2084)");
        expect(t.standard).toBe("Rec.2020");
        expect(t.maxCLL).toBeGreaterThan(0);
        expect(t.maxFALL).toBeGreaterThan(0);
        expect(t.peakNits).toBeGreaterThan(t.referenceWhiteNits);
      } else {
        expect(t.transfer).toBe("BT.1886");
        expect(t.standard).toBe("Rec.709");
        expect(t.peakNits).toBe(100);
        expect(t.maxCLL).toBeNull();
      }
    }
  });

  test("color-accurate and sdr-rec709 are genuinely neutral; the look grades are not", () => {
    const accurate = findColorGrade("color-accurate")!;
    expect([accurate.contrast, accurate.saturation, accurate.temperatureK, accurate.tint]).toEqual([1, 1, 0, 0]);
    expect(accurate.curves).toEqual({ shadows: 0, midtones: 0, highlights: 0 });
    expect(accurate.lgg.lift).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(accurate.lgg.gamma.g).toBe(1);
    expect(accurate.lgg.gain.r).toBe(1);

    const sdr = findColorGrade("sdr-rec709")!;
    expect(sdr.target.transfer).toBe("BT.1886");
    expect(sdr.target.peakNits).toBe(100);
    expect(sdr.hdrOnly).toBe(false);

    for (const id of ["cinematic", "filmic", "moody", "vibrant", "atmospheric", "rich"]) {
      const g = findColorGrade(id)!;
      const neutral =
        g.contrast === 1 && g.saturation === 1 && g.temperatureK === 0 && g.tint === 0;
      expect(neutral).toBe(false);
    }
  });

  test("hdr is the only HDR-only grade and it targets PQ / Rec.2020 / 1000 nits", () => {
    expect(COLOR_GRADES.filter((g) => g.hdrOnly).map((g) => g.id)).toEqual(["hdr"]);
    const hdr = findColorGrade("hdr")!;
    expect(hdr.target.display).toBe("HDR");
    expect(hdr.target.transfer).toBe("PQ (SMPTE ST 2084)");
    expect(hdr.target.standard).toBe("Rec.2020");
    expect(hdr.target.peakNits).toBe(1000);
    expect(hdr.target.referenceWhiteNits).toBe(203);
    expect(hdr.target.maxCLL).toBe(1000);
  });

  test("findColorGrade / isColorGradeId reject anything outside the catalogue", () => {
    expect(findColorGrade("cinematic")!.id).toBe("cinematic");
    expect(findColorGrade("noir")).toBeNull();
    expect(findColorGrade("")).toBeNull();
    expect(findColorGrade(null)).toBeNull();
    expect(findColorGrade(7)).toBeNull();
    expect(isColorGradeId("moody")).toBe(true);
    expect(isColorGradeId("cinematic-warm")).toBe(false);
    expect(NO_GRADE_LABEL).toBe("None");
  });

  test("the grader view exposes the parameters verbatim and is a fresh copy", () => {
    const view = colorGradeView(findColorGrade("cinematic")!);
    const source = findColorGrade("cinematic")!;
    expect(view.parameters.contrast).toBe(source.contrast);
    expect(view.parameters.lutEquivalent).toBe(source.lutEquivalent);
    expect(view.parameters.target).toEqual(source.target);
    expect(view.description).toBe(source.description);
    // Copies, never the catalogue objects themselves.
    expect(view.parameters.curves).not.toBe(source.curves);
    expect(view.parameters.lgg.lift).not.toBe(source.lgg.lift);
    expect(view.parameters.target).not.toBe(source.target);
    expect(listColorGradeViews().length).toBe(9);
  });
});

describe("render plan — grade to renderer parameters", () => {
  test("is deterministic: the same grade always yields the same plan", () => {
    const a = buildRenderPlan("moody");
    const b = buildRenderPlan(findColorGrade("moody")!);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // And a copy, not a shared mutable object.
    expect(a).not.toBe(b);
  });

  test("carries the ordered operations a renderer would run", () => {
    const plan = buildRenderPlan("rich");
    expect(plan.operations.map((o) => o.op)).toEqual([
      "decode-linear",
      "white-balance",
      "lift-gamma-gain",
      "tone-curve",
      "contrast",
      "saturation",
      "lut-apply",
      "output-transform",
    ]);
    expect(plan.operations.map((o) => o.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const contrast = plan.operations.find((o) => o.op === "contrast")!;
    expect(contrast.params.multiplier).toBe(findColorGrade("rich")!.contrast);
    const lgg = plan.operations.find((o) => o.op === "lift-gamma-gain")!;
    expect(String(lgg.params.lift)).toBe("0.495/0.495/0.495");
  });

  test("the LUT is named but never claimed as baked", () => {
    for (const grade of COLOR_GRADES) {
      const plan = buildRenderPlan(grade);
      expect(plan.lut.name).toBe(grade.lutEquivalent);
      expect(plan.lut.baked).toBe(false);
      expect(plan.lut.requiresProvider).toBe(true);
      expect(plan.lut.format).toBe("cube-33");
    }
  });

  test("lists exactly the steps that need a provider and reports no pixel work", () => {
    const sdr = buildRenderPlan("cinematic");
    expect(sdr.providerWork.map((w) => w.step)).toEqual([
      "decode real source frames",
      "apply the graded parameter set to pixels",
      "bake the LUT file",
    ]);
    // HDR adds tone-mapping — honestly listed, not performed.
    const hdr = buildRenderPlan("hdr");
    expect(hdr.providerWork.length).toBe(4);
    expect(hdr.providerWork[3].step).toContain("tone-map");
    for (const w of hdr.providerWork) expect(w.capability).toBe("video_enhancement");
    expect(sdr.note).toContain("No frames were decoded");
  });

  test("the output transform matches the grade's target exactly", () => {
    const plan = buildRenderPlan("hdr");
    expect(plan.output.transfer).toBe("PQ (SMPTE ST 2084)");
    expect(plan.output.peakNits).toBe(1000);
    const out = plan.operations.find((o) => o.op === "output-transform")!;
    expect(out.params.peakNits).toBe(1000);
    expect(out.params.primaries).toBe("Rec.2020");

    const sdr = buildRenderPlan("sdr-rec709");
    expect(sdr.output.transfer).toBe("BT.1886");
    expect(sdr.output.peakNits).toBe(100);
  });

  test("an unknown grade id is a loud error, never a silent default", () => {
    expect(() => buildRenderPlan("noir" as never)).toThrow(/Unknown colour grade/);
  });
});

describe("grade assignment model", () => {
  test("an empty / absent value is an empty assignment and is not 'unreadable'", () => {
    for (const raw of [null, undefined]) {
      const n = normalizeAssignment(raw);
      expect(n.assignment).toEqual(EMPTY_ASSIGNMENT);
      expect(n.unreadable).toBe(false);
      expect(n.dropped).toEqual([]);
    }
  });

  test("a stored envelope round-trips through serialize → normalize", () => {
    const assignment = { project: "cinematic" as const, scenes: { s1: "moody" as const } };
    const n = normalizeAssignment(serializeAssignment(assignment));
    expect(n.assignment).toEqual(assignment);
    expect(n.unreadable).toBe(false);
  });

  test("grade ids outside the catalogue are dropped and reported, never applied", () => {
    const n = normalizeAssignment({
      format: COLOR_ASSIGNMENT_FORMAT,
      version: 1,
      project: "noir",
      scenes: { s1: "vibrant", s2: "teal-orange" },
    });
    expect(n.assignment.project).toBeNull();
    expect(n.assignment.scenes).toEqual({ s1: "vibrant" });
    expect(n.dropped.sort()).toEqual(["noir", "teal-orange"]);
    expect(n.unreadable).toBe(false);
  });

  test("a foreign object under the same key is reported unreadable, not guessed at", () => {
    const n = normalizeAssignment({ some: "other settings blob" });
    expect(n.unreadable).toBe(true);
    expect(n.assignment).toEqual(EMPTY_ASSIGNMENT);
    const bad = normalizeAssignment("just a string");
    expect(bad.unreadable).toBe(true);
  });

  test("effective grade walks scene override → project default → none", () => {
    const assignment = { project: "rich" as const, scenes: { s1: "moody" as const } };
    expect(effectiveGrade(assignment, "s1")).toEqual({ gradeId: "moody", source: "scene" });
    expect(effectiveGrade(assignment, "s2")).toEqual({ gradeId: "rich", source: "project" });
    expect(effectiveGrade(assignment, null)).toEqual({ gradeId: "rich", source: "project" });
    expect(effectiveGrade(EMPTY_ASSIGNMENT, "s1")).toEqual({ gradeId: null, source: "none" });
  });

  test("assignmentsEqual is order-insensitive but value-exact", () => {
    const a = { project: "cinematic" as const, scenes: { s1: "moody" as const, s2: "rich" as const } };
    const b = { project: "cinematic" as const, scenes: { s2: "rich" as const, s1: "moody" as const } };
    expect(assignmentsEqual(a, b)).toBe(true);
    expect(assignmentsEqual(a, { ...a, project: "filmic" })).toBe(false);
    expect(assignmentsEqual(a, { project: "cinematic", scenes: { s1: "moody" } })).toBe(false);
    expect(assignmentsEqual(a, { project: "cinematic", scenes: { s1: "moody", s2: "moody" } })).toBe(false);
    expect(assignmentsEqual(EMPTY_ASSIGNMENT, EMPTY_ASSIGNMENT)).toBe(true);
  });
});
