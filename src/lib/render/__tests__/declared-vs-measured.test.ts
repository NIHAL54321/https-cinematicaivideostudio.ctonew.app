/**
 * DECLARED VERSUS MEASURED — the guard that stops the two from being confused
 * (Phase 8, block 2b).
 *
 * THE FACT UNDER GUARD. The 2160p preset's specification DECLARES HEVC Main at
 * level 5.1. The delivered file the pipeline produced for it MEASURES level 5.0
 * (ffprobe `level=150`). A surface that prints "level 5.1" as though it were the
 * file's property is wrong, and a surface that quietly rewrites the preset to
 * 5.0 so the pair agree is a different kind of wrong: it hides a difference
 * that is real.
 *
 * WHAT THIS FILE PROVES
 *   1. On the real recorded data, both sentences exist, each labelled, and the
 *      divergence is stated in words.
 *   2. The two sentences are built from separate inputs, so no value can cross
 *      from one into the other: tampering with the declared value moves only the
 *      declared line; tampering with the measured record moves only the measured
 *      line. A measured value can never be rendered as if it were declared, and
 *      a declared value can never be rendered as if it were measured.
 *   3. Every surface that prints the resolved specification goes through the one
 *      component that builds those two lines — a raw `@ L${level}` interpolation
 *      in a panel fails this test.
 *   4. Each proof run's quoted numbers carry the job id they belong to.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENCODER_PROOF_RUNS,
  MEASURED_ENCODE_OUTPUTS,
  buildDeclaredVersusMeasured,
  declaredVersusMeasured,
  measuredOutputFor,
  type MeasuredEncodeOutput,
} from "@/lib/render/encoder-facts";
import { findExportPreset } from "@/lib/export/presets";

const ROOT = join(process.cwd(), "src");
const specPanel = readFileSync(join(ROOT, "components/render/export-spec-panel.tsx"), "utf8");
const pipelinePanel = readFileSync(join(ROOT, "components/render/render-pipeline-panel.tsx"), "utf8");
const component = readFileSync(join(ROOT, "components/render/declared-measured.tsx"), "utf8");

describe("the real 2160p pair: the specification declares 5.1, the file measures 5.0", () => {
  const preset = findExportPreset("youtube-2160p");
  const cmp = declaredVersusMeasured({
    presetId: "youtube-2160p",
    codec: String(preset?.video.codec),
    profile: String(preset?.video.profile),
    level: (preset?.video.level as string | null) ?? null,
  });

  test("the preset really declares level 5.1 — the comparison is not fed a constant", () => {
    expect(`declared level from the catalogue: ${preset?.video.level}`).toBe("declared level from the catalogue: 5.1");
  });

  test("the declared sentence carries the declared level AND says it is not a measurement", () => {
    expect(cmp.declaredLine).toContain("DECLARED in the specification");
    expect(cmp.declaredLine).toContain("level 5.1");
    expect(cmp.declaredLine).toContain("not a measurement of any file");
  });

  test("the measured sentence carries the measured level, the raw ffprobe integer, and its job", () => {
    expect(cmp.measuredLine).not.toBeNull();
    expect(cmp.measuredLine!).toContain("MEASURED with ffprobe");
    expect(cmp.measuredLine!).toContain("level 5.0");
    expect(cmp.measuredLine!).toContain("level=150");
    expect(cmp.measuredLine!).toContain("job cmvoxscud000dffo7u3oki7cs");
    expect(cmp.measuredLine!).toContain("not a project's video");
  });

  test("the file's level is never presented as the declared one, nor the declared one as the file's", () => {
    // The measured sentence must not claim 5.1; the declared sentence must not
    // claim 5.0. That is the whole distinction, in two assertions.
    expect(cmp.measuredLine!).not.toContain("level 5.1");
    expect(cmp.declaredLine).not.toContain("level 5.0");
    expect(cmp.levelRelation).toBe("the file measures lower than declared");
  });

  test("the divergence is stated in words, naming both numbers", () => {
    expect(cmp.divergenceSentence).not.toBeNull();
    expect(cmp.divergenceSentence!).toContain("declares level 5.1");
    expect(cmp.divergenceSentence!).toContain("measures level 5.0");
    expect(cmp.divergenceSentence!).toContain("Neither number is corrected to match the other");
  });

  test("the 1080p pair agrees, and agreement is reported as agreement rather than as a measurement claim", () => {
    const p = findExportPreset("youtube-1080p");
    const c = declaredVersusMeasured({
      presetId: "youtube-1080p",
      codec: String(p?.video.codec),
      profile: String(p?.video.profile),
      level: (p?.video.level as string | null) ?? null,
    });
    expect(c.levelRelation).toBe("identical");
    expect(c.divergenceSentence).toBeNull();
    expect(c.measuredLine!).toContain("MEASURED with ffprobe");
  });

  test("a preset with no measurement says so instead of borrowing another file's numbers", () => {
    const c = declaredVersusMeasured({ presetId: "youtube-shorts", codec: "h264", profile: "High", level: "4.0" });
    expect(c.measuredLine).toBeNull();
    expect(c.levelRelation).toBe("no measurement");
    expect(c.declaredLine).toContain("DECLARED in the specification");
  });
});

describe("no value can cross between the two sentences", () => {
  const declared = { presetId: "youtube-2160p", codec: "hevc", profile: "Main", level: "5.1" };
  const measured = measuredOutputFor("youtube-2160p")!;
  const base = buildDeclaredVersusMeasured(declared, measured);

  test("tampering with the DECLARED level moves only the declared line", () => {
    const tampered = buildDeclaredVersusMeasured({ ...declared, level: "6.2" }, measured);
    expect(tampered.declaredLine).toContain("level 6.2");
    // The measured sentence is byte-identical: the declared value did not leak in.
    expect(tampered.measuredLine).toBe(base.measuredLine!);
    expect(tampered.measuredLine!).not.toContain("6.2");
  });

  test("tampering with the MEASURED record moves only the measured line", () => {
    const other: MeasuredEncodeOutput = { ...measured, level: "9.9", levelRaw: 999, jobId: "job-tampered-for-a-test" };
    const tampered = buildDeclaredVersusMeasured(declared, other);
    expect(tampered.measuredLine!).toContain("level 9.9");
    expect(tampered.measuredLine!).toContain("job-tampered-for-a-test");
    // The declared sentence is byte-identical: the measured value did not leak in.
    expect(tampered.declaredLine).toBe(base.declaredLine);
    expect(tampered.declaredLine).not.toContain("9.9");
    expect(tampered.levelRelation).toBe("the file measures higher than declared");
  });

  test("dropping the measurement removes the measured sentence entirely rather than filling it", () => {
    const none = buildDeclaredVersusMeasured(declared, null);
    expect(none.measuredLine).toBeNull();
    expect(none.divergenceSentence).toBeNull();
    expect(none.declaredLine).toBe(base.declaredLine);
  });
});

describe("the surfaces use the one builder, and no panel prints a level by hand", () => {
  test("both spec-printing panels import the shared component", () => {
    for (const [name, text] of [
      ["export-spec-panel", specPanel],
      ["render-pipeline-panel", pipelinePanel],
    ] as const) {
      expect(`${name} imports DeclaredVersusMeasured: ${text.includes('from "@/components/render/declared-measured"')}`).toBe(
        `${name} imports DeclaredVersusMeasured: true`,
      );
      expect(`${name} renders it: ${text.includes("<DeclaredVersusMeasured")}`).toBe(`${name} renders it: true`);
    }
  });

  test("neither panel interpolates a codec level straight onto the screen", () => {
    // The old shape was `{spec.video.level ? ` @ L${spec.video.level}` : ""}` —
    // one unlabelled number that a reader takes for the file's own level.
    for (const [name, text] of [
      ["export-spec-panel", specPanel],
      ["render-pipeline-panel", pipelinePanel],
    ] as const) {
      expect(`${name} raw level interpolation: ${/@ L\$\{/.test(text)}`).toBe(`${name} raw level interpolation: false`);
    }
  });

  test("the component itself takes the level from the builder, never from a literal on the page", () => {
    expect(component).toContain("declaredVersusMeasured({");
    expect(/declaredLine|measuredLine/.test(component)).toBe(true);
    // It must label the two facts structurally, so a screenshot reader and a
    // diff can both tell which is which.
    expect(component).toContain('data-fact="declared"');
    expect(component).toContain('data-fact="measured"');
    expect(component).toContain('data-fact="no-measurement"');
  });
});

describe("every quoted number belongs to the run it names", () => {
  test("each proof run carries a job id and its measurement text names that job", () => {
    for (const run of ENCODER_PROOF_RUNS) {
      expect(`${run.preset} carries a job id: ${run.jobId.startsWith("cmvo")}`).toBe(`${run.preset} carries a job id: true`);
      expect(`${run.preset} names its own job: ${run.measured.includes(run.jobId)}`).toBe(
        `${run.preset} names its own job: true`,
      );
      expect(`${run.preset} evidence names the same job: ${run.evidence.includes(run.jobId)}`).toBe(
        `${run.preset} evidence names the same job: true`,
      );
    }
  });

  test("the 1080p entry does not merge three runs' byte counts into one sentence", () => {
    const run = ENCODER_PROOF_RUNS.find((r) => r.preset === "youtube-1080p")!;
    // The numbers quoted as its own are its own job's…
    expect(run.measured).toContain("2,108,951 bytes");
    expect(run.measured).toContain("2,109,388 bytes");
    // …and the other two 1080p proofs are named as OTHER jobs, with their own.
    expect(run.measured).toContain("cmvox5zpo000dff13oujat027");
    expect(run.measured).toContain("2,116,354 bytes");
    expect(run.measured).toContain("cmvoxiahh000fffskry022esk");
    expect(run.measured).toContain("2,116,306 bytes");
  });

  test("every measured output points at a run recorded as having produced a file", () => {
    for (const m of MEASURED_ENCODE_OUTPUTS) {
      const run = ENCODER_PROOF_RUNS.find((r) => r.jobId === m.jobId);
      expect(`${m.presetId} has a recorded run for ${m.jobId}: ${Boolean(run)}`).toBe(
        `${m.presetId} has a recorded run for ${m.jobId}: true`,
      );
      expect(`${m.presetId} run produced a file: ${run!.verdict}`).toBe(`${m.presetId} run produced a file: produced a file`);
      expect(`${m.presetId} measured at the same preset: ${run!.preset}`).toBe(`${m.presetId} measured at the same preset: ${m.presetId}`);
    }
  });
});
