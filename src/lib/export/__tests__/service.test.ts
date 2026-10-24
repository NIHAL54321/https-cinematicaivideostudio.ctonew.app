/**
 * Phase 6 Block 1 — export service contract test (no database).
 *
 * The service is store-injected exactly so this runs without Prisma: the memory
 * store below implements the same `ExportStore` interface the Prisma store
 * implements (src/lib/export/store.ts), so the shapes asserted here are the
 * shapes the HTTP route returns.
 *
 * The fixture has real scene durations AND a saved editor timeline, so the tests
 * prove the duration — and therefore the size estimate — comes from the
 * project's own data rather than from an assumption.
 */
import { describe, expect, test } from "bun:test";
import {
  EXPORT_ACTIONS,
  EXPORT_ENCODE_CAPABILITY,
  EXPORT_ENCODE_ENV_NAMES,
  exportConnectedProviders,
  exportProviderConnected,
  isExportAction,
  runExportAction,
  type ExportResult,
  type ExportSceneRow,
  type ExportStore,
} from "../service";
import { EXPORT_ASSIGNMENT_FORMAT, EMPTY_EXPORT_ASSIGNMENT } from "../assignment";
import { EXPORT_PRESET_IDS } from "../presets";
import { allProviderEnvVars } from "../../ai/providers/env-keys";
import { buildTimelineFromScenes } from "../../editor/timeline";
import { toSnapshot } from "../../editor/versions";

const SCENES: ExportSceneRow[] = [
  { id: "s1", title: "Intro", durationSeconds: 300 },
  { id: "s2", title: "Body", durationSeconds: 420 },
];

/** A saved editor timeline whose duration is 11 s — 300+420 must NOT win. */
const TIMELINE = buildTimelineFromScenes([
  { id: "s1", title: "Intro", narration: "Intro.", durationSeconds: 6 },
  { id: "s2", title: "Body", narration: "Body.", durationSeconds: 5 },
]);

function memoryStore(
  options: {
    ownerId?: string;
    scenes?: ExportSceneRow[];
    rawTimeline?: unknown;
    exportPreset?: unknown;
  } = {},
) {
  const ownerId = options.ownerId ?? "u1";
  const scenes = options.scenes ?? SCENES;
  let rawTimeline: unknown = options.rawTimeline ?? null;
  let exportPreset: unknown = options.exportPreset ?? null;
  const writes: unknown[] = [];
  const store: ExportStore = {
    async findOwnedProject(userId, projectId) {
      if (userId !== ownerId || projectId !== "p1") return null;
      return { id: "p1", title: "Test project" };
    },
    async listScenes() {
      return scenes;
    },
    async readRawTimeline() {
      return rawTimeline;
    },
    async readExportPreset() {
      return exportPreset;
    },
    async writeExportPreset(_projectId, value) {
      exportPreset = value;
      writes.push(value);
    },
  };
  return { store, writes, exportPreset: () => exportPreset };
}

function manifestOf(res: ExportResult): Record<string, any> {
  return res.body.manifest as Record<string, any>;
}

function assertGate(body: Record<string, unknown>, expectedCapability = EXPORT_ENCODE_CAPABILITY) {
  const gate = body.provider as Record<string, unknown>;
  expect(gate).toBeDefined();
  expect(gate.capability).toBe(expectedCapability);
  expect(gate.connected).toBe(false);
  // `connected` is DERIVED, not a constant: it is false here because no key is
  // set on this server, and it is exactly the same predicate the orchestrator
  // uses to decide whether to attempt a call.
  expect(gate.connected).toBe(exportProviderConnected());
  expect(gate.connected).toBe(exportConnectedProviders().length > 0);
  // Derived from the provider env-key registry: the replicate + runway slots
  // are what serve video_enhancement, so these are the names code really reads.
  expect(gate.requiredEnv).toEqual(EXPORT_ENCODE_ENV_NAMES);
  expect(gate.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
  expect(EXPORT_ENCODE_ENV_NAMES.every((n) => allProviderEnvVars().includes(n))).toBe(true);
  expect(gate.envHint).toBe("REPLICATE_API_TOKEN or RUNWAY_API_KEY");
  expect(String(gate.note)).toContain("REPLICATE_API_TOKEN");
  expect(String(gate.note)).toContain("RUNWAY_API_KEY");
  expect(String(gate.note)).not.toContain("VIDEO_PROCESSING_API_KEY");
  // The note now states the truth per slot: ONE serving slot is wired
  // (Replicate, video_enhancement only) and the other is not, so a key that
  // belongs only to the unwired slot would change nothing.
  expect((gate.wiredProviders as { id: string }[]).map((p) => p.id)).toEqual(["replicate"]);
  expect((gate.unwiredProviders as { id: string }[]).map((p) => p.id)).toEqual(["runway"]);
  expect(String(gate.note)).toContain("IS wired");
  expect(String(gate.note)).toContain("nothing was attempted");
  expect(String(gate.note)).toContain("UNWIRED slot");
  expect(String(gate.note)).toContain("filesProduced stays 0");
  expect(String(gate.note)).not.toContain("sk-");
}

describe("export service — action surface and tenancy", () => {
  test("exposes exactly the six export actions (Block 1's four + Block 3's two)", () => {
    expect(EXPORT_ACTIONS).toEqual([
      "listExportPresets",
      "planExport",
      "applyExportPreset",
      "clearExportPreset",
      "planSidecars",
      "checkPublishReadiness",
    ]);
    expect(isExportAction("planExport")).toBe(true);
    expect(isExportAction("planSidecars")).toBe(true);
    expect(isExportAction("checkPublishReadiness")).toBe(true);
    expect(isExportAction("renderAndUpload")).toBe(false);
  });

  test("an unknown action is a 400 that lists the actions", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "nope", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_action");
    expect(String(res.body.note)).toContain("listExportPresets");
  });

  test("a missing projectId is a 400", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "planExport" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("project_id_required");
  });

  test("a foreign project is a 404 (never 403) for every export action", async () => {
    const { store } = memoryStore({ ownerId: "someone-else" });
    for (const action of EXPORT_ACTIONS) {
      const res = await runExportAction(store, "u1", {
        action,
        projectId: "p1",
        presetIds: ["youtube-1080p"],
      });
      expect(res.status, action).toBe(404);
      expect(res.body.code).toBe("not_found");
    }
  });

  test("a project that does not exist is a 404 too", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p-other" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });
});

describe("export service — listExportPresets", () => {
  test("returns the whole catalogue with its real numbers and applies nothing", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(7);
    const presets = res.body.presets as Record<string, any>[];
    expect(presets.length).toBe(7);
    expect(presets.map((p) => p.id)).toEqual([...EXPORT_PRESET_IDS]);
    const uhd = presets.find((p) => p.id === "youtube-2160p")!;
    expect(uhd.resolution).toBe("3840×2160");
    expect(uhd.container).toBe("mp4");
    expect(uhd.video.codec).toBe("H.265/HEVC");
    expect(uhd.video.bitrateKbps).toBe(45_000);
    expect(uhd.audio.codec).toBe("AAC-LC");
    expect(uhd.audio.channelLayout).toBe("stereo");
    expect(uhd.colour.standard).toBe("Rec.709");
    expect(uhd.colour.transfer).toBe("BT.1886");
    expect(uhd.colour.peakNits).toBe(100);
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect((res.body.plan as Record<string, unknown>).filesProduced).toBe(0);
    assertGate(res.body);
  });

  test("the duration comes from the saved timeline when one exists, else from the scenes", async () => {
    const fromScenes = await runExportAction(memoryStore().store, "u1", { action: "listExportPresets", projectId: "p1" });
    expect((fromScenes.body.duration as Record<string, unknown>).source).toBe("scenes");
    expect((fromScenes.body.duration as Record<string, unknown>).seconds).toBe(720);

    const fromTimeline = await runExportAction(memoryStore({ rawTimeline: toSnapshot(TIMELINE) }).store, "u1", {
      action: "listExportPresets",
      projectId: "p1",
    });
    expect((fromTimeline.body.duration as Record<string, unknown>).source).toBe("timeline");
    expect((fromTimeline.body.duration as Record<string, unknown>).seconds).toBe(11);
  });

  test("estimates every preset at the project's duration, using the stated formula", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1" });
    const estimates = res.body.estimates as Record<string, any>[];
    expect(estimates.length).toBe(7);
    for (const e of estimates) {
      expect(e.estimatedSize.bytes).toBe(((e.videoBitrateKbps + e.audioBitrateKbps) * 1000 * 720) / 8);
      expect(e.estimatedSize.estimate).toBe(true);
      expect(e.estimatedSize.produced).toBe(false);
    }
    expect((res.body.sizeModel as Record<string, unknown>).formula).toBe("size = (video bitrate + audio bitrate) × duration ÷ 8");
  });

  test("an explicit durationSeconds wins and is reported as source \"request\"", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1", durationSeconds: 7_200 });
    expect(res.status).toBe(200);
    expect((res.body.duration as Record<string, unknown>).source).toBe("request");
    expect((res.body.duration as Record<string, unknown>).human).toBe("2h 00m 00s");
    const estimates = res.body.estimates as Record<string, any>[];
    const fhd = estimates.find((e) => e.presetId === "youtube-1080p")!;
    expect(fhd.estimatedSize.bytes).toBe(7_545_600_000);
  });

  test("a bad explicit duration is a typed 400, not an estimate", async () => {
    const { store } = memoryStore();
    for (const durationSeconds of [0, -5, Number.NaN, 7_201]) {
      const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1", durationSeconds });
      expect(res.status, String(durationSeconds)).toBe(400);
      expect(res.body.code).toBe("invalid_duration");
    }
  });

  test("with no duration anywhere, no size is estimated and the note says so", async () => {
    const { store } = memoryStore({ scenes: [{ id: "s1", title: null, durationSeconds: null }] });
    const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1" });
    expect(res.status).toBe(200);
    expect((res.body.duration as Record<string, unknown>).source).toBe("none");
    expect(res.body.estimates).toEqual([]);
    expect(String(res.body.note)).toContain("No project duration is available");
  });
});

describe("export service — planExport (the deliverable manifest)", () => {
  test("with nothing applied it plans the whole catalogue and states what is not produced", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "planExport", projectId: "p1" });
    expect(res.status).toBe(200);
    const selection = res.body.selection as Record<string, unknown>;
    expect(selection.source).toBe("all");
    expect(selection.count).toBe(7);
    const manifest = manifestOf(res);
    expect(manifest.fileCount).toBe(7);
    expect(manifest.filesProduced).toBe(0);
    expect(manifest.produced).toBe(false);
    expect(manifest.outputs.length).toBe(7);
    expect(manifest.totalEstimatedBytes).toBe(manifest.outputs.reduce((s: number, o: Record<string, any>) => s + o.estimatedSize.bytes, 0));
    expect((manifest.notProduced as string[]).some((n) => n.includes("0 bytes were written"))).toBe(true);
    const names = manifest.outputs.map((o: Record<string, unknown>) => o.fileName);
    expect(names).toContain("test-project-youtube-1080p.mp4");
    expect(names.every((n: string) => n.endsWith(".mp4"))).toBe(true);
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    assertGate(res.body);
  });

  test("the 120-minute long-form case is exact at the manifest level", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", {
      action: "planExport",
      projectId: "p1",
      presetIds: ["youtube-2160p", "youtube-1080p"],
      durationSeconds: 7_200,
    });
    expect(res.status).toBe(200);
    const manifest = manifestOf(res);
    expect(manifest.fileCount).toBe(2);
    expect(manifest.durationSeconds).toBe(7_200);
    expect(manifest.durationHuman).toBe("2h 00m 00s");
    const uhd = manifest.outputs.find((o: Record<string, any>) => o.presetId === "youtube-2160p")!;
    const fhd = manifest.outputs.find((o: Record<string, any>) => o.presetId === "youtube-1080p")!;
    expect(uhd.estimatedSize.bytes).toBe(40_845_600_000);
    expect(fhd.estimatedSize.bytes).toBe(7_545_600_000);
    expect(manifest.totalEstimatedBytes).toBe(48_391_200_000);
    expect(manifest.totalEstimatedHuman).toBe("45.07 GiB"); // 48,391,200,000 ÷ 1024³
  });

  test("planExport with no available duration is a typed 400, not a zero-size manifest", async () => {
    const { store } = memoryStore({ scenes: [] });
    const res = await runExportAction(store, "u1", { action: "planExport", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("duration_unavailable");
    expect(res.body.manifest).toBeUndefined();
  });

  test("unknown, non-array and empty presetIds are typed 400s", async () => {
    const { store } = memoryStore();
    const unknown = await runExportAction(store, "u1", { action: "planExport", projectId: "p1", presetIds: ["youtube-1080p", "legacy-tv"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("unknown_preset");
    expect(unknown.body.unknown).toEqual(["legacy-tv"]);

    const notArray = await runExportAction(store, "u1", { action: "planExport", projectId: "p1", presetIds: "youtube-1080p" });
    expect(notArray.status).toBe(400);
    expect(notArray.body.code).toBe("invalid_preset_ids");

    const empty = await runExportAction(store, "u1", { action: "planExport", projectId: "p1", presetIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("invalid_preset_ids");
  });

  test("duplicate preset ids are deduped into canonical order", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", {
      action: "planExport",
      projectId: "p1",
      presetIds: ["instagram-reels", "youtube-2160p", "instagram-reels", "youtube-2160p"],
    });
    expect(res.status).toBe(200);
    expect((res.body.selection as Record<string, unknown>).presetIds).toEqual(["youtube-2160p", "instagram-reels"]);
    expect(manifestOf(res).fileCount).toBe(2);
  });

  test("the provider gate is on the plan and nothing is ever produced", async () => {
    const { store } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "planExport", projectId: "p1", presetIds: ["instagram-reels"] });
    const plan = res.body.plan as Record<string, unknown>;
    expect(plan.encoded).toBe(false);
    expect(plan.muxed).toBe(false);
    expect(plan.filesProduced).toBe(0);
    assertGate(res.body);
    const manifest = manifestOf(res);
    expect(manifest.outputs[0].estimatedSize.produced).toBe(false);
    expect(manifest.outputs[0].estimatedSize.estimate).toBe(true);
  });
});

describe("export service — apply / read-back / reset idempotency", () => {
  test("applyExportPreset persists the choice, and re-applying it is a no-op", async () => {
    const { store, writes, exportPreset } = memoryStore();
    const first = await runExportAction(store, "u1", {
      action: "applyExportPreset",
      projectId: "p1",
      presetIds: ["instagram-reels"],
    });
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(true);
    expect(first.body.persisted).toBe(true);
    expect(writes.length).toBe(1);
    const stored = exportPreset() as Record<string, unknown>;
    expect(stored.format).toBe(EXPORT_ASSIGNMENT_FORMAT);
    expect(stored.presetIds).toEqual(["instagram-reels"]);
    expect(typeof stored.appliedAt).toBe("string");

    const second = await runExportAction(store, "u1", {
      action: "applyExportPreset",
      projectId: "p1",
      presetIds: ["instagram-reels"],
    });
    expect(second.status).toBe(200);
    expect(second.body.changed).toBe(false);
    expect(second.body.persisted).toBe(false);
    expect(writes.length).toBe(1);
    expect(String((second.body.changelist as string[])[0])).toContain("already");
    expect((first.body.assignment as Record<string, any>).appliedAt).toBe((second.body.assignment as Record<string, any>).appliedAt);
  });

  test("read-back through listExportPresets and planExport sees the persisted choice", async () => {
    const { store } = memoryStore();
    await runExportAction(store, "u1", { action: "applyExportPreset", projectId: "p1", presetIds: ["youtube-shorts", "youtube-2160p"] });

    const list = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1" });
    const assignment = list.body.assignment as Record<string, unknown>;
    expect(assignment.applied).toBe(true);
    expect(assignment.presetIds).toEqual(["youtube-2160p", "youtube-shorts"]);
    expect((list.body.appliedPresets as Record<string, unknown>[]).map((p) => p["id"])).toEqual(["youtube-2160p", "youtube-shorts"]);

    const plan = await runExportAction(store, "u1", { action: "planExport", projectId: "p1" });
    expect((plan.body.selection as Record<string, unknown>).source).toBe("applied");
    expect(manifestOf(plan).fileCount).toBe(2);
  });

  test("applyExportPreset returns the manifest it would produce, and persists nothing about size", async () => {
    const { store, exportPreset } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "applyExportPreset", projectId: "p1", presetIds: ["youtube-1080p"] });
    const manifest = manifestOf(res);
    expect(manifest.fileCount).toBe(1);
    expect(manifest.durationSeconds).toBe(720);
    expect(manifest.outputs[0].estimatedSize.bytes).toBe(((8_000 + 384) * 1000 * 720) / 8);
    // The stored object holds only the choice — no cached spec, no cached size.
    const stored = exportPreset() as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["appliedAt", "format", "presetIds", "version"]);
    assertGate(res.body);
  });

  test("applyExportPreset without presetIds, or with an unknown one, is a typed 400 and writes nothing", async () => {
    const { store, writes } = memoryStore();
    const missing = await runExportAction(store, "u1", { action: "applyExportPreset", projectId: "p1" });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("invalid_preset_ids");

    const unknown = await runExportAction(store, "u1", { action: "applyExportPreset", projectId: "p1", presetIds: ["nope"] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("unknown_preset");

    expect(writes.length).toBe(0);
  });

  test("clearExportPreset clears the stored key (a bare null) and is idempotent", async () => {
    const { store, writes, exportPreset } = memoryStore();
    await runExportAction(store, "u1", { action: "applyExportPreset", projectId: "p1", presetIds: ["instagram-reels"] });

    const cleared = await runExportAction(store, "u1", { action: "clearExportPreset", projectId: "p1" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.changed).toBe(true);
    expect(cleared.body.persisted).toBe(true);
    expect(exportPreset()).toBeNull();
    expect(writes[writes.length - 1]).toBeNull();
    expect((cleared.body.assignment as Record<string, unknown>).presetIds).toEqual([]);
    expect((cleared.body.previous as Record<string, unknown>).presetIds).toEqual(["instagram-reels"]);

    const again = await runExportAction(store, "u1", { action: "clearExportPreset", projectId: "p1" });
    expect(again.body.changed).toBe(false);
    expect(again.body.persisted).toBe(false);
    expect(writes.length).toBe(2);
    assertGate(again.body);

    // After a clear, a plan falls back to the whole catalogue again.
    const plan = await runExportAction(store, "u1", { action: "planExport", projectId: "p1" });
    expect((plan.body.selection as Record<string, unknown>).source).toBe("all");
  });

  test("clearExportPreset on a never-applied project is a no-op", async () => {
    const { store, writes } = memoryStore();
    const res = await runExportAction(store, "u1", { action: "clearExportPreset", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect(writes.length).toBe(0);
  });
});

describe("export service — stored data is read leniently but honestly", () => {
  test("an unreadable stored value is reported and ignored (nothing half-applied)", async () => {
    const { store } = memoryStore({ exportPreset: { format: "something-else", presetIds: ["youtube-1080p"] } });
    const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.unreadable).toBe(true);
    expect((res.body.assignment as Record<string, unknown>).presetIds).toEqual([]);
    expect(String(res.body.note)).toContain("unreadable");

    const plan = await runExportAction(store, "u1", { action: "planExport", projectId: "p1" });
    expect((plan.body.selection as Record<string, unknown>).source).toBe("all");
  });

  test("a stored preset id that is no longer in the catalogue is dropped and counted", async () => {
    const { store } = memoryStore({
      exportPreset: { format: EXPORT_ASSIGNMENT_FORMAT, version: 1, presetIds: ["youtube-1080p", "legacy-tv"], appliedAt: "2026-01-01T00:00:00.000Z" },
    });
    const res = await runExportAction(store, "u1", { action: "listExportPresets", projectId: "p1" });
    expect(res.body.unreadable).toBe(false);
    expect(res.body.droppedPresets).toEqual(["legacy-tv"]);
    expect((res.body.assignment as Record<string, unknown>).presetIds).toEqual(["youtube-1080p"]);
  });

  test("the empty assignment is the shape a cleared project reads back as", () => {
    expect(EMPTY_EXPORT_ASSIGNMENT).toEqual({ presetIds: [], appliedAt: null });
  });
});
