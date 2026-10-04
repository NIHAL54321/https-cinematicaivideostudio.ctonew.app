/**
 * Phase 6 Block 5 — export job handoff contract test (no database).
 *
 * Two things are proven here and they are different:
 *
 *  1. THE NO-PROVIDER PATH. The job service calls the REAL AI Model
 *     Orchestrator (src/lib/ai/orchestrator.ts, capability video_enhancement).
 *     With no provider ready, the router's own "Provider Not Connected" answer
 *     is what the job records — verbatim — and the job lands in `blocked`, with
 *     every provider-only field left null.
 *
 *  2. THE PROVIDER PATH. A fake video_enhancement provider is registered
 *     TEST-ONLY (the registry hard-gates it to CAVS_TEST_MODE / NODE_ENV=test,
 *     so production can never see it) and the real orchestrator calls it. The
 *     task it receives is captured and asserted field by field against the
 *     applied preset's own numbers — proving the request carries the preset's
 *     real spec, not a summary.
 *
 * The store is in-memory and mirrors the Prisma store's interface, so the shapes
 * asserted here are the shapes the HTTP route returns.
 */
process.env.CAVS_TEST_MODE = "1"; // test-only providers are visible under this flag only

import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  DEDUPE_NOTE,
  EXPORT_JOB_ACTIONS,
  EXPORT_JOB_CAPABILITY,
  EXPORT_JOB_STATES,
  EXPORT_JOB_STATE_INFO,
  EXPORT_JOB_TASK_TYPE,
  JOB_PROVIDER_ONLY_FIELDS,
  MAX_EXPORT_JOBS_PER_PROJECT,
  buildExportJobRouterRequest,
  isExportJobAction,
  jobOutputSpec,
  jobRequestKey,
  normalizeExportJobs,
  unreachableJobStates,
  reachableJobStates,
} from "../jobs";
import { runExportJobAction, type ExportJobStore } from "../job-service";
import { EXPORT_ENCODE_ENV_NAMES, exportProviderGate, runExportAction } from "../service";
import { EMPTY_EXPORT_ASSIGNMENT } from "../assignment";
import { findExportPreset } from "../presets";
import { registerProvider } from "../../ai/providers/registry";
import { isProviderReady, type AiProvider } from "../../ai/providers/types";
import type { AiTask } from "../../ai/types";
import type { AiPersistence } from "../../ai/orchestrator";
import { buildTimelineFromScenes } from "../../editor/timeline";
import { toSnapshot } from "../../editor/versions";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const SCENES = [
  { id: "s1", title: "Cold open", narration: "The city wakes before the sun does.", durationSeconds: 300 },
  { id: "s2", title: "Turn", narration: "Then the letter arrives, and nothing is the same.", durationSeconds: 420 },
];

/** A saved 11-second cut — 300 + 420 must NOT win over this. */
const TIMELINE_SNAPSHOT = toSnapshot(
  buildTimelineFromScenes([
    { id: "s1", title: "Cold open", narration: "The city wakes before the sun does.", durationSeconds: 6 },
    { id: "s2", title: "Turn", narration: "Then the letter arrives, and nothing is the same.", durationSeconds: 5 },
  ]),
  { note: "test cut" },
);

function appliedPreset(ids: string[], appliedAt = "2026-10-03T10:00:00.000Z") {
  return { format: "cavis.export.preset", version: 1, presetIds: ids, appliedAt };
}

interface HarnessOptions {
  ownerId?: string;
  preset?: unknown;
  rawTimeline?: unknown;
  scenes?: typeof SCENES;
}

/** The in-memory twin of the Prisma ExportJobStore (JSON round-trips like Prisma). */
function harness(options: HarnessOptions = {}) {
  const ownerId = options.ownerId ?? "u1";
  let preset: unknown = options.preset ?? null;
  let rawTimeline: unknown = options.rawTimeline === undefined ? TIMELINE_SNAPSHOT : options.rawTimeline;
  let jobs: unknown = null;
  const scenes = options.scenes ?? SCENES;
  const writes: unknown[] = [];
  const store: ExportJobStore = {
    async findOwnedProject(userId, projectId) {
      if (userId !== ownerId || projectId !== "p1") return null;
      return { id: "p1", title: "The City Wakes" };
    },
    async listScenes() {
      return scenes.map((s) => ({ id: s.id, title: s.title, narration: s.narration, durationSeconds: s.durationSeconds }));
    },
    async readRawTimeline() {
      return rawTimeline;
    },
    async readProjectMeta() {
      return {
        description: "A short film about a letter.",
        targetAspect: "LANDSCAPE_16_9",
        targetDurationSeconds: 11,
        seoDefaults: { title: "The City Wakes", description: "A short film.", tags: ["film", "city"] },
        seoDefaultsSource: "ProjectSettings.seoDefaults",
      };
    },
    async listThumbnailAssets() {
      return [];
    },
    async readExportPreset() {
      return preset;
    },
    async writeExportPreset(_projectId, value) {
      preset = value;
    },
    async readExportJobs() {
      return jobs;
    },
    async writeExportJobs(_projectId, value) {
      // Prisma stores JSON: round-trip so the record must survive serialisation.
      jobs = value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
      writes.push(jobs);
    },
  };
  return {
    store,
    writes,
    jobCount: () => (Array.isArray(jobs) ? (jobs as unknown[]).length : 0),
    setPreset: (v: unknown) => {
      preset = v;
    },
    setScenes: (list: typeof SCENES | null) => {
      rawTimeline = null;
      (store as unknown as { listScenes: () => Promise<unknown> }).listScenes = async () => list ?? [];
    },
  };
}

/** In-memory orchestrator audit trail — records what Prisma would write. */
class MemoryPersistence implements AiPersistence {
  logs: Record<string, unknown>[] = [];
  generations: { id: string; input: Record<string, unknown> }[] = [];
  async createGeneration(input: Record<string, unknown> & { userId: string }) {
    const id = `gen-${this.generations.length + 1}`;
    this.generations.push({ id, input });
    return { id };
  }
  async updateGeneration() {}
  async createProviderLog(input: Record<string, unknown>) {
    this.logs.push(input);
  }
}

/* ------------------------------------------------------------------ */
/* The test-only video-processing provider                             */
/* ------------------------------------------------------------------ */

const calls: AiTask[] = [];
let ready = false; // "configured AND wired" — flipped per test
let mode: "ok" | "fail" = "ok";

const fakeVideoProvider: AiProvider = {
  id: "test-video-processing",
  name: "Test Video Processing (dev-gated stub)",
  capabilities: ["video_enhancement"],
  rank: 1,
  metadata: { quality: 0.9, speed: 0.9, cost: 0.9, maxResolution: "3840x2160" },
  isConfigured: () => ready,
  isWired: () => ready,
  requiredEnv: () => ["TEST_VIDEO_PROCESSING_KEY"],
  modelFor: () => "test-encoder-1",
  call: async (task: AiTask) => {
    calls.push(task);
    if (mode === "fail") return { status: "failed", error: "test encoder exploded deliberately", latencyMs: 3 };
    return {
      status: "ok",
      outputRefs: { url: "test://encoded-output", providerRequestId: "test-req-1" },
      latencyMs: 3,
    };
  },
};

beforeAll(() => {
  registerProvider(fakeVideoProvider, { testOnly: true });
});

beforeEach(() => {
  calls.length = 0;
  ready = false;
  mode = "ok";
});

function body(res: Awaited<ReturnType<typeof runExportJobAction>>) {
  return res.body as Record<string, any>;
}

function snapshotOf(res: Awaited<ReturnType<typeof runExportJobAction>>) {
  const b = body(res);
  return (b.snapshot ?? (b.job as Record<string, any>).snapshot) as Record<string, any>;
}

/* ------------------------------------------------------------------ */
/* 1. The engine surface and the state model                           */
/* ------------------------------------------------------------------ */

describe("export job — the action surface and the honest state model", () => {
  test("exposes exactly the three job actions", () => {
    expect(EXPORT_JOB_ACTIONS).toEqual(["createExportJob", "listExportJobs", "getExportJob"]);
    expect(isExportJobAction("createExportJob")).toBe(true);
    expect(isExportJobAction("getExportJob")).toBe(true);
    expect(isExportJobAction("renderAndUpload")).toBe(false);
  });
  test("only two of the four states are reachable without a provider; nothing is simulated", () => {
    expect(reachableJobStates().map((s) => s.state)).toEqual(["queued", "blocked"]);
    expect(unreachableJobStates().map((s) => s.state)).toEqual(["handed_off", "provider_failed"]);
    for (const s of unreachableJobStates()) {
      expect(String(s.unreachableReason)).toContain("provider");
    }
    // No state anywhere claims progress: no encoding, no uploading, no completed.
    for (const banned of ["encoding", "uploading", "completed", "processing", "rendering"]) {
      expect(EXPORT_JOB_STATES as readonly string[]).not.toContain(banned);
    }
    expect(EXPORT_JOB_STATE_INFO.length).toBe(4);
  });
  /**
   * The panel renders `states.unreachable[].reason` VERBATIM (src/components/
   * editor/export-panel.tsx). `reason` is the WIRE name `stateModelView()`
   * serialises the model's `unreachableReason` as. For one build the panel read
   * the model's own field name instead, so the UI printed "no reason reported"
   * for reasons the engine HAD reported — caught against the running app in a
   * browser on 2026-10-03. This test pins the contract the panel must keep
   * reading: the key `reason`, carrying the model's own sentence, never a
   * substitute.
   */
  test("each unreachable state reaches the panel as `reason`, carrying the engine's own sentence", async () => {
    const h = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const res = await runExportJobAction(h.store, "u1", { action: "listExportJobs", projectId: "p1" });
    const states = body(res).states as { unreachable: Array<Record<string, unknown>> };
    expect(states.unreachable.map((e) => e.state)).toEqual(["handed_off", "provider_failed"]);
    for (const entry of states.unreachable) {
      // The wire name the panel reads — and the model's internal field name must
      // not leak onto it, because reading that name renders the honest-looking
      // fallback for a reason that does exist.
      expect(typeof entry.reason).toBe("string");
      expect(String(entry.reason)).toContain("provider");
      expect("unreachableReason" in entry).toBe(false);
      // What the panel would paint: the engine's sentence, not the fallback.
      expect(entry.reason ?? "no reason reported").not.toBe("no reason reported");
    }
    // The value on the wire IS the model's own reason — not a fabricated string.
    expect(states.unreachable.map((e) => e.reason)).toEqual(unreachableJobStates().map((s) => s.unreachableReason));
    // The reachable two carry no reason at all: null, not invented.
    const reachable = body(res).states.reachable as Array<Record<string, unknown>>;
    expect(reachable.map((e) => e.state)).toEqual(["queued", "blocked"]);
    for (const entry of reachable) expect("reason" in entry).toBe(false);
  });
  test("the provider-only fields are declared, so nothing can quietly populate them", () => {
    expect([...JOB_PROVIDER_ONLY_FIELDS]).toEqual([
      "progress",
      "percentComplete",
      "etaSeconds",
      "completedAt",
      "outputUrl",
      "outputBytes",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The request carries the preset's real parameters                 */
/* ------------------------------------------------------------------ */

describe("the orchestrator request is the preset's real spec, not a summary", () => {
  test("video + audio + colour parameters are copied from the preset itself", () => {
    const preset = findExportPreset("youtube-2160p")!;
    const spec = jobOutputSpec(preset, "The City Wakes", 11);
    expect(spec.container).toBe(preset.container);
    expect(spec.resolution).toBe(preset.resolution);
    expect(spec.video.codec).toBe(preset.video.codec);
    expect(spec.video.profile).toBe(preset.video.profile);
    expect(spec.video.level).toBe(preset.video.level);
    expect(spec.video.frameRate).toBe(preset.video.frameRate);
    expect(spec.video.bitrateKbps).toBe(preset.video.rateControl.targetVideoBitrateKbps);
    expect(spec.audio.channelLayout).toBe(preset.audio.channelLayout);
    expect(spec.audio.sampleRateHz).toBe(preset.audio.sampleRateHz);
    expect(spec.audio.loudnessTargetLufs).toBe(preset.audio.loudnessTargetLufs);
    expect(spec.audio.truePeakDbfs).toBe(preset.audio.truePeakDbfs);
    expect(spec.colour.display).toBe(preset.colour.display);
    expect(spec.fileName).toBe("the-city-wakes-youtube-2160p.mp4");

    const req = buildExportJobRouterRequest({
      projectId: "p1",
      jobId: "job-1",
      requestKey: "sha256:abc",
      capturedAt: "2026-10-03T10:00:00.000Z",
      durationSeconds: 11,
      durationSource: "timeline",
      outputs: [spec],
      sidecars: [
        {
          id: "subtitles-srt",
          label: "SRT",
          fileName: "the-city-wakes.en.srt",
          mimeType: "application/x-subrip",
          container: "srt",
          contentState: "exists",
          bytes: 120,
          truncated: false,
          requires: null,
          requiresEnv: null,
        },
      ],
    });
    expect(req.type).toBe(EXPORT_JOB_TASK_TYPE);
    expect(req.capability).toBe(EXPORT_JOB_CAPABILITY);
    // The preset's own resolution string, character for character (it uses ×).
    expect(req.params.resolution).toBe(preset.resolution);
    expect(req.params.resolution.startsWith("3840")).toBe(true);
    expect(req.params.requirements).toEqual(["4k"]);
    expect(req.payload.deliverable.video.bitrateKbps).toBe(preset.video.rateControl.targetVideoBitrateKbps);
    expect(req.payload.loudnessTargetLufs).toBe(preset.audio.loudnessTargetLufs);
    expect(req.payload.sidecarsToMux.map((s) => [s.id, s.contentState])).toEqual([["subtitles-srt", "exists"]]);
    expect(String(req.payload.videoRef)).toContain("project-timeline://p1");
    expect(req.payload.videoRefKind).toContain("no rendered or uploaded source file exists");
  });
  test("the request key is a function of the request facts only", () => {
    const base = {
      projectId: "p1",
      presetIds: ["youtube-1080p"] as const,
      durationSeconds: 11,
      durationSource: "timeline",
      sidecarStates: [["subtitles-srt", "exists"]] as const,
      cueCount: 2,
    };
    const k1 = jobRequestKey({ ...base });
    expect(jobRequestKey({ ...base })).toBe(k1);
    expect(jobRequestKey({ ...base, durationSeconds: 12 })).not.toBe(k1);
    expect(jobRequestKey({ ...base, presetIds: ["youtube-shorts"] })).not.toBe(k1);
    expect(jobRequestKey({ ...base, cueCount: 3 })).not.toBe(k1);
    expect(jobRequestKey({ ...base, sidecarStates: [["subtitles-srt", "empty"]] })).not.toBe(k1);
    expect(k1.startsWith("sha256:")).toBe(true);
  });
  test("a stored job list is read leniently and cannot be repaired into claims", () => {
    expect(normalizeExportJobs(null)).toEqual({ jobs: [], unreadable: false, dropped: [] });
    expect(normalizeExportJobs({ nope: true }).unreadable).toBe(true);
    const mixed = normalizeExportJobs([
      { format: "cavis.export.job", id: "j1", state: "blocked", snapshot: {} },
      { format: "other", id: "j2", state: "blocked", snapshot: {} },
      { format: "cavis.export.job", id: "j3", state: "completed", snapshot: {} },
    ]);
    expect(mixed.jobs.map((j) => j.id)).toEqual(["j1"]);
    expect(mixed.dropped.length).toBe(2);
    expect(mixed.dropped[1].reason).toContain("unknown state");
  });
});

/* ------------------------------------------------------------------ */
/* 3. No provider connected — the honest blocked job                   */
/* ------------------------------------------------------------------ */

describe("no provider connected — the job lands blocked with the router's own answer", () => {
  test("a project with no applied preset is a typed 400", async () => {
    const { store } = harness({ preset: null });
    const res = await runExportJobAction(store, "u1", { action: "createExportJob", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("no_preset_applied");
    expect(String(res.body.note)).toContain("applyExportPreset");
  });
  test("a preset override is refused: a job snapshots the APPLIED set", async () => {
    const { store } = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const res = await runExportJobAction(store, "u1", {
      action: "createExportJob",
      projectId: "p1",
      presetIds: ["youtube-shorts"],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("preset_override_not_allowed");
  });
  test("no duration at all is a typed 400 rather than an estimated request", async () => {
    const { store } = harness({ preset: appliedPreset(["youtube-1080p"]), rawTimeline: null, scenes: [] });
    const res = await runExportJobAction(store, "u1", { action: "createExportJob", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("duration_unavailable");
    expect(res.body.durationSource).toBe("none");
  });
  test("an unreadable stored job list is a 409, never an overwrite", async () => {
    const { store } = harness({ preset: appliedPreset(["youtube-1080p"]) });
    (store as unknown as { readExportJobs: () => Promise<unknown> }).readExportJobs = async () => ({ nope: 1 });
    const res = await runExportJobAction(store, "u1", { action: "createExportJob", projectId: "p1" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("job_store_unreadable");
  });

  test("the created job is blocked, records the router verbatim, and claims nothing", async () => {
    const { store, jobCount } = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const persistence = new MemoryPersistence();
    const res = await runExportJobAction(store, "u1", { action: "createExportJob", projectId: "p1" }, { ai: { persistence } });
    const b = body(res);

    expect(res.status).toBe(200);
    expect(b.created).toBe(true);
    expect(b.state).toBe("blocked");
    expect(jobCount()).toBe(1);

    // The request really went through the orchestrator (one honest audit row).
    expect(persistence.logs.length).toBe(1);
    expect(String(persistence.logs[0].errorMessage)).toContain("Provider Not Connected");
    expect(persistence.generations.length).toBe(0); // nothing was ever attempted

    // The router's own answer is recorded verbatim, not reworded.
    expect(b.router.status).toBe("not_connected");
    expect(String(b.router.error)).toContain("Provider Not Connected");
    expect(String(b.router.error)).toContain(EXPORT_JOB_CAPABILITY);
    expect(b.router.provider).toBeNull();
    expect(b.router.attempts).toEqual([]);
    expect(b.router.requiredEnv.length).toBeGreaterThan(0); // the router's own names

    // The export surface's gate and the router's own answer are the SAME
    // derived list — they can never contradict each other in one response.
    expect(b.envHint).toBe("REPLICATE_API_TOKEN or RUNWAY_API_KEY");
    expect(b.requiredEnv).toContain("REPLICATE_API_TOKEN");
    expect(b.requiredEnv).toContain("RUNWAY_API_KEY");
    expect(b.requiredEnv).not.toContain("VIDEO_PROCESSING_API_KEY");
    expect(b.provider.connected).toBe(false);
    expect(b.provider.requiredEnv).toEqual(EXPORT_ENCODE_ENV_NAMES);
    expect(b.router.requiredEnv).toEqual(EXPORT_ENCODE_ENV_NAMES);
    expect(String(b.envNote)).toContain("REPLICATE_API_TOKEN");
    expect(String(b.envNote)).toContain("derived from the provider registry");
    expect(JSON.stringify(b)).not.toContain("sk-");

    // NO progress, percentage, ETA or completion is populated anywhere.
    for (const field of JOB_PROVIDER_ONLY_FIELDS) expect(b[field]).toBeNull();
    expect(b.filesProduced).toBe(0);
    expect(b.plan).toEqual({ requested: true, encoded: false, muxed: false, uploaded: false, filesProduced: 0 });
    const job = b.job as Record<string, any>;
    for (const field of JOB_PROVIDER_ONLY_FIELDS) expect(job[field]).toBeNull();
    expect(job.filesProduced).toBe(0);
    expect(job.state).toBe("blocked");

    // The status history says what was attempted, when, and what answered.
    const events = (job.statusHistory as Record<string, unknown>[]).map((h) => h.event);
    expect(events).toEqual(["snapshot-captured", "orchestrator-request", "router:not_connected"]);
    const last = (job.statusHistory as Record<string, any>[]).at(-1)!;
    expect(last.state).toBe("blocked");
    expect(String(last.detail)).toContain("Provider Not Connected");
    expect(last.requiredEnv.length).toBeGreaterThan(0);
    for (const h of job.statusHistory as Record<string, unknown>[]) expect(typeof h.at).toBe("string");
  });

  test("the snapshot freezes the request and says what it is of", async () => {
    const { store } = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const res = await runExportJobAction(store, "u1", { action: "createExportJob", projectId: "p1" });
    const b = body(res);
    const snap = snapshotOf(res);

    expect(snap.kind).toBe("request-snapshot");
    expect(snap.presetAssignment.presetIds).toEqual(["youtube-1080p"]);
    expect(snap.duration.seconds).toBe(11);
    expect(snap.duration.source).toBe("timeline");
    expect(snap.outputs.length).toBe(1);
    expect(snap.outputs[0].presetId).toBe("youtube-1080p");
    expect(snap.outputs[0].estimatedSize.bytes).toBeGreaterThan(0);
    expect(snap.sidecars.length).toBe(5);
    for (const s of snap.sidecars) expect(["exists", "requires-generation", "empty"]).toContain(s.contentState);
    expect(snap.readiness.length).toBe(6);
    for (const r of snap.readiness) expect(typeof r.verdict).toBe("string");
    expect(snap.of.length).toBe(5);
    expect(String(snap.note)).toContain("does NOT change when the project changes");
    expect(String(b.snapshotRegime.note)).toContain("never re-read from the project");
    expect(b.snapshotRegime.immutable).toBe(true);
  });

  test("an existing job does not move when the project changes", async () => {
    const h = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const created = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" });
    const jobId = body(created).job.jobId as string;
    expect(snapshotOf(created).presetAssignment.presetIds).toEqual(["youtube-1080p"]);

    // The project changes underneath the job: a different preset set and no timeline.
    h.setPreset(appliedPreset(["youtube-shorts", "square-1080"]));
    h.setScenes([{ id: "s9", title: "New", narration: "Different.", durationSeconds: 60 }]);

    const reread = await runExportJobAction(h.store, "u1", { action: "getExportJob", projectId: "p1", jobId });
    expect(reread.status).toBe(200);
    const snap = snapshotOf(reread);
    expect(snap.presetAssignment.presetIds).toEqual(["youtube-1080p"]); // unchanged
    expect(snap.duration.seconds).toBe(11);
    expect(snap.duration.source).toBe("timeline");
    expect(snap.outputs.length).toBe(1);
    expect(snap.outputs[0].presetId).toBe("youtube-1080p");

    // A NEW job is what captures the new state — and it is a different request.
    const second = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" });
    expect(body(second).created).toBe(true);
    expect(body(second).job.jobId).not.toBe(jobId);
    expect(snapshotOf(second).presetAssignment.presetIds).toEqual(["youtube-shorts", "square-1080"]);
  });

  test("an identical request is de-duplicated (the same job is returned)", async () => {
    const h = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const first = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" });
    const second = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" });
    expect(body(first).created).toBe(true);
    expect(body(second).created).toBe(false);
    expect(body(second).deduplicated).toBe(true);
    expect(body(second).job.jobId).toBe(body(first).job.jobId);
    expect(body(second).job.snapshot.capturedAt).toBe(body(first).job.snapshot.capturedAt);
    expect(h.jobCount()).toBe(1);
    expect(String(body(second).dedupe.note)).toContain("de-duplicated");
    expect(DEDUPE_NOTE).toContain("not a silent merge");
  });

  test("list returns summaries newest first; get is 400 without a jobId and 404 for an unknown one", async () => {
    const h = harness({ preset: appliedPreset(["youtube-1080p"]) });
    await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" });
    await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1", durationSeconds: 30 });

    const listed = await runExportJobAction(h.store, "u1", { action: "listExportJobs", projectId: "p1" });
    const lb = body(listed);
    expect(listed.status).toBe(200);
    expect(lb.count).toBe(2);
    expect(lb.counts.blocked).toBe(2);
    expect(lb.counts.filesProduced).toBe(0);
    expect(lb.states.reachable.map((s: { state: string }) => s.state)).toEqual(["queued", "blocked"]);
    expect(lb.states.unreachable.map((s: { state: string }) => s.state)).toEqual(["handed_off", "provider_failed"]);
    const rows = lb.jobs as Record<string, any>[];
    expect(rows[0].createdAt >= rows[1].createdAt).toBe(true);
    for (const row of rows) {
      expect(row.progress).toBeNull();
      expect(row.completedAt).toBeNull();
      expect(row.filesProduced).toBe(0);
      expect(row.routerStatus).toBe("not_connected");
      expect(row.routerRequiredEnv.length).toBeGreaterThan(0);
      expect(row.lastHistoryEntry.event).toBe("router:not_connected");
    }

    const noId = await runExportJobAction(h.store, "u1", { action: "getExportJob", projectId: "p1" });
    expect(noId.status).toBe(400);
    expect(noId.body.code).toBe("job_id_required");

    const missing = await runExportJobAction(h.store, "u1", { action: "getExportJob", projectId: "p1", jobId: "nope" });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("job_not_found");
  });

  test("the job limit is refused explicitly rather than overwriting a snapshot", async () => {
    const h = harness({ preset: appliedPreset(["youtube-1080p"]) });
    for (let i = 0; i < MAX_EXPORT_JOBS_PER_PROJECT; i += 1) {
      const res = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1", durationSeconds: 11 + i });
      expect(res.status).toBe(200);
    }
    const past = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1", durationSeconds: 999 });
    expect(past.status).toBe(400);
    expect(past.body.code).toBe("export_job_limit");
    expect(h.jobCount()).toBe(MAX_EXPORT_JOBS_PER_PROJECT);
  });

  test("a foreign or missing project is a 404 for every job action (never 403)", async () => {
    const h = harness({ ownerId: "someone-else", preset: appliedPreset(["youtube-1080p"]) });
    for (const action of EXPORT_JOB_ACTIONS) {
      const res = await runExportJobAction(h.store, "u1", { action, projectId: "p1", jobId: "j1" });
      expect(res.status, action).toBe(404);
      expect(res.body.code).toBe("not_found");
    }
    const missing = harness();
    const res = await runExportJobAction(missing.store, "u1", { action: "listExportJobs", projectId: "p-other" });
    expect(res.status).toBe(404);
  });

  test("an unknown job action is a 400 that lists the three", async () => {
    const { store } = harness();
    const res = await runExportJobAction(store, "u1", { action: "exportNow", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_action");
    expect(String(res.body.note)).toContain("createExportJob");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The provider path — the real orchestrator, an injected provider   */
/* ------------------------------------------------------------------ */

describe("with an injected (test-only) video_enhancement provider", () => {
  test("the task the job hands over carries the applied preset's exact spec", async () => {
    ready = true;
    const preset = findExportPreset("youtube-shorts")!;
    const h = harness({ preset: appliedPreset(["youtube-shorts"]) });
    const persistence = new MemoryPersistence();
    const res = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" }, { ai: { persistence, attemptsLimit: 1 } });
    const b = body(res);

    // It really went through the orchestrator, and the provider really answered.
    expect(persistence.generations.length).toBe(1);
    expect(persistence.logs.length).toBe(1);
    expect(calls.length).toBe(1);

    const task = calls[0];
    expect(task.type).toBe(EXPORT_JOB_TASK_TYPE);
    expect(task.capability).toBe(EXPORT_JOB_CAPABILITY);
    expect(task.projectId).toBe("p1");
    const payload = task.payload as Record<string, any>;
    const deliverable = payload.deliverable as Record<string, any>;
    // Asserted against the PRESET's own numbers — not against the job's copy.
    expect(deliverable.presetId).toBe("youtube-shorts");
    expect(deliverable.container).toBe(preset.container);
    expect(deliverable.resolution).toBe(preset.resolution);
    expect(deliverable.video.codec).toBe(preset.video.codec);
    expect(deliverable.video.profile).toBe(preset.video.profile);
    expect(deliverable.video.level).toBe(preset.video.level);
    expect(deliverable.video.frameRate).toBe(preset.video.frameRate);
    expect(deliverable.video.bitrateKbps).toBe(preset.video.rateControl.targetVideoBitrateKbps);
    expect(deliverable.audio.codec).toBe(preset.audio.codec);
    expect(deliverable.audio.channelLayout).toBe(preset.audio.channelLayout);
    expect(deliverable.audio.sampleRateHz).toBe(preset.audio.sampleRateHz);
    expect(deliverable.audio.bitrateKbps).toBe(preset.audio.audioBitrateKbps);
    expect(payload.loudnessTargetLufs).toBe(preset.audio.loudnessTargetLufs);
    expect(payload.sidecarsToMux.map((s: { id: string }) => s.id)).toContain("subtitles-srt");
    expect(payload.sidecarsToMux.map((s: { id: string }) => s.id)).toContain("chapters");
    expect((task.params as Record<string, unknown>).resolution).toBe(preset.resolution);
    expect((task.params as Record<string, unknown>).format).toBe(preset.container);
    expect((task.params as Record<string, unknown>).videoType).toBe("shorts");

    // …and the job records the transition honestly.
    expect(b.state).toBe("handed_off");
    expect(b.router.status).toBe("ok");
    expect(b.router.provider).toBe("test-video-processing");
    expect(b.job.statusHistory.map((x: { event: string }) => x.event)).toEqual([
      "snapshot-captured",
      "orchestrator-request",
      "router:ok",
    ]);
    const last = b.job.statusHistory.at(-1) as Record<string, any>;
    expect(last.state).toBe("handed_off");
    expect(String(last.detail)).toContain("has NOT verified an encoded file");
    // Even a provider answer never becomes a completion claim.
    expect(b.completedAt).toBeNull();
    expect(b.progress).toBeNull();
    expect(b.outputUrl).toBeNull();
    expect(b.filesProduced).toBe(0);
    expect(b.plan.encoded).toBe(false);
  });

  test("a provider that fails lands in provider_failed — never blocked, never ok", async () => {
    ready = true;
    mode = "fail";
    const h = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const persistence = new MemoryPersistence();
    const res = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" }, { ai: { persistence, attemptsLimit: 1 } });
    const b = body(res);
    expect(b.state).toBe("provider_failed");
    expect(b.router.status).toBe("failed");
    expect(String(b.router.error)).toContain("test encoder exploded deliberately");
    expect(b.router.attempts.length).toBe(1);
    expect(b.router.attempts[0].status).toBe("failed");
    expect(b.progress).toBeNull();
    expect(b.filesProduced).toBe(0);
    expect(b.job.statusHistory.map((x: { event: string }) => x.event).at(-1)).toBe("router:failed");
  });

  test("nothing is reachable from the provider path without the stub being ready", async () => {
    // The same request with the stub NOT ready: configured/wired false, so the
    // router never sees it and the job is blocked — the honest default.
    expect(isProviderReady(fakeVideoProvider)).toBe(false);
    const h = harness({ preset: appliedPreset(["youtube-1080p"]) });
    const res = await runExportJobAction(h.store, "u1", { action: "createExportJob", projectId: "p1" });
    expect(body(res).state).toBe("blocked");
    expect(calls.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Engine/panel surface contract                                     */
/* ------------------------------------------------------------------ */

describe("the job surface sits on the same single endpoint without disturbing the six", () => {
  test("the three job actions are not export actions, and the export gate still names one env var", async () => {
    const { store } = harness();
    // EXPORT_ACTIONS is the six the Block 4 panel renders; a job action is NOT
    // one of them, so the panel contract test's "the panel is the whole engine
    // surface" stays true of the six it covers.
    const res = await runExportAction(store, "u1", { action: "createExportJob", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_action");
    const gate = exportProviderGate("anything");
    expect(gate.requiredEnv).toEqual(EXPORT_ENCODE_ENV_NAMES);
    expect(EMPTY_EXPORT_ASSIGNMENT.presetIds).toEqual([]);
  });
});
