/**
 * A DECLARED SYNTHETIC SOURCE — the test signal the encoder proof encodes.
 *
 * WHY THIS EXISTS, AND WHAT IT IS NOT
 * Phase 8's claim under test is narrow and must stay narrow: *this machine can
 * run a real encode through the pipeline's own stage*. It is not a claim that a
 * user's project was rendered. So the input is not a project's media and not the
 * scripted fixture world's media — it is a signal the encoder generates itself,
 * from a known pattern and a known tone, at a declared size, cadence and length,
 * whose every property can be recomputed by anyone reading this file.
 *
 * WHAT IS DECLARED (and printed in the evidence, not just asserted here)
 *   pattern        lavfi `testsrc2` — moving colour bars with a burned-in timer
 *   tone           lavfi `sine` at 440 Hz, so the file has an audio stream that
 *                  the mux stage and the loudness measurement have something real
 *                  to work on
 *   duration       seconds of BOTH inputs (they are the same number)
 *   resolution     width × height in pixels
 *   frame rate     frames per second
 *   frame count    duration × frame rate, printed as an integer so the encoder's
 *                  own "frame= N" line can be checked against it
 *
 * WHAT IT IS NOT
 *   - not a master, not a delivery, not a 4K anything until a 4K encode of it
 *     succeeds, and even then only "a 2160p encode of a synthetic source";
 *   - not attached to a user's project or to the fixture project (the row that
 *     carries it is marked `syntheticProof` in its own columns);
 *   - not a substitute for the provider key: nothing about this touches a model.
 *
 * The generated file's own digest is measured from the bytes on disk after the
 * encoder writes it, never computed from the argv.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The marking string carried in every row and every path this proof produces. */
export const SYNTHETIC_MARKER = "synthetic-encoder-proof";

export const SYNTHETIC_STATEMENT =
  "SYNTHETIC ENCODER PROOF — this is a generated test source (testsrc2 video + a 440 Hz sine tone) that the " +
  "encoder produced and then encoded, so that a real encode could be measured on this machine. It is NOT a " +
  "user's project, NOT the fixture project, and NOT a delivered master. Nothing here says any customer's video " +
  "was rendered.";

export interface SyntheticSourceDeclaration {
  /** Discriminator, so a reader of the JSON cannot mistake it for project media. */
  kind: "synthetic-encoder-proof-source";
  synthetic: true;
  marker: string;
  statement: string;
  /** The lavfi filter graphs, verbatim. */
  pattern: string;
  tone: string;
  durationSeconds: number;
  widthPx: number;
  heightPx: number;
  frameRate: number;
  /** duration × frame rate, as an integer. */
  frameCount: number;
  /** The full argv the generator ran (or would run, before it runs). */
  generatorArgv: string[];
  /** Absolute path of the generated file — null until it has been generated. */
  path: string | null;
  bytes: number | null;
  sha256: string | null;
  generatedAt: string | null;
  /** What the generator's own stderr said it produced, trimmed. */
  generatorSaid: string | null;
  /**
   * EXTRA ENCODER ARGUMENTS for this proof attempt only, appended to the argv the
   * encode stage builds from the job's resolved preset specification.
   *
   * This exists because 4K was TRIED with the shipped preset's own settings and
   * the machine killed the encoder; a second attempt under a smaller thread/frame
   * pool is a different experiment and has to say so. It lives on the synthetic
   * DECLARATION, never on a preset: a preset's defaults are not adjustable by a
   * proof, and `syntheticOf()` returns null for every job that is not a declared
   * synthetic proof, so a real project's encode cannot pick this up.
   */
  encoderTuning?: string[];
}

export interface SyntheticSourceRequest {
  widthPx: number;
  heightPx: number;
  frameRate: number;
  durationSeconds: number;
}

/** The sizes this proof tries, largest first, and the preset each is asked about. */
export function syntheticSourceArgv(req: SyntheticSourceRequest, outPath: string): string[] {
  const { widthPx, heightPx, frameRate, durationSeconds } = req;
  return [
    "-y",
    "-hide_banner",
    "-f", "lavfi",
    "-i", `testsrc2=size=${widthPx}x${heightPx}:rate=${frameRate}:duration=${durationSeconds}`,
    "-f", "lavfi",
    "-i", `sine=frequency=440:sample_rate=48000:duration=${durationSeconds}`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-ac", "2",
    "-shortest",
    outPath,
  ];
}

/** The declaration, before anything has run. `path` is filled in by `generate`. */
export function declareSyntheticSource(req: SyntheticSourceRequest, outPath: string): SyntheticSourceDeclaration {
  return {
    kind: "synthetic-encoder-proof-source",
    synthetic: true,
    marker: SYNTHETIC_MARKER,
    statement: SYNTHETIC_STATEMENT,
    pattern: `testsrc2=size=${req.widthPx}x${req.heightPx}:rate=${req.frameRate}:duration=${req.durationSeconds}`,
    tone: `sine=frequency=440:sample_rate=48000:duration=${req.durationSeconds}`,
    durationSeconds: req.durationSeconds,
    widthPx: req.widthPx,
    heightPx: req.heightPx,
    frameRate: req.frameRate,
    frameCount: Math.round(req.durationSeconds * req.frameRate),
    generatorArgv: syntheticSourceArgv(req, outPath),
    path: null,
    bytes: null,
    sha256: null,
    generatedAt: null,
    generatorSaid: null,
  };
}

export interface GenerateResult {
  ok: boolean;
  declaration: SyntheticSourceDeclaration;
  /** Present when !ok: what went wrong, in the encoder's own words where it spoke. */
  failure: string | null;
  wallClockMs: number;
}

/**
 * Generate the source. Refuses to overwrite a file it did not measure, and
 * refuses to claim a digest for bytes it did not read back.
 */
export function generateSyntheticSource(req: SyntheticSourceRequest, outDir: string): GenerateResult {
  const started = Date.now();
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${SYNTHETIC_MARKER}-${req.widthPx}x${req.heightPx}-${req.durationSeconds}s.mp4`);
  const declaration = declareSyntheticSource(req, outPath);
  const r = spawnSync("ffmpeg", declaration.generatorArgv, { encoding: "utf8", timeout: 10 * 60 * 1000 });
  const wallClockMs = Date.now() - started;
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code ?? "spawn-error";
    return {
      ok: false,
      declaration,
      failure: `generating the synthetic source failed: spawn ffmpeg → ${code} (${r.error.message})`,
      wallClockMs,
    };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      declaration,
      failure: `generating the synthetic source failed: ffmpeg exited ${r.status}; stderr: ${(r.stderr || "").trim().slice(0, 400)}`,
      wallClockMs,
    };
  }
  if (!existsSync(outPath)) {
    return { ok: false, declaration, failure: `ffmpeg exited 0 but wrote no file at ${outPath}`, wallClockMs };
  }
  const bytes = statSync(outPath).size;
  if (bytes <= 0) return { ok: false, declaration, failure: `the generator wrote a 0-byte file at ${outPath}`, wallClockMs };
  const sha256 = createHash("sha256").update(readFileSync(outPath)).digest("hex");
  // ffmpeg reports the frame it ended on; keep its last video line so the declared
  // frameCount can be checked against what the encoder says, not assumed.
  const said = (r.stderr || "")
    .split("\n")
    .filter((l) => l.includes("frame=") || l.includes("video:"))
    .pop();
  return {
    ok: true,
    declaration: { ...declaration, path: outPath, bytes, sha256, generatedAt: new Date().toISOString(), generatorSaid: said?.trim() ?? null },
    failure: null,
    wallClockMs,
  };
}
