import { describe, expect, test } from "bun:test";
import {
  COLOR_ACTIONS,
  COLOR_RENDER_ENV_NAMES,
  colorProviderGate,
  isColorAction,
  runColorAction,
  type ColorSceneRow,
  type ColorStore,
} from "../service";
import { COLOR_GRADES, COLOR_GRADE_IDS } from "../presets";
import { allProviderEnvVars } from "../../ai/providers/env-keys";
import { COLOR_ASSIGNMENT_FORMAT } from "../assignment";
import { toSnapshot } from "../../editor/versions";
import { buildTimelineFromScenes } from "../../editor/timeline";

/**
 * Phase 5 Block 4 — colour API contract test.
 *
 * The service is store-injected exactly so this can run without a database: the
 * in-memory store below is the same interface the Prisma store implements
 * (src/lib/color/store.ts), so the shapes asserted here are the shapes the HTTP
 * route returns.
 */

const SCENES: ColorSceneRow[] = [
  { id: "s1", title: "Intro" },
  { id: "s2", title: "Body" },
];

function memoryStore(options: { ownerId?: string; scenes?: ColorSceneRow[]; stored?: unknown; timelineOnly?: boolean } = {}) {
  const ownerId = options.ownerId ?? "u1";
  const scenes = options.scenes ?? SCENES;
  let stored: unknown = options.stored ?? null;
  let writes = 0;
  const timeline = options.timelineOnly
    ? toSnapshot(buildTimelineFromScenes([{ id: "manual-9", title: "Manual", narration: null, durationSeconds: 4 }]))
    : null;

  const store: ColorStore = {
    async findOwnedProject(userId, projectId) {
      if (userId !== ownerId || projectId !== "p1") return null;
      return { id: "p1", title: "Test project" };
    },
    async readColorGrade() {
      return stored;
    },
    async writeColorGrade(_projectId, value) {
      writes += 1;
      stored = value;
    },
    async listScenes() {
      return scenes;
    },
    async readRawTimeline() {
      return timeline;
    },
  };

  return { store, stored: () => stored, writes: () => writes };
}

describe("colour service — listGrades", () => {
  test("returns the nine grades with their real parameters and the current assignment", async () => {
    const { store, writes } = memoryStore();
    const res = await runColorAction(store, "u1", { action: "listGrades", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("listGrades");
    expect(res.body.count).toBe(9);
    const grades = res.body.grades as { id: string; parameters: Record<string, unknown>; description: string }[];
    expect(grades.map((g) => g.id)).toEqual([...COLOR_GRADE_IDS]);
    const cinematic = grades.find((g) => g.id === "cinematic")!;
    expect(cinematic.parameters.contrast).toBe(1.15);
    expect(cinematic.parameters.lutEquivalent).toContain("2383");
    expect(cinematic.description.length).toBeGreaterThan(80);
    expect(res.body.assignment).toEqual({ project: null, scenes: {} });
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    // A catalogue read is pure: nothing was written.
    expect(writes()).toBe(0);
  });

  test("carries the honest render gate (connected false + env var names only)", async () => {
    const { store } = memoryStore();
    const res = await runColorAction(store, "u1", { action: "listGrades", projectId: "p1" });
    const gate = res.body.provider as { connected: boolean; requiredEnv: string[]; envHint: string; capability: string; note: string };
    expect(gate.connected).toBe(false);
    // Derived for video_enhancement (replicate + runway) — never a literal.
    expect(gate.requiredEnv).toEqual(COLOR_RENDER_ENV_NAMES);
    expect(gate.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    expect(gate.envHint).toBe("REPLICATE_API_TOKEN or RUNWAY_API_KEY");
    expect(gate.capability).toBe("video_enhancement");
    expect(gate.note).toContain("nothing was rendered");
    // Names only — never a value.
    for (const name of gate.requiredEnv) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  test("reports an unreadable stored value honestly instead of pretending it is empty", async () => {
    const { store } = memoryStore({ stored: { nope: true } });
    const res = await runColorAction(store, "u1", { action: "listGrades", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.unreadable).toBe(true);
    expect(res.body.assignment).toEqual({ project: null, scenes: {} });
    expect(String(res.body.note)).toContain("unreadable");
  });

  test("ignores stored grade ids that left the catalogue and says how many", async () => {
    const { store } = memoryStore({
      stored: { format: COLOR_ASSIGNMENT_FORMAT, version: 1, project: "noir", scenes: { s2: "rich" } },
    });
    const res = await runColorAction(store, "u1", { action: "listGrades", projectId: "p1" });
    expect(res.body.droppedGrades).toEqual(["noir"]);
    expect((res.body.assignment as { scenes: Record<string, string> }).scenes).toEqual({ s2: "rich" });
  });
});

describe("colour service — applyGrade", () => {
  test("resolves the grade to renderer parameters and records it as the project default", async () => {
    const { store, stored, writes } = memoryStore();
    const res = await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "cinematic" });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("project");
    expect(res.body.gradeId).toBe("cinematic");
    expect(res.body.changed).toBe(true);
    expect(res.body.persisted).toBe(true);
    expect(writes()).toBe(1);
    expect(stored()).toEqual({
      format: COLOR_ASSIGNMENT_FORMAT,
      version: 1,
      project: "cinematic",
      scenes: {},
    });
    expect(res.body.assignment).toEqual({ project: "cinematic", scenes: {} });

    const render = res.body.render as { operations: { op: string }[]; lut: { baked: boolean }; performed: boolean; provider: { connected: boolean; requiredEnv: string[] } };
    expect(render.operations.length).toBe(8);
    expect(render.lut.baked).toBe(false);
    expect(render.performed).toBe(false);
    expect(render.provider.connected).toBe(false);
    expect(render.provider.requiredEnv).toEqual(COLOR_RENDER_ENV_NAMES);

    const plan = res.body.plan as { applied: boolean; pixelsRendered: boolean; lutBaked: boolean; toneMapped: boolean };
    expect(plan).toEqual({ applied: true, pixelsRendered: false, lutBaked: false, toneMapped: false, steps: 8 });
    expect(String(res.body.note)).toContain("no frames were decoded");
  });

  test("a scene scope records a per-scene override and keeps the project default", async () => {
    const { store, stored } = memoryStore();
    await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "cinematic" });
    const res = await runColorAction(store, "u1", {
      action: "applyGrade",
      projectId: "p1",
      gradeId: "moody",
      scope: "scene",
      sceneId: "s2",
    });
    expect(res.status).toBe(200);
    expect(res.body.sceneId).toBe("s2");
    expect(res.body.sceneSource).toBe("project");
    expect(res.body.assignment).toEqual({ project: "cinematic", scenes: { s2: "moody" } });
    expect(res.body.effective).toEqual({ gradeId: "moody", source: "scene" });
    expect(stored()).toEqual({ format: COLOR_ASSIGNMENT_FORMAT, version: 1, project: "cinematic", scenes: { s2: "moody" } });
  });

  test("a scene that only exists on the timeline is a valid target and is labelled as such", async () => {
    const { store } = memoryStore({ timelineOnly: true });
    const res = await runColorAction(store, "u1", {
      action: "applyGrade",
      projectId: "p1",
      gradeId: "filmic",
      scope: "scene",
      sceneId: "manual-9",
    });
    expect(res.status).toBe(200);
    expect(res.body.sceneSource).toBe("timeline");
    expect(res.body.changed).toBe(true);
  });

  test("re-applying the same grade is an honest no-op (nothing written)", async () => {
    const { store, writes } = memoryStore();
    await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "rich" });
    const before = writes();
    const res = await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "rich" });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect((res.body.changelist as string[])[0]).toContain("already rich");
    expect(writes()).toBe(before);
  });

  test("an unknown grade id is a 400 that lists the catalogue — never a silent default", async () => {
    const { store, writes } = memoryStore();
    const res = await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "noir" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_grade");
    expect(String(res.body.note)).toContain("cinematic");
    expect(writes()).toBe(0);
    const missing = await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1" });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe("unknown_grade");
  });

  test("a bad scope is 400 and a scene with no id is 400, an unknown scene is 404", async () => {
    const { store } = memoryStore();
    const badScope = await runColorAction(store, "u1", {
      action: "applyGrade",
      projectId: "p1",
      gradeId: "cinematic",
      scope: "timeline",
    });
    expect(badScope.status).toBe(400);
    expect(badScope.body.code).toBe("invalid_scope");

    const noScene = await runColorAction(store, "u1", {
      action: "applyGrade",
      projectId: "p1",
      gradeId: "cinematic",
      scope: "scene",
    });
    expect(noScene.status).toBe(400);
    expect(noScene.body.code).toBe("scene_id_required");

    const ghost = await runColorAction(store, "u1", {
      action: "applyGrade",
      projectId: "p1",
      gradeId: "cinematic",
      scope: "scene",
      sceneId: "ghost",
    });
    expect(ghost.status).toBe(404);
    expect(ghost.body.code).toBe("scene_not_found");
  });
});

describe("colour service — resetGrade", () => {
  test("clears a project assignment and reports the change", async () => {
    const { store, stored } = memoryStore();
    await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "hdr" });
    const res = await runColorAction(store, "u1", { action: "resetGrade", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.gradeId).toBeNull();
    expect(res.body.changed).toBe(true);
    expect(res.body.persisted).toBe(true);
    expect(res.body.previous).toEqual({ project: "hdr", scenes: {} });
    expect(res.body.assignment).toEqual({ project: null, scenes: {} });
    expect(res.body.effective).toEqual({ gradeId: null, source: "none" });
    expect(stored()).toEqual({ format: COLOR_ASSIGNMENT_FORMAT, version: 1, project: null, scenes: {} });
  });

  test("clearing a scene override leaves the project default in place", async () => {
    const { store } = memoryStore();
    await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "cinematic" });
    await runColorAction(store, "u1", {
      action: "applyGrade",
      projectId: "p1",
      gradeId: "moody",
      scope: "scene",
      sceneId: "s1",
    });
    const res = await runColorAction(store, "u1", { action: "resetGrade", projectId: "p1", scope: "scene", sceneId: "s1" });
    expect(res.body.changed).toBe(true);
    expect(res.body.assignment).toEqual({ project: "cinematic", scenes: {} });
    // Falling back to the project default is the documented behaviour.
    expect(res.body.effective).toEqual({ gradeId: "cinematic", source: "project" });
  });

  test("resetting something that has no grade is an honest no-op (nothing written)", async () => {
    const { store, writes } = memoryStore();
    const res = await runColorAction(store, "u1", { action: "resetGrade", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect((res.body.changelist as string[])[0]).toContain("already none");
    expect(writes()).toBe(0);
  });
});

describe("colour service — renderGradePreview (provider-gated)", () => {
  test("returns the honest gate, changes nothing and persists nothing", async () => {
    const { store, stored, writes } = memoryStore();
    await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "vibrant" });
    const before = stored();
    const writesBefore = writes();

    const res = await runColorAction(store, "u1", { action: "renderGradePreview", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.gradeId).toBe("vibrant");
    expect(res.body.gradeSource).toBe("project");
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect((res.body.preview as { produced: boolean }).produced).toBe(false);

    const gate = res.body.provider as { connected: boolean; requiredEnv: string[]; envHint: string; note: string };
    expect(gate.connected).toBe(false);
    expect(gate.requiredEnv).toEqual(COLOR_RENDER_ENV_NAMES);
    expect(gate.envHint).toBe("REPLICATE_API_TOKEN or RUNWAY_API_KEY");
    expect(gate.note).toContain("nothing was rendered");

    const plan = res.body.plan as Record<string, unknown>;
    expect(plan).toEqual({ applied: false, pixelsRendered: false, lutBaked: false, toneMapped: false });
    // The gate is honest: the assignment is untouched and nothing was written.
    expect(stored()).toEqual(before);
    expect(writes()).toBe(writesBefore);
  });

  test("takes an explicit gradeId and falls back to the scene override", async () => {
    const { store } = memoryStore();
    await runColorAction(store, "u1", { action: "applyGrade", projectId: "p1", gradeId: "cinematic" });
    await runColorAction(store, "u1", {
      action: "applyGrade",
      projectId: "p1",
      gradeId: "atmospheric",
      scope: "scene",
      sceneId: "s1",
    });
    const explicit = await runColorAction(store, "u1", { action: "renderGradePreview", projectId: "p1", gradeId: "hdr" });
    expect(explicit.body.gradeId).toBe("hdr");
    expect(explicit.body.gradeSource).toBe("request");
    // HDR is the one grade that also needs tone-mapping.
    expect((explicit.body.render as { providerWork: unknown[] }).providerWork.length).toBe(4);

    const scoped = await runColorAction(store, "u1", {
      action: "renderGradePreview",
      projectId: "p1",
      scope: "scene",
      sceneId: "s1",
    });
    expect(scoped.body.gradeId).toBe("atmospheric");
    expect(scoped.body.gradeSource).toBe("scene");
  });

  test("with no grade and no assignment it refuses honestly instead of assuming a look", async () => {
    const { store } = memoryStore();
    const res = await runColorAction(store, "u1", { action: "renderGradePreview", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("no_grade");
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
  });

  test("an unknown grade id is still 400 on the gated path", async () => {
    const { store } = memoryStore();
    const res = await runColorAction(store, "u1", { action: "renderGradePreview", projectId: "p1", gradeId: "teal-orange" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_grade");
  });
});

describe("colour service — request contract and tenancy", () => {
  test("every colour action is reachable and isColorAction rejects anything else", () => {
    expect([...COLOR_ACTIONS]).toEqual(["listGrades", "applyGrade", "resetGrade", "renderGradePreview"]);
    for (const action of COLOR_ACTIONS) expect(isColorAction(action)).toBe(true);
    expect(isColorAction("autoEdit")).toBe(false);
    expect(isColorAction(undefined)).toBe(false);
  });

  test("a foreign or missing project is a 404 for every action (never 403)", async () => {
    const { store, writes } = memoryStore({ ownerId: "someone-else" });
    for (const action of COLOR_ACTIONS) {
      const res = await runColorAction(store, "u1", { action, projectId: "p1", gradeId: "cinematic" });
      expect(res.status, action).toBe(404);
      expect(res.body.code).toBe("not_found");
    }
    const absent = await runColorAction(store, "u1", { action: "listGrades", projectId: "nope" });
    expect(absent.status).toBe(404);
    expect(writes()).toBe(0);
  });

  test("missing projectId is 400 and an unknown action is 400", async () => {
    const { store } = memoryStore();
    const noProject = await runColorAction(store, "u1", { action: "listGrades" });
    expect(noProject.status).toBe(400);
    expect(noProject.body.code).toBe("project_id_required");
    const unknown = await runColorAction(store, "u1", { action: "renderFrames", projectId: "p1" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("unknown_action");
  });

  test("no gate ever leaks a secret value or claims a connection", () => {
    const gate = colorProviderGate("Testing");
    expect(gate.connected).toBe(false);
    expect(JSON.stringify(gate)).not.toMatch(/sk-|secret|token=/i);
    for (const name of gate.requiredEnv) {
      expect(COLOR_RENDER_ENV_NAMES).toContain(name);
      expect(allProviderEnvVars()).toContain(name);
    }
    expect(COLOR_GRADES.length).toBe(9);
  });
});
