/**
 * THE PRODUCTION CLAIM FOLLOWS THE ROWS (Phase 8, block 11).
 *
 * The defect this file exists for: for two blocks the product told every signed-in
 * user that no project's video had ever been produced on this build. Block 10
 * produced one — 172,271,154 bytes, sha256 a05f3f60…, 180.033 s, 1920×1080 — and
 * the sentence stayed. A typed absence is the same defect as a typed achievement:
 * it stops tracking the rows.
 *
 * So the claim is now a DERIVATION, and this file is its negative control. The
 * same pure function is fed an empty account and a populated one and the text is
 * required to follow, in both directions:
 *
 *   - empty rows  → the "none" sentence, and no byte count, digest or duration
 *                   may appear in it;
 *   - one row     → that row's bytes, digest prefix, duration, dimensions and
 *                   codec, and the "none" sentence must be GONE;
 *   - the row's numbers change → the text changes with them (nothing cached);
 *   - a row with no measurements → the text says the measurement is missing
 *                   rather than assuming a codec, a duration or a size;
 *   - the old hard-coded sentence appears in NEITHER output, so a re-hardcoded
 *                   claim fails here as well as in the source sweep.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  absencesFromStageOutput,
  deriveProductionStatement,
  durableFromStageOutput,
  measuredFromStageOutput,
  unreadableProductionStatement,
  type DeliveredVideoRow,
} from "@/lib/render/production-state";


/** The sentence the product printed until block 11. It must appear nowhere now. */
const OLD_HARD_CODED_CLAIM =
  "No project's video has been produced on this build and none can be yet";

/** The real shape the pipeline's container-mux stage records (job cmw5amjtb0003ffpncsz0xz7a). */
const REAL_MUX_OUTPUT = {
  bytes: 172_271_154,
  sha256: "a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22",
  durable: {
    key: "renders/cmw5aj2hs0000ffya657nkt8x/cmw5amjtb0003ffpncsz0xz7a/delivered-container-a05f3f60fbd0d889.mp4",
    bytes: 172_271_154,
    bucket: "cinema-studio",
    sha256: "a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22",
    verified: true,
    objectBytesInStorage: 172_271_154,
  },
  ffprobeReadBack: {
    audio: { channels: 2, codecName: "aac", bitRateKbps: 45, sampleRateHz: 48_000 },
    video: {
      level: 40,
      pixFmt: "yuv420p",
      profile: "High",
      widthPx: 1920,
      heightPx: 1080,
      codecName: "h264",
      bitRateKbps: 7601,
      avgFrameRate: "30/1",
    },
    streams: 3,
    durationSeconds: 180.033333,
    overallBitRateKbps: 7655,
  },
  deliveryFacts: {
    music: "none — nothing was mixed from a music provider",
    narration: "none — no voice provider produced a voiceover for this job",
    screening: "not screened and not cleared",
    subtitles: "none burned in, none muxed",
    aiGeneration: "not AI-generated: stock footage from the providers named in `source.clips[].provenance`",
  },
};

/** One delivered-container row, as the loader builds it from the artefact + mux rows. */
function deliveredRow(over: Partial<DeliveredVideoRow> = {}): DeliveredVideoRow {
  return {
    jobId: "cmw5amjtb0003ffpncsz0xz7a",
    projectId: "p7a_fix_project",
    projectTitle: "The tide gauge at Ardnish (P7-7a FIXTURE project)",
    presetId: "youtube-1080p",
    presetLabel: "YouTube 1080p (FHD SDR)",
    bytes: 172_271_154,
    sha256: "a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22",
    createdAt: "2026-11-06T18:13:44.015Z",
    measured: measuredFromStageOutput(REAL_MUX_OUTPUT),
    durable: durableFromStageOutput(REAL_MUX_OUTPUT),
    absences: absencesFromStageOutput(REAL_MUX_OUTPUT),
    ...over,
  };
}

const ACCOUNT = { kind: "account" } as const;

describe("the stage output is parsed as the pipeline writes it", () => {
  test("ffprobe's read-back becomes the measured facts — every field from the row", () => {
    const m = measuredFromStageOutput(REAL_MUX_OUTPUT)!;
    expect(m).not.toBeNull();
    expect(m.durationSeconds).toBe(180.033333);
    expect([m.widthPx, m.heightPx]).toEqual([1920, 1080]);
    expect(m.videoCodec).toBe("h264");
    expect(m.profile).toBe("High");
    expect(m.level).toBe(40);
    expect(m.pixelFormat).toBe("yuv420p");
    expect(m.frameRate).toBe("30/1");
    expect(m.audioCodec).toBe("aac");
    expect([m.audioChannels, m.audioSampleRateHz]).toEqual([2, 48_000]);
  });

  test("the encode stage's own `measured` object is read too, when that is all there is", () => {
    const m = measuredFromStageOutput({ measured: REAL_MUX_OUTPUT.ffprobeReadBack })!;
    expect(m.durationSeconds).toBe(180.033333);
    expect(m.widthPx).toBe(1920);
  });

  test("an output with no probe records no measurement — nothing is assumed", () => {
    expect(measuredFromStageOutput({ bytes: 10 })).toBeNull();
    expect(measuredFromStageOutput(null)).toBeNull();
    expect(measuredFromStageOutput("nope")).toBeNull();
    expect(durableFromStageOutput({ bytes: 10 })).toBeNull();
    expect(absencesFromStageOutput({ bytes: 10 })).toBeNull();
  });

  test("the durable copy is read from the row, and `verified` is only true when the stage said so", () => {
    const d = durableFromStageOutput(REAL_MUX_OUTPUT)!;
    expect(d.bucket).toBe("cinema-studio");
    expect(d.key).toContain("delivered-container-a05f3f60fbd0d889.mp4");
    expect(d.objectBytes).toBe(172_271_154);
    expect(d.verified).toBe(true);
    const unverified = durableFromStageOutput({ durable: { bucket: "b", key: "k", bytes: 5 } })!;
    expect(unverified.verified).toBe(false);
  });
});

describe("NEGATIVE CONTROL — the same derivation, an empty account and a populated one", () => {
  test("empty rows produce the none sentence, and no number that could only come from a row", () => {
    const empty = deriveProductionStatement([], ACCOUNT);
    expect(empty.exists).toBe(false);
    expect(empty.count).toBe(0);
    expect(empty.deliveryLines).toEqual([]);
    expect(empty.jobIds).toEqual([]);
    expect(empty.sentence).toContain("No delivered container exists for this account");
    expect(empty.sentence).toContain("delivered-container");
    // No figure may leak into an absence statement.
    expect(empty.sentence).not.toContain("172,271,154");
    expect(empty.sentence).not.toContain("180.033");
    expect(empty.sentence).not.toContain("a05f3f60");
    expect(empty.sentence).not.toContain("1920");
  });

  test("one row produces that row's own numbers — bytes, digest, duration, dimensions, codec, audio", () => {
    const one = deriveProductionStatement([deliveredRow()], ACCOUNT);
    expect(one.exists).toBe(true);
    expect(one.count).toBe(1);
    expect(one.jobIds).toEqual(["cmw5amjtb0003ffpncsz0xz7a"]);
    expect(one.sentence).toContain("One delivered container exists for this account");
    expect(one.sentence).toContain("172,271,154 B");
    expect(one.sentence).toContain("a05f3f60fbd0d889");
    expect(one.sentence).toContain("180.033 s");
    expect(one.sentence).toContain("1920×1080");
    expect(one.sentence).toContain("h264 High");
    expect(one.sentence).toContain("ffprobe level=40");
    expect(one.sentence).toContain("aac 2 ch 48,000 Hz");
    expect(one.sentence).toContain("cinema-studio");
    expect(one.sentence).toContain("renders/");
    // The absence sentence and the "none" sentence cannot both be true.
    expect(one.sentence).not.toContain("No delivered container exists");
    expect(one.sentence).toContain("Nothing in this paragraph is evidence of customers, usage, revenue or a live service");
  });

  test("what the file does NOT contain is carried from the mux stage's own words", () => {
    const one = deriveProductionStatement([deliveredRow()], ACCOUNT);
    expect(one.absenceLines.length).toBeGreaterThanOrEqual(4);
    const all = one.absenceLines.join(" ");
    expect(all).toContain("no voice provider produced a voiceover");
    expect(all).toContain("nothing was mixed from a music provider");
    expect(all).toContain("none burned in, none muxed");
    expect(all).toContain("not screened and not cleared");
    expect(one.sentence).toContain("What it does not contain:");
  });

  test("THE TEXT IS NOT CACHED: change the row's bytes and the sentence changes with it", () => {
    const a = deriveProductionStatement([deliveredRow()], ACCOUNT);
    const b = deriveProductionStatement([deliveredRow({ bytes: 999, sha256: "b".repeat(64), durable: null })], ACCOUNT);
    expect(a.sentence).not.toBe(b.sentence);
    expect(b.sentence).toContain("999 B");
    expect(b.sentence).not.toContain("172,271,154 B");
    // And a second row changes the count and both job ids.
    const two = deriveProductionStatement(
      [deliveredRow(), deliveredRow({ jobId: "job_2", bytes: 5, sha256: "c".repeat(64) })],
      ACCOUNT,
    );
    expect(two.count).toBe(2);
    expect(two.sentence).toContain("2 delivered containers exist");
    expect(two.jobIds).toEqual(["cmw5amjtb0003ffpncsz0xz7a", "job_2"]);
  });

  test("a row with no measurements says the measurement is missing instead of assuming one", () => {
    const bare = deriveProductionStatement(
      [deliveredRow({ measured: null, durable: null, absences: null })],
      ACCOUNT,
    );
    expect(bare.exists).toBe(true);
    expect(bare.sentence).toContain("no measurement");
    expect(bare.sentence).not.toContain("1920×1080");
    expect(bare.sentence).not.toContain("180.033");
    expect(bare.sentence).toContain("No durable copy is recorded");
    expect(bare.absenceLines[0]).toContain("recorded no statement of what its delivered file does not contain");
    expect(bare.sentence).toContain("its silence is not a claim");
  });

  test("a row whose digest is not a sha256 is refused rather than printed as one", () => {
    const bad = deriveProductionStatement([deliveredRow({ sha256: "short" })], ACCOUNT);
    expect(bad.exists).toBe(false);
    expect(bad.sentence).toContain("No delivered container exists");
  });

  test("project scope names the project, account scope names the account", () => {
    const project = deriveProductionStatement([deliveredRow()], {
      kind: "project",
      projectId: "p7a_fix_project",
      projectTitle: "The tide gauge at Ardnish (P7-7a FIXTURE project)",
    });
    expect(project.scope).toBe("project");
    expect(project.sentence).toContain('for project "The tide gauge at Ardnish (P7-7a FIXTURE project)"');
    const none = deriveProductionStatement([], { kind: "project", projectId: "p", projectTitle: "P" });
    expect(none.headline).toBe("No delivered video for this project");
    expect(none.sentence).toContain('No delivered container exists for project "P"');
  });

  test("the OLD hard-coded sentence appears in neither the empty nor the populated text", () => {
    for (const statement of [
      deriveProductionStatement([], ACCOUNT),
      deriveProductionStatement([deliveredRow()], ACCOUNT),
      unreadableProductionStatement(),
    ]) {
      expect(statement.sentence).not.toContain(OLD_HARD_CODED_CLAIM);
      expect(statement.headline).not.toContain(OLD_HARD_CODED_CLAIM);
    }
  });
});

describe("a failed read is not an absence", () => {
  test("the unreadable statement says the read failed, and claims nothing about output", () => {
    const unreadable = unreadableProductionStatement();
    expect(unreadable.exists).toBe(false);
    expect(unreadable.sentence).toContain("could not read the render rows");
    expect(unreadable.sentence).toContain("a failed read is not evidence that none does");
    expect(unreadable.sentence).not.toContain("No delivered container exists");
  });
});

describe("the module itself cannot go back to a typed claim", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/render/production-state.ts"), "utf8");

  test("no absence claim is written in the module", () => {
    const lower = source.toLowerCase();
    expect(lower).not.toContain("no project's video has been produced");
    expect(lower).not.toContain("none can be yet");
    expect(lower).not.toContain("no project video has been produced");
  });

  test("the loader delegates to the pure derivation rather than composing its own sentence", () => {
    expect(source).toContain("export function deriveProductionStatement(");
    expect(source).toContain("return deriveProductionStatement(");
    // The loader must return the derivation's own result, not a literal object.
    expect(source).toContain("deriveProductionStatement(rows, scope)");
  });
});
