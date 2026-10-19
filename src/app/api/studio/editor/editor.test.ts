import { describe, expect, test } from "bun:test";
import { EDITOR_ACTIONS, runEditorAction, type EditorSceneRow, type EditorStore, type EditorVersionRow } from "../../../../lib/editor/service";
import {
  buildTimelineFromScenes,
  clipById,
  clipsAt,
  timelineDurationMs,
  timelinesEqual,
  trimClip,
  type Timeline,
} from "../../../../lib/editor/timeline";
import { SCENE_CONTROLS } from "../../../../lib/editor/scene-control-meta";
import { AUTO_EDITOR_COMMANDS } from "../../../../lib/editor/auto-editor";
import { PACE_DIMENSIONS } from "../../../../lib/editor/pacing";
import { isEditorSnapshot, toSnapshot, validateTimelineShape } from "../../../../lib/editor/versions";
import { COLOR_GRADE_IDS } from "../../../../lib/color/presets";
import { allProviderEnvVars } from "../../../../lib/ai/providers/env-keys";
import { capabilityConnectivity } from "../../../../lib/ai/providers/capability-connectivity";
import type { FramingAssetRow } from "../../../../lib/framing/service";

/**
 * Phase 5 Blocks 1 + 2 — editor API contract test.
 *
 * The service is store-injected exactly so this can run without a database:
 * the in-memory store below is the same interface the Prisma store implements
 * (src/lib/editor/store.ts), so the shapes asserted here are the shapes the
 * HTTP route returns.
 */

const SCENES: EditorSceneRow[] = [
  { id: "s1", title: "Intro", narration: "Welcome to the studio.", durationSeconds: 5 },
  { id: "s2", title: "Body", narration: "This is the second scene.", durationSeconds: 6 },
];

function memoryStore(
  options: { ownerId?: string; scenes?: EditorSceneRow[]; assets?: FramingAssetRow[]; targetAspect?: string | null } = {},
) {
  const ownerId = options.ownerId ?? "u1";
  const scenes = options.scenes ?? SCENES;
  let raw: unknown = null;
  // Block 4 — ProjectSettings.extra.colorGrade.
  let colorGrade: unknown = null;
  // Block 5a — ProjectSettings.extra.shortsRepurpose.
  let shortsRepurpose: unknown = null;
  // Block 5b — ProjectSettings.extra.framing.
  let framing: unknown = null;
  // Phase 6 Block 1 — ProjectSettings.extra.exportPreset.
  let exportPreset: unknown = null;
  const versions: { versionNumber: number; note: string | null; snapshot: unknown; createdAt: Date; createdById: string }[] = [];

  let exportJobs: unknown = null;
  const store: EditorStore = {
    async findOwnedProject(userId, projectId) {
      if (userId !== ownerId || projectId !== "p1") return null;
      return { id: "p1", title: "Test project", targetAspect: options.targetAspect ?? null };
    },
    async listScenes() {
      return scenes;
    },
    async readRawTimeline() {
      return raw;
    },
    async writeRawTimeline(_projectId, timeline) {
      raw = timeline;
    },
    async listVersionRows(_projectId): Promise<EditorVersionRow[]> {
      return versions
        .slice()
        .sort((a, b) => b.versionNumber - a.versionNumber)
        .map((v) => {
          const check = validateTimelineShape(v.snapshot);
          return {
            versionNumber: v.versionNumber,
            note: v.note,
            createdAt: v.createdAt,
            snapshotBytes: JSON.stringify(v.snapshot).length,
            clipCount: check.ok ? check.timeline.clips.length : 0,
            durationMs: check.ok ? check.timeline.durationMs : 0,
            editorSnapshot: isEditorSnapshot(v.snapshot),
          };
        });
    },
    async nextVersionNumber() {
      return versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
    },
    async insertVersion(input) {
      const createdAt = new Date();
      versions.push({ ...input, createdAt });
      return { versionNumber: input.versionNumber, createdAt };
    },
    async findVersion(_projectId, versionNumber) {
      const row = versions.find((v) => v.versionNumber === versionNumber);
      return row ? { snapshot: row.snapshot, createdAt: row.createdAt } : null;
    },
    // Block 4 — the colour assignment lives in ProjectSettings.extra.colorGrade.
    async readColorGrade() {
      return colorGrade;
    },
    async writeColorGrade(_projectId, value) {
      colorGrade = value;
    },
    // Block 5a — the shorts set lives in ProjectSettings.extra.shortsRepurpose.
    async readShortsRepurpose() {
      return shortsRepurpose;
    },
    async writeShortsRepurpose(_projectId, value) {
      shortsRepurpose = value;
    },
    // Block 5b — real asset dimensions + ProjectSettings.extra.framing.
    async listMediaAssets() {
      return options.assets ?? [];
    },
    async readFraming() {
      return framing;
    },
    async writeFraming(_projectId, value) {
      framing = value;
    },
    // Phase 6 Block 1 — ProjectSettings.extra.exportPreset.
    async readExportPreset() {
      return exportPreset;
    },
    async writeExportPreset(_projectId, value) {
      exportPreset = value;
    },
    async readExportJobs() {
      return exportJobs;
    },
    async writeExportJobs(_projectId, value) {
      exportJobs = value;
    },
  };

  return {
    store,
    versions,
    raw: () => raw,
    colorGrade: () => colorGrade,
    shortsRepurpose: () => shortsRepurpose,
    framing: () => framing,
    exportPreset: () => exportPreset,
  };
}

function timelineOf(body: Record<string, unknown>): Timeline {
  return body.timeline as Timeline;
}

describe("POST /api/studio/editor — build", () => {
  test("builds the timeline deterministically from the project's scenes", async () => {
    const { store, raw } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "build", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("build");
    expect(res.body.projectId).toBe("p1");
    expect(res.body.projectTitle).toBe("Test project");
    expect(res.body.source).toBe("scenes");
    expect(res.body.sceneCount).toBe(2);
    const timeline = timelineOf(res.body);
    expect(timeline.clips.length).toBe(6); // 2 video + 2 voice + 2 subtitles
    expect(res.body.clipCount).toBe(6);
    expect(timeline.durationMs).toBe(11_000);
    expect(clipsAt(timeline, "video").map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 5000],
      [5000, 11_000],
    ]);
    // build never persists
    expect(raw()).toBeNull();
  });

  test("a project with no scenes builds an empty timeline", async () => {
    const { store } = memoryStore({ scenes: [] });
    const res = await runEditorAction(store, "u1", { action: "build", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(timelineOf(res.body).clips.length).toBe(0);
    expect(timelineOf(res.body).durationMs).toBe(0);
  });
});

describe("POST /api/studio/editor — load", () => {
  test("falls back to the scenes when nothing was saved yet", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "load", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("scenes");
    expect(timelineOf(res.body).clips.length).toBe(6);
    expect(String(res.body.note)).toContain("No saved timeline yet");
  });

  test("save → load returns exactly the saved timeline", async () => {
    const { store, raw } = memoryStore();
    const built = buildTimelineFromScenes(SCENES);
    const edited = trimClip(built, { clipId: "sc-s1-video", startMs: 500, endMs: 4000 }).timeline;

    const saved = await runEditorAction(store, "u1", { action: "save", projectId: "p1", timeline: edited });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe(true);
    expect(saved.body.count).toBe(edited.clips.length);
    expect(saved.body.durationMs).toBe(timelineDurationMs(edited));
    expect(raw()).not.toBeNull();

    const loaded = await runEditorAction(store, "u1", { action: "load", projectId: "p1" });
    expect(loaded.status).toBe(200);
    expect(loaded.body.source).toBe("saved");
    const restored = timelineOf(loaded.body);
    expect(timelinesEqual(restored, edited)).toBe(true);
    const clip = restored.clips.find((c) => c.id === "sc-s1-video")!;
    expect([clip.startMs, clip.endMs]).toEqual([500, 4000]);
  });

  test("an unreadable saved value falls back to the scenes (stale saved)", async () => {
    const { store } = memoryStore();
    await store.writeRawTimeline("p1", { nonsense: true });
    const res = await runEditorAction(store, "u1", { action: "load", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("scenes");
    expect(String(res.body.note)).toContain("unreadable");
  });
});

describe("POST /api/studio/editor — save validation", () => {
  test("rejects a malformed timeline body with 400", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "save", projectId: "p1", timeline: { clips: "nope" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_timeline");
  });

  test("drops malformed clips and reports how many", async () => {
    const { store } = memoryStore();
    const timeline = buildTimelineFromScenes(SCENES);
    const payload = {
      version: timeline.version,
      clips: [...timeline.clips, { id: "broken", name: 42, trackId: "video", startMs: 0, endMs: 10 }],
    };
    const res = await runEditorAction(store, "u1", { action: "save", projectId: "p1", timeline: payload });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.count).toBe(timeline.clips.length);
    expect(String(res.body.note)).toContain("1 malformed clip");
  });
});

describe("POST /api/studio/editor — versions", () => {
  test("createVersion numbers versions from 1 and versions lists newest first", async () => {
    const { store, versions } = memoryStore();

    const first = await runEditorAction(store, "u1", { action: "createVersion", projectId: "p1", note: "first cut" });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(true);
    expect(first.body.versionNumber).toBe(1);
    expect(first.body.note).toBe("first cut");
    expect(first.body.clipCount).toBe(6);
    expect(versions.length).toBe(1);

    // edit + save, then snapshot again
    const edited = trimClip(buildTimelineFromScenes(SCENES), { clipId: "sc-s1-video", endMs: 3000 }).timeline;
    await runEditorAction(store, "u1", { action: "save", projectId: "p1", timeline: edited });
    const second = await runEditorAction(store, "u1", { action: "createVersion", projectId: "p1" });
    expect(second.body.versionNumber).toBe(2);
    expect(second.body.note).toBeNull();

    const list = await runEditorAction(store, "u1", { action: "versions", projectId: "p1" });
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(2);
    const rows = list.body.versions as { versionNumber: number; note: string | null; snapshotBytes: number }[];
    expect(rows.map((r) => r.versionNumber)).toEqual([2, 1]);
    expect(rows[0].note).toBeNull();
    expect(rows[1].note).toBe("first cut");
    expect(rows.every((r) => r.snapshotBytes > 0)).toBe(true);
    // the list never carries the snapshot payload itself
    expect(Object.keys(rows[0])).not.toContain("snapshot");
  });

  test("restoreVersion puts an older timeline back into the working timeline", async () => {
    const { store } = memoryStore();
    const original = buildTimelineFromScenes(SCENES);

    // version 1 = the original scaffold
    await runEditorAction(store, "u1", { action: "createVersion", projectId: "p1", note: "original" });
    // then destructively edit
    const edited = trimClip(original, { clipId: "sc-s1-video", startMs: 0, endMs: 1000 }).timeline;
    await runEditorAction(store, "u1", { action: "save", projectId: "p1", timeline: edited });

    const restored = await runEditorAction(store, "u1", { action: "restoreVersion", projectId: "p1", versionNumber: 1 });
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toBe(true);
    expect(restored.body.versionNumber).toBe(1);
    const restoredTimeline = timelineOf(restored.body);
    expect(timelinesEqual(restoredTimeline, original)).toBe(true);
    expect(restoredTimeline.clips.find((c) => c.id === "sc-s1-video")!.endMs).toBe(5000);

    // the restore is persisted as the working timeline
    const loaded = await runEditorAction(store, "u1", { action: "load", projectId: "p1" });
    expect(loaded.body.source).toBe("saved");
    expect(timelinesEqual(timelineOf(loaded.body), original)).toBe(true);
  });

  test("unknown version → 404, invalid version number → 400", async () => {
    const { store } = memoryStore();
    const missing = await runEditorAction(store, "u1", { action: "restoreVersion", projectId: "p1", versionNumber: 7 });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("not_found");

    const invalid = await runEditorAction(store, "u1", { action: "restoreVersion", projectId: "p1", versionNumber: 0 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("invalid_version_number");
  });
});

describe("POST /api/studio/editor — request contract", () => {
  test("unknown action → 400 listing the supported actions", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "publish", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown action.");
    for (const action of EDITOR_ACTIONS) expect(String(res.body.note)).toContain(action);
  });

  test("missing projectId → 400", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "load" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("project_id_required");
  });

  test("a foreign project is a 404 for every action (never 403)", async () => {
    const { store } = memoryStore();
    for (const action of EDITOR_ACTIONS) {
      const res = await runEditorAction(store, "intruder", { action, projectId: "p1", versionNumber: 1 });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("not_found");
    }
  });

  test("a non-object body is treated as empty input", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", "not-an-object");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown action.");
  });
});

/* ------------------------------------------------------------------ */
/* Phase 5 Block 2 — sceneControl / autoTransitions / version filtering */
/* ------------------------------------------------------------------ */

const SIX_SCENES: EditorSceneRow[] = [
  { id: "s1", title: "Intro", narration: "The film opens on a quiet street.", durationSeconds: 5 },
  { id: "s2", title: "Setup", narration: "A second beat of narration.", durationSeconds: 5 },
  { id: "s3", title: "Problem", narration: "The difficulty shows up now.", durationSeconds: 5 },
  { id: "s4", title: "Turn", narration: "Everything changes here.", durationSeconds: 5 },
  { id: "s5", title: "Climax", narration: "The loudest moment of all.", durationSeconds: 5 },
  { id: "s6", title: "Outro", narration: "And the calm returns.", durationSeconds: 5 },
];

interface ProviderGateView {
  capability: string;
  connected: boolean;
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

interface MusicSelectionView {
  categoryId: string;
  name: string;
  score: number;
  reason: string;
  mood: string;
  energy: number;
  pace: string;
  gain: number;
}

function gateOf(body: Record<string, unknown>): ProviderGateView {
  return body.provider as ProviderGateView;
}

/** Honest-gate invariant shared by every provider-gated control. */
function assertHonestGate(gate: ProviderGateView, capability: string): void {
  expect(gate).toBeDefined();
  expect(gate.capability).toBe(capability);
  expect(gate.connected).toBe(false);
  expect(Array.isArray(gate.requiredEnv)).toBe(true);
  // env var NAMES only — never a `KEY=value` pair, never a secret value — and
  // every name is one the provider env-key registry actually declares, i.e. a
  // name some code really reads. An EMPTY list is allowed only when nothing
  // serves the capability, and then the note says exactly that.
  for (const name of gate.requiredEnv) {
    expect(name).toMatch(/^[A-Z0-9_]+$/);
    expect(allProviderEnvVars()).toContain(name);
  }
  if (gate.requiredEnv.length === 0) {
    expect(gate.envHint).toBeNull();
    expect(gate.note).toContain("No provider is wired");
  } else {
    expect(gate.note).toContain(gate.requiredEnv[0]);
  }
  expect(typeof gate.note).toBe("string");
  expect(gate.note.length).toBeGreaterThan(0);
}

describe("POST /api/studio/editor — sceneControl", () => {
  test("unknown control → 400 listing the seven supported controls", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "regenerateEverything",
      sceneId: "s1",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_control");
    for (const control of SCENE_CONTROLS) expect(String(res.body.note)).toContain(control);
  });

  test("missing sceneId → 400", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "changeTransition",
      kind: "fade",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("scene_id_required");
  });

  test("a scene that is on neither the project nor the timeline → 404", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "regenerateScene",
      sceneId: "ghost",
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("scene_not_found");
  });

  test("changeTransition applies to the scene's outgoing clip and returns the timeline", async () => {
    const { store } = memoryStore();
    const built = buildTimelineFromScenes(SCENES);
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "changeTransition",
      sceneId: "s1",
      kind: "fade",
      timeline: built,
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("sceneControl");
    expect(res.body.control).toBe("changeTransition");
    expect(res.body.sceneId).toBe("s1");
    expect(res.body.sceneSource).toBe("project");
    expect(res.body.timelineSource).toBe("request");
    expect(res.body.changed).toBe(true);
    expect((res.body.changelist as string[]).length).toBeGreaterThan(0);
    // scene controls plan only — the client saves the timeline itself
    expect(res.body.persisted).toBe(false);

    const timeline = timelineOf(res.body);
    const outgoing = clipById(timeline, "sc-s1-video")!;
    expect(outgoing.transition?.kind).toBe("fade");
    // the catalog midpoint for fade (300-600ms) — deterministic, no provider
    expect(outgoing.transition?.durationMs).toBe(450);
    expect(res.body.provider).toBeUndefined();
    // no clip was invented and the other scenes are untouched
    expect(clipsAt(timeline, "video").map((c) => c.id)).toEqual(["sc-s1-video", "sc-s2-video"]);
    expect(clipsAt(timeline, "video").find((c) => c.id === "sc-s2-video")!.transition).toBeFalsy();
  });

  test("regenerateScene re-derives a scene's clips without duplicating them", async () => {
    const { store } = memoryStore();
    const built = buildTimelineFromScenes(SCENES);
    const trimmed = trimClip(built, { clipId: "sc-s1-video", endMs: 3000 }).timeline;
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "regenerateScene",
      sceneId: "s1",
      timeline: trimmed,
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    const timeline = timelineOf(res.body);
    expect(clipById(timeline, "sc-s1-video")!.endMs).toBe(5000);
    // 2 scenes x (video + voice + subtitles) — the stale clip was replaced, not kept
    expect(timeline.clips.length).toBe(built.clips.length);
    expect(timeline.clips.filter((c) => c.id === "sc-s1-video").length).toBe(1);
  });

  test("regenerateVisual is provider-gated: honest gate, plan only, no timeline change", async () => {
    const { store } = memoryStore();
    const built = buildTimelineFromScenes(SCENES);
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "regenerateVisual",
      sceneId: "s1",
      visualPrompt: "A slow dolly over a rain-soaked city",
      timeline: built,
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    // nothing was generated → no timeline is returned at all
    expect(res.body.timeline).toBeUndefined();
    assertHonestGate(gateOf(res.body), "image_generation");
    const plan = res.body.plan as { applied: boolean; visualPrompt: string; clipIds: string[] };
    expect(plan.applied).toBe(false);
    expect(plan.visualPrompt).toContain("rain-soaked city");
    expect(plan.clipIds).toContain("sc-s1-video");
    expect(String(res.body.note)).toContain("Provider Not Connected");
    expect(String(res.body.changelist).length).toBeGreaterThan(0);
  });

  test("regenerateVoice reports the honest TTS gate", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "regenerateVoice",
      sceneId: "s1",
      timeline: buildTimelineFromScenes(SCENES),
    });
    expect(res.status).toBe(200);
    assertHonestGate(gateOf(res.body), "voice_generation");
    expect(gateOf(res.body).requiredEnv.join(" ")).toContain("ELEVENLABS_API_KEY");
    expect(String(res.body.note)).toContain("no speech was synthesized");
  });

  test("changeMusic selects a category deterministically and gates synthesis honestly", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "changeMusic",
      sceneId: "s2",
      mood: "epic",
      energy: 80,
      timeline: buildTimelineFromScenes(SCENES),
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    const selection = res.body.selection as MusicSelectionView;
    expect(selection.categoryId.length).toBeGreaterThan(0);
    expect(selection.name.length).toBeGreaterThan(0);
    expect(typeof selection.score).toBe("number");
    expect(selection.mood).toBe("epic");
    expect(selection.energy).toBe(80);
    expect(selection.pace).toBe("fast");
    expect(selection.gain).toBeCloseTo(0.44, 5);
    assertHonestGate(gateOf(res.body), "music_generation");
    expect(String(res.body.note)).toContain("Deterministic pick");
    // the music clip plan really landed on the timeline (span + gain + category)
    const timeline = timelineOf(res.body);
    const music = clipsAt(timeline, "music").find((c) => c.sceneId === "s2")!;
    expect(music.sourceRef).toBe(`music-category:${selection.categoryId}`);
    expect(music.gain).toBe(selection.gain);
    expect([music.startMs, music.endMs]).toEqual([5000, 11_000]);
  });

  test("restyleScene records the grade and returns a changelist", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "restyleScene",
      sceneId: "s1",
      grade: "cinematic-warm",
      timeline: buildTimelineFromScenes(SCENES),
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    const changelist = res.body.changelist as string[];
    expect(changelist.some((line) => line.includes("grade:") && line.includes("cinematic-warm"))).toBe(true);
    const timeline = timelineOf(res.body);
    expect(clipById(timeline, "sc-s1-video")!.grade).toBe("cinematic-warm");
    // only the scene's own visual clips are graded
    expect(clipById(timeline, "sc-s2-video")!.grade).toBeUndefined();
    const plan = res.body.plan as { applied: boolean; grade: string; clipIds: string[] };
    expect(plan.applied).toBe(true);
    expect(plan.grade).toBe("cinematic-warm");
    expect(plan.clipIds).toContain("sc-s1-video");
  });

  test("a control on a scene that only exists on the supplied timeline still works", async () => {
    const { store } = memoryStore({ scenes: [] });
    const built = buildTimelineFromScenes(SCENES);
    const res = await runEditorAction(store, "u1", {
      action: "sceneControl",
      projectId: "p1",
      control: "changeSubtitle",
      sceneId: "s2",
      styleId: "cinematic",
      timeline: built,
    });
    expect(res.status).toBe(200);
    expect(res.body.sceneSource).toBe("timeline");
    expect(res.body.changed).toBe(true);
    expect(clipById(timelineOf(res.body), "sc-s2-subtitles")!.subtitleStyle).toBe("cinematic");
  });
});

describe("POST /api/studio/editor — autoTransitions", () => {
  test("a 6-scene timeline gets a conservative set of transitions", async () => {
    const { store } = memoryStore({ scenes: SIX_SCENES });
    const built = buildTimelineFromScenes(SIX_SCENES);
    const res = await runEditorAction(store, "u1", {
      action: "autoTransitions",
      projectId: "p1",
      timeline: built,
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("autoTransitions");
    expect(res.body.persisted).toBe(false);
    const timeline = timelineOf(res.body);
    const video = clipsAt(timeline, "video");
    expect(video.length).toBe(6);
    expect(timeline.clips.length).toBe(built.clips.length);

    // policy: a timeline never opens on a blend
    expect(video[0].transition == null).toBe(true);
    const summary = res.body.transitions as { total: number; nonCut: number; dramatic: number; cuts: number };
    expect(summary.total).toBe(video.filter((c) => c.transition).length);
    expect(summary.nonCut).toBeGreaterThanOrEqual(1);
    expect(summary.nonCut).toBeLessThanOrEqual(2); // conservative budget on 5 edges
    expect(summary.cuts + summary.nonCut).toBe(summary.total);
    expect(summary.dramatic).toBeLessThanOrEqual(summary.nonCut);
    expect(res.body.violations).toEqual([]);
    // the blends sit on scene boundaries and use catalog kinds only
    const nonCut = video.filter((c) => c.transition && c.transition.kind !== "cut");
    for (const clip of nonCut) {
      const index = video.indexOf(clip);
      const next = video[index + 1];
      expect(next).toBeDefined();
      expect(next.sceneId).not.toBe(clip.sceneId);
    }
    expect(String(res.body.note)).toContain("nothing was persisted".replace("nothing", "Nothing"));

    // idempotent: running the policy again returns a structurally identical timeline
    const again = await runEditorAction(store, "u1", {
      action: "autoTransitions",
      projectId: "p1",
      timeline,
    });
    expect(again.status).toBe(200);
    expect(timelinesEqual(timelineOf(again.body), timeline)).toBe(true);
  });

  test("autoTransitions without a supplied timeline uses the project's scenes", async () => {
    const { store } = memoryStore({ scenes: SIX_SCENES });
    const res = await runEditorAction(store, "u1", { action: "autoTransitions", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(clipsAt(timelineOf(res.body), "video").length).toBe(6);
  });
});

describe("POST /api/studio/editor — version filtering", () => {
  test("non-editor snapshots are hidden from the list and counted honestly", async () => {
    const { store, versions } = memoryStore();
    await runEditorAction(store, "u1", { action: "createVersion", projectId: "p1", note: "editor cut" });
    // A Phase 1-3 PROJECT snapshot shares the ProjectVersion table.
    versions.push({
      versionNumber: 9,
      note: "phase 1 project snapshot",
      snapshot: { projectId: "p1", projectTitle: "Test project", scenes: [] },
      createdAt: new Date(),
      createdById: "u1",
    });

    const list = await runEditorAction(store, "u1", { action: "versions", projectId: "p1" });
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(1);
    expect(list.body.hiddenCount).toBe(1);
    const rows = list.body.versions as { versionNumber: number }[];
    expect(rows.map((r) => r.versionNumber)).toEqual([1]);
    expect(String(list.body.note)).toContain("1 non-editor snapshot");
  });

  test("hiddenCount is 0 and no note is added when every snapshot is an editor timeline", async () => {
    const { store } = memoryStore();
    await runEditorAction(store, "u1", { action: "createVersion", projectId: "p1" });
    await runEditorAction(store, "u1", { action: "createVersion", projectId: "p1", note: "second" });
    const list = await runEditorAction(store, "u1", { action: "versions", projectId: "p1" });
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(2);
    expect(list.body.hiddenCount).toBe(0);
    expect(list.body.note).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Phase 5 Block 3 — autoEdit / analyzePacing                          */
/* ------------------------------------------------------------------ */

const FAST_SCENES: EditorSceneRow[] = [
  { id: "f1", title: "Beat one", narration: "A short line.", durationSeconds: 2 },
  { id: "f2", title: "Beat two", narration: "Another short line.", durationSeconds: 2 },
  { id: "f3", title: "Beat three", narration: "A third short line.", durationSeconds: 2 },
];

const SLOW_SCENES: EditorSceneRow[] = [
  { id: "k1", title: "Long take one", narration: "A longer development of the idea.", durationSeconds: 10 },
  { id: "k2", title: "Long take two", narration: "And the second long development.", durationSeconds: 10 },
];

describe("POST /api/studio/editor — autoEdit", () => {
  test("unknown command → 400 listing the twelve commands", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "autoEdit",
      projectId: "p1",
      command: "moreEverything",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_command");
    expect(res.body.error).toBe("Unknown command.");
    for (const command of AUTO_EDITOR_COMMANDS) expect(String(res.body.note)).toContain(command);
  });

  test("missing command → 400", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "autoEdit", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_command");
  });

  test("applies a deterministic command, returns the timeline and persists nothing", async () => {
    const { store, raw } = memoryStore({ scenes: SIX_SCENES });
    const built = buildTimelineFromScenes(SIX_SCENES);
    const res = await runEditorAction(store, "u1", {
      action: "autoEdit",
      projectId: "p1",
      command: "strongerHook",
      timeline: built,
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("autoEdit");
    expect(res.body.command).toBe("strongerHook");
    expect(res.body.timelineSource).toBe("request");
    expect(res.body.changed).toBe(true);
    expect((res.body.changelist as string[]).length).toBeGreaterThan(0);
    expect(res.body.persisted).toBe(false);
    const timeline = timelineOf(res.body);
    // the hook shot is ≤3s, the following scenes moved up and a title card exists
    expect(clipsAt(timeline, "video")[0].endMs - clipsAt(timeline, "video")[0].startMs).toBeLessThanOrEqual(3000);
    expect(clipsAt(timeline, "video")[1].startMs).toBe(3000);
    expect(timeline.clips.filter((c) => c.sourceRef === "hook:title").length).toBe(1);
    expect(res.body.clipCount).toBe(timeline.clips.length);
    expect(res.body.clipCount).toBe(built.clips.length + 1);
    expect(res.body.durationMs).toBe(timeline.durationMs);
    expect(res.body.durationMs).toBe(28_000);
    // pure: nothing reached the store
    expect(raw()).toBeNull();
    // the pure commands carry no provider gate at all
    expect(res.body.provider).toBeUndefined();
  });

  test("without a supplied timeline it works from the project's scenes", async () => {
    const { store } = memoryStore({ scenes: SIX_SCENES });
    const res = await runEditorAction(store, "u1", { action: "autoEdit", projectId: "p1", command: "moreBroll" });
    expect(res.status).toBe(200);
    expect(res.body.timelineSource).toBe("timeline");
    const timeline = timelineOf(res.body);
    expect(clipsAt(timeline, "video").length).toBe(6);
    expect(clipsAt(timeline, "broll").length).toBe(5); // one insert per boundary
    for (const clip of clipsAt(timeline, "broll")) {
      const span = clip.endMs - clip.startMs;
      expect(span).toBeGreaterThanOrEqual(1500);
      expect(span).toBeLessThanOrEqual(2500);
      expect(String(clip.sourceRef)).toMatch(/^scene:/);
    }
  });

  test("a command with nothing to do returns the same timeline and an empty changelist", async () => {
    const { store } = memoryStore({ scenes: SIX_SCENES });
    const built = buildTimelineFromScenes(SIX_SCENES);
    const first = await runEditorAction(store, "u1", {
      action: "autoEdit",
      projectId: "p1",
      command: "reduceRepetition",
      timeline: built,
    });
    expect(first.status).toBe(200);
    expect(first.body.changed).toBe(false);
    expect(first.body.changelist).toEqual([]);
    expect(timelinesEqual(timelineOf(first.body), built)).toBe(true);
    expect(String(first.body.note).length).toBeGreaterThan(0);
  });

  test("a malformed timeline body → 400", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", {
      action: "autoEdit",
      projectId: "p1",
      command: "moreCinematic",
      timeline: { clips: "nope" },
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_timeline");
  });

  test("youtubeOptimized returns the honest SEO gate next to the real edits", async () => {
    const { store } = memoryStore({ scenes: SIX_SCENES });
    const res = await runEditorAction(store, "u1", {
      action: "autoEdit",
      projectId: "p1",
      command: "youtubeOptimized",
      timeline: buildTimelineFromScenes(SIX_SCENES),
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    assertHonestGate(gateOf(res.body), "seo_generation");
    // seo_generation is served by openai/anthropic/google — the derived names.
    expect(gateOf(res.body).requiredEnv).toContain("OPENAI_API_KEY");
    expect(gateOf(res.body).requiredEnv).toContain("ANTHROPIC_API_KEY");
    expect(gateOf(res.body).requiredEnv.join(" ")).not.toContain("LLM_PROVIDER_API_KEY");
    const plan = res.body.plan as { suggestions: { requested: string[]; produced: boolean } };
    expect(plan.suggestions.produced).toBe(false);
    expect(plan.suggestions.requested).toEqual(["title", "description"]);
    // The note's connectivity sentence is DERIVED from the registry on every
    // call, so the assertion is derived too: seo_generation is served by a WIRED
    // slot on this build (openai), so the note must name that slot and its env
    // var and repeat the live reason — never a fixed "not wired"/"not connected"
    // claim, and never that a title or description was written.
    const liveSeo = capabilityConnectivity("seo_generation");
    expect(liveSeo.wiredSlots.map((s) => s.id)).toContain("openai");
    expect(String(res.body.note)).toContain(liveSeo.wiredSlots[0].id);
    expect(String(res.body.note)).toContain("OPENAI_API_KEY");
    expect(String(res.body.note)).toContain(liveSeo.reason);
    expect(String(res.body.note)).not.toContain("not wired");
    expect(String(res.body.note)).toContain("no code path that dispatches to a provider");
    const seoLine = (res.body.changelist as string[]).find((line) => line.startsWith("seo:"));
    expect(seoLine).toBeDefined();
    expect(seoLine!).toContain("NOT generated");
    expect(seoLine!).toContain(liveSeo.reason);
    expect(seoLine!).not.toContain("is not connected");
    // the deterministic half really landed: safe margins on every caption clip
    expect(
      clipsAt(timelineOf(res.body), "subtitles").every((c) => c.sourceRef === "subtitle:safe-margin"),
    ).toBe(true);
  });

  test("betterVoiceover reports the honest TTS gate", async () => {
    const { store } = memoryStore({ scenes: SIX_SCENES });
    const res = await runEditorAction(store, "u1", {
      action: "autoEdit",
      projectId: "p1",
      command: "betterVoiceover",
      timeline: buildTimelineFromScenes(SIX_SCENES),
    });
    expect(res.status).toBe(200);
    assertHonestGate(gateOf(res.body), "voice_generation");
    expect(gateOf(res.body).requiredEnv).toContain("ELEVENLABS_API_KEY");
    expect(gateOf(res.body).requiredEnv).toContain("AZURE_SPEECH_KEY");
    expect(gateOf(res.body).requiredEnv).toContain("AZURE_SPEECH_REGION");
    expect(gateOf(res.body).requiredEnv.join(" ")).not.toContain("VOICE_PROVIDER_API_KEY");
  });
});

describe("POST /api/studio/editor — analyzePacing", () => {
  test("returns the five dimensions, the overall reading and the band", async () => {
    const { store, raw } = memoryStore({ scenes: SIX_SCENES });
    const res = await runEditorAction(store, "u1", {
      action: "analyzePacing",
      projectId: "p1",
      timeline: buildTimelineFromScenes(SIX_SCENES),
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("analyzePacing");
    expect(res.body.timelineSource).toBe("request");
    const dimensions = res.body.dimensions as Record<string, { score: number; label: string; reason: string }>;
    expect(Object.keys(dimensions)).toEqual([...PACE_DIMENSIONS]);
    for (const id of PACE_DIMENSIONS) {
      expect(dimensions[id].score).toBeGreaterThanOrEqual(0);
      expect(dimensions[id].score).toBeLessThanOrEqual(100);
      expect(dimensions[id].label.length).toBeGreaterThan(0);
      expect(dimensions[id].reason.length).toBeGreaterThan(0);
    }
    expect(res.body.overall).toBeGreaterThanOrEqual(0);
    expect(res.body.overall).toBeLessThanOrEqual(100);
    expect(["too slow", "balanced", "too fast"]).toContain(String(res.body.band));
    expect(res.body.clipCount).toBe(18);
    expect(res.body.durationMs).toBe(30_000);
    expect(res.body.persisted).toBe(false);
    // BLOCK 9 — the provider half of the note is DERIVED from the registry now
    // (see src/lib/editor/__tests__/pacing-provider-note.test.ts): over HTTP it
    // must state what an AI pass would REQUIRE and what the live registry says,
    // never a fixed claim about this server's keys.
    expect(String(res.body.note)).toContain("would need a provider that is configured AND wired");
    expect(String(res.body.note)).toContain("no code path that dispatches to a provider");
    expect(String(res.body.note)).not.toContain("none is connected");
    // analysing never writes the timeline back
    expect(raw()).toBeNull();
  });

  test("a faster cadence reads a higher sceneChange", async () => {
    const { store } = memoryStore();
    const fast = await runEditorAction(store, "u1", {
      action: "analyzePacing",
      projectId: "p1",
      timeline: buildTimelineFromScenes(FAST_SCENES),
    });
    const slow = await runEditorAction(store, "u1", {
      action: "analyzePacing",
      projectId: "p1",
      timeline: buildTimelineFromScenes(SLOW_SCENES),
    });
    const scoreOf = (res: { body: Record<string, unknown> }) =>
      (res.body.dimensions as Record<string, { score: number }>).sceneChange.score;
    expect(scoreOf(fast)).toBeGreaterThan(scoreOf(slow));
    expect(scoreOf(fast)).toBe(100);
    expect(scoreOf(slow)).toBe(0);
  });

  test("without a supplied timeline it reads the project's saved timeline", async () => {
    const { store } = memoryStore({ scenes: SIX_SCENES });
    const res = await runEditorAction(store, "u1", { action: "analyzePacing", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.timelineSource).toBe("timeline");
    expect(res.body.clipCount).toBe(18);
  });
});

/**
 * Phase 5 Block 4 — the colour system is served through THIS endpoint.
 * These tests pin the wiring (route → editor service → src/lib/color) and the
 * tenancy/error contract the UI depends on; the colour engine's own behaviour is
 * covered in src/lib/color/__tests__.
 */
describe("POST /api/studio/editor — Block 4 colour actions", () => {
  test("listGrades is reachable through the editor endpoint and returns the nine grades", async () => {
    const { store } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "listGrades", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("listGrades");
    expect(res.body.projectId).toBe("p1");
    expect(res.body.count).toBe(9);
    expect((res.body.grades as { id: string }[]).map((g) => g.id)).toEqual([...COLOR_GRADE_IDS]);
  });

  test("applyGrade records the assignment on the project's settings and stays deterministic", async () => {
    const { store, colorGrade } = memoryStore();
    const res = await runEditorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "cinematic" });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("project");
    expect(res.body.changed).toBe(true);
    expect(res.body.persisted).toBe(true);
    expect((colorGrade() as { project: string }).project).toBe("cinematic");
    // The renderer parameter set travels with the answer.
    const render = res.body.render as { performed: boolean; lut: { baked: boolean } };
    expect(render.performed).toBe(false);
    expect(render.lut.baked).toBe(false);
    // Identical input → byte-identical plan.
    const again = await runEditorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "cinematic" });
    expect(JSON.stringify(res.body.render)).toBe(JSON.stringify(again.body.render));
  });

  test("renderGradePreview returns the honest provider gate and changes nothing", async () => {
    const { store, colorGrade } = memoryStore();
    await runEditorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "moody" });
    const before = JSON.stringify(colorGrade());
    const res = await runEditorAction(store, "u1", { action: "renderGradePreview", projectId: "p1" });
    expect(res.status).toBe(200);
    const gate = res.body.provider as { connected: boolean; requiredEnv: string[]; envHint: string; note: string };
    expect(gate.connected).toBe(false);
    // video_enhancement → the replicate + runway slots → their registry keys.
    expect(gate.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    expect(gate.envHint).toBe("REPLICATE_API_TOKEN or RUNWAY_API_KEY");
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect(JSON.stringify(colorGrade())).toBe(before);
  });

  test("resetGrade clears the assignment", async () => {
    const { store, colorGrade } = memoryStore();
    await runEditorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "rich" });
    const res = await runEditorAction(store, "u1", { action: "resetGrade", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect((colorGrade() as { project: string | null }).project).toBeNull();
  });

  test("an unknown grade is 400 and an unknown colour action is 400", async () => {
    const { store } = memoryStore();
    const badGrade = await runEditorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "noir" });
    expect(badGrade.status).toBe(400);
    expect(badGrade.body.code).toBe("unknown_grade");
    const badAction = await runEditorAction(store, "u1", { action: "renderFrames", projectId: "p1" });
    expect(badAction.status).toBe(400);
    expect(String(badAction.body.note)).toContain("renderGradePreview");
  });

  test("a foreign project is a 404 for every colour action (never 403)", async () => {
    const { store } = memoryStore({ ownerId: "someone-else" });
    for (const action of ["listGrades", "applyGrade", "resetGrade", "renderGradePreview"]) {
      const res = await runEditorAction(store, "u1", { action, projectId: "p1", gradeId: "cinematic" });
      expect(res.status, action).toBe(404);
      expect(res.body.code).toBe("not_found");
    }
  });

  test("the colour actions are part of the advertised action list", () => {
    for (const action of ["listGrades", "applyGrade", "resetGrade", "renderGradePreview"]) {
      expect([...EDITOR_ACTIONS]).toContain(action);
    }
  });
});

describe("POST /api/studio/editor — Phase 6 Block 1 export actions", () => {
  test("the export actions are part of the advertised action list", () => {
    for (const action of ["listExportPresets", "planExport", "applyExportPreset", "clearExportPreset"]) {
      expect([...EDITOR_ACTIONS]).toContain(action);
    }
  });

  test("apply → plan routes through the single editor surface and persists the choice", async () => {
    const { store, exportPreset } = memoryStore();
    const applied = await runEditorAction(store, "u1", {
      action: "applyExportPreset",
      projectId: "p1",
      presetIds: ["youtube-1080p"],
    });
    expect(applied.status).toBe(200);
    expect(applied.body.persisted).toBe(true);
    expect(exportPreset()).not.toBeNull();

    const planned = await runEditorAction(store, "u1", { action: "planExport", projectId: "p1" });
    expect(planned.status).toBe(200);
    const manifest = planned.body.manifest as Record<string, unknown>;
    expect(manifest.fileCount).toBe(1);
    expect(manifest.filesProduced).toBe(0);
  });

  test("a foreign project is a 404 for every export action (never 403)", async () => {
    const { store } = memoryStore({ ownerId: "someone-else" });
    for (const action of ["listExportPresets", "planExport", "applyExportPreset", "clearExportPreset"]) {
      const res = await runEditorAction(store, "u1", { action, projectId: "p1", presetIds: ["youtube-1080p"] });
      expect(res.status, action).toBe(404);
      expect(res.body.code).toBe("not_found");
    }
  });
});
