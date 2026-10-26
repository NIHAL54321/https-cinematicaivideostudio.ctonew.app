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
import type { RenderStage } from "./pipeline";
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
      const withSource = ctx.facts.scenes.filter((s) => s.sourcePath);
      if (withSource.length === 0) {
        throw new StageFailure(
          `encode-master cannot start: 0 of ${ctx.facts.sceneCount} scene(s) carry a source media file, so there is nothing to encode. ` +
            "A master is never invented from an empty timeline.",
        );
      }
      const listPath = join(ctx.stageDir, "timeline.ffconcat");
      writeFileSync(
        listPath,
        ["ffconcat version 1.0", ...withSource.map((s) => `file '${String(s.sourcePath).replace(/'/g, "'\\''")}'`)].join("\n") + "\n",
        "utf8",
      );
      inputArgs = ["-f", "concat", "-safe", "0", "-i", listPath];
      sourceRecord = {
        kind: "project-scenes",
        synthetic: false,
        concatList: listPath,
        sourceClips: withSource.length,
        sceneCount: ctx.facts.sceneCount,
        paths: withSource.map((s) => s.sourcePath),
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
    // anywhere still says what it is. An ordinary delivery is not stamped: its
    // title comes from the project, and inventing one here would be a claim.
    const stamp = synthetic
      ? ["-metadata", `title=SYNTHETIC ENCODER PROOF (${SYNTHETIC_MARKER})`, "-metadata", `comment=${SYNTHETIC_STATEMENT}`]
      : [];
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
    return {
      record: {
        container: probed.format.formatName,
        faststart: true,
        syntheticProof: Boolean(synthetic),
        containerTags: probed.format.tags,
        containerMarkedSynthetic: synthetic ? Object.values(probed.format.tags).some((t) => t.includes(SYNTHETIC_MARKER)) : false,
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
