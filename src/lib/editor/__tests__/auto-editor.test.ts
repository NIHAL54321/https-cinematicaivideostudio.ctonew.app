import { describe, expect, test } from "bun:test";
import {
  AUTO_EDITOR_COMMANDS,
  AUTO_EDITOR_META,
  IMAGE_PROVIDER_ENV_NAMES,
  LLM_PROVIDER_ENV_NAMES,
  SAFE_SUBTITLE_MARGIN_REF,
  VOICE_PROVIDER_ENV_NAMES,
  applyAutoEditCommand,
  isAutoEditCommand,
  jaccardSimilarity,
  normalizeWords,
  type AutoEditorResult,
} from "../auto-editor";
import { allProviderEnvVars } from "../../ai/providers/env-keys";
import { capabilityEnvHint } from "../../ai/providers/capability-env";
import { capabilityConnectivity } from "../../ai/providers/capability-connectivity";
import {
  EditorError,
  addClip,
  adjustVolume,
  buildTimelineFromScenes,
  clipById,
  clipsAt,
  deleteClip,
  reorderClip,
  timelinesEqual,
  trimClip,
  type SceneInput,
  type Timeline,
} from "../timeline";
import { setTransition } from "../transitions";

/**
 * Phase 5 Block 3 — the twelve AI Auto-Editor commands.
 *
 * What matters here (and is asserted below):
 *   - the DETERMINISTIC half of every command really edits the timeline (and the
 *     changelist says exactly what changed),
 *   - the AI half NEVER fabricates: gated commands return an honest gate
 *     (connected:false + env var NAMES only) plus a plan,
 *   - equal input → equal output, the input timeline is never mutated, and the
 *     normalising commands reach a fixed point (running them twice is a no-op).
 */

const THREE: SceneInput[] = [
  {
    id: "s1",
    title: "Cold open",
    narration: "This is the opening narration of the film.",
    durationSeconds: 5,
    visualPrompt: "A slow dolly over a rain-soaked city at night",
  },
  { id: "s2", title: "The problem", narration: "Now the difficulty appears.", durationSeconds: 5 },
  { id: "s3", title: "The payoff", narration: "The resolution lands here.", durationSeconds: 5 },
];

function base(scenes: SceneInput[] = THREE): Timeline {
  return buildTimelineFromScenes(scenes);
}

function videoOf(timeline: Timeline) {
  return clipsAt(timeline, "video");
}

function planOf(result: AutoEditorResult): Record<string, unknown> {
  return (result.plan ?? {}) as Record<string, unknown>;
}

/** The honest gate invariant shared by every provider-gated command. */
function assertHonestGate(result: AutoEditorResult, capability: string, envNames: string[]): void {
  const gate = result.provider;
  expect(gate).toBeDefined();
  expect(gate!.capability).toBe(capability);
  expect(gate!.connected).toBe(false);
  // The names are the DERIVED ones for this capability (registry + slot table),
  // never a literal invented for the gate.
  expect(gate!.requiredEnv).toEqual(envNames);
  expect(gate!.envHint).toBe(capabilityEnvHint(capability));
  // env var NAMES only — never a `KEY=value` pair, never a secret value, and
  // every one of them is a name the provider registry actually reads.
  for (const name of gate!.requiredEnv) {
    expect(name).toMatch(/^[A-Z0-9_]+$/);
    expect(allProviderEnvVars()).toContain(name);
  }
  expect(gate!.note).toContain(envNames[0]);
  // The note's statement about connectivity is DERIVED at call time, so the
  // expectation is derived the same way — from the registry, not from a fixed
  // phrase. Two branches, and BOTH are exercised by the callers below
  // (image_generation / voice_generation have no wired slot; seo_generation is
  // served by a wired slot on this build):
  //   - no serving slot wired  → the note must say so ("not wired");
  //   - a serving slot IS wired → the note must say THAT, name the wired slot and
  //     its env var, and must never fall back to a "not wired" claim.
  const live = capabilityConnectivity(capability);
  expect(gate!.connectivity[0].reason).toBe(live.reason);
  if (live.wiredSlots.length === 0) {
    expect(live.reason).toContain("not wired");
    expect(gate!.note).toContain("not wired");
  } else {
    expect(gate!.note).toContain(live.wiredSlots[0].id);
    for (const key of live.wiredSlots.flatMap((s) => s.envKeys)) expect(gate!.note).toContain(key);
    expect(gate!.note).not.toContain("not wired");
  }
  // …and whatever the registry says, a gate may never imply THIS command wrote
  // anything: the auto editor has no dispatch call site, key or no key.
  expect(gate!.note).toContain("no code path that dispatches to a provider");
  expect(gate!.note).toContain("nothing was generated and no provider output was invented.");
  expect(gate!.note).not.toContain("IMAGE_PROVIDER_API_KEY");
  expect(gate!.note).not.toContain("VOICE_PROVIDER_API_KEY");
  expect(gate!.note).not.toContain("LLM_PROVIDER_API_KEY");
}

describe("auto-editor — catalog", () => {
  test("there are twelve commands, all described in AUTO_EDITOR_META", () => {
    expect(AUTO_EDITOR_COMMANDS.length).toBe(12);
    expect(new Set(AUTO_EDITOR_COMMANDS).size).toBe(12);
    expect(AUTO_EDITOR_META.map((m) => m.id)).toEqual([...AUTO_EDITOR_COMMANDS]);
    for (const meta of AUTO_EDITOR_META) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
    }
  });

  test("isAutoEditCommand accepts the twelve ids and rejects anything else", () => {
    for (const command of AUTO_EDITOR_COMMANDS) expect(isAutoEditCommand(command)).toBe(true);
    expect(isAutoEditCommand("moreEverything")).toBe(false);
    expect(isAutoEditCommand(undefined)).toBe(false);
    expect(isAutoEditCommand(7)).toBe(false);
  });

  test("an unknown command is a typed error, not a silent no-op", () => {
    expect(() => applyAutoEditCommand(base(), THREE, "moreEverything" as never)).toThrow(EditorError);
    try {
      applyAutoEditCommand(base(), THREE, "noSuchCommand" as never);
    } catch (err) {
      expect((err as EditorError).code).toBe("invalid_input");
    }
  });

  test("every command returns the envelope, a timeline and never mutates the input", () => {
    const timeline = base();
    const snapshot = JSON.stringify(timeline);
    for (const command of AUTO_EDITOR_COMMANDS) {
      const result = applyAutoEditCommand(timeline, THREE, command);
      expect(result.command).toBe(command);
      expect(typeof result.changed).toBe("boolean");
      expect(Array.isArray(result.changelist)).toBe(true);
      for (const line of result.changelist) expect(typeof line).toBe("string");
      expect(result.timeline).toBeDefined();
      expect(Array.isArray(result.timeline!.clips)).toBe(true);
      expect(typeof result.note).toBe("string");
      // the input timeline is untouched (pure function)
      expect(JSON.stringify(timeline)).toBe(snapshot);
    }
  });

  test("equal input produces a byte-identical result (determinism)", () => {
    for (const command of AUTO_EDITOR_COMMANDS) {
      const a = applyAutoEditCommand(base(), THREE, command);
      const b = applyAutoEditCommand(base(), THREE, command);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

describe("auto-editor — moreCinematic", () => {
  const LONG: SceneInput[] = [
    { ...THREE[0], durationSeconds: 12 },
    THREE[1],
    THREE[2],
  ];

  test("tightens over-long scenes into the 4-8s band and pulls the following scenes earlier", () => {
    const timeline = base(LONG);
    const result = applyAutoEditCommand(timeline, LONG, "moreCinematic");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[0].endMs - video[0].startMs).toBe(8000);
    expect([video[1].startMs, video[1].endMs]).toEqual([8000, 13_000]);
    expect([video[2].startMs, video[2].endMs]).toEqual([13_000, 18_000]);
    expect(result.timeline!.durationMs).toBe(18_000);
    // the caption of the tightened shot never overhangs it
    expect(clipById(result.timeline!, "sc-s1-subtitles")!.endMs).toBe(8000);
    expect(result.changelist.some((line) => line.includes("tightened") && line.includes("cinematic band"))).toBe(true);
  });

  test("tags the scene's visual clips with the cinematic grade marker", () => {
    const result = applyAutoEditCommand(base(LONG), LONG, "moreCinematic");
    const video = videoOf(result.timeline!);
    for (const clip of video) expect(clip.grade).toBe("cinematic");
    expect(result.changelist.some((line) => line.includes("grade:") && line.includes("cinematic"))).toBe(true);
    expect(planOf(result).grade).toBe("cinematic");
  });

  test("prefers soft dissolves at scene boundaries and never opens a lane on a blend", () => {
    const result = applyAutoEditCommand(base(LONG), LONG, "moreCinematic");
    const video = videoOf(result.timeline!);
    // the first clip of the lane carries no transition at all
    expect(video[0].transition == null).toBe(true);
    const blends = video.filter((clip) => clip.transition && clip.transition.kind !== "cut");
    expect(blends.length).toBeGreaterThanOrEqual(1);
    for (const clip of blends) {
      expect(["dissolve", "crossfade"]).toContain(clip.transition!.kind);
      // conservative: a blend uses at most half of the shorter neighbour
      const index = video.indexOf(clip);
      const span = Math.min(clip.endMs - clip.startMs, video[index + 1].endMs - video[index + 1].startMs);
      expect(clip.transition!.durationMs).toBeLessThanOrEqual(Math.floor(span / 2));
    }
    // deterministic choice: dissolve on the first eligible boundary
    expect(video[1].transition!.kind).toBe("dissolve");
    expect(video[1].transition!.durationMs).toBe(450);
  });

  test("is idempotent — a second run changes nothing", () => {
    const first = applyAutoEditCommand(base(LONG), LONG, "moreCinematic");
    const second = applyAutoEditCommand(first.timeline!, LONG, "moreCinematic");
    expect(second.changed).toBe(false);
    expect(second.changelist).toEqual([]);
    expect(second.timeline).toBe(first.timeline!);
    expect(timelinesEqual(second.timeline!, first.timeline!)).toBe(true);
  });
});

describe("auto-editor — moreEmotional", () => {
  test("lengthens the closing scene and lowers the music-energy target", () => {
    const timeline = addClip(base(), {
      name: "Music — Cinematic",
      trackId: "music",
      startMs: 0,
      durationMs: 15_000,
      gain: 0.5,
    }).timeline;
    const result = applyAutoEditCommand(timeline, THREE, "moreEmotional");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[2].endMs - video[2].startMs).toBe(6250); // 5000ms × 1.25
    expect(planOf(result).musicEnergyTarget).toBe(30);
    const music = clipsAt(result.timeline!, "music")[0];
    expect(music.gain).toBe(0.29);
    expect(result.changelist.some((line) => line.includes("gain 0.5 → 0.29"))).toBe(true);
  });

  test("stretches an existing dissolve to its catalog maximum", () => {
    const withDissolve = setTransition(base(), { clipId: "sc-s2-video", kind: "dissolve", durationMs: 300 }).timeline;
    const result = applyAutoEditCommand(withDissolve, THREE, "moreEmotional");
    const outgoing = clipById(result.timeline!, "sc-s2-video")!;
    expect(outgoing.transition!.kind).toBe("dissolve");
    expect(outgoing.transition!.durationMs).toBe(600);
    expect(result.changelist.some((line) => line.includes("longer dissolve"))).toBe(true);
  });

  test("honours the intensity argument (a relative 'more' command)", () => {
    const full = applyAutoEditCommand(base(), THREE, "moreEmotional");
    const half = applyAutoEditCommand(base(), THREE, "moreEmotional", { intensity: 50 });
    const fullSpan = videoOf(full.timeline!)[2].endMs - videoOf(full.timeline!)[2].startMs;
    const halfSpan = videoOf(half.timeline!)[2].endMs - videoOf(half.timeline!)[2].startMs;
    expect(fullSpan).toBe(6250);
    expect(halfSpan).toBe(6000); // 5000 × 1.125 is below the +1000ms floor
    expect(planOf(half).intensity).toBe(50);
  });
});

describe("auto-editor — moreViral", () => {
  test("cuts the hook to ≤3s, hard-cuts out of it and bolds the hook captions", () => {
    const result = applyAutoEditCommand(base(), THREE, "moreViral");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[0].endMs - video[0].startMs).toBeLessThanOrEqual(3000);
    expect(video[0].endMs - video[0].startMs).toBe(3000);
    expect(video[1].startMs).toBe(3000); // the gap the trim opened was closed
    expect(video[0].transition!.kind).toBe("cut");
    expect(video[0].transition!.durationMs).toBe(0);
    const caption = clipById(result.timeline!, "sc-s1-subtitles")!;
    expect(caption.subtitleStyle).toBe("bold");
    expect(caption.endMs).toBe(3000);
    expect(planOf(result).hardCut).toBe(true);
    expect(planOf(result).hookSpanMs).toBe(3000);
  });

  test("is idempotent", () => {
    const first = applyAutoEditCommand(base(), THREE, "moreViral");
    const second = applyAutoEditCommand(first.timeline!, THREE, "moreViral");
    expect(second.changed).toBe(false);
    expect(second.timeline).toBe(first.timeline!);
    expect(second.changelist).toEqual([]);
  });
});

describe("auto-editor — betterPacing", () => {
  test("the voice clip length drives the scene length", () => {
    const shortenedVoice = trimClip(base(), { clipId: "sc-s1-voice", endMs: 7000 }).timeline;
    const result = applyAutoEditCommand(shortenedVoice, THREE, "betterPacing");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[0].endMs - video[0].startMs).toBe(7000);
    expect(video[1].startMs).toBe(7000);
    expect(video[2].startMs).toBe(12_000);
    // captions follow the picture box
    expect(clipById(result.timeline!, "sc-s1-subtitles")!.endMs).toBe(7000);
    expect(result.changelist.some((line) => line.includes("matched its 1 voice clip"))).toBe(true);
  });

  test("tightens the gaps on the video lane and moves the scene with its clips", () => {
    let shifted = base();
    for (const id of ["sc-s3-video", "sc-s3-voice", "sc-s3-subtitles"]) {
      shifted = reorderClip(shifted, { clipId: id, startMs: 10_700 }).timeline;
    }
    expect(videoOf(shifted)[2].startMs).toBe(10_700);
    const result = applyAutoEditCommand(shifted, THREE, "betterPacing");
    const video = videoOf(result.timeline!);
    expect(video[2].startMs).toBe(10_000);
    expect(clipById(result.timeline!, "sc-s3-voice")!.startMs).toBe(10_000);
    expect(clipById(result.timeline!, "sc-s3-subtitles")!.startMs).toBe(10_000);
    expect(result.changelist.some((line) => line.includes("closed a 700ms gap"))).toBe(true);
    // idempotent: nothing left to normalise
    expect(applyAutoEditCommand(result.timeline!, THREE, "betterPacing").changed).toBe(false);
  });
});

describe("auto-editor — betterVisuals", () => {
  test("plans the missing visuals behind an honest image gate and adds b-roll where a prompt exists", () => {
    const result = applyAutoEditCommand(base(), THREE, "betterVisuals");
    assertHonestGate(result, "image_generation", IMAGE_PROVIDER_ENV_NAMES);
    const plan = planOf(result);
    expect(plan.missingVisualPrompt).toEqual(["s2", "s3"]);
    expect(plan.unknownVisualPrompt).toEqual([]);
    expect((plan.readyPrompts as { sceneId: string }[]).map((p) => p.sceneId)).toEqual(["s1"]);
    expect((plan.readyPrompts as { visualPrompt: string }[])[0].visualPrompt).toContain("rain-soaked");
    // the deterministic half really landed: b-roll for the scene that has a prompt
    expect(result.changed).toBe(true);
    const broll = clipsAt(result.timeline!, "broll");
    expect(broll.length).toBe(1);
    expect(broll[0].sourceRef).toBe("visual:scene:s1");
    expect(broll[0].sceneId).toBe("s1");
    expect(result.changelist.some((line) => line.includes("no visual prompt yet"))).toBe(true);
    expect(String(result.note)).toContain("Provider Not Connected");
  });

  test("with no visual prompts at all the timeline is untouched", () => {
    const scenes: SceneInput[] = [{ ...THREE[0], visualPrompt: null }, THREE[1], THREE[2]];
    const timeline = base(scenes);
    const result = applyAutoEditCommand(timeline, scenes, "betterVisuals");
    expect(result.changed).toBe(false);
    expect(result.timeline).toBe(timeline); // same reference: nothing to do
    expect(clipsAt(result.timeline!, "broll").length).toBe(0);
    expect(result.provider!.connected).toBe(false);
    expect(result.changelist.some((line) => line.includes("no visual prompt yet"))).toBe(true);
  });

  test("scenes without a Scene row are reported as unknown, never as 'missing'", () => {
    const timeline = base();
    const result = applyAutoEditCommand(timeline, [], "betterVisuals");
    expect(result.changed).toBe(false);
    expect(planOf(result).unknownVisualPrompt).toEqual(["s1", "s2", "s3"]);
    expect(planOf(result).missingVisualPrompt).toEqual([]);
    expect(result.changelist.some((line) => line.includes("no Scene row"))).toBe(true);
    assertHonestGate(result, "image_generation", IMAGE_PROVIDER_ENV_NAMES);
  });
});

describe("auto-editor — betterVoiceover", () => {
  const VOICE_SCENES: SceneInput[] = [
    { id: "s1", title: "Cold open", narration: "This is the opening narration of the film.", durationSeconds: 5 },
    { id: "s2", title: "The problem", narration: null, durationSeconds: 5 },
    { id: "s3", title: "The payoff", narration: "The resolution lands here.", durationSeconds: 5 },
  ];

  test("normalises the voice-clip gain and plans the missing narration behind an honest TTS gate", () => {
    const quiet = adjustVolume(base(VOICE_SCENES), { clipId: "sc-s1-voice", gain: 0.2 }).timeline;
    const result = applyAutoEditCommand(quiet, VOICE_SCENES, "betterVoiceover");
    expect(result.changed).toBe(true);
    expect(clipById(result.timeline!, "sc-s1-voice")!.gain).toBe(1);
    expect(result.changelist.some((line) => line.includes("gain 0.2 → 1"))).toBe(true);
    expect(planOf(result).missingNarration).toEqual(["s2"]);
    expect(planOf(result).gainTarget).toBe(1);
    expect(result.changelist.some((line) => line.includes("no narration text to speak"))).toBe(true);
    assertHonestGate(result, "voice_generation", VOICE_PROVIDER_ENV_NAMES);
    // no speech is ever claimed
    expect(String(result.note)).toContain("nothing was generated");
  });

  test("a missing gain is left alone (it is already the implicit 1.0) and is idempotent", () => {
    const timeline = base(VOICE_SCENES);
    const result = applyAutoEditCommand(timeline, VOICE_SCENES, "betterVoiceover");
    expect(result.changed).toBe(false);
    expect(result.timeline).toBe(timeline);
    expect(clipById(result.timeline!, "sc-s1-voice")!.gain).toBeUndefined();
    // the gate is still reported honestly
    expect(result.provider!.connected).toBe(false);
  });
});

describe("auto-editor — strongerHook", () => {
  test("shortens the opening shot, bolds the hook captions and adds a title card", () => {
    const result = applyAutoEditCommand(base(), THREE, "strongerHook");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[0].endMs - video[0].startMs).toBeLessThanOrEqual(3000);
    expect(video[1].startMs).toBe(3000);
    expect(clipById(result.timeline!, "sc-s1-subtitles")!.subtitleStyle).toBe("bold");
    const card = result.timeline!.clips.find((clip) => clip.sourceRef === "hook:title")!;
    expect(card).toBeDefined();
    expect(card.trackId).toBe("text");
    expect(card.sceneId).toBe("s1");
    expect([card.startMs, card.endMs]).toEqual([0, 3000]);
    expect(card.name).toContain("Cold open");
    expect(result.changelist.some((line) => line.includes("text: added"))).toBe(true);
  });

  test("is idempotent — the title card is never duplicated", () => {
    const first = applyAutoEditCommand(base(), THREE, "strongerHook");
    expect(first.timeline!.clips.filter((clip) => clip.sourceRef === "hook:title").length).toBe(1);
    const second = applyAutoEditCommand(first.timeline!, THREE, "strongerHook");
    expect(second.changed).toBe(false);
    expect(second.timeline!.clips.filter((clip) => clip.sourceRef === "hook:title").length).toBe(1);
  });
});

describe("auto-editor — moreBroll", () => {
  test("inserts one b-roll clip per scene boundary, pointing at its source scene", () => {
    const timeline = base();
    const result = applyAutoEditCommand(timeline, THREE, "moreBroll");
    expect(result.changed).toBe(true);
    const broll = clipsAt(result.timeline!, "broll");
    expect(broll.length).toBe(2); // 2 boundaries on a 3-scene timeline
    expect(broll.map((clip) => clip.sourceRef)).toEqual(["scene:s2", "scene:s3"]);
    expect(broll.map((clip) => clip.sceneId)).toEqual(["s2", "s3"]);
    expect(broll.map((clip) => clip.startMs)).toEqual([5000, 10_000]);
    for (const clip of broll) {
      const span = clip.endMs - clip.startMs;
      expect(span).toBeGreaterThanOrEqual(1500);
      expect(span).toBeLessThanOrEqual(2500);
    }
    expect(result.changelist.some((line) => line.includes("broll: added"))).toBe(true);
    // a single-scene timeline has no boundary to insert at
    const single = applyAutoEditCommand(base([THREE[0]]), [THREE[0]], "moreBroll");
    expect(single.changed).toBe(false);
  });

  test("is idempotent — inserts are never duplicated", () => {
    const first = applyAutoEditCommand(base(), THREE, "moreBroll");
    const second = applyAutoEditCommand(first.timeline!, THREE, "moreBroll");
    expect(second.changed).toBe(false);
    expect(clipsAt(second.timeline!, "broll").length).toBe(2);
    expect(second.changelist).toEqual([]);
  });
});

describe("auto-editor — reduceRepetition", () => {
  const DUPES: SceneInput[] = [
    { id: "s1", title: "The same beat", narration: "One line of narration here.", durationSeconds: 5 },
    { id: "s2", title: "The same beat", narration: "One line of narration here.", durationSeconds: 5 },
  ];

  test("shortens a near-duplicate consecutive scene without deleting it", () => {
    const timeline = base(DUPES);
    const result = applyAutoEditCommand(timeline, DUPES, "reduceRepetition");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[1].endMs - video[1].startMs).toBe(3000); // 5000ms × 0.6
    expect(video[0].endMs - video[0].startMs).toBe(5000);
    // never deleted, never duplicated
    expect(result.timeline!.clips.length).toBe(timeline.clips.length);
    expect(result.changelist.some((line) => line.includes("shortened") && line.includes("never deleted"))).toBe(true);
    expect(planOf(result).threshold).toBe(0.55);
  });

  test("detects the repeat through the narration when the titles differ", () => {
    const scenes: SceneInput[] = [
      { id: "s1", title: "Alpha", narration: "the same spoken line repeats here", durationSeconds: 6 },
      { id: "s2", title: "Beta", narration: "the same spoken line repeats here", durationSeconds: 6 },
    ];
    const result = applyAutoEditCommand(base(scenes), scenes, "reduceRepetition");
    expect(result.changed).toBe(true);
    expect(result.changelist.some((line) => line.includes("narration overlap"))).toBe(true);
  });

  test("leaves distinct consecutive scenes alone", () => {
    const timeline = base();
    const result = applyAutoEditCommand(timeline, THREE, "reduceRepetition");
    expect(result.changed).toBe(false);
    expect(result.timeline).toBe(timeline);
    expect(String(result.note)).toContain("No two consecutive scenes are near-duplicates");
  });

  test("the similarity helpers are deterministic word overlap", () => {
    expect([...normalizeWords("The Same Beat!")].sort()).toEqual(["beat", "same", "the"]);
    expect(jaccardSimilarity(normalizeWords("the same beat"), normalizeWords("the same beat"))).toBe(1);
    expect(jaccardSimilarity(normalizeWords("alpha beta"), normalizeWords("gamma delta"))).toBe(0);
    expect(jaccardSimilarity(new Set(), normalizeWords("anything"))).toBe(0);
  });
});

describe("auto-editor — professional", () => {
  test("records the colour-accurate grade and collapses every non-cut transition to one dissolve", () => {
    let styled = setTransition(base(), { clipId: "sc-s2-video", kind: "zoom", durationMs: 450 }).timeline;
    styled = setTransition(styled, { clipId: "sc-s3-video", kind: "cinematic", durationMs: 900 }).timeline;
    const result = applyAutoEditCommand(styled, THREE, "professional");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    for (const clip of video) expect(clip.grade).toBe("color-accurate");
    expect(video[1].transition!.kind).toBe("dissolve");
    expect(video[2].transition!.kind).toBe("dissolve");
    const kinds = new Set(
      video.filter((clip) => clip.transition).map((clip) => clip.transition!.kind),
    );
    expect(kinds.size).toBeLessThanOrEqual(2);
    for (const kind of kinds) expect(["cut", "dissolve"]).toContain(kind);
    expect((planOf(result).transitionKinds as string[]).length).toBeLessThanOrEqual(2);
    // idempotent
    expect(applyAutoEditCommand(result.timeline!, THREE, "professional").changed).toBe(false);
  });

  test("a lane that opens on a blend is reset to a hard cut (the house policy)", () => {
    const opened = setTransition(base(), { clipId: "sc-s1-video", kind: "fade", durationMs: 600 }).timeline;
    const result = applyAutoEditCommand(opened, THREE, "professional");
    expect(clipById(result.timeline!, "sc-s1-video")!.transition!.kind).toBe("cut");
    expect(result.changelist.some((line) => line.includes("opening edge"))).toBe(true);
  });
});

describe("auto-editor — documentary", () => {
  test("extends the scenes, adds the missing voice clips and marks the captions", () => {
    const timeline = deleteClip(base(), { clipId: "sc-s2-voice" }).timeline;
    const result = applyAutoEditCommand(timeline, THREE, "documentary");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[0].endMs - video[0].startMs).toBe(6000); // 5000ms × 1.2
    expect(video[1].startMs).toBe(6000);
    expect(video[2].startMs).toBe(12_000);
    // the narrated scene that lost its voice clip gets one back, pointing at the scene
    const voice = clipById(result.timeline!, "sc-s2-voice")!;
    expect(voice.trackId).toBe("voice");
    expect(voice.sourceRef).toBe("scene:s2");
    expect([voice.startMs, voice.endMs]).toEqual([6000, 12_000]);
    // documentary captions + a long dissolve
    for (const caption of clipsAt(result.timeline!, "subtitles")) expect(caption.subtitleStyle).toBe("documentary");
    const blends = video.filter((clip) => clip.transition && clip.transition.kind !== "cut");
    expect(blends.length).toBeGreaterThanOrEqual(1);
    for (const clip of blends) {
      expect(clip.transition!.kind).toBe("dissolve");
      expect(clip.transition!.durationMs).toBe(600);
    }
    // the voice AUDIO is never claimed
    expect(result.changelist.some((line) => line.includes("needs a TTS provider"))).toBe(true);
    expect(String(result.note)).toContain("nothing was synthesized");
    // idempotent
    expect(applyAutoEditCommand(result.timeline!, THREE, "documentary").changed).toBe(false);
  });
});

describe("auto-editor — youtubeOptimized", () => {
  test("3s hook, safe subtitle margins, tightened gaps and an honest SEO gate", () => {
    let timeline = base();
    for (const id of ["sc-s3-video", "sc-s3-voice", "sc-s3-subtitles"]) {
      timeline = reorderClip(timeline, { clipId: id, startMs: 10_700 }).timeline;
    }
    const result = applyAutoEditCommand(timeline, THREE, "youtubeOptimized");
    expect(result.changed).toBe(true);
    const video = videoOf(result.timeline!);
    expect(video[0].endMs - video[0].startMs).toBeLessThanOrEqual(3000);
    expect(video[1].startMs).toBe(3000);
    expect(video[2].startMs).toBe(8000); // the 700ms gap was closed
    for (const caption of clipsAt(result.timeline!, "subtitles")) {
      expect(caption.sourceRef).toBe(SAFE_SUBTITLE_MARGIN_REF);
    }
    assertHonestGate(result, "seo_generation", LLM_PROVIDER_ENV_NAMES);
    expect(planOf(result).suggestions).toEqual({
      requested: ["title", "description"],
      produced: false,
      capability: "seo_generation",
    });
    expect(result.changelist.some((line) => line.includes("were NOT generated"))).toBe(true);
    // …and the changelist's SEO line is the DERIVED one, not a fixed claim about
    // this server's keys: it repeats the live registry reason and says outright
    // that no title/description came out of this command (a wired slot may exist,
    // which is why it may not say "not connected" any more).
    const seoLine = result.changelist.find((line) => line.startsWith("seo:"));
    expect(seoLine).toBeDefined();
    const seoLive = capabilityConnectivity("seo_generation");
    expect(seoLine!).toContain(seoLive.reason);
    expect(seoLine!).toContain("no code path that dispatches to a");
    expect(seoLine!).toContain("no title or description was written or invented");
    expect(seoLine!).not.toContain("is not connected");
    // nothing was invented for the SEO half
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("suggestedTitle");
    expect(serialized).not.toContain("suggestedDescription");
  });

  test("is idempotent", () => {
    const first = applyAutoEditCommand(base(), THREE, "youtubeOptimized");
    const second = applyAutoEditCommand(first.timeline!, THREE, "youtubeOptimized");
    expect(second.changed).toBe(false);
    expect(second.timeline).toBe(first.timeline!);
    // the plan/changelist is still reported (plan lines describe the blocked half)
    expect(second.changelist.some((line) => line.includes("were NOT generated"))).toBe(true);
    expect(second.provider!.connected).toBe(false);
  });
});

describe("auto-editor — provider honesty", () => {
  test("every gated command reports connectable env var names and no fabricated output", () => {
    const cases: {
      command: "betterVisuals" | "betterVoiceover" | "youtubeOptimized";
      capability: string;
      env: string[];
    }[] = [
      { command: "betterVisuals", capability: "image_generation", env: IMAGE_PROVIDER_ENV_NAMES },
      { command: "betterVoiceover", capability: "voice_generation", env: VOICE_PROVIDER_ENV_NAMES },
      { command: "youtubeOptimized", capability: "seo_generation", env: LLM_PROVIDER_ENV_NAMES },
    ];
    for (const entry of cases) {
      const result = applyAutoEditCommand(base(), THREE, entry.command);
      assertHonestGate(result, entry.capability, entry.env);
      // a gate is never a "here is the generated thing" payload
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("http://");
      expect(serialized).not.toContain("https://");
      expect(planOf(result).capability === undefined || planOf(result).capability === entry.capability).toBe(true);
    }
  });

  test("the pure commands carry no provider at all", () => {
    for (const command of ["moreCinematic", "moreEmotional", "moreViral", "betterPacing", "strongerHook", "moreBroll", "reduceRepetition", "professional", "documentary"] as const) {
      const result = applyAutoEditCommand(base(), THREE, command);
      expect(result.provider).toBeUndefined();
    }
  });
});
