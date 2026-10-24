/**
 * Phase 8 block 1 — the render pipeline's spine, held to its own rules.
 *
 * What is pinned here:
 *   - the declaration is coherent (unique ids, contiguous order, weights sum to
 *     100, every probe it names exists, every stage has an executor, every
 *     `file` stage names an artefact kind and is gated by at least one probe);
 *   - status and progress are DERIVED from stage rows and nothing else;
 *   - a gated stage blocks the pipeline, names the missing input, and leaves NO
 *     row for the stages after it and NO artefact;
 *   - the NEGATIVE CONTROLS: a stage that claims a file it did not write, writes
 *     nothing, writes a mismatched digest, or returns an empty record, is
 *     FAILED — never "succeeded";
 *   - a stop is a real stop with its reason stored;
 *   - and the whole pipeline DOES complete when every requisite is present, so
 *     the gate is a gate and not a wall.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PIPELINE_STAGES,
  PIPELINE_WEIGHT_TOTAL,
  deriveJobStatus,
  deriveProgress,
  type RenderStage,
  type StageRowView,
  type StageState,
} from "../pipeline";
import { PROBES, runProbe, type Probe, type ProbeId } from "../probes";
import { EXECUTORS } from "../executors";
import { runRenderPipeline, type RenderStore } from "../runner";
import type { ProjectFacts, RenderJobFacts, StageFile } from "../types";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const FACTS: ProjectFacts = {
  projectId: "proj1",
  title: "FIXTURE — pipeline test project",
  sceneCount: 3,
  scenes: [
    { id: "s1", order: 0, durationSeconds: 5, narrationChars: 40, subtitleCount: 2, assetCount: 1, sourcePath: "s3://a.mp4" },
    { id: "s2", order: 1, durationSeconds: 7, narrationChars: 55, subtitleCount: 3, assetCount: 1, sourcePath: "s3://b.mp4" },
    { id: "s3", order: 2, durationSeconds: null, narrationChars: 12, subtitleCount: 0, assetCount: 0, sourcePath: null },
  ],
  scriptChars: 107,
  subtitleCueCount: 5,
  sourceMediaCount: 2,
};

interface MemRow {
  id: string;
  stageId: string;
  sequence: number;
  state: StageState;
  startedAt: Date;
  finishedAt: Date | null;
  blockedReason: string | null;
  missingInput: string | null;
  errorMessage: string | null;
  output: unknown;
  artefactCount: number;
}

function memoryStore(init: { stopRequestedAt?: Date | null; stopReason?: string | null } = {}) {
  let job: RenderJobFacts = {
    id: "job1",
    projectId: FACTS.projectId,
    userId: "user1",
    presetId: "youtube-2160p",
    presetLabel: "YouTube 4K (2160p SDR)",
    pipelineVersion: "render-pipeline/1",
    fixture: true,
    requestedAt: new Date(0),
    startedAt: null,
    finishedAt: null,
    stopRequestedAt: init.stopRequestedAt ?? null,
    stopReason: init.stopReason ?? null,
  };
  const rows: MemRow[] = [];
  const artefacts: Array<StageFile & { stageId: string }> = [];
  let seq = 0;
  const store: RenderStore = {
    async readJob() {
      return job;
    },
    async startJob(_id, at) {
      job = { ...job, startedAt: job.startedAt ?? at };
    },
    async finishJob(_id, at) {
      job = { ...job, finishedAt: at };
    },
    async createStageRun({ stageId, sequence, startedAt }) {
      const id = `run${++seq}`;
      rows.push({
        id,
        stageId,
        sequence,
        state: "RUNNING",
        startedAt,
        finishedAt: null,
        blockedReason: null,
        missingInput: null,
        errorMessage: null,
        output: null,
        artefactCount: 0,
      });
      return id;
    },
    async finishStageRun(runId, patch) {
      const row = rows.find((r) => r.id === runId);
      if (!row) throw new Error(`no row ${runId}`);
      row.state = patch.state;
      row.finishedAt = patch.finishedAt;
      row.blockedReason = patch.blockedReason ?? null;
      row.missingInput = patch.missingInput ?? null;
      row.errorMessage = patch.errorMessage ?? null;
      row.output = patch.output ?? null;
      row.artefactCount = patch.artefactCount;
    },
    async createArtefact({ stageId, file }) {
      artefacts.push({ ...file, stageId });
    },
    async projectFacts() {
      return FACTS;
    },
  };
  return { store, rows, artefacts, job: () => job };
}

/** Every probe answers ok — used to prove the pipeline CAN finish. */
function allOkProbes(): Record<ProbeId, Probe> {
  const ids: ProbeId[] = ["project-has-scenes", "storage-writable", "ffmpeg-binary", "ffprobe-binary", "encode-provider-keyed"];
  return Object.fromEntries(ids.map((id) => [id, async () => ({ ok: true, detail: `${id}: forced ok for this test`, missing: null })])) as Record<
    ProbeId,
    Probe
  >;
}

function failingProbe(id: ProbeId, missing: string): Probe {
  return async () => ({ ok: false, detail: `${id}: forced failure for this test`, missing });
}

/** A real file written to a temp dir, with its real digest. */
function writeRealFile(dir: string, name: string, body: string): StageFile {
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return { artefactKind: "unused", path, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
}

/** Executors that really write the files the file stages declare. */
function realFileExecutors(dir: string): Record<string, (ctx: { stageDir: string; artefacts: Record<string, StageFile> }) => Promise<unknown>> {
  return {
    "encode-master": async () => {
      const f = writeRealFile(dir, "master.mp4", "FAKE-MP4-BYTES-FOR-TEST");
      return { record: { encoder: "test double", bytes: f.bytes }, files: [{ ...f, artefactKind: "master-video" }] };
    },
    "container-mux": async () => {
      const f = writeRealFile(dir, "delivered.mp4", "FAKE-CONTAINER-BYTES");
      return { record: { container: "test double" }, files: [{ ...f, artefactKind: "delivered-container" }] };
    },
    "checksum-artefact": async () => {
      const f = writeRealFile(dir, "delivered.mp4.sha256", "digest sidecar");
      return { record: { sidecar: f.path }, files: [{ ...f, artefactKind: "checksum-sidecar" }] };
    },
  };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "cavs-render-test-"));
}

/* ------------------------------------------------------------------ */
/* 1 — the declaration                                                 */
/* ------------------------------------------------------------------ */

describe("the pipeline declaration", () => {
  test("stage ids are unique and the order is contiguous from 1", () => {
    const ids = PIPELINE_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PIPELINE_STAGES.map((s) => s.sequence)).toEqual(PIPELINE_STAGES.map((_, i) => i + 1));
  });

  test("weights sum to exactly 100, so a percentage means something", () => {
    expect(PIPELINE_WEIGHT_TOTAL).toBe(100);
  });

  test("every probe a stage names is registered — no stage names a capability that does not exist", () => {
    for (const stage of PIPELINE_STAGES) {
      for (const req of stage.requires) expect(PROBES[req.probeId]).toBeDefined();
      for (const id of stage.reports ?? []) expect(PROBES[id]).toBeDefined();
    }
  });

  test("every stage has an executor — a declared stage does something", () => {
    for (const stage of PIPELINE_STAGES) expect(EXECUTORS[stage.id]).toBeDefined();
  });

  test("every FILE stage names its artefact kind AND is gated by at least one probe", () => {
    const fileStages = PIPELINE_STAGES.filter((s) => s.produces.kind === "file");
    expect(fileStages.length).toBe(3);
    for (const stage of fileStages) {
      expect(stage.produces.artefactKind).toBeTruthy();
      // A file stage with no requisite could "run" with nothing present.
      expect(stage.requires.length).toBeGreaterThan(0);
    }
  });

  test("a stage can only require an artefact from an EARLIER stage", () => {
    for (const stage of PIPELINE_STAGES) {
      if (!stage.requiresArtefactOf) continue;
      const producer = PIPELINE_STAGES.find((s) => s.id === stage.requiresArtefactOf!.stageId);
      expect(producer).toBeDefined();
      expect(producer!.sequence).toBeLessThan(stage.sequence);
      expect(producer!.produces.artefactKind).toBe(stage.requiresArtefactOf.artefactKind);
    }
  });

  test("no stage carries a hand-typed capability boolean", () => {
    for (const stage of PIPELINE_STAGES) {
      const keys = Object.keys(stage);
      for (const forbidden of ["canRun", "available", "enabled", "supported", "works"]) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2 — status and progress are DERIVED                                 */
/* ------------------------------------------------------------------ */

describe("derived status and progress", () => {
  const row = (stageId: string, state: StageState): StageRowView => ({
    stageId,
    sequence: PIPELINE_STAGES.find((s) => s.id === stageId)!.sequence,
    state,
  });

  test("no rows at all is queued — the only state before the worker touches it", () => {
    expect(deriveJobStatus([])).toBe("queued");
    expect(deriveProgress([]).percent).toBe(0);
  });

  test("four succeeded stages of seven is running, never succeeded", () => {
    const rows = ["resolve-inputs", "assemble-timeline", "audio-mix-plan", "subtitle-plan"].map((id) => row(id, "SUCCEEDED"));
    expect(deriveJobStatus(rows)).toBe("running");
  });

  test("a BLOCKED row makes the job blocked, a FAILED row makes it failed, a STOPPED row stopped", () => {
    expect(deriveJobStatus([row("encode-master", "BLOCKED")])).toBe("blocked");
    expect(deriveJobStatus([row("encode-master", "FAILED")])).toBe("failed");
    expect(deriveJobStatus([row("container-mux", "STOPPED")])).toBe("stopped");
    // A failure outranks a block: something that ran and broke is worse news.
    expect(deriveJobStatus([row("encode-master", "BLOCKED"), row("container-mux", "FAILED")])).toBe("failed");
  });

  test("succeeded requires EVERY declared stage to have a SUCCEEDED row", () => {
    const all = PIPELINE_STAGES.map((s) => row(s.id, "SUCCEEDED"));
    expect(deriveJobStatus(all)).toBe("succeeded");
    expect(deriveJobStatus(all.slice(0, -1))).toBe("running");
  });

  test("progress is the weight of succeeded stages and the arithmetic is printed", () => {
    const rows = ["resolve-inputs", "assemble-timeline", "audio-mix-plan", "subtitle-plan"].map((id) => row(id, "SUCCEEDED"));
    const p = deriveProgress(rows);
    expect(p.percent).toBe(45);
    expect(p.earnedWeight).toBe(45);
    expect(p.totalWeight).toBe(100);
    expect(p.arithmetic).toContain("(10 + 15 + 10 + 10) / 100");
    expect(p.arithmetic).toContain("no timer");
  });

  test("a blocked stage earns no weight and is listed with the reason", () => {
    const rows = [row("resolve-inputs", "SUCCEEDED"), row("assemble-timeline", "SUCCEEDED"), row("encode-master", "BLOCKED")];
    const p = deriveProgress(rows);
    expect(p.percent).toBe(25);
    expect(p.uncounted.map((u) => u.stageId)).toContain("encode-master");
  });
});

/* ------------------------------------------------------------------ */
/* 3 — the gate, and the negative controls                             */
/* ------------------------------------------------------------------ */

describe("gating and the negative controls", () => {
  test("a gated stage BLOCKS, names the missing input, and the later stages get no row", async () => {
    const { store, rows, artefacts } = memoryStore();
    const dir = tmp();
    try {
      const result = await runRenderPipeline("job1", {
        store,
        probes: { ...allOkProbes(), "ffmpeg-binary": failingProbe("ffmpeg-binary", "ffmpeg binary — not installed on this machine (ENOENT)") },
        executors: { ...EXECUTORS, ...realFileExecutors(dir) } as never,
        outputRoot: dir,
      });
      expect(result.status).toBe("blocked");
      expect(result.halted?.stageId).toBe("encode-master");
      expect(result.halted?.state).toBe("BLOCKED");
      expect(result.halted?.missingInput).toContain("ffmpeg binary");
      // Four plan stages ran, the encode stage is the blocked one, and the two
      // after it have NO row at all.
      expect(rows.map((r) => r.stageId)).toEqual([
        "resolve-inputs",
        "assemble-timeline",
        "audio-mix-plan",
        "subtitle-plan",
        "encode-master",
      ]);
      expect(rows.some((r) => r.stageId === "container-mux")).toBe(false);
      expect(rows.some((r) => r.stageId === "checksum-artefact")).toBe(false);
      expect(artefacts.length).toBe(0);
      expect(result.artefactsWritten).toBe(0);
      expect(result.progress.percent).toBe(45);
      expect(rows.find((r) => r.stageId === "encode-master")!.blockedReason).toContain("Nothing was run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NEGATIVE CONTROL: a file stage that returns no file is FAILED, not succeeded, and writes no artefact", async () => {
    const { store, rows, artefacts } = memoryStore();
    const dir = tmp();
    const lyingStages: RenderStage[] = [
      {
        id: "liar",
        sequence: 1,
        title: "A stage that promises a file",
        consumes: [],
        produces: { kind: "file", label: "a file it will not write", artefactKind: "liar-file" },
        weight: 100,
        requires: [],
        note: "test double",
      },
    ];
    try {
      const result = await runRenderPipeline("job1", {
        store,
        stages: lyingStages,
        probes: allOkProbes(),
        executors: { liar: async () => ({ record: { ok: true } }) },
        outputRoot: dir,
      });
      expect(result.status).toBe("failed");
      expect(rows[0].state).toBe("FAILED");
      expect(rows[0].errorMessage).toContain("does not succeed without its declared artefact");
      expect(artefacts.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NEGATIVE CONTROL: a file stage naming a path that does not exist is FAILED", async () => {
    const { store, rows, artefacts } = memoryStore();
    const dir = tmp();
    const stage: RenderStage = {
      id: "ghost",
      sequence: 1,
      title: "A stage that points at nothing",
      consumes: [],
      produces: { kind: "file", label: "a phantom", artefactKind: "ghost-file" },
      weight: 100,
      requires: [],
      note: "test double",
    };
    try {
      const result = await runRenderPipeline("job1", {
        store,
        stages: [stage],
        probes: allOkProbes(),
        executors: {
          ghost: async () => ({
            record: { claimed: true },
            files: [{ artefactKind: "ghost-file", path: join(dir, "nope.mp4"), bytes: 10, sha256: "deadbeef" }],
          }),
        },
        outputRoot: dir,
      });
      expect(result.status).toBe("failed");
      expect(rows[0].errorMessage).toContain("nothing exists at that path");
      expect(artefacts.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NEGATIVE CONTROL: a file stage whose digest does not match the bytes is FAILED", async () => {
    const { store, rows, artefacts } = memoryStore();
    const dir = tmp();
    const stage: RenderStage = {
      id: "forger",
      sequence: 1,
      title: "A stage that misreports its digest",
      consumes: [],
      produces: { kind: "file", label: "a file with the wrong digest", artefactKind: "forged-file" },
      weight: 100,
      requires: [],
      note: "test double",
    };
    try {
      const f = writeRealFile(dir, "forged.mp4", "real bytes");
      const result = await runRenderPipeline("job1", {
        store,
        stages: [stage],
        probes: allOkProbes(),
        executors: {
          forger: async () => ({ record: { claimed: true }, files: [{ ...f, artefactKind: "forged-file", sha256: "0".repeat(64) }] }),
        },
        outputRoot: dir,
      });
      expect(result.status).toBe("failed");
      expect(rows[0].errorMessage).toContain("the bytes hash to");
      expect(artefacts.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NEGATIVE CONTROL: a record stage that returns nothing is FAILED", async () => {
    const { store, rows } = memoryStore();
    const dir = tmp();
    const stage: RenderStage = {
      id: "empty",
      sequence: 1,
      title: "A stage with nothing to show",
      consumes: [],
      produces: { kind: "record", label: "a plan" },
      weight: 100,
      requires: [],
      note: "test double",
    };
    try {
      const result = await runRenderPipeline("job1", {
        store,
        stages: [stage],
        probes: allOkProbes(),
        executors: { empty: async () => ({ record: {} }) },
        outputRoot: dir,
      });
      expect(result.status).toBe("failed");
      expect(rows[0].errorMessage).toContain("nothing to show");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unregistered probe blocks rather than passing", async () => {
    const { store, rows } = memoryStore();
    const dir = tmp();
    const stage: RenderStage = {
      id: "mystery",
      sequence: 1,
      title: "A stage gated on a probe that does not exist",
      consumes: [],
      produces: { kind: "record", label: "a plan" },
      weight: 100,
      requires: [{ probeId: "ffmpeg-binary", missingLabel: "something" }],
      note: "test double",
    };
    try {
      const result = await runRenderPipeline("job1", {
        store,
        stages: [stage],
        probes: {} as Record<ProbeId, Probe>,
        executors: { mystery: async () => ({ record: { x: 1 } }) },
        outputRoot: dir,
      });
      expect(result.status).toBe("blocked");
      expect(rows[0].missingInput).toContain("does not exist");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 4 — a stop is a real stop                                           */
/* ------------------------------------------------------------------ */

describe("stopping", () => {
  test("a stop request stops the pipeline at the next stage and stores the reason", async () => {
    const { store, rows, job } = memoryStore({ stopRequestedAt: new Date(1000), stopReason: "owner pressed stop" });
    const dir = tmp();
    try {
      const result = await runRenderPipeline("job1", {
        store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...realFileExecutors(dir) } as never,
        outputRoot: dir,
      });
      expect(result.status).toBe("stopped");
      expect(rows.length).toBe(1);
      expect(rows[0].stageId).toBe("resolve-inputs");
      expect(rows[0].state).toBe("STOPPED");
      expect(rows[0].blockedReason).toContain("owner pressed stop");
      expect(result.halted?.reason).toBe("owner pressed stop");
      expect(job().stopReason).toBe("owner pressed stop");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 5 — the pipeline CAN complete when every requisite is present        */
/* ------------------------------------------------------------------ */

describe("the whole pipeline with every requisite present", () => {
  test("all seven stages succeed, three real artefacts are recorded, progress is 100%", async () => {
    const { store, rows, artefacts } = memoryStore();
    const dir = tmp();
    try {
      const result = await runRenderPipeline("job1", {
        store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...realFileExecutors(dir) } as never,
        outputRoot: dir,
      });
      expect(result.status).toBe("succeeded");
      expect(rows.length).toBe(PIPELINE_STAGES.length);
      expect(rows.every((r) => r.state === "SUCCEEDED")).toBe(true);
      expect(artefacts.map((a) => a.artefactKind).sort()).toEqual(["checksum-sidecar", "delivered-container", "master-video"]);
      expect(result.artefactsWritten).toBe(3);
      expect(result.progress.percent).toBe(100);
      // Every stage row recorded the progress as of its own completion.
      const first = rows[0].output as { progressAfterStage?: { percent: number } };
      expect(first.progressAfterStage?.percent).toBe(10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 6 — the real probes on this machine                                 */
/* ------------------------------------------------------------------ */

describe("the real probes", () => {
  test("the ffmpeg probe reports the truth and names ffmpeg when it fails", async () => {
    const r = await runProbe("ffmpeg-binary", { projectId: "p", outputDir: tmp(), projectFacts: async () => ({ sceneCount: 1 }) });
    expect(typeof r.ok).toBe("boolean");
    if (!r.ok) {
      expect(r.missing).toContain("ffmpeg");
      expect(r.detail.length).toBeGreaterThan(10);
    } else {
      expect(r.detail).toContain("exit 0");
    }
  });

  test("the storage probe really writes, reads back and cleans up after itself", async () => {
    const dir = tmp();
    try {
      const r = await runProbe("storage-writable", { projectId: "p", outputDir: dir, projectFacts: async () => ({ sceneCount: 1 }) });
      expect(r.ok).toBe(true);
      expect(r.detail).toContain("wrote, read back and unlinked");
      // Nothing left behind by the probe.
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the encode-provider probe answers from capabilityConnectivity, not from a literal", async () => {
    const r = await runProbe("encode-provider-keyed", { projectId: "p", outputDir: tmp(), projectFacts: async () => ({ sceneCount: 1 }) });
    expect(r.detail).toContain("capabilityConnectivity()");
    expect(typeof r.ok).toBe("boolean");
    if (!r.ok) expect(r.missing).toContain("video_enhancement");
  });
});
