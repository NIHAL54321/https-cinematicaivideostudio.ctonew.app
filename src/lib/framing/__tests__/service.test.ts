/**
 * Phase 5 Block 5b — framing service contract test (no database).
 *
 * The service is store-injected exactly so this runs without Prisma: the memory
 * store below implements the same `FramingStore` interface the Prisma store
 * implements (src/lib/framing/store.ts), so the shapes asserted here are the
 * shapes the HTTP route returns.
 *
 * The fixture deliberately mixes real source geometries — scene 1 has an
 * attached 1920×1080 asset, scene 2 an attached 1080×1920 asset — so the tests
 * prove the crop changes because of the DATA, not just because of the format.
 */
import { describe, expect, test } from "bun:test";
import {
  FRAMING_ACTIONS,
  FRAMING_DETECTOR_ENV_NAMES,
  FRAMING_PROVIDER_CONNECTED,
  FRAMING_RENDER_ENV_NAMES,
  isFramingAction,
  runFramingAction,
  type FramingAssetRow,
  type FramingResult,
  type FramingSceneRow,
  type FramingStore,
} from "../service";
import { FRAMING_FORMAT } from "../assignment";
import { allProviderEnvVars } from "../../ai/providers/env-keys";

const SCENES: FramingSceneRow[] = [
  { id: "s1", title: "Intro", narration: "Welcome to the studio, where every frame is planned.", durationSeconds: 5, aspectRatio: "SIXTEEN_NINE" },
  { id: "s2", title: "Vertical cut", narration: "This scene was shot vertically for the feed.", durationSeconds: 6, aspectRatio: "NINE_SIXTEEN" },
];

const ASSETS: FramingAssetRow[] = [
  { id: "a1", name: "intro-master.mp4", widthPx: 1920, heightPx: 1080, sceneIds: ["s1"] },
  { id: "a2", name: "vertical-shot.mp4", widthPx: 1080, heightPx: 1920, sceneIds: ["s2"] },
];

/** A stored Block 5a shorts set: two 9:16 clips over the two scenes. */
const SHORTS_SET = {
  format: "cavis.repurpose.assignment",
  version: 1,
  targets: { shorts: { enabled: true, count: 10, minSeconds: 20, maxSeconds: 60, kinds: ["highlight"] } },
  clips: [
    { id: "shorts-1", target: "shorts", rank: 1, label: "Hook", startMs: 0, endMs: 5000, durationMs: 5000, scenes: ["s1"] },
    { id: "shorts-2", target: "shorts", rank: 2, label: "Payoff", startMs: 5000, endMs: 11_000, durationMs: 6000, scenes: ["s2"] },
  ],
  appliedAt: "2026-10-02T00:00:00.000Z",
  timelineMs: 11_000,
};

function memoryStore(
  options: {
    ownerId?: string;
    scenes?: FramingSceneRow[];
    assets?: FramingAssetRow[];
    shorts?: unknown;
    framing?: unknown;
    targetAspect?: string | null;
    rawTimeline?: unknown;
  } = {},
) {
  const ownerId = options.ownerId ?? "u1";
  const scenes = options.scenes ?? SCENES;
  const assets = options.assets ?? ASSETS;
  let framing: unknown = options.framing ?? null;
  const writes: unknown[] = [];
  const store: FramingStore = {
    async findOwnedProject(userId, projectId) {
      if (userId !== ownerId || projectId !== "p1") return null;
      return { id: "p1", title: "Test project", targetAspect: options.targetAspect ?? null };
    },
    async listScenes() {
      return scenes;
    },
    async listMediaAssets() {
      return assets;
    },
    async readRawTimeline() {
      return options.rawTimeline ?? null;
    },
    async readShortsRepurpose() {
      return options.shorts ?? null;
    },
    async readFraming() {
      return framing;
    },
    async writeFraming(_projectId, value) {
      framing = value;
      writes.push(value);
    },
  };
  return { store, writes, framing: () => framing };
}

function clips(res: FramingResult): Record<string, unknown>[] {
  return (res.body.clips as Record<string, unknown>[]) ?? [];
}

function clip(res: FramingResult, clipId: string): Record<string, unknown> {
  const found = clips(res).find((c) => c["clipId"] === clipId);
  if (!found) throw new Error(`no clip ${clipId} in ${clips(res).map((c) => c["clipId"]).join(", ")}`);
  return found;
}

function crop(res: FramingResult, clipId: string): { x: number; y: number; width: number; height: number } {
  const geometry = clip(res, clipId)["geometry"] as Record<string, Record<string, number>>;
  return geometry["crop"] as unknown as { x: number; y: number; width: number; height: number };
}

describe("framing service — action surface", () => {
  test("exposes exactly the four framing actions", () => {
    expect(FRAMING_ACTIONS).toEqual(["listFrameFormats", "planReframe", "applyReframe", "resetReframe"]);
    expect(isFramingAction("planReframe")).toBe(true);
    expect(isFramingAction("reframeMagically")).toBe(false);
  });

  test("an unknown action is a 400 that lists the actions", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "nope", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("unknown_action");
    expect(String(res.body.note)).toContain("listFrameFormats");
  });

  test("a missing projectId is a 400", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "planReframe" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("project_id_required");
  });

  test("a foreign or missing project is a 404 with no data leak, for every action", async () => {
    const { store } = memoryStore({ ownerId: "someone-else" });
    for (const action of FRAMING_ACTIONS) {
      const res = await runFramingAction(store, "u1", { action, projectId: "p1" });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("not_found");
      expect(res.body.error).toBe("Project not found.");
      // No catalogue, no plan, no assignment — nothing about the other tenant.
      expect(res.body.formats).toBeUndefined();
      expect(res.body.clips).toBeUndefined();
      expect(res.body.assignment).toBeUndefined();
    }
    const missing = await runFramingAction(store, "u1", { action: "planReframe", projectId: "does-not-exist" });
    expect(missing.status).toBe(404);
  });
});

describe("listFrameFormats", () => {
  test("returns the four real formats, the policies and the honest detector gate", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "listFrameFormats", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(4);
    const formats = res.body.formats as Record<string, unknown>[];
    expect(formats.map((f) => f["id"])).toEqual(["16:9", "9:16", "1:1", "4:5"]);
    expect(formats.map((f) => f["resolution"])).toEqual(["1920×1080", "1080×1920", "1080×1080", "1080×1350"]);
    const vertical = formats.find((f) => f["id"] === "9:16") as Record<string, unknown>;
    const safe = vertical["safeAreas"] as Record<string, Record<string, number>>;
    expect(safe["actionSafe"]["width"]).toBe(1004);
    expect(safe["captionSafe"]["height"]).toBe(228);
    const policies = res.body.policies as Record<string, unknown>[];
    expect(policies.map((p) => p["id"])).toEqual(["centre-cover", "upper-third-bias", "caption-safe-hold", "pan-across-travel"]);
    expect(String(policies[0]["rule"])).toContain("centre");
    expect(policies[3]["explicitOnly"]).toBe(true);
    // The catalogue read reports the standing gates and changes nothing.
    expect((res.body.provider as Record<string, unknown>)["connected"]).toBe(false);
    const anchors = res.body.anchors as Record<string, unknown>;
    expect(anchors["known"]).toBe(false);
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect(res.body.clipCount).toBe(2);
    expect(res.body.sceneCount).toBe(2);
  });
});

describe("planReframe — the geometry is real and the format really changes it", () => {
  test("project scope plans every clip and cites the real source dimensions", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe("project");
    expect(clips(res).map((c) => c["clipId"])).toEqual(["sc-s1-video", "sc-s2-video"]);
    expect(res.body.scopedCount).toBe(2);
    // default target = the engine's 16:9 for a project with no declared aspect
    const first = clip(res, "sc-s1-video");
    expect((first["target"] as Record<string, unknown>)["id"]).toBe("16:9");
    expect((first["target"] as Record<string, unknown>)["origin"]).toBe("engine-default");
    const source = first["source"] as Record<string, unknown>;
    expect(source["origin"]).toBe("asset-dimensions");
    expect(source["widthPx"]).toBe(1920);
    expect(source["heightPx"]).toBe(1080);
    expect(source["assetId"]).toBe("a1");
    expect(String(source["originDetail"])).toContain("Asset.width/height");
    // 16:9 → 16:9 crops nothing
    expect(crop(res, "sc-s1-video")).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect((first["geometry"] as Record<string, Record<string, number>>)["scale"]).toBe(1);
    expect(((first["delivery"] as Record<string, unknown>)["upscale"] as number)).toBe(1);
  });

  test("a 9:16 source into a 16:9 target is a real height crop, corrected for the caption band", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    const second = clip(res, "sc-s2-video");
    const geometry = second["geometry"] as Record<string, Record<string, number>>;
    expect(geometry["crop"]).toEqual({ x: 0, y: 1227, width: 1080, height: 608 });
    expect(geometry["travelPx"]).toEqual({ x: 0, y: 1312 });
    expect(geometry["scale"]).toBe(1.7778);
    const policy = second["policy"] as Record<string, unknown>;
    expect(policy["engineDefault"]).toBe("caption-safe-hold");
    expect(policy["id"]).toBe("caption-safe-hold");
    expect(policy["requested"]).toBe(false);
    expect(String(policy["selectedBecause"])).toContain("must not be cropped out");
    const caption = second["caption"] as Record<string, unknown>;
    expect(caption["present"]).toBe(true);
    expect(caption["verticalFraction"]).toBe(1); // the band's rows survived
    expect(caption["horizontalFraction"]).toBe(1);
    // and the safe areas are reported verbatim
    const safe = second["safeAreas"] as Record<string, Record<string, unknown>>;
    expect((safe["target"]["actionSafe"] as Record<string, number>)["width"]).toBe(1786);
    expect((safe["safeAreaClamp"] as Record<string, unknown>)["applied"]).toBe(false);
  });

  test("changing the format really changes the crop window (all four formats)", async () => {
    const { store } = memoryStore();
    const crops: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const format of ["16:9", "9:16", "1:1", "4:5"] as const) {
      const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", format });
      expect(res.status).toBe(200);
      expect((clip(res, "sc-s1-video")["target"] as Record<string, unknown>)["id"]).toBe(format);
      expect((clip(res, "sc-s1-video")["target"] as Record<string, unknown>)["origin"]).toBe("request");
      crops[format] = crop(res, "sc-s1-video");
    }
    expect(crops["16:9"]).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(crops["9:16"]).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    expect(crops["1:1"]).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(crops["4:5"]).toEqual({ x: 528, y: 0, width: 864, height: 1080 });
    // Four formats, four different windows — not one geometry with four labels.
    const keys = Object.values(crops).map((c) => `${c.x},${c.y},${c.width},${c.height}`);
    expect(new Set(keys).size).toBe(4);
  });

  test("a clip already in the target aspect is not cropped at all", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", format: "9:16" });
    expect(crop(res, "sc-s2-video")).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
    expect((clip(res, "sc-s2-video")["geometry"] as Record<string, Record<string, number>>)["scale"]).toBe(1);
    // the delivery note states the upscale honestly
    const delivery = clip(res, "sc-s1-video")["delivery"] as Record<string, unknown>;
    expect(delivery["upscale"]).toBe(1.7778);
    expect(delivery["keptColumns"]).toBe(608);
    expect(delivery["sourceColumns"]).toBe(1920);
    expect(String(delivery["note"])).toContain("1.7778× enlargement");
  });

  test("keyframes are emitted verbatim, and a hold has identical windows", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", format: "9:16" });
    const motion = clip(res, "sc-s1-video")["motion"] as Record<string, unknown>;
    expect(motion["kind"]).toBe("hold");
    expect(motion["basis"]).toBe("no-motion-data");
    const frames = motion["keyframes"] as Record<string, unknown>[];
    expect(frames.length).toBe(3);
    expect(frames.map((f) => f["tMs"])).toEqual([0, 2500, 5000]);
    expect(frames[0]["crop"]).toEqual(frames[2]["crop"] as unknown as Record<string, number>);
    expect(String(motion["rule"])).toContain("nothing pans");

    const pan = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", format: "9:16", policy: "pan-across-travel" });
    const panMotion = clip(pan, "sc-s1-video")["motion"] as Record<string, unknown>;
    expect(panMotion["kind"]).toBe("pan");
    expect(panMotion["basis"]).toBe("stated-rule");
    const panFrames = panMotion["keyframes"] as Record<string, unknown>[];
    expect(panFrames.length).toBe(5);
    expect((panFrames[0]["crop"] as Record<string, number>)["x"]).toBe(0);
    expect((panFrames[2]["crop"] as Record<string, number>)["x"]).toBe(656);
    expect((panFrames[4]["crop"] as Record<string, number>)["x"]).toBe(1312);
  });

  test("scope scene and scope clip narrow the plan, and the clip view is the first one", async () => {
    const { store } = memoryStore();
    const byScene = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "scene", sceneId: "s2" });
    expect(byScene.status).toBe(200);
    expect(byScene.body.scopedCount).toBe(1);
    expect(clips(byScene).map((c) => c["clipId"])).toEqual(["sc-s2-video"]);
    const byClip = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "clip", clipId: "sc-s1-video" });
    expect(byClip.body.scopedCount).toBe(1);
    expect((byClip.body.clip as Record<string, unknown>)["clipId"]).toBe("sc-s1-video");
    expect((byClip.body.clip as Record<string, unknown>)["clipId"]).toBe((clips(byClip)[0] as Record<string, unknown>)["clipId"]);
  });

  test("a plan request persists nothing", async () => {
    const { store, writes } = memoryStore();
    await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", format: "9:16" });
    expect(writes.length).toBe(0);
  });
});

describe("planReframe — every plan is honestly gated", () => {
  test("the subject anchor is unknown, the detector gate names its env vars, and nothing changed", async () => {
    const { store, writes } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", format: "9:16" });
    const first = clip(res, "sc-s1-video");
    const anchoring = first["anchoring"] as Record<string, unknown>;
    expect(anchoring["known"]).toBe(false);
    expect(anchoring["anchorKind"]).toBe("rule-position");
    const detector = anchoring["detector"] as Record<string, unknown>;
    expect(detector["connected"]).toBe(false);
    expect(detector["capability"]).toBe("face_detection");
    // Derived over the three detection capabilities (openai, google, replicate):
    // the google slot accepts EITHER google key name, so both appear.
    expect(detector["requiredEnv"]).toEqual(FRAMING_DETECTOR_ENV_NAMES);
    expect(detector["requiredEnv"]).toEqual([
      "OPENAI_API_KEY",
      "GOOGLE_AI_API_KEY",
      "GOOGLE_API_KEY",
      "REPLICATE_API_TOKEN",
    ]);
    expect(String(detector["note"])).toContain("no face, chart or line of text was located");
    expect(FRAMING_PROVIDER_CONNECTED).toBe(false);
    // The gate changes nothing at all.
    expect(res.body.changed).toBe(false);
    expect(res.body.persisted).toBe(false);
    expect(writes.length).toBe(0);

    // No invented detection: no box, no centre, no confidence anywhere.
    const asText = JSON.stringify(res.body);
    expect(asText).not.toContain('"boundingBox"');
    expect(asText).not.toContain('"confidence"');
    expect(asText).not.toContain('"detectedSubjects"');
    expect(asText).not.toContain('"detectorBox"');
    // The anchor used is exactly the policy's rule anchor.
    const policy = first["policy"] as Record<string, unknown>;
    expect(policy["anchorSource"]).toBe("policy-rule");
    const geometry = first["geometry"] as Record<string, Record<string, number>>;
    expect(geometry["anchor"]).toEqual({ x: 0.5, y: 0.5 });
    // And the render path is gated too.
    const plan = res.body.plan as Record<string, Record<string, unknown>>;
    expect(plan["framesRendered"]).toBe(false);
    expect((plan["render"] as Record<string, unknown>)["connected"]).toBe(false);
    expect((plan["render"] as Record<string, unknown>)["requiredEnv"]).toEqual(FRAMING_RENDER_ENV_NAMES);
    expect((plan["render"] as Record<string, unknown>)["requiredEnv"]).toEqual([
      "REPLICATE_API_TOKEN",
      "RUNWAY_API_KEY",
    ]);
  });

  test("the render gate is present on every action that returns a plan", async () => {
    const { store } = memoryStore();
    for (const action of ["listFrameFormats", "planReframe"] as const) {
      const res = await runFramingAction(store, "u1", { action, projectId: "p1" });
      const plan = res.body.plan as Record<string, Record<string, unknown>>;
      expect((plan["render"] as Record<string, unknown>)["connected"]).toBe(false);
    }
  });
});

describe("planReframe — typed 400s", () => {
  test("bad format, bad policy, bad anchor", async () => {
    const { store } = memoryStore();
    const format = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", format: "21:9" });
    expect(format.status).toBe(400);
    expect(format.body.code).toBe("unknown_format");
    expect(String(format.body.note)).toContain("16:9, 9:16, 1:1, 4:5");

    const policy = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", policy: "auto-detect-face" });
    expect(policy.status).toBe(400);
    expect(policy.body.code).toBe("unknown_policy");
    expect(String(policy.body.note)).toContain("centre-cover");

    const anchor = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", anchor: { x: 2, y: 0.5 } });
    expect(anchor.status).toBe(400);
    expect(anchor.body.code).toBe("invalid_anchor");

    const scope = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "everything" });
    expect(scope.status).toBe(400);
    expect(scope.body.code).toBe("invalid_scope");
  });

  test("bad scene / clip, and the ids the plan actually has", async () => {
    const { store } = memoryStore();
    const missingScene = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "scene" });
    expect(missingScene.status).toBe(400);
    expect(missingScene.body.code).toBe("scene_id_required");

    const unknownScene = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "scene", sceneId: "nope" });
    expect(unknownScene.status).toBe(400);
    expect(unknownScene.body.code).toBe("unknown_scene");

    const missingClip = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "clip" });
    expect(missingClip.status).toBe(400);
    expect(missingClip.body.code).toBe("clip_id_required");

    const unknownClip = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "clip", clipId: "shorts-9" });
    expect(unknownClip.status).toBe(400);
    expect(unknownClip.body.code).toBe("unknown_clip");
    expect(String(unknownClip.body.note)).toContain("sc-s1-video");
    // No shorts set is applied, and the message says so honestly.
    expect(String(unknownClip.body.note)).toContain("No Block 5a shorts set is applied");
    expect(unknownClip.body.changed).toBe(false);
  });
});

describe("applyReframe / resetReframe — persistence and read-back", () => {
  test("apply persists a project override and the read-back really uses it", async () => {
    const { store, writes, framing } = memoryStore();
    const res = await runFramingAction(store, "u1", {
      action: "applyReframe",
      projectId: "p1",
      scope: "project",
      format: "9:16",
      policy: "centre-cover",
    });
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(true);
    expect(res.body.persisted).toBe(true);
    expect(writes.length).toBe(1);
    const stored = framing() as Record<string, unknown>;
    expect(stored["format"]).toBe(FRAMING_FORMAT);
    const view = res.body.assignment as Record<string, unknown>;
    expect(view["applied"]).toBe(true);
    const project = view["project"] as Record<string, unknown>;
    expect(project["format"]).toBe("9:16");
    expect(project["policy"]).toBe("centre-cover");
    // The plan returned by the apply is the READ-BACK, computed from the saved override.
    expect((clip(res, "sc-s1-video")["target"] as Record<string, unknown>)["id"]).toBe("9:16");
    expect((clip(res, "sc-s1-video")["target"] as Record<string, unknown>)["origin"]).toBe("project-override");
    expect(crop(res, "sc-s1-video")).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    expect(res.body.appliedAt).toBeTruthy();
    expect((res.body.changelist as string[]).length).toBeGreaterThan(1);
  });

  test("a second identical apply changes nothing", async () => {
    const { store, writes } = memoryStore();
    const first = await runFramingAction(store, "u1", { action: "applyReframe", projectId: "p1", format: "1:1" });
    expect(first.body.changed).toBe(true);
    const second = await runFramingAction(store, "u1", { action: "applyReframe", projectId: "p1", format: "1:1" });
    expect(second.body.changed).toBe(false);
    expect(second.body.persisted).toBe(false);
    expect(writes.length).toBe(1);
    expect(String((second.body.changelist as string[])[0])).toContain("nothing to change");
  });

  test("an empty apply is refused", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "applyReframe", projectId: "p1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("empty_override");
  });

  test("scene and clip overrides win over the project override (and say which scope won)", async () => {
    const { store } = memoryStore();
    await runFramingAction(store, "u1", { action: "applyReframe", projectId: "p1", scope: "project", format: "16:9" });
    const sceneApply = await runFramingAction(store, "u1", { action: "applyReframe", projectId: "p1", scope: "scene", sceneId: "s1", format: "9:16" });
    expect(sceneApply.status).toBe(200);
    const clipApply = await runFramingAction(store, "u1", {
      action: "applyReframe",
      projectId: "p1",
      scope: "clip",
      clipId: "sc-s2-video",
      format: "1:1",
      anchor: { x: 0, y: 0.5 },
    });
    expect(clipApply.status).toBe(200);
    expect(clipApply.body.changed).toBe(true);

    const plan = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    // s1 clip → scene override 9:16; s2 clip → clip override 1:1 with the anchor honoured
    expect((clip(plan, "sc-s1-video")["target"] as Record<string, unknown>)["id"]).toBe("9:16");
    expect((clip(plan, "sc-s1-video")["target"] as Record<string, unknown>)["origin"]).toBe("scene-override");
    expect((clip(plan, "sc-s2-video")["target"] as Record<string, unknown>)["id"]).toBe("1:1");
    expect((clip(plan, "sc-s2-video")["target"] as Record<string, unknown>)["origin"]).toBe("clip-override");
    const geometry = clip(plan, "sc-s2-video")["geometry"] as Record<string, Record<string, number>>;
    expect(geometry["crop"]["x"]).toBe(0); // the anchor really moved it off centre
    expect((clip(plan, "sc-s2-video")["policy"] as Record<string, unknown>)["anchorSource"]).toBe("override-anchor");
    const effective = plan.body.effectiveByClip as Record<string, Record<string, unknown>>;
    expect(effective["sc-s1-video"]["overrideSource"]).toBe("scene");
    expect(effective["sc-s2-video"]["overrideSource"]).toBe("clip");
  });

  test("reset clears the override and the engine plan really comes back", async () => {
    const { store, framing } = memoryStore();
    await runFramingAction(store, "u1", { action: "applyReframe", projectId: "p1", scope: "clip", clipId: "sc-s1-video", format: "9:16" });
    const before = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1", scope: "clip", clipId: "sc-s1-video" });
    expect((clip(before, "sc-s1-video")["target"] as Record<string, unknown>)["id"]).toBe("9:16");

    const reset = await runFramingAction(store, "u1", { action: "resetReframe", projectId: "p1", scope: "clip", clipId: "sc-s1-video" });
    expect(reset.status).toBe(200);
    expect(reset.body.changed).toBe(true);
    expect(reset.body.persisted).toBe(true);
    expect(reset.body.hadOverride).toBe(true);
    expect(((reset.body.assignment as Record<string, unknown>)["clips"] as Record<string, unknown>)["sc-s1-video"]).toBeUndefined();
    expect(((reset.body.assignment as Record<string, unknown>)["applied"] as boolean)).toBe(false);
    // The engine's own plan is in force again: back to the 16:9 default geometry.
    expect((clip(reset, "sc-s1-video")["target"] as Record<string, unknown>)["id"]).toBe("16:9");
    expect((clip(reset, "sc-s1-video")["target"] as Record<string, unknown>)["origin"]).toBe("engine-default");
    expect(crop(reset, "sc-s1-video")).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(framing()).toBeNull();

    const again = await runFramingAction(store, "u1", { action: "resetReframe", projectId: "p1", scope: "clip", clipId: "sc-s1-video" });
    expect(again.body.changed).toBe(false);
    expect(again.body.hadOverride).toBe(false);
    expect(String((again.body.changelist as string[])[0])).toContain("nothing to change");
  });

  test("a project reset clears a project override", async () => {
    const { store } = memoryStore();
    await runFramingAction(store, "u1", { action: "applyReframe", projectId: "p1", format: "4:5" });
    const reset = await runFramingAction(store, "u1", { action: "resetReframe", projectId: "p1" });
    expect(reset.body.changed).toBe(true);
    expect(reset.body.hadOverride).toBe(true);
    expect(crop(reset, "sc-s1-video")).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  test("an unreadable stored assignment is ignored, not half-applied", async () => {
    const { store } = memoryStore({ framing: { format: "cavis.framing.assignment", version: 1, project: { format: "21:9" }, scenes: {}, clips: {} } });
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(res.body.droppedOverrides).toEqual(["project"]);
    expect(String(res.body.note)).toContain("were dropped");
    // The plan is the engine default because the bogus override was dropped.
    expect((clip(res, "sc-s1-video")["target"] as Record<string, unknown>)["id"]).toBe("16:9");
    const broken = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    expect(broken.status).toBe(200);
  });

  test("a nonsense stored value is reported as unreadable", async () => {
    const { store } = memoryStore({ framing: "not-an-object" });
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    expect(res.body.unreadable).toBe(true);
    expect(String(res.body.note)).toContain("unreadable");
  });

  test("the project's declared target aspect drives the default format when nothing else does", async () => {
    const { store } = memoryStore({ targetAspect: "NINE_SIXTEEN" });
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    const target = clip(res, "sc-s1-video")["target"] as Record<string, unknown>;
    expect(target["id"]).toBe("9:16");
    expect(target["origin"]).toBe("project-target-aspect");
    expect(String(target["originDetail"])).toContain("exact delivery format");
  });

  test("a scene with no asset and no declared aspect falls back to the stated nominal frame", async () => {
    const { store } = memoryStore({
      scenes: [{ id: "s1", title: "Bare", narration: null, durationSeconds: 5, aspectRatio: null }],
      assets: [],
    });
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    const source = clip(res, "sc-s1-video")["source"] as Record<string, unknown>;
    expect(source["origin"]).toBe("engine-default");
    expect(source["widthPx"]).toBe(1920);
    expect(String(source["originDetail"])).toContain("not a measurement of the footage");
    // No narration → no upper-third rule; the honest centre fallback.
    expect((clip(res, "sc-s1-video")["policy"] as Record<string, unknown>)["engineDefault"]).toBe("centre-cover");
  });

  test("a scene's declared aspect is used when no asset dimensions exist (and is cited)", async () => {
    const { store } = memoryStore({
      scenes: [{ id: "s1", title: "Declared", narration: null, durationSeconds: 5, aspectRatio: "FOUR_FIVE" }],
      assets: [],
    });
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    const source = clip(res, "sc-s1-video")["source"] as Record<string, unknown>;
    expect(source["origin"]).toBe("scene-aspect");
    expect(source["widthPx"]).toBe(1080);
    expect(source["heightPx"]).toBe(1350);
    expect(source["sceneAspectDeclared"]).toBe("FOUR_FIVE");
  });
});

describe("the Block 5a link — repurposed clips are reframed against their own target", () => {
  test("with a shorts set applied, each clips plans at its platform aspect", async () => {
    const { store } = memoryStore({ shorts: SHORTS_SET });
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    expect(res.status).toBe(200);
    expect(clips(res).map((c) => c["clipId"])).toEqual(["sc-s1-video", "sc-s2-video", "shorts-1", "shorts-2"]);
    const link = res.body.repurposingLink as Record<string, unknown>;
    expect(link["applied"]).toBe(true);
    expect(link["clipCount"]).toBe(2);
    expect(link["byTarget"]).toEqual({ shorts: 2 });
    expect(link["aspects"]).toEqual({ shorts: "9:16" });

    const shortsClip = clip(res, "shorts-1");
    expect(shortsClip["kind"]).toBe("shorts");
    expect(shortsClip["platformTarget"]).toBe("shorts");
    expect(shortsClip["label"]).toBe("Hook");
    expect(shortsClip["startMs"]).toBe(0);
    expect(shortsClip["endMs"]).toBe(5000);
    const target = shortsClip["target"] as Record<string, unknown>;
    expect(target["id"]).toBe("9:16");
    expect(target["origin"]).toBe("platform-target");
    expect(String(target["originDetail"])).toContain("declares 9:16");
    // Its source geometry comes from the scene's real asset, and it crops for 9:16.
    expect((shortsClip["source"] as Record<string, unknown>)["assetId"]).toBe("a1");
    expect(crop(res, "shorts-1")).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
  });

  test("a shorts clip can carry its own override", async () => {
    const { store } = memoryStore({ shorts: SHORTS_SET });
    const applied = await runFramingAction(store, "u1", {
      action: "applyReframe",
      projectId: "p1",
      scope: "clip",
      clipId: "shorts-2",
      format: "1:1",
    });
    expect(applied.status).toBe(200);
    expect(applied.body.changed).toBe(true);
    const readBack = clip(applied, "shorts-2");
    expect((readBack["target"] as Record<string, unknown>)["id"]).toBe("1:1");
    expect((readBack["override"] as Record<string, unknown>)["source"]).toBe("clip");
  });

  test("without a shorts set the link says so and the clip ids do not exist", async () => {
    const { store } = memoryStore();
    const res = await runFramingAction(store, "u1", { action: "planReframe", projectId: "p1" });
    const link = res.body.repurposingLink as Record<string, unknown>;
    expect(link["applied"]).toBe(false);
    expect(link["clipCount"]).toBe(0);
    expect(String(link["note"])).toContain("Run applyShorts");
    const shorts = await runFramingAction(store, "u1", {
      action: "applyReframe",
      projectId: "p1",
      scope: "clip",
      clipId: "shorts-1",
      format: "9:16",
    });
    expect(shorts.status).toBe(400);
    expect(shorts.body.code).toBe("unknown_clip");
  });
});
