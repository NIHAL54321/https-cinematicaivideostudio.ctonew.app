/**
 * Phase 8 block 2a — what a render job records, and what a blocked encode row
 * now prints.
 *
 * Two properties, both asserted here against the REAL runner with the encoder
 * probes injected as absent (this machine has no ffmpeg):
 *
 *   1. a gated FILE stage records `wouldRunWith` — the resolved specification and
 *      the exact argv — while `missingInput` still names the ffmpeg binary and
 *      the stage still produces nothing;
 *   2. `specMatchesRecord` compares the job's recorded digest with the catalogue's
 *      current one, so a job re-read after the preset catalogue changed says so
 *      instead of quietly showing different numbers.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRenderPipeline, type RenderStore } from "../runner";
import type { Probe, ProbeId } from "../probes";
import type { ProjectFacts, RenderJobFacts } from "../types";
import { findExportPreset, resolvedSpecCore } from "@/lib/export/presets";
import { sha256OfJson } from "@/lib/export/spec-fingerprint";

const PRESET = findExportPreset("youtube-2160p")!;
const CORE = resolvedSpecCore(PRESET);
const DIGEST = sha256OfJson(CORE);

const FACTS: ProjectFacts = {
  projectId: "p_spec",
  title: "The Future of Artificial Intelligence",
  sceneCount: 2,
  scenes: [
    { id: "s1", order: 1, durationSeconds: 5, narrationChars: 40, subtitleCount: 1, assetCount: 1, sourcePath: "/tmp/a.png" },
    { id: "s2", order: 2, durationSeconds: 5, narrationChars: 30, subtitleCount: 0, assetCount: 1, sourcePath: "/tmp/b.png" },
  ],
  scriptChars: 70,
  subtitleCueCount: 1,
  sourceMediaCount: 2,
};

interface Row {
  stageId: string;
  state: string;
  missingInput: string | null;
  output: unknown;
}

function fakeStore(job: Partial<RenderJobFacts>): { store: RenderStore; rows: Row[] } {
  const rows: Row[] = [];
  const stageOfRun = new Map<string, string>();
  let runSeq = 0;
  const full: RenderJobFacts = {
    id: "job_spec",
    projectId: FACTS.projectId,
    userId: "u1",
    presetId: PRESET.id,
    presetLabel: PRESET.label,
    presetSpec: CORE,
    presetSpecSha256: DIGEST,
    specVersion: PRESET.specVersion,
    fixture: true,
    requestedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    stopRequestedAt: null,
    stopReason: null,
    pipelineVersion: "render-pipeline/1",
    ...job,
  };
  const store: RenderStore = {
    readJob: async () => full,
    startJob: async () => {},
    finishJob: async () => {},
    createStageRun: async ({ stageId }) => {
      const id = `run-${++runSeq}`;
      stageOfRun.set(id, stageId);
      return id;
    },
    finishStageRun: async (runId, patch) => {
      rows.push({
        stageId: stageOfRun.get(runId) ?? "unknown",
        state: patch.state,
        missingInput: patch.missingInput ?? null,
        output: patch.output,
      });
    },
    createArtefact: async () => {},
    projectFacts: async () => FACTS,
  };
  return { store, rows };
}

/** The probes for a machine with no encoder: ffmpeg and ffprobe are absent. */
const PROBES: Record<ProbeId, Probe> = {
  "ffmpeg-binary": async () => ({
    ok: false,
    detail: "spawn ffmpeg -version → ENOENT (spawnSync ffmpeg ENOENT)",
    missing: "the ffmpeg binary — not installed on this machine (ENOENT)",
  }),
  "ffprobe-binary": async () => ({
    ok: false,
    detail: "spawn ffprobe -version → ENOENT",
    missing: "the ffprobe binary — not installed on this machine (ENOENT)",
  }),
  "storage-writable": async () => ({ ok: true, detail: "wrote, read back and unlinked 32 bytes", missing: null }),
  "encode-provider-keyed": async () => ({ ok: false, detail: "connected=false", missing: "a keyed encode provider" }),
  "project-has-scenes": async () => ({ ok: true, detail: "counted 2 Scene row(s)", missing: null }),
};

async function run(job: Partial<RenderJobFacts> = {}, probes: Record<ProbeId, Probe> = PROBES) {
  const { store, rows } = fakeStore(job);
  const outputRoot = mkdtempSync(join(tmpdir(), "cavs-spec-"));
  const result = await runRenderPipeline("job_spec", { store, probes, outputRoot });
  return { result, rows };
}

/** Pull the wouldRunWith payload out of whichever row carries one. */
function planOf(rows: Row[]): Record<string, any> | null {
  for (const r of rows) {
    const w = (r.output as { wouldRunWith?: Record<string, any> })?.wouldRunWith;
    if (w) return w;
  }
  return null;
}

describe("a gated file stage records the specification it would run with", () => {
  test("the encode stage is BLOCKED, names ffmpeg, and carries wouldRunWith", async () => {
    const { result, rows } = await run();
    expect(result.status).toBe("blocked");
    expect(result.halted?.stageId).toBe("encode-master");
    expect(result.halted?.missingInput).toContain("ffmpeg");
    expect(result.artefactsWritten).toBe(0);

    const encodeRow = rows.find((r) => r.stageId === "encode-master")!;
    expect(encodeRow.state).toBe("BLOCKED");
    expect(encodeRow.missingInput).toContain("the ffmpeg binary");

    const plan = planOf(rows)!;
    expect(plan.resolved).toBe(true);
    expect(plan.presetId).toBe("youtube-2160p");
    expect(plan.spec.video.codecId).toBe("hevc");
    expect(plan.spec.video.level).toBe("5.1");
    expect(plan.spec.video.rateControl.targetVideoBitrateKbps).toBe(45_000);
    expect(plan.spec.audio.loudnessTargetLufs).toBe(-14);
    expect(plan.command.binary).toBe("ffmpeg");
    expect(plan.command.args.join(" ")).toContain("+faststart");
    expect(plan.command.missingInput).toContain("ffmpeg");
    expect(plan.producedNothing).toBe(true);
  });

  test("the recorded spec and the catalogue agree, and the row says so", async () => {
    const { rows } = await run();
    const plan = planOf(rows)!;
    expect(plan.recordedSpecSha256).toBe(DIGEST);
    expect(plan.liveSpecSha256).toBe(DIGEST);
    expect(plan.specMatchesRecord).toBe(true);
    expect(plan.recordedSpec.video.codecId).toBe("hevc");
  });

  test("a job recorded under a DIFFERENT spec says the catalogue has changed", async () => {
    const { rows } = await run({ presetSpecSha256: "0".repeat(64) });
    const plan = planOf(rows)!;
    expect(plan.specMatchesRecord).toBe(false);
    expect(plan.recordedSpecSha256).toBe("0".repeat(64));
    expect(plan.liveSpecSha256).toBe(DIGEST);
  });

  test("a job whose preset is no longer in the catalogue reports that, not a spec", async () => {
    const { rows } = await run({ presetId: "legacy-tv" });
    const plan = planOf(rows)!;
    expect(plan.resolved).toBe(false);
    expect(plan.reason).toContain("not in the catalogue");
  });

  test("nothing is written and no later stage gets a row", async () => {
    const { result } = await run();
    const reached = result.stageRows.map((r) => r.stageId);
    expect(reached).toEqual(["resolve-inputs", "assemble-timeline", "audio-mix-plan", "subtitle-plan", "encode-master"]);
    expect(reached).not.toContain("container-mux");
    expect(reached).not.toContain("checksum-artefact");
    expect(result.artefactsWritten).toBe(0);
  });
});

describe("a blocked RECORD stage does not print an encode plan", () => {
  test("stage 1 blocked on the scene count carries no wouldRunWith", async () => {
    const { result, rows } = await run({}, {
      ...PROBES,
      "project-has-scenes": async () => ({ ok: false, detail: "counted 0 Scene row(s)", missing: "scenes on the project" }),
    });
    expect(result.status).toBe("blocked");
    expect(result.halted?.stageId).toBe("resolve-inputs");
    expect(result.halted?.missingInput).toContain("scenes on the project");
    expect(planOf(rows)).toBeNull();
  });
});
