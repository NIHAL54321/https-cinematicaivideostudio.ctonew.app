import { describe, expect, test } from "bun:test";
import {
  REPURPOSE_ACTIONS,
  REPURPOSE_ANALYSIS_ENV_NAMES,
  REPURPOSE_RENDER_ENV_NAMES,
  REPURPOSE_RENDER_CAPABILITY,
  REPURPOSE_ANALYSIS_CAPABILITY,
  runRepurposeAction,
  type RepurposeSceneRow,
  type RepurposeStore,
} from "../service";
import { toSnapshot, type Timeline } from "../../editor/versions";
import { allProviderEnvVars } from "../../ai/providers/env-keys";
import { envNamesPhrase } from "../../ai/providers/capability-env";
import { buildTimelineFromScenes, type SceneInput } from "../../editor/timeline";

/**
 * Phase 5 Block 5a — the repurposing API contract.
 *
 * `runRepurposeAction` takes the store as an argument, so the whole action
 * surface is exercised here without a database. The in-memory store below is the
 * same interface src/lib/repurpose/store.ts implements, so the shapes asserted
 * here are the shapes the HTTP route returns.
 *
 * Covered: every action's success shape, config validation (typed 400s),
 * persistence + read-back, idempotence, the honest provider gates, and tenancy
 * (a foreign or missing project is a 404 for EVERY action — never 403).
 */

const SCENES: RepurposeSceneRow[] = [
  {
    id: "s1",
    title: "Intro",
    durationSeconds: 6,
    narration: "Why do 90% of documentaries fail in the first minute? You are about to see the method that changed everything.",
  },
  { id: "s2", title: "Setup", durationSeconds: 6, narration: "Most creators begin with the wrong question." },
  {
    id: "s3",
    title: "Discovery",
    durationSeconds: 10,
    narration: "But here is what nobody told you: I lost 40 hours on the first edit, and the reason was simple.",
  },
  {
    id: "s4",
    title: "Quote",
    durationSeconds: 10,
    narration: '"The edit is the film," the editor said. It was the best advice I ever received.',
  },
  {
    id: "s5",
    title: "Numbers",
    durationSeconds: 10,
    narration: "We cut the runtime by 62 percent and the retention increased by 3.5 times.",
  },
  {
    id: "s6",
    title: "How to",
    durationSeconds: 10,
    narration: "First, map the story beats. Second, learn the pacing rule, because the process means nothing without it.",
  },
];

interface MemoryStore {
  store: RepurposeStore;
  /** The raw value in ProjectSettings.extra.shortsRepurpose. */
  stored: () => unknown;
  /** Writes to that key (so "nothing was written" is provable). */
  writes: () => number;
  /** Force a stored value in, to simulate corrupt/legacy state. */
  seed: (value: unknown) => void;
}

function memoryStore(
  options: { ownerId?: string; scenes?: RepurposeSceneRow[]; rawTimeline?: unknown } = {},
): MemoryStore {
  const ownerId = options.ownerId ?? "u1";
  const scenes = options.scenes ?? SCENES;
  let stored: unknown = null;
  let writeCount = 0;
  const store: RepurposeStore = {
    async findOwnedProject(userId, projectId) {
      if (userId !== ownerId || projectId !== "p1") return null;
      return { id: "p1", title: "Test project" };
    },
    async listScenes() {
      return scenes;
    },
    async readRawTimeline() {
      return options.rawTimeline ?? null;
    },
    async readShortsRepurpose() {
      return stored;
    },
    async writeShortsRepurpose(_projectId, value) {
      writeCount += 1;
      stored = value;
    },
  };
  return { store, stored: () => stored, writes: () => writeCount, seed: (value) => (stored = value) };
}

async function call(store: RepurposeStore, body: Record<string, unknown>, userId = "u1") {
  const res = await runRepurposeAction(store, userId, { projectId: "p1", ...body });
  return res as { status: number; body: Record<string, unknown> };
}

describe("repurposing — action routing and tenancy", () => {
  test("an unknown action is a 400 listing the four supported actions", async () => {
    const { store } = memoryStore();
    const res = await runRepurposeAction(store, "u1", { action: "makeShorts", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown repurposing action.");
    for (const action of REPURPOSE_ACTIONS) expect(String(res.body.note)).toContain(action);
    expect(REPURPOSE_ACTIONS.length).toBe(4);
  });

  test("a missing projectId is a 400 before anything else happens", async () => {
    const { store, writes } = memoryStore();
    const res = await runRepurposeAction(store, "u1", { action: "listShortsMoments" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("project_id_required");
    expect(writes()).toBe(0);
  });

  test("a foreign or missing project is a 404 for EVERY action — never 403, never data", async () => {
    const { store, writes } = memoryStore();
    for (const action of REPURPOSE_ACTIONS) {
      const foreign = await runRepurposeAction(store, "intruder", { action, projectId: "p1" });
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe("not_found");
      expect(foreign.body.error).toBe("Project not found.");
      expect(JSON.stringify(foreign.body)).not.toContain("s1");
      const missing = await runRepurposeAction(store, "u1", { action, projectId: "nope" });
      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe("not_found");
    }
    expect(writes()).toBe(0);
  });

  test("a non-object body is treated as empty input", async () => {
    const { store } = memoryStore();
    const res = await runRepurposeAction(store, "u1", "nope");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown repurposing action.");
  });
});

describe("repurposing — listShortsMoments", () => {
  test("returns scored, classified candidates with verbatim reasons and the config in force", async () => {
    const { store } = memoryStore();
    const res = await call(store, { action: "listShortsMoments" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("listShortsMoments");
    expect(res.body.timelineSource).toBe("scenes");
    expect(res.body.watchedFootage).toBe(false);
    expect(res.body.momentCount as number).toBeGreaterThan(0);
    const moments = res.body.moments as Record<string, unknown>[];
    expect(moments.length).toBeGreaterThan(0);
    for (const m of moments) {
      expect(typeof m.kind).toBe("string");
      expect(typeof m.score).toBe("number");
      expect((m.score as number) > 0).toBe(true);
      expect(String(m.reason)).toContain(`${m.score}/100`);
      expect(String(m.reason)).toContain("the footage was not analysed");
      expect(Array.isArray(m.signals)).toBe(true);
      expect((m.signals as unknown[]).length).toBeGreaterThan(0);
      expect(m.watchedFootage).toBe(false);
    }
    // The config is reported back so the client can show what was used.
    const config = res.body.config as { targets: Record<string, { count: number; minSeconds: number; maxSeconds: number }> };
    expect(config.targets.shorts.count).toBe(10);
    expect(config.targets.reels.count).toBe(5);
    expect(config.targets.tiktoks.count).toBe(5);
    expect(res.body.configSource).toBe("default");
    expect(res.body.totalClips as number).toBeGreaterThan(0);
    expect(res.body.persisted).toBe(false);
    expect(res.body.changed).toBe(false);
  });

  test("the honest provider gate: media analysis is not connected, env NAMES only, nothing changed", async () => {
    const { store, writes } = memoryStore();
    const res = await call(store, { action: "listShortsMoments" });
    const gate = res.body.provider as {
      capability: string;
      connected: boolean;
      requiredEnv: string[];
      envHint: string | null;
      note: string;
    };
    expect(gate.capability).toBe(REPURPOSE_ANALYSIS_CAPABILITY);
    expect(gate.connected).toBe(false);
    // Derived over speech_recognition + scene_detection (openai, google,
    // replicate, elevenlabs, azure) — every name is read by the registry.
    expect(gate.requiredEnv).toEqual(REPURPOSE_ANALYSIS_ENV_NAMES);
    expect(gate.requiredEnv).toContain("ELEVENLABS_API_KEY");
    expect(gate.requiredEnv).toContain("AZURE_SPEECH_KEY");
    expect(gate.requiredEnv).toContain("AZURE_SPEECH_REGION");
    expect(gate.envHint).toBe(envNamesPhrase(gate.requiredEnv));
    for (const name of gate.requiredEnv) {
      expect(name).toMatch(/^[A-Z0-9_]+$/);
      expect(allProviderEnvVars()).toContain(name);
    }
    expect(gate.note).toContain("no transcript was produced");
    const plan = res.body.plan as Record<string, unknown>;
    expect(plan.transcriptProduced).toBe(false);
    expect(plan.mediaAnalysed).toBe(false);
    expect(plan.clipsRendered).toBe(false);
    const render = plan.render as { connected: boolean; requiredEnv: string[] };
    expect(render.connected).toBe(false);
    expect(render.requiredEnv).toEqual(REPURPOSE_RENDER_ENV_NAMES);
    expect(render.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    expect(writes()).toBe(0);
  });

  test("an empty video lane plans zero clips and invents nothing", async () => {
    const { store } = memoryStore({ scenes: [] });
    const res = await call(store, { action: "listShortsMoments" });
    expect(res.status).toBe(200);
    expect(res.body.momentCount).toBe(0);
    expect(res.body.totalClips).toBe(0);
    const targets = res.body.targets as { produced: number; note: string }[];
    for (const t of targets) {
      expect(t.produced).toBe(0);
      expect(t.note.length).toBeGreaterThan(0);
    }
  });
});

describe("repurposing — configureShortsTargets", () => {
  /**
   * A long-form source (6 × 30s = 180s). The 52s fixture at the top of this file
   * cannot physically hold two non-overlapping 30-45s clips, so the
   * "the supplied config really changes the output" assertions use this one —
   * the shape the feature exists for. The shortfall case on a too-short source
   * is asserted separately, below.
   */
  const longTimeline = () =>
    buildTimelineFromScenes(SCENES.map((s): SceneInput => ({ ...s, durationSeconds: 30 })));

  test("a supplied config is really applied: it changes the counts, the windows and the selection", async () => {
    const { store } = memoryStore({ rawTimeline: toSnapshot(longTimeline()) });
    const before = await call(store, { action: "listShortsMoments" });
    const after = await call(store, {
      action: "configureShortsTargets",
      targets: { shorts: { count: 2, minSeconds: 30, maxSeconds: 45 }, reels: { enabled: false } },
    });
    expect(after.status).toBe(200);
    expect(after.body.configSource).toBe("request");
    expect(after.body.persisted).toBe(false);
    expect(after.body.changed).toBe(true);
    const shorts = (after.body.targets as { target: string; count: number; produced: number; minSeconds: number }[]).find(
      (t) => t.target === "shorts",
    );
    expect(shorts?.count).toBe(2);
    expect(shorts?.produced).toBe(2); // the count is honoured when the window fits
    expect(shorts?.minSeconds).toBe(30);
    for (const clip of after.body.clips as { target: string; durationMs: number }[]) {
      if (clip.target !== "shorts") continue;
      expect(clip.durationMs).toBeGreaterThanOrEqual(30_000);
      expect(clip.durationMs).toBeLessThanOrEqual(45_000);
    }
    const closedReels = (after.body.targets as { target: string; enabled: boolean; produced: number }[]).find(
      (t) => t.target === "reels",
    );
    expect(closedReels?.enabled).toBe(false);
    expect(closedReels?.produced).toBe(0);
    expect((before.body.clips as unknown[]).length).toBeGreaterThan((after.body.clips as unknown[]).length);
  });

  test("a window too wide for the source is reported as a shortfall, not papered over", async () => {
    // Same request against a 52s source: 2 non-overlapping 30-45s clips do not
    // fit, so the engine returns 1 and says how many candidates it skipped.
    const { store } = memoryStore();
    const res = await call(store, {
      action: "configureShortsTargets",
      targets: { shorts: { count: 2, minSeconds: 30, maxSeconds: 45 }, reels: { enabled: false } },
    });
    expect(res.status).toBe(200);
    const shorts = (res.body.targets as { target: string; count: number; produced: number; skippedOverlap: number; note: string }[]).find(
      (t) => t.target === "shorts",
    );
    expect(shorts?.count).toBe(2);
    expect(shorts?.produced).toBe(1);
    expect(shorts?.skippedOverlap).toBeGreaterThan(0);
    expect(shorts?.note).toContain("1/2 clip(s) selected");
  });

  test("bad configs are typed 400s and nothing is written", async () => {
    const { store, writes } = memoryStore();
    const cases: { targets: unknown; code: string }[] = [
      { targets: { shorts: { count: 0 } }, code: "invalid_count" },
      { targets: { shorts: { count: 999 } }, code: "invalid_count" },
      { targets: { shorts: { minSeconds: 90, maxSeconds: 30 } }, code: "invalid_duration_window" },
      { targets: { reels: { maxSeconds: 2 } }, code: "invalid_duration_window" },
      { targets: { tiktoks: { kinds: [] } }, code: "invalid_kinds" },
      { targets: { tiktoks: { kinds: ["funny"] } }, code: "unknown_clip_kind" },
      { targets: { youtube: { count: 3 } }, code: "unknown_target" },
      { targets: "nope", code: "invalid_config" },
    ];
    for (const { targets, code } of cases) {
      const res = await call(store, { action: "configureShortsTargets", targets });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
      expect(res.body.persisted).toBe(false);
      expect(res.body.changed).toBe(false);
      expect(String(res.body.note).length).toBeGreaterThan(0);
    }
    expect(writes()).toBe(0);
    // The same bad config on the OTHER actions is refused identically.
    for (const action of ["listShortsMoments", "applyShorts", "clearShorts"]) {
      const res = await call(store, { action, targets: { shorts: { count: -1 } } });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_count");
    }
    expect(writes()).toBe(0);
  });
});

describe("repurposing — applyShorts / clearShorts persistence", () => {
  test("apply persists the chosen set as project metadata and it reads back deterministically", async () => {
    const { store, stored, writes } = memoryStore();
    const res = await call(store, { action: "applyShorts", targets: { shorts: { count: 3 } } });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("applyShorts");
    expect(res.body.changed).toBe(true);
    expect(res.body.persisted).toBe(true);
    expect(writes()).toBe(1);
    expect(res.body.totalClips as number).toBeGreaterThan(0);

    const raw = stored() as Record<string, unknown>;
    expect(raw.format).toBe("cavis.repurpose.shorts");
    expect(raw.version).toBe(1);
    expect(typeof raw.appliedAt).toBe("string");
    expect((raw.clips as unknown[]).length).toBe(res.body.totalClips as number);

    // Read back through the list action: the stored set is what the API reports.
    const readBack = await call(store, { action: "listShortsMoments" });
    const applied = readBack.body.applied as { clipCount: number; clips: { id: string; reason: string }[] } | null;
    expect(applied).not.toBeNull();
    expect(applied?.clipCount).toBe(res.body.totalClips as number);
    expect(readBack.body.configSource).toBe("applied");
    expect(applied?.clips[0].reason).toContain("no statistic was invented");

    // Apply exactly the same thing again: no second write, changed=false.
    const again = await call(store, { action: "applyShorts", targets: { shorts: { count: 3 } } });
    expect(again.body.changed).toBe(false);
    expect(again.body.persisted).toBe(false);
    expect(writes()).toBe(1);

    // Rebuilding the engine's own selection from the stored config matches.
    const plan = readBack.body.clips as { id: string }[];
    expect(plan.length).toBe(applied?.clipCount as number);
  });

  test("apply says so when the config produces no clips and writes nothing new", async () => {
    const { store } = memoryStore();
    const res = await call(store, {
      action: "applyShorts",
      targets: { shorts: { kinds: ["quote"], count: 1, minSeconds: 40, maxSeconds: 60 } },
    });
    expect(res.status).toBe(200);
    expect(res.body.totalClips as number).toBeGreaterThan(0); // the quoted scene is a real quote moment
    const empty = await call(store, { action: "applyShorts", targets: { shorts: { enabled: false }, reels: { enabled: false }, tiktoks: { enabled: false } } });
    expect(empty.status).toBe(200);
    expect(empty.body.totalClips).toBe(0);
    expect(empty.body.applied).not.toBeNull();
    expect(empty.body.applied).toMatchObject({ clipCount: 0 });
  });

  test("clear removes the metadata, reports the previous set and is idempotent", async () => {
    const { store, stored, writes } = memoryStore();
    await call(store, { action: "applyShorts" });
    expect(stored()).not.toBeNull();
    const cleared = await call(store, { action: "clearShorts" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.action).toBe("clearShorts");
    expect(cleared.body.changed).toBe(true);
    expect(cleared.body.persisted).toBe(true);
    expect(cleared.body.applied).toBeNull();
    expect((cleared.body.previous as { clipCount: number }).clipCount).toBeGreaterThan(0);
    expect(stored()).toBeNull();
    const before = writes();
    const again = await call(store, { action: "clearShorts" });
    expect(again.body.changed).toBe(false);
    expect(again.body.persisted).toBe(false);
    expect(writes()).toBe(before);
    const readBack = await call(store, { action: "listShortsMoments" });
    expect(readBack.body.applied).toBeNull();
    expect(readBack.body.configSource).toBe("default");
  });

  test("clear is pure metadata: it needs no provider gate and performs no media work", async () => {
    const { store } = memoryStore();
    await call(store, { action: "applyShorts" });
    const res = await call(store, { action: "clearShorts" });
    const plan = res.body.plan as Record<string, unknown>;
    expect(plan.clipsRendered).toBe(false);
    expect(res.body.provider).toBeUndefined();
  });
});

describe("repurposing — stored state is read defensively", () => {
  test("an unreadable stored value is reported, ignored, and never half-applied", async () => {
    const mem = memoryStore();
    // Simulate a corrupt/legacy value in ProjectSettings.extra.shortsRepurpose.
    mem.seed({ format: "something.else", clips: "nope" });
    expect(mem.stored()).not.toBeNull();
    const res = await call(mem.store, { action: "listShortsMoments" });
    expect(res.status).toBe(200);
    expect(res.body.unreadable).toBe(true);
    expect(res.body.applied).toBeNull();
    expect(String(res.body.note)).toContain("unreadable");
    expect(res.body.totalClips as number).toBeGreaterThan(0); // the plan is still built from the timeline
  });

  test("clips with an impossible window are dropped and counted, not trusted", async () => {
    const mem = memoryStore();
    mem.seed({
      format: "cavis.repurpose.shorts",
      version: 1,
      appliedAt: "2026-01-01T00:00:00.000Z",
      timelineMs: 52000,
      targets: { shorts: { enabled: true, count: 2, minSeconds: 20, maxSeconds: 60, kinds: ["highlight"] } },
      clips: [
        {
          id: "shorts-1",
          target: "shorts",
          rank: 1,
          label: "reversed window",
          clipKind: "highlight",
          momentKind: "hook",
          startMs: 10_000,
          endMs: 5_000,
          durationMs: -5_000,
        },
        {
          id: "shorts-2",
          target: "shorts",
          rank: 2,
          label: "usable window",
          clipKind: "highlight",
          momentKind: "hook",
          momentId: "hook-s0",
          score: 55,
          reason: "kept verbatim",
          startMs: 0,
          endMs: 20_000,
          durationMs: 20_000,
          scenes: ["s1"],
        },
      ],
    });
    const res = await call(mem.store, { action: "listShortsMoments" });
    const applied = res.body.applied as { clipCount: number; clips: { reason: string }[] } | null;
    expect(applied?.clipCount).toBe(1); // the reversed window was dropped
    expect(applied?.clips[0].reason).toBe("kept verbatim"); // and it is read back verbatim
    expect(String(res.body.note)).toContain("dropped");
  });

  test("a saved timeline is used when it is readable, and reported as the source", async () => {
    const timeline: Timeline = buildTimelineFromScenes([
      { id: "x1", title: "One", durationSeconds: 4, narration: "Hello." },
      { id: "x2", title: "Two", durationSeconds: 4, narration: "Goodbye." },
    ]);
    const mem = memoryStore({ rawTimeline: toSnapshot(timeline) });
    const res = await call(mem.store, { action: "listShortsMoments" });
    expect(res.status).toBe(200);
    expect(res.body.timelineSource).toBe("saved");
    expect(res.body.timelineMs).toBe(timeline.durationMs);
    expect(res.body.clipCount).toBe(timeline.clips.length);

    // An unreadable saved timeline falls back to the scenes and says so.
    const broken = memoryStore({ rawTimeline: { format: "cavis.editor.timeline", version: 1, timeline: "nope" } });
    const fallback = await call(broken.store, { action: "listShortsMoments" });
    expect(fallback.body.timelineSource).toBe("scenes");
  });
});
