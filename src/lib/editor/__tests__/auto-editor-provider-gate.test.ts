import { describe, expect, test } from "bun:test";
import {
  IMAGE_PROVIDER_ENV_NAMES,
  LLM_PROVIDER_ENV_NAMES,
  VOICE_PROVIDER_ENV_NAMES,
  applyAutoEditCommand,
} from "../auto-editor";
import { buildTimelineFromScenes, type SceneInput } from "../timeline";
import { capabilityConnectivity } from "../../ai/providers/capability-connectivity";

/**
 * Block 8 (remainder) — the auto-editor's three provider-gated commands.
 *
 * `betterVisuals` exposed its gate only when the timeline happened to have a
 * missing/unknown visual prompt (`provider: blocked ? provider : undefined`),
 * while its two siblings exposed theirs unconditionally. A caller therefore could
 * not read image_generation's connectivity from a response for a timeline with
 * every prompt present — even though generating a missing visual IS a
 * provider-dependent step of that command. Every assertion here fails on the
 * pre-change source.
 *
 * The second defect pinned here is the changelist sentence "… — OPENAI_API_KEY
 * not set", a claim about THIS server's keys; it is replaced by the registry's
 * own live reason, which is the same predicate /api/ai/status reports.
 */

const ALL_PROMPTS: SceneInput[] = [
  {
    id: "s1",
    title: "Cold open",
    narration: "This is the opening narration of the film.",
    durationSeconds: 8,
    visualPrompt: "A slow dolly over a rain-soaked city at night",
  },
  {
    id: "s2",
    title: "The problem",
    narration: "Now the difficulty appears and it matters.",
    durationSeconds: 8,
    visualPrompt: "A quiet desk under a single lamp",
  },
  {
    id: "s3",
    title: "The payoff",
    narration: "The resolution lands here.",
    durationSeconds: 8,
    visualPrompt: "Sunrise over the harbour",
  },
];

const GATED = [
  { command: "betterVisuals", capability: "image_generation", env: IMAGE_PROVIDER_ENV_NAMES },
  { command: "betterVoiceover", capability: "voice_generation", env: VOICE_PROVIDER_ENV_NAMES },
  { command: "youtubeOptimized", capability: "seo_generation", env: LLM_PROVIDER_ENV_NAMES },
] as const;

describe("auto-editor — every gated command exposes its gate, and it is the registry's", () => {
  test("all three gated commands expose a gate for a timeline with nothing missing", () => {
    const timeline = buildTimelineFromScenes(ALL_PROMPTS);
    for (const entry of GATED) {
      const result = applyAutoEditCommand(timeline, ALL_PROMPTS, entry.command);
      // FAILS on the pre-change source: betterVisuals returned provider === undefined here.
      expect(result.provider).toBeDefined();
      const gate = result.provider!;
      expect(gate.capability).toBe(entry.capability);
      const live = capabilityConnectivity(entry.capability);
      expect(gate.connected).toBe(live.connected);
      expect(gate.connectivity[0].reason).toBe(live.reason);
      expect(gate.connectivity[0].status).toBe(live.status);
      expect(gate.requiredEnv).toEqual(live.requiredEnv);
      expect([...gate.requiredEnv].sort()).toEqual([...entry.env].sort());
    }
  });

  test("betterVisuals never claims a specific env var is not set — it prints the live reason", () => {
    const missing = ALL_PROMPTS.map((s, i) => (i === 1 ? { ...s, visualPrompt: null } : s));
    const result = applyAutoEditCommand(buildTimelineFromScenes(missing), missing, "betterVisuals");
    const lines = result.changelist.filter((l) => l.includes("no visual prompt yet"));
    expect(lines.length).toBe(1);
    for (const line of lines) {
      expect(line).not.toMatch(/not set/);
      expect(line).toContain(capabilityConnectivity("image_generation").reason);
    }
    for (const line of result.changelist) expect(line).not.toMatch(/not set/);
  });

  test("betterVoiceover prints the live reason too, not a claim about a key", () => {
    const silent = ALL_PROMPTS.map((s, i) => (i === 1 ? { ...s, narration: null } : s));
    const result = applyAutoEditCommand(buildTimelineFromScenes(silent), silent, "betterVoiceover");
    const lines = result.changelist.filter((l) => l.includes("no narration text to speak"));
    expect(lines.length).toBe(1);
    for (const line of lines) {
      expect(line).not.toMatch(/not set/);
      expect(line).toContain(capabilityConnectivity("voice_generation").reason);
    }
  });
});
