/**
 * The stage EXECUTORS — what each declared stage actually does when its
 * requisites are all present.
 *
 * Four of the seven stages compute a plan and record it (they are pure and are
 * exercised by the tests and by the live proof). Three must leave a FILE on
 * disk; they spawn a real encoder and verify its output, and they refuse to
 * pretend when there is nothing to encode. Nothing here returns a made-up
 * artefact: `files` is filled only from `statSync` and a digest of bytes that
 * were really written.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildMix } from "@/lib/mix";
import { buildSubtitles } from "@/lib/subtitles";
import { musicProvider } from "@/lib/music/providers";
import { findExportPreset, resolvedSpecCore } from "@/lib/export/presets";
import { sha256OfJson } from "@/lib/export/spec-fingerprint";
import { encodeCommandPlan } from "@/lib/export/youtube-master";
import { SYNTHETIC_MARKER, SYNTHETIC_STATEMENT, type SyntheticSourceDeclaration } from "./synthetic-source";
import { downloadObjectToFile, statObjectSize } from "@/lib/storage";
import { storeDeliveredFile } from "./delivery-store";
import {
  LOUDNESS_TARGET_LUFS,
  buildMusicMixGraph,
  musicFetchRefusal,
  narrationSpansFromScenes,
  parseEbur128Summary,
} from "./music-mix";
import {
  planClipNormalisation,
  sourcePathKind,
  timelineTargetFromSpec,
  type AudioDecision,
  type SegmentTrim,
  type SourcePathKind,
  type TimelineTarget,
} from "./source-clip";
import type { RenderStage } from "./pipeline";
import { deliveryProvenance } from "./delivery-provenance";
// The refusal sentence is shared with the Export panel, so the warning a user
// reads before pressing Render is the same string this stage throws.
import { encodeRefusalSentence } from "./encode-refusal";
import { StageFailure, type StageExecContext, type StageFile, type StageOutcome } from "./types";

export type StageExecutor = (ctx: StageExecContext) => Promise<StageOutcome>;

/**
 * A digest of exactly these bytes, from disk — read in 1 MiB chunks.
 *
 * It used to `readFileSync` the whole file, which is fine for a 20-second proof
 * and not fine for a ten-minute 1080p master on a machine with ~800 MB to spare:
 * the digest would have needed the entire film in memory. Chunked reading makes
 * the cost of measuring a file independent of its size.
 */
export function sha256File(path: string): { bytes: number; sha256: string } {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  const buf = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      hash.update(buf.subarray(0, n));
      bytes += n;
    }
  } finally {
    closeSync(fd);
  }
  return { bytes, sha256: hash.digest("hex") };
}

/** Stable JSON so a fingerprint of the same inputs is the same fingerprint. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

function requireArtefact(ctx: StageExecContext, kind: string, stageId: string): StageFile {
  const file = ctx.artefacts[kind];
  if (!file) {
    // Defensive: the runner gates on this too. If we ever get here, the stage
    // must not invent a file.
    throw new StageFailure(
      `${stageId} needs the "${kind}" artefact from an earlier stage and no artefact row exists — nothing is invented.`,
    );
  }
  if (!existsSync(file.path)) {
    throw new StageFailure(`${stageId} was given "${kind}" at ${file.path}, but no file exists there any more.`);
  }
  return file;
}

/**
 * Run a child process to completion WITHOUT blocking this process's event loop.
 *
 * These used to be `spawnSync`, which parks the whole thread until the child
 * exits. The render worker runs INSIDE the app server (see
 * `src/workers/worker-boot.ts`), so a `spawnSync` encode froze every HTTP
 * request for the length of the encode: the Export panel's progress polls hung
 * and then answered in a burst, and `/api/health` did not reply until ffmpeg
 * was done. `spawn` + an awaited `close` keeps the loop free — the stage still
 * waits for the child, but the server keeps answering while it runs.
 *
 * stdout/stderr are STREAMED into bounded buffers (a ten-minute encode can print
 * a lot, and only the tail is ever read), and the timeout still kills the child
 * with SIGKILL exactly as `spawnSync`'s did.
 */
interface CapturedRun {
  status: number | null;
  stdout: string;
  stderr: string;
  error: NodeJS.ErrnoException | null;
  timedOut: boolean;
}

/** Enough for any real encoder's diagnostics; far less than a film's progress log. */
const OUTPUT_CAP_BYTES = 1024 * 1024;

function spawnCaptured(bin: string, args: string[], timeoutMs: number): Promise<CapturedRun> {
  return new Promise<CapturedRun>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    const settle = (result: CapturedRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP_BYTES) stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < OUTPUT_CAP_BYTES) stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => settle({ status: null, stdout, stderr, error: err as NodeJS.ErrnoException, timedOut }));
    child.on("close", (code) => settle({ status: code, stdout, stderr, error: null, timedOut }));
  });
}

/** Run a binary and fail the stage with its own stderr if it exits non-zero. */
async function runEncoder(bin: string, args: string[], stageId: string): Promise<void> {
  const r = await spawnCaptured(bin, args, 15 * 60 * 1000);
  if (r.error) {
    const code = r.error.code ?? "spawn-error";
    throw new StageFailure(`${stageId}: spawn ${bin} failed — ${code} (${r.error.message})`);
  }
  if (r.timedOut) {
    throw new StageFailure(
      `${stageId}: ${bin} was killed after the 15-minute stage timeout; stderr: ${(r.stderr || "").trim().slice(-400) || "(empty)"}`,
    );
  }
  if (r.status !== 0) {
    throw new StageFailure(
      `${stageId}: ${bin} exited ${r.status}; stderr: ${(r.stderr || "").trim().slice(0, 400) || "(empty)"}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* WHAT THE ENCODER'S OWN FILE SAYS, read back with ffprobe/ffmpeg     */
/* ------------------------------------------------------------------ */

export interface MeasuredStream {
  index: number;
  codecType: string | null;
  codecName: string | null;
  profile: string | null;
  level: number | null;
  width: number | null;
  height: number | null;
  pixFmt: string | null;
  avgFrameRate: string | null;
  bitRate: number | null;
  sampleRate: number | null;
  channels: number | null;
  durationSeconds: number | null;
  /** The container's own tags — where a synthetic file carries its marking. */
  tags: Record<string, string>;
}

export interface MeasuredFile {
  path: string;
  format: { formatName: string | null; durationSeconds: number | null; bitRate: number | null; sizeBytes: number | null; tags: Record<string, string> };
  streams: MeasuredStream[];
  /** Raw ffprobe JSON size, so a reader can tell a full read from a stub. */
  ffprobeJsonBytes: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const tags = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (typeof val === "string") out[k] = val;
  return out;
};

/** Measure a real file with ffprobe. Throws with ffprobe's own words when it cannot read it. */
export async function measureFile(path: string, stageId: string): Promise<MeasuredFile> {
  const r = await spawnCaptured(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    120_000,
  );
  if (r.error || r.status !== 0) {
    const why = r.error ? (r.error.code ?? "spawn-error") : r.timedOut ? "timed out after 120 s" : `exit ${r.status}`;
    throw new StageFailure(
      `${stageId}: ffprobe could not read ${path} (${why}) — ` +
        `the streams are unverified, so the stage does not claim them.`,
    );
  }
  const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
  const fmt = (parsed.format ?? {}) as Record<string, unknown>;
  const rawStreams = Array.isArray(parsed.streams) ? (parsed.streams as Record<string, unknown>[]) : [];
  return {
    path,
    format: {
      formatName: str(fmt.format_name),
      durationSeconds: num(fmt.duration),
      bitRate: num(fmt.bit_rate),
      sizeBytes: num(fmt.size),
      tags: tags(fmt.tags),
    },
    streams: rawStreams.map((s) => ({
      index: num(s.index) ?? -1,
      codecType: str(s.codec_type),
      codecName: str(s.codec_name),
      profile: str(s.profile),
      level: num(s.level),
      width: num(s.width),
      height: num(s.height),
      pixFmt: str(s.pix_fmt),
      avgFrameRate: str(s.avg_frame_rate),
      bitRate: num(s.bit_rate),
      sampleRate: num(s.sample_rate),
      channels: num(s.channels),
      durationSeconds: num(s.duration),
      tags: tags(s.tags),
    })),
    ffprobeJsonBytes: r.stdout.length,
  };
}

/**
 * Integrated loudness and true peak from an ebur128 pass — only when ffmpeg
 * actually printed both figures. A missing figure yields null and the record says
 * so; nothing is estimated from the bitrate or the tone frequency.
 */
export async function measureLoudnessOfFile(
  path: string,
): Promise<{ integratedLufs: number | null; truePeakDbfs: number | null; tool: string | null }> {
  const r = await spawnCaptured(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
    180_000,
  );
  // The figures are parsed by the shared parser (./music-mix) so the mix record
  // and this read-out cannot disagree about what ffmpeg printed.
  const parsed = parseEbur128Summary(`${r.stdout || ""}\n${r.stderr || ""}`);
  const first = (r.stdout || "").split("\n").find((l) => l.includes("ffmpeg version")) ?? null;
  return {
    integratedLufs: parsed.integratedLufs,
    truePeakDbfs: parsed.truePeakDbfs,
    tool: first?.trim().slice(0, 120) ?? null,
  };
}

/**
 * The export specification this job recorded, resolved back to a live preset —
 * and REFUSED when the preset has been edited since enqueue.
 *
 * `presetSpec`/`presetSpecSha256` are written on the job at enqueue time so the
 * numbers stay the job's numbers. Building argv from a preset that has since
 * changed would quietly run different numbers under the old job's name, so this
 * throws instead and names the two digests.
 */
function specForJob(ctx: StageExecContext, stageId: string) {
  const live = findExportPreset(ctx.job.presetId);
  if (!live) {
    throw new StageFailure(
      `${stageId}: preset "${ctx.job.presetId}" is not in the export catalogue any more, so there is no specification to run.`,
    );
  }
  if (ctx.job.presetSpecSha256 !== null) {
    const liveDigest = sha256OfJson(resolvedSpecCore(live));
    if (liveDigest !== ctx.job.presetSpecSha256) {
      throw new StageFailure(
        `${stageId}: the preset "${ctx.job.presetId}" was edited after this job was enqueued ` +
          `(recorded spec ${ctx.job.presetSpecSha256.slice(0, 12)}…, live spec ${liveDigest.slice(0, 12)}…). ` +
          `The stage will not run numbers that are not the ones the job recorded.`,
      );
    }
  }
  return live;
}

/** The synthetic declaration carried by a synthetic-proof job, or null. */
function syntheticOf(ctx: StageExecContext): SyntheticSourceDeclaration | null {
  if (!ctx.job.syntheticProof) return null;
  const d = ctx.job.syntheticSource as SyntheticSourceDeclaration | null;
  if (!d || d.kind !== "synthetic-encoder-proof-source") {
    throw new StageFailure(
      "this job is marked syntheticProof but carries no synthetic-source declaration — the marking and the input disagree, so the encode is refused.",
    );
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* REAL FOOTAGE ON THE TIMELINE (Phase 8, block 7b)                     */
/* ------------------------------------------------------------------ */

/** One scene's clip, after it has been materialised and normalised for the timeline. */
export interface PreparedClip {
  sceneId: string;
  order: number;
  sourcePath: string;
  pathKind: SourcePathKind;
  /** Where the bytes the encoder actually opened came from. */
  materialised: {
    path: string;
    from: "object-storage" | "local-filesystem";
    objectKey: string | null;
    /** What object storage itself said the object's size is (object keys only). */
    objectBytesInStorage: number | null;
    bytes: number;
    sha256: string;
    /** The digest recorded on the asset when its object was stored, if any. */
    recordedSha256: string | null;
    /** true/false when a recorded digest exists; null when the row states none. */
    digestMatchesRecord: boolean | null;
  };
  /** The clip as the provider served it, read back with ffprobe. */
  sourceMeasured: ClipMeasurement;
  /** The clip as the concat demuxer will read it. */
  normalized: ClipMeasurement & {
    path: string;
    bytes: number;
    sha256: string;
    /** true only when every parameter the timeline needs was measured as matching. */
    matchesTimelineTarget: boolean;
    targetCheck: Array<{ field: string; expected: string | number | boolean; measured: string | number | boolean | null; matches: boolean }>;
  };
  audio: AudioDecision;
  /** How the scene's declared duration governed this segment (block 8). */
  trim: SegmentTrim;
  /** The segment measured against the scene's declared duration; null when the scene declared none. */
  lengthCheck: { expectedSeconds: number; measuredSeconds: number | null; toleranceSeconds: number; matches: boolean } | null;
  normalization: { argv: string[]; videoFilter: string; reasons: Array<{ arg: string; reason: string }> };
  normalisationWallClockMs: number;
}

export interface ClipMeasurement {
  durationSeconds: number | null;
  video: { codecName: string | null; width: number | null; height: number | null; pixFmt: string | null; avgFrameRate: string | null; bitRateKbps: number | null } | null;
  audio: { codecName: string | null; sampleRateHz: number | null; channels: number | null; bitRateKbps: number | null } | null;
  hasAudio: boolean;
}

async function measureClip(path: string, stageId: string): Promise<ClipMeasurement> {
  const p = await measureFile(path, stageId);
  const v = p.streams.find((s) => s.codecType === "video") ?? null;
  const a = p.streams.find((s) => s.codecType === "audio") ?? null;
  return {
    durationSeconds: p.format.durationSeconds,
    video: v
      ? {
          codecName: v.codecName,
          width: v.width,
          height: v.height,
          pixFmt: v.pixFmt,
          avgFrameRate: v.avgFrameRate,
          bitRateKbps: v.bitRate === null ? null : Math.round(v.bitRate / 1000),
        }
      : null,
    audio: a
      ? {
          codecName: a.codecName,
          sampleRateHz: a.sampleRate,
          channels: a.channels,
          bitRateKbps: a.bitRate === null ? null : Math.round(a.bitRate / 1000),
        }
      : null,
    hasAudio: a !== null,
  };
}

/** "30000/1001" → 29.97; "30/1" → 30. Null when ffprobe's answer is not a ratio. */
export function frameRateValue(avgFrameRate: string | null): number | null {
  if (!avgFrameRate) return null;
  const m = /^(\d+)\/(\d+)$/.exec(avgFrameRate.trim());
  if (!m) return null;
  const den = Number(m[2]);
  if (!den) return null;
  return Number(m[1]) / den;
}

/**
 * MATERIALISE every scene's clip and NORMALISE it to the job's own preset.
 *
 * The caller has already refused to run when any scene has no source, so this
 * only ever sees scenes with one. Each clip is:
 *   1. read from where its `sourcePath` says it lives — an object key is
 *      downloaded out of storage into the stage directory and DIGESTED, an
 *      absolute path is opened as it is; a bare provider URL is refused, because
 *      a render does not fetch from somebody else's CDN mid-encode;
 *   2. measured with ffprobe BEFORE anything is done to it, so the record shows
 *      what the provider actually served;
 *   3. normalised with an argv derived from the preset (fit, cadence, pixel
 *      format, and a deliberate audio decision), then measured AGAIN and
 *      checked against the target. A segment whose measured parameters do not
 *      match would break the concat demuxer, so a mismatch fails the stage
 *      instead of being concatenated and hoped over.
 */
async function prepareTimelineClips(ctx: StageExecContext, target: TimelineTarget): Promise<PreparedClip[]> {
  const dir = join(ctx.stageDir, "sources");
  mkdirSync(dir, { recursive: true });
  const prepared: PreparedClip[] = [];

  for (const [i, scene] of ctx.facts.scenes.entries()) {
    const sourcePath = scene.sourcePath as string;
    const kind = sourcePathKind(sourcePath);
    const stem = `${String(i + 1).padStart(2, "0")}-${scene.id}`;

    let materialisedPath: string;
    let from: "object-storage" | "local-filesystem";
    let objectBytesInStorage: number | null = null;
    if (kind === "url") {
      throw new StageFailure(
        `encode-master: scene #${scene.order} (${scene.id}) has only a provider URL as its source ` +
          `(${sourcePath}), and no stored object. A render does not fetch footage from a provider's CDN mid-encode, ` +
          `so this clip is not on the timeline and the project is not encoded.`,
      );
    }
    if (kind === "local-path") {
      if (!existsSync(sourcePath)) {
        throw new StageFailure(
          `encode-master: scene #${scene.order} (${scene.id}) names a local file at ${sourcePath} and no file exists there any more.`,
        );
      }
      materialisedPath = sourcePath;
      from = "local-filesystem";
    } else {
      objectBytesInStorage = await statObjectSize(sourcePath);
      if (objectBytesInStorage === null) {
        throw new StageFailure(
          `encode-master: scene #${scene.order} (${scene.id}) names object key "${sourcePath}" and storage does not hold it. ` +
            `The clip is not on this machine and cannot be encoded.`,
        );
      }
      materialisedPath = join(dir, `${stem}${extOf(sourcePath)}`);
      const written = await downloadObjectToFile(sourcePath, materialisedPath);
      if (written !== objectBytesInStorage) {
        throw new StageFailure(
          `encode-master: reading "${sourcePath}" out of storage wrote ${written} bytes but storage reports ${objectBytesInStorage}.`,
        );
      }
      from = "object-storage";
    }

    const materialisedDigest = sha256File(materialisedPath);
    const recordedSha256 = scene.source?.storedSha256 ?? null;
    const digestMatchesRecord = recordedSha256 === null ? null : recordedSha256 === materialisedDigest.sha256;
    if (digestMatchesRecord === false) {
      throw new StageFailure(
        `encode-master: the bytes read for scene #${scene.order} (${scene.id}) hash to ${materialisedDigest.sha256.slice(0, 12)}… ` +
          `but the asset records ${String(recordedSha256 ?? "").slice(0, 12)}… — the clip on the timeline is not the clip that was stored, so the encode is refused.`,
      );
    }

    const sourceMeasured = await measureClip(materialisedPath, "encode-master:source-measure");
    if (!sourceMeasured.video) {
      throw new StageFailure(
        `encode-master: ffprobe found no video stream in scene #${scene.order}'s clip at ${materialisedPath} — there is no picture to encode.`,
      );
    }

    const plan = planClipNormalisation({
      inputPath: materialisedPath,
      outputPath: join(dir, `${stem}-normalized.mp4`),
      target,
      sourceHasAudio: sourceMeasured.hasAudio,
      // The scene's own declared duration is what the segment is built to.
      sceneDurationSeconds: scene.durationSeconds,
      sourceDurationSeconds: sourceMeasured.durationSeconds,
    });
    const normStart = Date.now();
    await runEncoder("ffmpeg", plan.argv, "encode-master:normalise");
    const normalisationWallClockMs = Date.now() - normStart;
    const normalizedPath = plan.argv[plan.argv.length - 1];
    if (!existsSync(normalizedPath)) {
      throw new StageFailure(`encode-master: ffmpeg exited 0 but wrote no normalised segment at ${normalizedPath}`);
    }
    const normalizedDigest = sha256File(normalizedPath);
    if (normalizedDigest.bytes <= 0) {
      throw new StageFailure(`encode-master: the normalised segment for scene #${scene.order} is 0 bytes`);
    }
    const normalizedMeasured = await measureClip(normalizedPath, "encode-master:normalized-measure");
    const fpsMeasured = frameRateValue(normalizedMeasured.video?.avgFrameRate ?? null);
    const targetCheck = [
      { field: "widthPx", expected: target.widthPx, measured: normalizedMeasured.video?.width ?? null, matches: normalizedMeasured.video?.width === target.widthPx },
      { field: "heightPx", expected: target.heightPx, measured: normalizedMeasured.video?.height ?? null, matches: normalizedMeasured.video?.height === target.heightPx },
      { field: "pixelFormat", expected: target.pixelFormat, measured: normalizedMeasured.video?.pixFmt ?? null, matches: normalizedMeasured.video?.pixFmt === target.pixelFormat },
      {
        field: "frameRate",
        expected: target.frameRate,
        measured: fpsMeasured === null ? null : Number(fpsMeasured.toFixed(3)),
        matches: fpsMeasured !== null && Math.abs(fpsMeasured - target.frameRate) < 0.01,
      },
      { field: "hasAudio", expected: true, measured: normalizedMeasured.hasAudio, matches: normalizedMeasured.hasAudio },
    ];
    const matchesTimelineTarget = targetCheck.every((c) => c.matches);
    if (!matchesTimelineTarget) {
      throw new StageFailure(
        `encode-master: the normalised segment for scene #${scene.order} does not match the timeline target ` +
          `(${targetCheck.filter((c) => !c.matches).map((c) => `${c.field}: wanted ${c.expected}, measured ${c.measured}`).join("; ")}) — ` +
          `concatenating a segment with different parameters would produce a broken master, so the stage fails instead.`,
      );
    }

    // LENGTH: the segment must be the length the scene declares. A cut that did not
    // take, or a held frame that overshot, would put a timeline in the master that
    // the project never asked for — so it fails here, naming both numbers, rather
    // than being discovered in the finished film.
    const lengthToleranceSeconds = 1 / target.frameRate + 0.05;
    const lengthCheck =
      plan.trim.outputLimitSeconds === null
        ? null
        : {
            expectedSeconds: plan.trim.outputLimitSeconds,
            measuredSeconds: normalizedMeasured.durationSeconds,
            toleranceSeconds: Number(lengthToleranceSeconds.toFixed(3)),
            matches:
              normalizedMeasured.durationSeconds !== null &&
              Math.abs(normalizedMeasured.durationSeconds - plan.trim.outputLimitSeconds) <= lengthToleranceSeconds,
          };
    if (lengthCheck && !lengthCheck.matches) {
      throw new StageFailure(
        `encode-master: the segment for scene #${scene.order} measures ${lengthCheck.measuredSeconds} s but the scene ` +
          `declares ${lengthCheck.expectedSeconds} s (tolerance ${lengthCheck.toleranceSeconds} s = one frame at ` +
          `${target.frameRate} fps plus 50 ms). A segment of the wrong length would change the master's timing, so the ` +
          `encode is refused rather than delivered with a timeline nobody declared.`,
      );
    }

    prepared.push({
      sceneId: scene.id,
      order: scene.order,
      sourcePath,
      pathKind: kind,
      materialised: {
        path: materialisedPath,
        from,
        objectKey: kind === "object-key" ? sourcePath : null,
        objectBytesInStorage,
        bytes: materialisedDigest.bytes,
        sha256: materialisedDigest.sha256,
        recordedSha256,
        digestMatchesRecord,
      },
      sourceMeasured,
      normalized: {
        path: normalizedPath,
        bytes: normalizedDigest.bytes,
        sha256: normalizedDigest.sha256,
        ...normalizedMeasured,
        matchesTimelineTarget,
        targetCheck,
      },
      audio: plan.audio,
      trim: plan.trim,
      lengthCheck,
      normalization: { argv: plan.argv, videoFilter: plan.videoFilter, reasons: plan.reasons },
      normalisationWallClockMs,
    });
  }

  return prepared;
}

/** ".mp4" for a key that ends in one, "" otherwise — the extension ffmpeg infers from. */
function extOf(key: string): string {
  const m = /(\.[a-z0-9]{2,4})$/i.exec(key);
  return m ? m[1] : ".mp4";
}

/* ------------------------------------------------------------------ */
/* THE MUSIC BED, FETCHED ONCE AND DIGESTED (BLOCK M2)                  */
/* ------------------------------------------------------------------ */

/** A ceiling on what a provider may hand this machine as one track's audio. */
const MUSIC_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Download the provider's audio to a file, server-side, and answer with the
 * bytes actually written.
 *
 * This is the ONLY place a render touches the network, and it runs in
 * `music-fetch`, never in `encode-master`: by the time the encoder starts, the
 * bed is a local file with a digest. A non-2xx, an empty body or a body larger
 * than the ceiling fails the stage — a track the provider did not serve is not
 * encoded, and a truncated one is not treated as music.
 */
async function downloadAudioToFile(url: string, outPath: string, stageId: string): Promise<number> {
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new StageFailure(
      `${stageId}: the provider did not answer within 120 s for this track's audio, so nothing was written and no bed exists.`,
    );
  }
  if (!res.ok) {
    throw new StageFailure(
      `${stageId}: the provider answered ${res.status} for this track's audio, so nothing was written and no bed exists.`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new StageFailure(`${stageId}: the provider answered ${res.status} with an empty body — 0 bytes is not a music bed.`);
  }
  if (buf.byteLength > MUSIC_DOWNLOAD_MAX_BYTES) {
    throw new StageFailure(
      `${stageId}: the provider's answer is ${buf.byteLength} bytes, over the ${MUSIC_DOWNLOAD_MAX_BYTES}-byte ceiling this ` +
        `stage will write — nothing was written, and the track is not treated as fetched.`,
    );
  }
  writeFileSync(outPath, buf);
  const written = statSync(outPath).size;
  if (written !== buf.byteLength) {
    throw new StageFailure(`${stageId}: ${buf.byteLength} bytes were received but ${written} reached ${outPath}.`);
  }
  return written;
}

export const EXECUTORS: Record<string, StageExecutor> = {
  /* 1 — read and fingerprint what the project actually holds. */
  "resolve-inputs": async (ctx) => {
    const scenes = ctx.facts.scenes.map((s) => ({
      id: s.id,
      order: s.order,
      durationSeconds: s.durationSeconds,
      narrationChars: s.narrationChars,
      sourcePath: s.sourcePath,
    }));
    const fingerprint = createHash("sha256")
      .update(canonicalJson({ projectId: ctx.facts.projectId, preset: ctx.job.presetId, scenes }))
      .digest("hex");
    return {
      record: {
        manifest: "render input manifest",
        projectId: ctx.facts.projectId,
        projectTitle: ctx.facts.title,
        presetId: ctx.job.presetId,
        presetLabel: ctx.job.presetLabel,
        sceneCount: ctx.facts.sceneCount,
        scriptChars: ctx.facts.scriptChars,
        subtitleCueCount: ctx.facts.subtitleCueCount,
        sourceMediaCount: ctx.facts.sourceMediaCount,
        fingerprint,
        fingerprintBasis: "SHA-256 of the canonical JSON of {projectId, presetId, scenes[id,order,duration,narrationChars,sourcePath]}",
      },
    };
  },

  /* 2 — cumulative timeline arithmetic over the project's own scene order. */
  "assemble-timeline": async (ctx) => {
    let cursorMs = 0;
    const clips = ctx.facts.scenes.map((s) => {
      const startMs = cursorMs;
      const durationMs = Math.max(0, Math.round((s.durationSeconds ?? 0) * 1000));
      cursorMs += durationMs;
      return { sceneId: s.id, order: s.order, startMs, endMs: cursorMs, durationMs, declaredDuration: s.durationSeconds !== null };
    });
    const undeclared = clips.filter((c) => !c.declaredDuration).length;
    return {
      record: {
        plan: "ordered clip timeline",
        clipCount: clips.length,
        totalDurationMs: cursorMs,
        firstStartMs: clips.length > 0 ? clips[0].startMs : null,
        lastEndMs: clips.length > 0 ? clips[clips.length - 1].endMs : null,
        clipsWithDeclaredDuration: clips.length - undeclared,
        clipsWithNoDeclaredDuration: undeclared,
        durationBasis:
          "Scene.durationSeconds as stored. A scene with no declared duration contributes 0 ms — the timeline does not invent a length.",
        clips,
      },
    };
  },

  /* 3 — the mix PLAN from src/lib/mix. No mixed audio file: that needs an encoder. */
  "audio-mix-plan": async (ctx) => {
    const plan = buildMix({ loudnessTarget: -14 });
    const narrationScenes = ctx.facts.scenes.filter((s) => s.narrationChars > 0).length;
    return {
      record: {
        plan: "audio mix plan (src/lib/mix buildMix)",
        loudnessTargetLufs: -14,
        trackCount: plan.tracks.length,
        trackIds: plan.tracks.map((t) => t.id),
        trackGains: plan.tracks.map((t) => ({ id: t.id, gain: t.gain })),
        scenesWithNarration: narrationScenes,
        audioFileProduced: false,
        whyNoAudioFile:
          "A mix plan is arithmetic over gains and loudness. Rendering it to an audio file needs an encoder, which this pipeline gates at the encode stage — so this stage produces no file and says so.",
      },
    };
  },

  /* 4 — the subtitle PLAN from src/lib/subtitles. Burn-in is the encoder's job. */
  "subtitle-plan": async (ctx) => {
    const narration = ctx.facts.scenes
      .map((s) => `Scene ${s.order}`)
      .join(". ");
    const plan = buildSubtitles({ text: narration.length > 0 ? narration : "" });
    return {
      record: {
        plan: "subtitle plan (src/lib/subtitles buildSubtitles)",
        cueCount: plan.cues.length,
        timingModel: plan.timingModel ?? null,
        style: plan.style ?? null,
        projectSubtitleRows: ctx.facts.subtitleCueCount,
        burnedIn: false,
        whyNotBurnedIn:
          "Burning cues into pixels is an encode operation. This stage plans the cues; the encode stage is where they would reach the frame, and it is gated.",
      },
    };
  },

  /* 5 — fetch the selected music bed, or say plainly that there is none. */
  "music-fetch": async (ctx) => {
    const music = ctx.facts.music;
    // NO SELECTION IS NOT A FAILURE: the stage still runs, and says so.
    if (!music) {
      return {
        record: {
          stage: "music-fetch",
          musicSelected: false,
          bedFetched: false,
          why: "this project has no music selection, so no bed was fetched and the encode runs the argv it ran before music could be mixed",
          mixWillApply: false,
        },
      };
    }

    // THE GATE, AT THE LAST STEP TOO. The verdict is the STORED one, read from
    // the selection's row on this run — a verdict that was a permission at
    // selection time and is not one now refuses here, in the gate's own words.
    if (!music.verdict.permitted) {
      throw new StageFailure(
        musicFetchRefusal({
          title: music.title,
          artist: music.artist,
          reason: music.verdict.reason,
          basis: music.verdict.basis,
        }),
      );
    }

    mkdirSync(ctx.stageDir, { recursive: true });
    const out = join(ctx.stageDir, "music-bed.mp3");
    let bytes: number;
    let sourceKind: "provider-url" | "local-file";

    if (music.syntheticTestAsset) {
      // A DECLARED SYNTHETIC TEST ASSET: a tone this team generated for the
      // block's proof. It is labelled as such in this record and in the job's
      // rows — it is never called music from a catalogue.
      const path = music.syntheticSourcePath;
      if (!path || !existsSync(path)) {
        throw new StageFailure(
          `music-fetch: the selection is marked a synthetic test asset and declares ${path ?? "(no path)"}, where no file exists — ` +
            `nothing is fetched and no bed is invented.`,
        );
      }
      copyFileSync(path, out);
      bytes = statSync(out).size;
      if (bytes === 0) throw new StageFailure(`music-fetch: the declared synthetic test asset at ${path} is 0 bytes.`);
      sourceKind = "local-file";
    } else {
      const provider = musicProvider(music.provider);
      bytes = await downloadAudioToFile(provider.previewUrl(music.providerTrackId), out, "music-fetch");
      sourceKind = "provider-url";
    }

    const digest = sha256File(out);
    if (digest.bytes <= 0) throw new StageFailure("music-fetch: the music bed on disk is 0 bytes — no bed exists.");
    const measured = await measureFile(out, "music-fetch");
    const loudness = await measureLoudnessOfFile(out);

    return {
      record: {
        stage: "music-fetch",
        musicSelected: true,
        bedFetched: true,
        mixWillApply: true,
        selection: {
          assetId: music.assetId,
          provider: music.provider,
          providerTrackId: music.providerTrackId,
          title: music.title,
          artist: music.artist,
          artistHandle: music.artistHandle,
          durationSecondsStated: music.durationSeconds,
          attribution: music.attribution,
          licenceText: music.licenceText,
          intendedUse: music.intendedUse,
          permalink: music.permalink,
          volume: music.volume,
        },
        /** The gate's own verdict, quoted — the same object the Music tab shows. */
        licenceVerdict: {
          permitted: music.verdict.permitted,
          reason: music.verdict.reason,
          basis: music.verdict.basis,
          attributionRequired: music.verdict.attributionRequired,
          licenceText: music.verdict.licenceText,
        },
        licenceClaimNote:
          "The licence claim is the UPLOADER's and has not been independently verified: this stage reads the verdict stored " +
          "when the track was selected and does not re-check it with the rights holder.",
        sourceKind,
        /** No provider URL is recorded: it carries the app name and is not a fact about the bed. */
        sourceUrlRecorded: false,
        syntheticTestAsset: music.syntheticTestAsset,
        syntheticStatement: music.syntheticTestAsset
          ? "SYNTHETIC TEST ASSET — a tone generated with ffmpeg for BLOCK M2's proof. It is not music from any catalogue, " +
            "and nothing in this record claims it is."
          : null,
        path: out,
        bytes: digest.bytes,
        sha256: digest.sha256,
        measured: {
          measuredBy: "ffprobe -v error -print_format json -show_format -show_streams, read back from the file on disk",
          format: measured.format.formatName,
          durationSeconds: measured.format.durationSeconds,
          audio: (() => {
            const a = measured.streams.find((s) => s.codecType === "audio") ?? null;
            return a
              ? { codecName: a.codecName, sampleRateHz: a.sampleRate, channels: a.channels, bitRateKbps: a.bitRate === null ? null : Math.round(a.bitRate / 1000) }
              : null;
          })(),
        },
        /**
         * MEASURED loudness of the bed alone — the "before" figure the mix's
         * "after" is compared with. A null is what ffmpeg did not print.
         */
        loudness: {
          label: "MEASURED on the fetched bed file with ffmpeg ebur128",
          integratedLufs: loudness.integratedLufs,
          truePeakDbfs: loudness.truePeakDbfs,
          tool: loudness.tool,
          targetLufsForTheMix: LOUDNESS_TARGET_LUFS,
        },
      },
      files: [{ artefactKind: "music-bed", path: out, ...digest }],
    };
  },

  /* 6 — a real encode, with the job's own resolved specification. */
  "encode-master": async (ctx) => {
    const spec = specForJob(ctx, "encode-master");
    const plan = encodeCommandPlan(spec);
    const synthetic = syntheticOf(ctx);
    mkdirSync(ctx.stageDir, { recursive: true });

    // THE INPUT. A synthetic-proof job encodes the declared test source and
    // nothing else; an ordinary job encodes its scenes' own media, concatenated
    // through a list this stage writes. Neither path invents a frame: when there
    // is no source, the stage fails instead of encoding a colour it made up.
    let inputArgs: string[];
    let sourceRecord: Record<string, unknown>;
    if (synthetic) {
      if (!synthetic.path || !existsSync(synthetic.path)) {
        throw new StageFailure(
          `encode-master: the job's declared synthetic source is not on disk at ${synthetic.path ?? "(no path recorded)"} — ` +
            `no encode runs, and the declaration is not treated as a file.`,
        );
      }
      const actual = sha256File(synthetic.path);
      if (synthetic.sha256 !== null && actual.sha256 !== synthetic.sha256) {
        throw new StageFailure(
          `encode-master: the synthetic source at ${synthetic.path} does not hash to the digest recorded on the job ` +
            `(${synthetic.sha256.slice(0, 12)}… vs ${actual.sha256.slice(0, 12)}…) — the declared source is not the source, so the encode is refused.`,
        );
      }
      inputArgs = ["-i", synthetic.path];
      sourceRecord = {
        kind: "synthetic-encoder-proof-source",
        synthetic: true,
        marker: SYNTHETIC_MARKER,
        path: synthetic.path,
        bytes: actual.bytes,
        sha256: actual.sha256,
        sha256MatchesDeclaration: synthetic.sha256 === actual.sha256,
        pattern: synthetic.pattern,
        tone: synthetic.tone,
        durationSeconds: synthetic.durationSeconds,
        widthPx: synthetic.widthPx,
        heightPx: synthetic.heightPx,
        frameRate: synthetic.frameRate,
        frameCount: synthetic.frameCount,
        statement: SYNTHETIC_STATEMENT,
      };
    } else {
      // A PARTIAL TIMELINE IS NEVER DELIVERED AS THE PROJECT'S VIDEO.
      // Until block 7b this filtered the scenes that had media and encoded the
      // rest, so a project with 1 of 9 scenes sourced produced a 1-scene master
      // that looked like the project. It refuses now, and names the scenes.
      const missing = ctx.facts.scenes.filter((s) => !s.sourcePath);
      if (missing.length > 0) {
        // ONE SENTENCE, ONE SOURCE (Export panel block). The same string is printed
        // by the Export panel beside its disabled queue button — the warning and
        // the refusal are the same words because they come from the same function.
        throw new StageFailure(
          encodeRefusalSentence({
            sceneCount: ctx.facts.sceneCount,
            missing: missing.map((s) => ({ id: s.id, order: s.order })),
          }),
        );
      }
      const target = timelineTargetFromSpec(spec);
      const clips = await prepareTimelineClips(ctx, target);
      const listPath = join(ctx.stageDir, "timeline.ffconcat");
      writeFileSync(
        listPath,
        ["ffconcat version 1.0", ...clips.map((c) => `file '${String(c.normalized.path).replace(/'/g, "'\\''")}'`)].join("\n") + "\n",
        "utf8",
      );
      inputArgs = ["-f", "concat", "-safe", "0", "-i", listPath];
      sourceRecord = {
        kind: "project-scenes",
        synthetic: false,
        concatList: listPath,
        sourceClips: clips.length,
        sceneCount: ctx.facts.sceneCount,
        /** Every scene in the project is on the timeline — that is now a precondition, not a hope. */
        everySceneHasSource: clips.length === ctx.facts.sceneCount,
        paths: clips.map((c) => c.materialised.path),
        normalisedPaths: clips.map((c) => c.normalized.path),
        timelineTarget: {
          widthPx: target.widthPx,
          heightPx: target.heightPx,
          frameRate: target.frameRate,
          pixelFormat: target.pixelFormat,
          sampleRateHz: target.sampleRateHz,
          channels: target.channels,
          basis: target.basis,
        },
        /** How the timeline's duration relates to the scenes' declared durations. */
        durationBasis:
          "each segment is built TO ITS SCENE'S DECLARED DURATION: a clip longer than its scene is cut at the scene's " +
          "duration (-t), and a clip shorter than its scene has its last frame held (tpad stop_mode=clone) for exactly " +
          "the shortfall. Nothing is filled with black and nothing is looped. The master's length is therefore the sum " +
          "of the scenes' declared durations, and the master is measured afterwards to show that it is.",
        clips: clips.map((c) => ({
          sceneId: c.sceneId,
          order: c.order,
          sourcePath: c.sourcePath,
          pathKind: c.pathKind,
          declaredSceneDurationSeconds:
            ctx.facts.scenes.find((f) => f.id === c.sceneId)?.durationSeconds ?? null,
          materialised: c.materialised,
          sourceMeasured: c.sourceMeasured,
          normalized: c.normalized,
          /** What was done to the clip to make it the scene's length, and why. */
          trim: c.trim,
          lengthCheck: c.lengthCheck,
          audio: c.audio,
          normalization: c.normalization,
          normalisationWallClockMs: c.normalisationWallClockMs,
          /** What the provider/asset rows said this clip is, so the record is self-describing. */
          provenance: (() => {
            const s = ctx.facts.scenes.find((f) => f.id === c.sceneId)?.source ?? null;
            return s
              ? {
                  provider: s.provider,
                  providerAssetId: s.providerAssetId,
                  author: s.author,
                  pageUrl: s.pageUrl,
                  licenseType: s.licenseType,
                  licenseSource: s.licenseSource,
                  licenseUrl: s.licenseUrl,
                  attribution: s.attribution,
                  purchasedAt: s.purchasedAt,
                  expiresAt: s.expiresAt,
                }
              : null;
          })(),
        })),
      };
    }

    const out = join(ctx.stageDir, synthetic ? `${SYNTHETIC_MARKER}-master.mp4` : "master.mp4");
    // A proof attempt may declare extra encoder arguments (never a preset's, and
    // never a project's — `synthetic` is null for anything not declared synthetic).
    const tuning = synthetic?.encoderTuning ?? [];

    /* ---------------------------------------------------------------- *
     * THE MUSIC MIX (BLOCK M2)
     *
     * The bed was fetched, digested and measured by the `music-fetch` stage,
     * so this stage opens a LOCAL file: no network here. When the project has a
     * permitted selection, this stage will not deliver a file that silently
     * lacks it — a missing bed, or a stored verdict that is no longer a
     * permission, refuses the encode in the same words the fetch stage uses.
     *
     * With no selection, `musicArgs` and `filterArgs` are empty and the argv is
     * exactly the one this stage spawned before music could be mixed.
     * ---------------------------------------------------------------- */
    const music = ctx.facts.music;
    const bed = ctx.artefacts["music-bed"] ?? null;
    const narration = narrationSpansFromScenes(
      ctx.facts.scenes.map((s) => ({ durationSeconds: s.durationSeconds, narrationChars: s.narrationChars })),
    );
    let mixPlan: ReturnType<typeof buildMusicMixGraph> | null = null;
    if (!synthetic && music) {
      if (!music.verdict.permitted) {
        throw new StageFailure(
          musicFetchRefusal({
            title: music.title,
            artist: music.artist,
            reason: music.verdict.reason,
            basis: music.verdict.basis,
          }),
        );
      }
      if (!bed) {
        throw new StageFailure(
          `encode-master: this project has a permitted music selection ("${music.title}") and no music-bed artefact exists, ` +
            `so the encode would deliver a file without the music the project selected. Nothing is encoded; re-run from ` +
            `the music-fetch stage.`,
        );
      }
      const bedMeasured = await measureFile(bed.path, "encode-master:music-measure");
      mixPlan = buildMusicMixGraph({
        music,
        bedSeconds: bedMeasured.format.durationSeconds,
        targetSeconds: narration.totalMs / 1000,
        narration: narration.spans,
        sampleRateHz: spec.audio.sampleRateHz,
        channels: spec.audio.channels,
      });
      if (!mixPlan.applied) {
        throw new StageFailure(
          `encode-master: a music bed exists but the mix graph was not built — ${mixPlan.why ?? "no reason recorded"}. ` +
            `Delivering a file that silently lacks the selected music is not an option, so nothing is encoded.`,
        );
      }
    }
    const musicArgs = mixPlan?.applied && bed ? [...mixPlan.inputArgs, "-i", bed.path] : [];
    const filterArgs =
      mixPlan?.applied && mixPlan.filterComplex ? ["-filter_complex", mixPlan.filterComplex, ...mixPlan.maps] : [];

    const argv = [
      "-y",
      "-hide_banner",
      ...inputArgs,
      ...musicArgs,
      ...filterArgs,
      ...plan.stageAttribution.encode,
      ...plan.stageAttribution.mux,
      ...tuning,
      out,
    ];
    const startedAt = Date.now();
    await runEncoder("ffmpeg", argv, "encode-master");
    const wallClockMs = Date.now() - startedAt;
    if (!existsSync(out)) throw new StageFailure("encode-master: ffmpeg exited 0 but wrote no file at " + out);
    const measured = sha256File(out);
    if (measured.bytes <= 0) throw new StageFailure("encode-master: the encoder wrote a 0-byte file");

    // MEASURED loudness of the MIXED audio, read back from the file that was just
    // written — never estimated from the bed's own level or from the volume
    // filter's number. Null when ffmpeg printed no figure.
    const mixLoudness = mixPlan?.applied ? await measureLoudnessOfFile(out) : null;

    // WHAT THE FILE IS, read back from the file. Not from the argv.
    const probed = await measureFile(out, "encode-master");
    const v = probed.streams.find((s) => s.codecType === "video") ?? null;
    const a = probed.streams.find((s) => s.codecType === "audio") ?? null;

    return {
      record: {
        encoder: `${plan.binary} ${spec.video.codec} (${spec.video.codecFamily}) @ ${spec.video.profile}`,
        presetId: spec.id,
        presetLabel: spec.label,
        specVersion: spec.specVersion,
        presetSpecSha256: ctx.job.presetSpecSha256,
        specMatchesRecord: true,
        source: sourceRecord,
        output: out,
        bytes: measured.bytes,
        sha256: measured.sha256,
        wallClockMs,
        argv,
        /** Extra encoder arguments this proof attempt declared; [] for a shipped preset's own settings. */
        encoderTuning: tuning,
        argvProvenance: "built from the job's recorded resolved specification via encodeCommandPlan() — not hand-typed",
        /**
         * THE MUSIC MIX (BLOCK M2), with the numbers it was built from and the
         * file's own measurement beside the target. When no music is selected
         * this block says so and the argv above carries no music input.
         */
        musicMix: mixPlan
          ? {
              applied: true,
              selection: {
                assetId: music?.assetId ?? null,
                provider: music?.provider ?? null,
                providerTrackId: music?.providerTrackId ?? null,
                title: music?.title ?? null,
                artist: music?.artist ?? null,
                attribution: music?.attribution ?? null,
                licenceText: music?.licenceText ?? null,
                intendedUse: music?.intendedUse ?? null,
                syntheticTestAsset: music?.syntheticTestAsset ?? false,
              },
              licenceVerdict: music
                ? { permitted: music.verdict.permitted, reason: music.verdict.reason, basis: music.verdict.basis }
                : null,
              volume: mixPlan.volume,
              volumeSource:
                music?.volume === null || music?.volume === undefined
                  ? "DEFAULT_MIX.musicVolume (src/lib/music/ducking.ts) — the project set no level"
                  : "ProjectSettings.musicDefaults.volume",
              fadeInMs: mixPlan.fadeInMs,
              fadeOutMs: mixPlan.fadeOutMs,
              fit: mixPlan.fit,
              fitSentence: mixPlan.fitSentence,
              bedSeconds: mixPlan.bedSeconds,
              targetSeconds: mixPlan.targetSeconds,
              duckingApplied: mixPlan.duckingApplied,
              duckingSentence: mixPlan.duckingSentence,
              ducking: mixPlan.ducking,
              narrationBasis: narration.basis,
              narrationSpans: narration.spans,
              filterComplex: mixPlan.filterComplex,
              inputArgs: mixPlan.inputArgs,
              /** MEASURED on the master this stage just wrote, beside the target. */
              measuredLoudness: mixLoudness
                ? {
                    label: "MEASURED on the encoded master with ffmpeg ebur128 — not estimated",
                    integratedLufs: mixLoudness.integratedLufs,
                    truePeakDbfs: mixLoudness.truePeakDbfs,
                    targetLufs: LOUDNESS_TARGET_LUFS,
                    deltaFromTargetLufs:
                      mixLoudness.integratedLufs === null
                        ? null
                        : Math.round((mixLoudness.integratedLufs - LOUDNESS_TARGET_LUFS) * 10) / 10,
                    tool: mixLoudness.tool,
                  }
                : null,
            }
          : {
              applied: false,
              musicSelected: Boolean(music),
              why: synthetic
                ? "this job encodes a declared synthetic source, so no music mix applies to it"
                : "the project has no music selection: the argv carries no music input and no filter graph",
            },
        /** What this master does NOT contain, so a stage name cannot imply it. */
        deliveryFacts: synthetic
          ? null
          : {
              narration: "none — no voice provider produced a voiceover for this job",
              music: mixPlan?.applied
                ? `the selected track "${music?.title ?? "(untitled)"}" is mixed in (see musicMix above); its licence claim is the uploader's and unverified`
                : "none — nothing was mixed from a music provider",
              subtitles: "none burned in, none muxed",
              screening: "not screened and not cleared",
              aiGeneration: "not AI-generated: stock footage from the providers named in `source.clips[].provenance`, edited by this pipeline",
            },
        measured: {
          measuredBy: "ffprobe -v error -print_format json -show_format -show_streams, read back from the file on disk",
          format: probed.format.formatName,
          durationSeconds: probed.format.durationSeconds,
          overallBitRateKbps: probed.format.bitRate === null ? null : Math.round(probed.format.bitRate / 1000),
          video: v
            ? {
                codecName: v.codecName,
                profile: v.profile,
                level: v.level,
                widthPx: v.width,
                heightPx: v.height,
                pixFmt: v.pixFmt,
                avgFrameRate: v.avgFrameRate,
                bitRateKbps: v.bitRate === null ? null : Math.round(v.bitRate / 1000),
              }
            : null,
          audio: a
            ? { codecName: a.codecName, sampleRateHz: a.sampleRate, channels: a.channels, bitRateKbps: a.bitRate === null ? null : Math.round(a.bitRate / 1000) }
            : null,
        },
      },
      files: [{ artefactKind: "master-video", path: out, ...measured }],
    };
  },

  /* 6 — mux, stamp the container, then read it back with ffprobe. */
  "container-mux": async (ctx) => {
    const master = requireArtefact(ctx, "master-video", "container-mux");
    const synthetic = syntheticOf(ctx);
    const out = join(ctx.stageDir, synthetic ? `${SYNTHETIC_MARKER}-delivered.mp4` : "delivered.mp4");
    mkdirSync(ctx.stageDir, { recursive: true });
    // A synthetic file is stamped IN ITS OWN CONTAINER, so a copy of the file
    // anywhere still says what it is. An ordinary delivery is stamped with the
    // PROJECT'S title and a comment generated from its scenes' own provenance
    // rows (block 7b) — never with the synthetic marker, and never with a claim
    // no row supports.
    /* WAS MUSIC ACTUALLY MIXED? Read from the artefacts and the project's own
     * facts — never from the fact that a track is selected. The mix happens in
     * the ENCODE stage; this stage copies the container, so it can only report
     * what the encode stage's bed artefact and the stored verdict say. */
    const musicMixed = !synthetic && Boolean(ctx.artefacts["music-bed"]) && ctx.facts.music?.verdict.permitted === true;
    const musicFact = musicMixed ? ctx.facts.music : null;
    const provenance = synthetic ? null : deliveryProvenance(ctx.facts, musicMixed);
    const stamp = synthetic
      ? ["-metadata", `title=SYNTHETIC ENCODER PROOF (${SYNTHETIC_MARKER})`, "-metadata", `comment=${SYNTHETIC_STATEMENT}`]
      : ["-metadata", `title=${ctx.facts.title}`, ...(provenance ? ["-metadata", `comment=${provenance.comment}`] : [])];
    await runEncoder("ffmpeg", ["-y", "-hide_banner", "-i", master.path, "-c", "copy", ...stamp, "-movflags", "+faststart", out], "container-mux");
    if (!existsSync(out)) throw new StageFailure("container-mux: ffmpeg exited 0 but wrote no container at " + out);
    const probed = await measureFile(out, "container-mux");
    if (probed.streams.length === 0) {
      throw new StageFailure(`container-mux: ffprobe read ${out} and found no streams — the container is empty, so nothing is claimed.`);
    }
    const measured = sha256File(out);
    const v = probed.streams.find((s) => s.codecType === "video") ?? null;
    const a = probed.streams.find((s) => s.codecType === "audio") ?? null;
    const loudness = await measureLoudnessOfFile(out);
    // A REAL DELIVERY MUST NOT CARRY THE SYNTHETIC MARKER. It is not a proof, and
    // a copy of it must never read as one — so the marker is looked for in the
    // tags that came back, and its presence fails the stage.
    if (!synthetic && Object.values(probed.format.tags).some((t) => t.includes(SYNTHETIC_MARKER))) {
      throw new StageFailure(
        "container-mux: the delivered container carries the synthetic-proof marker, but this job is not a synthetic proof — the file would misdescribe itself, so it is not delivered.",
      );
    }

    /* A PRODUCED VIDEO THAT LIVES ONLY IN /tmp IS NOT A PRODUCED VIDEO (block 8).
     * Render output sits under RENDER_OUTPUT_DIR, which a machine reset wipes, so
     * the delivered container is written to this business's own object storage
     * here — after it has been measured, and with the object read back out and
     * hashed before the stage may succeed. A synthetic proof is NOT stored: it is
     * a labelled encoder test, not a delivery, and nothing about it belongs in the
     * download surface's durable store. */
    const durable = synthetic
      ? null
      : await storeDeliveredFile({
          userId: ctx.job.userId,
          jobId: ctx.job.id,
          kind: "delivered-container",
          path: out,
          bytes: measured.bytes,
          sha256: measured.sha256,
        });

    /* AND THE MASTER IS FREED. The delivered container has been copied, measured
     * and stored durably, so the intermediate master — the largest file this
     * pipeline makes — is deleted here rather than left to fill a machine with
     * ~1.3 GB of disk. Its artefact row stays: the row records what was produced,
     * and the "produced but gone" state is the honest one for a file deliberately
     * removed after it had been superseded. */
    const masterFreed = synthetic
      ? null
      : (() => {
          const bytes = statSync(master.path).size;
          unlinkSync(master.path);
          return {
            path: master.path,
            bytes,
            sha256: master.sha256,
            freedAt: new Date().toISOString(),
            why:
              "the master was superseded by the delivered container, which has been measured and stored durably; " +
              "keeping both would double the disk this job needs on a machine with ~1.3 GB free",
            masterArtefactStateAfterFreeing:
              "the master-video artefact row remains and its file is gone — the download centre reports that as \"produced but gone\", which is what it is",
          };
        })();

    return {
      record: {
        container: probed.format.formatName,
        faststart: true,
        syntheticProof: Boolean(synthetic),
        containerTags: probed.format.tags,
        containerMarkedSynthetic: synthetic ? Object.values(probed.format.tags).some((t) => t.includes(SYNTHETIC_MARKER)) : false,
        /** What this container was told about itself, and where each sentence came from. */
        titleWritten: synthetic ? `SYNTHETIC ENCODER PROOF (${SYNTHETIC_MARKER})` : ctx.facts.title,
        provenanceCommentWritten: provenance?.comment ?? null,
        provenance: provenance
          ? {
              providers: provenance.providers,
              everySceneHasProvenance: provenance.everySceneHasProvenance,
              generatedFrom: "the scenes' own StockAsset / LicensingMetadata rows, one credit clause per scene",
              sources: provenance.sources,
              absences: provenance.absences,
            }
          : null,
        /** The durable copy of this container, and how it was proved to be the same bytes. */
        durable,
        /** The intermediate master, freed after the delivered container superseded it. */
        masterFreed,
        /** What the file's audio IS, said plainly, because a stage named "mux" implies more. */
        audioContent: musicFact
          ? `the audio stream is the source clips' own audio mixed with the selected track "${musicFact.title}" at the ` +
            `project's music level, with fades, fitted to the master's length and ducked where the scene rows give narration ` +
            `timing; no narration and no sound effect was mixed, and no subtitle cue was burned in`
          : a
            ? "the audio stream is the source clips' own audio, re-encoded to AAC at the preset's layout; no narration, music or sound effect was mixed, and no subtitle cue was burned in"
            : "this file has no audio stream at all: no narration, music or sound effect was mixed, and no subtitle cue was burned in",
        narrationProduced: false,
        musicProduced: musicMixed,
        /** The music credit this container carries, from the selection's own rows. */
        musicProvenance: musicFact
          ? {
              title: musicFact.title,
              artist: musicFact.artist,
              artistHandle: musicFact.artistHandle,
              attribution: musicFact.attribution,
              licenceText: musicFact.licenceText,
              intendedUse: musicFact.intendedUse,
              provider: musicFact.provider,
              providerTrackId: musicFact.providerTrackId,
              permalink: musicFact.permalink,
              syntheticTestAsset: musicFact.syntheticTestAsset,
              licenceClaimNote:
                "the licence claim is the uploader's and has not been independently verified; a licence record is not a clearance",
            }
          : null,
        subtitlesBurnedIn: false,
        screenedOrCleared: false,
        screeningStatement: "No screening or clearance was performed on this file or on its source clips. A licence record is not a clearance.",
        ffprobeReadBack: {
          streams: probed.streams.length,
          durationSeconds: probed.format.durationSeconds,
          overallBitRateKbps: probed.format.bitRate === null ? null : Math.round(probed.format.bitRate / 1000),
          video: v ? { codecName: v.codecName, profile: v.profile, level: v.level, widthPx: v.width, heightPx: v.height, avgFrameRate: v.avgFrameRate, pixFmt: v.pixFmt } : null,
          audio: a ? { codecName: a.codecName, sampleRateHz: a.sampleRate, channels: a.channels, bitRateKbps: a.bitRate === null ? null : Math.round(a.bitRate / 1000) } : null,
        },
        loudness,
        bytes: measured.bytes,
      },
      files: [{ artefactKind: "delivered-container", path: out, ...measured }],
    };
  },

  /* 7 — the digest sidecar, written next to the delivered container. */
  "checksum-artefact": async (ctx) => {
    const delivered = requireArtefact(ctx, "delivered-container", "checksum-artefact");
    const synthetic = syntheticOf(ctx);
    const measured = sha256File(delivered.path);
    if (measured.sha256 !== delivered.sha256) {
      throw new StageFailure(
        `checksum-artefact: the delivered container's digest changed on disk (${delivered.sha256} → ${measured.sha256}); the artefact record would be a lie.`,
      );
    }
    const sidecar = `${delivered.path}.sha256`;
    writeFileSync(sidecar, `${measured.sha256}  ${delivered.path}\n`, "utf8");
    const written = sha256File(sidecar);
    // Read the sidecar back the way a later reader would, and compare the digest
    // it carries with a fresh digest of the file it names. A sidecar that merely
    // repeats an in-memory string would prove nothing.
    const sidecarText = readFileSync(sidecar, "utf8").trim();
    const [sidecarDigest, sidecarPath] = sidecarText.split(/\s+/);
    const recomputed = sha256File(sidecarPath);
    return {
      record: {
        digest: measured.sha256,
        bytes: measured.bytes,
        sidecar,
        syntheticProof: Boolean(synthetic),
        sidecarDigest,
        sidecarNamesPath: sidecarPath,
        digestMatchesFile: sidecarDigest === recomputed.sha256 && recomputed.sha256 === measured.sha256,
        verified: "the sidecar was read back from disk, and the digest it names was recomputed from the file it names",
      },
      files: [{ artefactKind: "checksum-sidecar", path: sidecar, ...written }],
    };
  },
};

/** Every declared stage must have an executor — asserted by the tests. */
export function executorFor(stage: RenderStage): StageExecutor | undefined {
  return EXECUTORS[stage.id];
}
