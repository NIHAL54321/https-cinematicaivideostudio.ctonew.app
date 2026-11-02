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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMix } from "@/lib/mix";
import { buildSubtitles } from "@/lib/subtitles";
import { findExportPreset, resolvedSpecCore } from "@/lib/export/presets";
import { sha256OfJson } from "@/lib/export/spec-fingerprint";
import { encodeCommandPlan } from "@/lib/export/youtube-master";
import { SYNTHETIC_MARKER, SYNTHETIC_STATEMENT, type SyntheticSourceDeclaration } from "./synthetic-source";
import { downloadObjectToFile, statObjectSize } from "@/lib/storage";
import {
  planClipNormalisation,
  sourcePathKind,
  timelineTargetFromSpec,
  type AudioDecision,
  type SourcePathKind,
  type TimelineTarget,
} from "./source-clip";
import type { RenderStage } from "./pipeline";
import { deliveryProvenance } from "./delivery-provenance";
import { StageFailure, type StageExecContext, type StageFile, type StageOutcome } from "./types";

export type StageExecutor = (ctx: StageExecContext) => Promise<StageOutcome>;

/** A digest of exactly these bytes, from disk. */
export function sha256File(path: string): { bytes: number; sha256: string } {
  const bytes = statSync(path).size;
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { bytes, sha256 };
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

/** Run a binary and fail the stage with its own stderr if it exits non-zero. */
function runEncoder(bin: string, args: string[], stageId: string): void {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 15 * 60 * 1000 });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code ?? "spawn-error";
    throw new StageFailure(`${stageId}: spawn ${bin} failed — ${code} (${r.error.message})`);
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
export function measureFile(path: string, stageId: string): MeasuredFile {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.error || r.status !== 0) {
    throw new StageFailure(
      `${stageId}: ffprobe could not read ${path} (${r.error ? (r.error as NodeJS.ErrnoException).code : `exit ${r.status}`}) — ` +
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
export function measureLoudnessOfFile(path: string): { integratedLufs: number | null; truePeakDbfs: number | null; tool: string | null } {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], {
    encoding: "utf8",
    timeout: 180_000,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  const tail = out.slice(out.lastIndexOf("Summary:") === -1 ? 0 : out.lastIndexOf("Summary:"));
  const i = /Integrated loudness:[\s\S]*?\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(tail);
  const p = /True peak:[\s\S]*?\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/.exec(tail);
  const first = (r.stdout || "").split("\n").find((l) => l.includes("ffmpeg version")) ?? null;
  return {
    integratedLufs: i ? Number(i[1]) : null,
    truePeakDbfs: p ? Number(p[1]) : null,
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
  normalization: { argv: string[]; videoFilter: string; reasons: Array<{ arg: string; reason: string }> };
  normalisationWallClockMs: number;
}

export interface ClipMeasurement {
  durationSeconds: number | null;
  video: { codecName: string | null; width: number | null; height: number | null; pixFmt: string | null; avgFrameRate: string | null; bitRateKbps: number | null } | null;
  audio: { codecName: string | null; sampleRateHz: number | null; channels: number | null; bitRateKbps: number | null } | null;
  hasAudio: boolean;
}

function measureClip(path: string, stageId: string): ClipMeasurement {
  const p = measureFile(path, stageId);
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

    const sourceMeasured = measureClip(materialisedPath, "encode-master:source-measure");
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
    });
    const normStart = Date.now();
    runEncoder("ffmpeg", plan.argv, "encode-master:normalise");
    const normalisationWallClockMs = Date.now() - normStart;
    const normalizedPath = plan.argv[plan.argv.length - 1];
    if (!existsSync(normalizedPath)) {
      throw new StageFailure(`encode-master: ffmpeg exited 0 but wrote no normalised segment at ${normalizedPath}`);
    }
    const normalizedDigest = sha256File(normalizedPath);
    if (normalizedDigest.bytes <= 0) {
      throw new StageFailure(`encode-master: the normalised segment for scene #${scene.order} is 0 bytes`);
    }
    const normalizedMeasured = measureClip(normalizedPath, "encode-master:normalized-measure");
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

  /* 5 — a real encode, with the job's own resolved specification. */
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
        throw new StageFailure(
          `encode-master REFUSES to encode this project: ${missing.length} of ${ctx.facts.sceneCount} scene(s) carry no source media — ` +
            `scene(s) ${missing.map((s) => `#${s.order} (${s.id})`).join(", ")}. ` +
            `A master built from ${ctx.facts.sceneCount - missing.length} of ${ctx.facts.sceneCount} scenes would be delivered as the ` +
            `project's video while missing the rest of it, so no encode runs. Attach footage to every scene, or encode a project that has one.`,
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
          "each clip is concatenated IN FULL: Scene.durationSeconds is not applied as a trim in this build, so the master's " +
          "length is the sum of the clips' own durations, not the sum of the scenes' declared durations",
        clips: clips.map((c) => ({
          sceneId: c.sceneId,
          order: c.order,
          sourcePath: c.sourcePath,
          pathKind: c.pathKind,
          materialised: c.materialised,
          sourceMeasured: c.sourceMeasured,
          normalized: c.normalized,
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
    const argv = ["-y", "-hide_banner", ...inputArgs, ...plan.stageAttribution.encode, ...plan.stageAttribution.mux, ...tuning, out];
    const startedAt = Date.now();
    runEncoder("ffmpeg", argv, "encode-master");
    const wallClockMs = Date.now() - startedAt;
    if (!existsSync(out)) throw new StageFailure("encode-master: ffmpeg exited 0 but wrote no file at " + out);
    const measured = sha256File(out);
    if (measured.bytes <= 0) throw new StageFailure("encode-master: the encoder wrote a 0-byte file");

    // WHAT THE FILE IS, read back from the file. Not from the argv.
    const probed = measureFile(out, "encode-master");
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
        /** What this master does NOT contain, so a stage name cannot imply it. */
        deliveryFacts: synthetic
          ? null
          : {
              narration: "none — no voice provider produced a voiceover for this job",
              music: "none — nothing was mixed from a music provider",
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
    const provenance = synthetic ? null : deliveryProvenance(ctx.facts);
    const stamp = synthetic
      ? ["-metadata", `title=SYNTHETIC ENCODER PROOF (${SYNTHETIC_MARKER})`, "-metadata", `comment=${SYNTHETIC_STATEMENT}`]
      : ["-metadata", `title=${ctx.facts.title}`, ...(provenance ? ["-metadata", `comment=${provenance.comment}`] : [])];
    runEncoder("ffmpeg", ["-y", "-hide_banner", "-i", master.path, "-c", "copy", ...stamp, "-movflags", "+faststart", out], "container-mux");
    if (!existsSync(out)) throw new StageFailure("container-mux: ffmpeg exited 0 but wrote no container at " + out);
    const probed = measureFile(out, "container-mux");
    if (probed.streams.length === 0) {
      throw new StageFailure(`container-mux: ffprobe read ${out} and found no streams — the container is empty, so nothing is claimed.`);
    }
    const measured = sha256File(out);
    const v = probed.streams.find((s) => s.codecType === "video") ?? null;
    const a = probed.streams.find((s) => s.codecType === "audio") ?? null;
    const loudness = measureLoudnessOfFile(out);
    // A REAL DELIVERY MUST NOT CARRY THE SYNTHETIC MARKER. It is not a proof, and
    // a copy of it must never read as one — so the marker is looked for in the
    // tags that came back, and its presence fails the stage.
    if (!synthetic && Object.values(probed.format.tags).some((t) => t.includes(SYNTHETIC_MARKER))) {
      throw new StageFailure(
        "container-mux: the delivered container carries the synthetic-proof marker, but this job is not a synthetic proof — the file would misdescribe itself, so it is not delivered.",
      );
    }
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
        /** What the file's audio IS, said plainly, because a stage named "mux" implies more. */
        audioContent: a
          ? "the audio stream is the source clips' own audio, re-encoded to AAC at the preset's layout; no narration, music or sound effect was mixed, and no subtitle cue was burned in"
          : "this file has no audio stream at all: no narration, music or sound effect was mixed, and no subtitle cue was burned in",
        narrationProduced: false,
        musicProduced: false,
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
