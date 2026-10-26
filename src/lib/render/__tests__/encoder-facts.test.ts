/**
 * THE GUARD ON WHAT THE SELECTION SURFACES SAY ABOUT THE ENCODER
 * (Phase 8, block 2b).
 *
 * Two opposite failures are possible and both are failures:
 *
 *   1. The copy still says the encoder is absent. That was true before block 2b
 *      installed `ffmpeg 7.0.2` and proved an encode on a declared synthetic
 *      source; saying it now would under-claim what the build can do.
 *   2. The copy widens to "a project video was produced" / "your video is
 *      ready". Nothing of the kind happened: the only files that exist are
 *      encodes of a generated test source, and a real project still has no
 *      source media without a media provider.
 *
 * So this file scans the product's own source for both, and pins the recorded
 * facts (`encoder-facts.ts`) to the runs they came from. It reads files, so it
 * runs from the repo root like the other source sweeps.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ENCODER_INSTALL,
  ENCODER_PROOF_RUNS,
  NO_PROJECT_VIDEO_SENTENCE,
  RESOLUTIONS_NOT_PROVED,
  RESOLUTIONS_PROVED,
} from "@/lib/render/encoder-facts";
import { findExportPreset } from "@/lib/export/presets";
import { YOUTUBE_MASTER_BOUNDARY } from "@/lib/export/youtube-master";
import { SPEC_DELIVERY_STATEMENT } from "@/lib/export/spec-matrix";

const ROOT = join(process.cwd(), "src");

/** Every .ts/.tsx file under src, minus the tests (which quote the forbidden strings). */
function sourceFiles(dir: string = ROOT, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(p, acc);
    } else if (p.endsWith(".ts") || p.endsWith(".tsx")) {
      acc.push(p);
    }
  }
  return acc;
}

const FILES = sourceFiles().map((path) => ({ path, text: readFileSync(path, "utf8") }));

/** Claims that the encoder is not here. All of these are now false. */
const ABSENT_ENCODER_CLAIMS = [
  "no encoder is installed",
  "this build has no encoder",
  "There is no encoder installed",
  "no encoder exists on this build",
];

/**
 * Phrases that would claim a real project's (or a customer's) video was made.
 * Each is checked against the words immediately before it: a negated form
 * ("no project's video has been produced") is the honest one and passes.
 */
const MADE_A_VIDEO_CLAIMS = [
  /project'?s? video (?:has been|was|is) (?:produced|rendered|delivered)/gi,
  /your video (?:has been|was|is) (?:produced|rendered|ready)/gi,
  /customer'?s? (?:video|project) (?:was|has been) (?:produced|rendered|delivered)/gi,
];

function offended(text: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 24), at).toLowerCase();
    if (/\b(no|not|never|nothing)\b/.test(before)) continue;
    out.push(m[0]);
  }
  return out;
}

describe("the encoder copy is what is now true", () => {
  test("no source file claims the encoder is absent", () => {
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      const lower = text.toLowerCase();
      for (const claim of ABSENT_ENCODER_CLAIMS) {
        if (lower.includes(claim.toLowerCase())) offenders.push(`${path}: "${claim}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no copy claims a project, customer or user video was produced", () => {
    const offenders: string[] = [];
    for (const { path, text } of FILES) {
      for (const pattern of MADE_A_VIDEO_CLAIMS) {
        for (const hit of offended(text, pattern)) offenders.push(`${path}: "${hit}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the selection surfaces say an encoder is present AND that no project video exists", () => {
    // The two halves must travel together: presence without the boundary is the
    // widening this test exists to stop.
    const masters = YOUTUBE_MASTER_BOUNDARY.join(" ");
    expect(masters).toContain("an encoder is installed on this build");
    expect(masters).toContain("no project's video has been produced");
    expect(SPEC_DELIVERY_STATEMENT).toContain("No project's video has been produced");
    for (const id of ["youtube-1080p", "youtube-2160p", "youtube-shorts"] as const) {
      const preset = findExportPreset(id);
      expect(preset, id).not.toBeNull();
      expect(preset!.deliveredStatement).toContain("No project's video has been produced");
      expect(preset!.deliveredStatement).toContain("DECLARED SYNTHETIC SOURCE");
    }
    expect(NO_PROJECT_VIDEO_SENTENCE).toContain("No project video has been produced");
  });

  test("the recorded facts name the binary, the resolutions and the failures", () => {
    expect(ENCODER_INSTALL.binary).toBe("ffmpeg");
    expect(ENCODER_INSTALL.versionLine).toContain("7.0.2");
    expect(ENCODER_INSTALL.runnabilitySource).toContain("live probe");
    // A resolution is "proved" only if a run that produced a file says so.
    const produced = ENCODER_PROOF_RUNS.filter((r) => r.verdict === "produced a file");
    expect(RESOLUTIONS_PROVED.length).toBe(produced.length);
    for (const r of produced) expect(RESOLUTIONS_PROVED).toContain(r.frame.split(" @")[0]!);
    // Every run that did not produce a file is in the not-proved list, with a reason.
    const notProduced = ENCODER_PROOF_RUNS.filter((r) => r.verdict !== "produced a file");
    expect(RESOLUTIONS_NOT_PROVED.length).toBe(notProduced.length);
    for (const r of notProduced) {
      expect(RESOLUTIONS_NOT_PROVED.map((x) => x.frame)).toContain(r.frame.split(" @")[0]!);
      expect(r.measured.length).toBeGreaterThan(40);
    }
    // No run is ever a project's video.
    for (const r of ENCODER_PROOF_RUNS) {
      expect(r.evidence.toLowerCase()).not.toContain("project video");
      expect(r.measured.toLowerCase()).not.toContain("user");
    }
  });
});
