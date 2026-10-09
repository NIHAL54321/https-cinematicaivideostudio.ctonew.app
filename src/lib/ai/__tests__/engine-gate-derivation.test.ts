/**
 * BLOCK 8 — the four engine gates are DERIVED, and they agree with /api/ai/status.
 *
 * The defect this file pins down, stated once: `framing/service.ts`,
 * `color/service.ts`, `repurpose/service.ts` and `editor/auto-editor.ts` each
 * carried a hard-coded `*_PROVIDER_CONNECTED = false`. A constant like that is a
 * claim about THIS MACHINE, and on a server that has a wired adapter and its key
 * set it would print "not connected" while `/api/ai/status` printed "connected"
 * — in the same response, on the same machine.
 *
 * The tests below therefore assert AGREEMENT, not a fixed value:
 *   - unkeyed: every gate is closed, its reason is derived, and no gate states a
 *     fixed fact about the server ("no provider key is set"),
 *   - keyed (in-test only, cleaned up in `finally`): every gate that covers
 *     `video_enhancement` reports exactly what the status API reports
 *     (configured AND wired), and no gate claims the key is absent,
 *   - a key that belongs to an UNWIRED slot changes nothing and the gate says so,
 *   - the answer is re-derived per call: removing the key flips it back.
 *
 * Env var NAMES only ever appear here; the placeholder value is set inside the
 * test and never written to disk.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { capabilityStatus } from "../status";
import { AI_CAPABILITIES, type AiCapabilityId } from "../types";
import { allProviderEnvVars } from "../providers/env-keys";
import { colorProviderGate } from "../../color/service";
import { framingDetectorGate, framingRenderGate } from "../../framing/service";
import { repurposeAnalysisGate, repurposeRenderGate } from "../../repurpose/service";
import { applyAutoEditCommand } from "../../editor/auto-editor";
import { buildTimelineFromScenes, type SceneInput } from "../../editor/timeline";

/** The registry's own name for the one slot that IS wired for video_enhancement. */
const KEY_ENV = "REPLICATE_API_TOKEN";
/** The registry's own name for a slot that advertises video_enhancement and is NOT wired. */
const UNWIRED_KEY_ENV = "RUNWAY_API_KEY";
/** A placeholder, never a real key: it only has to be a non-empty string. */
const SET_IN_TEST = "block8_in_test_placeholder_not_a_real_key";

const SCENES: SceneInput[] = [
  { id: "s1", title: "Cold open", narration: "This is the opening narration of the film.", durationSeconds: 5, visualPrompt: "A slow dolly over a rain-soaked city at night" },
  { id: "s2", title: "The problem", narration: "Now the difficulty appears.", durationSeconds: 5 },
  { id: "s3", title: "The payoff", narration: "The resolution lands here.", durationSeconds: 5 },
];

interface GateShape {
  capability: string;
  connected: boolean;
  engineDispatches: boolean;
  requiredEnv: string[];
  note: string;
  connectivity: { capability: string; status: string; connected: boolean }[];
}

/** Every engine gate, produced the way the engine produces it. */
function everyEngineGate(): { name: string; engine: string; gate: GateShape }[] {
  const timeline = buildTimelineFromScenes(SCENES);
  const visuals = applyAutoEditCommand(timeline, SCENES, "betterVisuals").provider as unknown as GateShape;
  const voice = applyAutoEditCommand(timeline, SCENES, "betterVoiceover").provider as unknown as GateShape;
  const seo = applyAutoEditCommand(timeline, SCENES, "youtubeOptimized").provider as unknown as GateShape;
  return [
    { name: "framingDetectorGate", engine: "framing", gate: framingDetectorGate("Locating the subject") as unknown as GateShape },
    { name: "framingRenderGate", engine: "framing", gate: framingRenderGate("Rendering the reframed pixels") as unknown as GateShape },
    { name: "colorProviderGate", engine: "color", gate: colorProviderGate("Rendering the graded frames") as unknown as GateShape },
    { name: "repurposeAnalysisGate", engine: "repurpose", gate: repurposeAnalysisGate("Transcribing the audio") as unknown as GateShape },
    { name: "repurposeRenderGate", engine: "repurpose", gate: repurposeRenderGate("Encoding the clip files") as unknown as GateShape },
    { name: "autoEditor:betterVisuals", engine: "auto-editor", gate: visuals },
    { name: "autoEditor:betterVoiceover", engine: "auto-editor", gate: voice },
    { name: "autoEditor:youtubeOptimized", engine: "auto-editor", gate: seo },
  ];
}

/**
 * Sentences that assert a FIXED fact about this server's keys. These are the
 * legacy wordings: each one can be false on a server where it is printed.
 * (A derived "X is not wired" is fine and deliberately not listed: it is a
 * conclusion computed from the registry just now, not a stored claim.)
 */
const FORBIDDEN_CLAIMS = [
  "no provider key is set",
  "no key is set",
  "no keys are set",
  "no keys are configured",
  "provider not connected",
  "no provider is connected",
  "not connected",
];

function claimOffenders(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_CLAIMS.filter((phrase) => lower.includes(phrase));
}

/**
 * The derived-gate invariants, asserted as joined strings so a mismatch prints
 * the gate's name next to the two values being compared.
 */
function expectDerivedGate(name: string, gate: GateShape): void {
  // A code fact, checked before anything that needs the new shape: this engine
  // has no call site that dispatches to a provider.
  expect(`${name}:engineDispatches=${gate.engineDispatches}`).toBe(`${name}:engineDispatches=false`);
  const entries = gate.connectivity ?? [];
  expect(`${name}:connectivityEntries=${entries.length > 0}`).toBe(`${name}:connectivityEntries=true`);
  for (const entry of entries) {
    const status = capabilityStatus(entry.capability as AiCapabilityId).status;
    // AGREEMENT with the status API — the whole point of the change.
    expect(`${name}|${entry.capability}:entryStatus=${entry.status}`).toBe(`${name}|${entry.capability}:entryStatus=${status}`);
    expect(`${name}|${entry.capability}:entryConnected=${entry.connected}`).toBe(
      `${name}|${entry.capability}:entryConnected=${status === "connected"}`,
    );
  }
  // DERIVED in both directions: the gate's own flag is the AND over its needs.
  expect(`${name}:connected=${gate.connected}`).toBe(`${name}:connected=${entries.every((e) => e.connected)}`);
  expect(`${name}:claims=${claimOffenders(gate.note).join(",")}`).toBe(`${name}:claims=`);
  expect(gate.note).toContain("no code path that dispatches");
  for (const envName of gate.requiredEnv) expect(allProviderEnvVars()).toContain(envName);
}

const savedKeys = new Map<string, string | undefined>();
for (const name of [KEY_ENV, UNWIRED_KEY_ENV]) savedKeys.set(name, process.env[name]);
afterEach(() => {
  for (const [name, value] of savedKeys) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("block 8 — every engine gate is derived from the registry, never declared", () => {
  test("UNKEYED: every gate is closed, derived, and free of fixed claims", () => {
    delete process.env[KEY_ENV];
    delete process.env[UNWIRED_KEY_ENV];
    for (const { name, gate } of everyEngineGate()) {
      // Nothing configured AND wired ⇒ closed. The status API agrees.
      expect(`${name}:connected=${gate.connected}`).toBe(`${name}:connected=false`);
      expectDerivedGate(name, gate);
    }
  });

  test("KEYED (in-test only): a video_enhancement gate reports what the status API reports", () => {
    process.env[KEY_ENV] = SET_IN_TEST;
    try {
      // Sanity: the key really does clear the capability for the status API.
      expect(capabilityStatus("video_enhancement").status).toBe("connected");
      const all = everyEngineGate();
      const videoGates = all.filter(({ gate }) =>
        (gate.connectivity ?? []).some((e) => e.capability === "video_enhancement"),
      );
      // color, framing render and repurpose render all cover video_enhancement.
      expect(videoGates.map((g) => g.name)).toEqual([
        "framingRenderGate",
        "colorProviderGate",
        "repurposeRenderGate",
      ]);
      for (const { name, gate } of videoGates) {
        // THE OLD BEHAVIOUR FAILS HERE, on this line: the constant said false
        // while the status API says connected.
        expect(`${name}:connected=${gate.connected}`).toBe(`${name}:connected=true`);
        expectDerivedGate(name, gate);
      }
      // And every gate in the app, video_enhancement or not, stays free of
      // claims that this server has no keys.
      for (const { name, gate } of all) {
        expect(`${name}:claims=${claimOffenders(gate.note).join(",")}`).toBe(`${name}:claims=`);
      }
    } finally {
      delete process.env[KEY_ENV];
    }
  });

  test("KEYED with an UNWIRED slot's key: nothing changes, and the gate says exactly that", () => {
    delete process.env[KEY_ENV];
    process.env[UNWIRED_KEY_ENV] = SET_IN_TEST;
    try {
      // Runway advertises video_enhancement and has no adapter.
      expect(capabilityStatus("video_enhancement").status).toBe("not_connected");
      const gate = framingRenderGate("Rendering the reframed pixels") as unknown as GateShape;
      expect(`${gate.connected}`).toBe("false");
      // It names the wired slot, and it does not pretend the runway key helps.
      expect(gate.note).toContain("REPLICATE_API_TOKEN");
      expect(gate.note).toContain("UNWIRED slot");
      expect(gate.note).toContain("RUNWAY_API_KEY");
      expect(claimOffenders(gate.note)).toEqual([]);
    } finally {
      delete process.env[UNWIRED_KEY_ENV];
    }
  });

  test("the gate is re-derived per call — removing the key puts the answer back", () => {
    delete process.env[KEY_ENV];
    const before = colorProviderGate("Rendering the graded frames") as unknown as GateShape;
    process.env[KEY_ENV] = SET_IN_TEST;
    const keyed = colorProviderGate("Rendering the graded frames") as unknown as GateShape;
    delete process.env[KEY_ENV];
    const after = colorProviderGate("Rendering the graded frames") as unknown as GateShape;
    // Same process, same module instance, three different answers: nothing about
    // this gate is cached, hard-coded, or decided at import time.
    expect(`${before.connected}/${keyed.connected}/${after.connected}`).toBe("false/true/false");
    expect(keyed.connectivity[0].status).toBe("connected");
    expect(after.connectivity[0].status).toBe("not_connected");
  });

  test("every gate's capabilities are registered, and no gate invents an env var name", () => {
    for (const { name, gate } of everyEngineGate()) {
      for (const entry of gate.connectivity) {
        expect(`${name}:${(AI_CAPABILITIES as readonly string[]).includes(entry.capability)}`).toBe(`${name}:true`);
      }
      expect(gate.requiredEnv.length).toBeGreaterThan(0);
      expect(JSON.stringify(gate)).not.toMatch(/sk-|secret|token=/i);
    }
  });
});
