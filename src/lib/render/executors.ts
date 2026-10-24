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

  /* 5 — a real encode. Gated on this machine; if the gate ever opens it spawns ffmpeg. */
  "encode-master": async (ctx) => {
    const withSource = ctx.facts.scenes.filter((s) => s.sourcePath);
    if (withSource.length === 0) {
      throw new StageFailure(
        `encode-master cannot start: 0 of ${ctx.facts.sceneCount} scene(s) carry a source media file, so there is nothing to encode. ` +
          "A master is never invented from an empty timeline.",
      );
    }
    const out = join(ctx.stageDir, "master.mp4");
    mkdirSync(ctx.stageDir, { recursive: true });
    runEncoder(
      "ffmpeg",
      [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", join(ctx.stageDir, "timeline.ffconcat"),
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        out,
      ],
      "encode-master",
    );
    if (!existsSync(out)) throw new StageFailure("encode-master: ffmpeg exited 0 but wrote no file at " + out);
    const measured = sha256File(out);
    if (measured.bytes <= 0) throw new StageFailure("encode-master: the encoder wrote a 0-byte file");
    return {
      record: { encoder: "ffmpeg libx264 crf 18", sourceClips: withSource.length, output: out, bytes: measured.bytes },
      files: [{ artefactKind: "master-video", path: out, ...measured }],
    };
  },

  /* 6 — mux, then read the container back with ffprobe. */
  "container-mux": async (ctx) => {
    const master = requireArtefact(ctx, "master-video", "container-mux");
    const out = join(ctx.stageDir, "delivered.mp4");
    mkdirSync(ctx.stageDir, { recursive: true });
    runEncoder("ffmpeg", ["-y", "-i", master.path, "-c", "copy", "-movflags", "+faststart", out], "container-mux");
    if (!existsSync(out)) throw new StageFailure("container-mux: ffmpeg exited 0 but wrote no container at " + out);
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "json", out], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (probe.error || probe.status !== 0) {
      throw new StageFailure(
        `container-mux: ffprobe could not read the container back (${probe.error ? (probe.error as NodeJS.ErrnoException).code : `exit ${probe.status}`}) — the streams are unverified, so the stage does not claim them.`,
      );
    }
    const measured = sha256File(out);
    return {
      record: { container: "mp4 faststart", ffprobeReadBack: probe.stdout.trim().slice(0, 500), bytes: measured.bytes },
      files: [{ artefactKind: "delivered-container", path: out, ...measured }],
    };
  },

  /* 7 — the digest sidecar, written next to the delivered container. */
  "checksum-artefact": async (ctx) => {
    const delivered = requireArtefact(ctx, "delivered-container", "checksum-artefact");
    const measured = sha256File(delivered.path);
    if (measured.sha256 !== delivered.sha256) {
      throw new StageFailure(
        `checksum-artefact: the delivered container's digest changed on disk (${delivered.sha256} → ${measured.sha256}); the artefact record would be a lie.`,
      );
    }
    const sidecar = `${delivered.path}.sha256`;
    writeFileSync(sidecar, `${measured.sha256}  ${delivered.path}\n`, "utf8");
    const written = sha256File(sidecar);
    return {
      record: {
        digest: measured.sha256,
        bytes: measured.bytes,
        sidecar,
        verified: "the sidecar was read back from disk after writing",
      },
      files: [{ artefactKind: "checksum-sidecar", path: sidecar, ...written }],
    };
  },
};

/** Every declared stage must have an executor — asserted by the tests. */
export function executorFor(stage: RenderStage): StageExecutor | undefined {
  return EXECUTORS[stage.id];
}
