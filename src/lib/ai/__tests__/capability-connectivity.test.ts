/**
 * BLOCK 8 — the shared derivation itself.
 *
 * `capability-connectivity.ts` is the one place a gate's `connected` comes from.
 * This suite pins the invariants that make it trustworthy:
 *   - for EVERY registered capability, `status`/`connected` is exactly what
 *     GET /api/ai/status reports (one predicate, two surfaces),
 *   - `connected` agrees with the per-slot view (configured AND wired),
 *   - the derived `reason` is computed per call — never cached across calls,
 *   - a single-capability requirement is the existing wording verbatim, so the
 *     operator instruction did not change when the gate did.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { AI_CAPABILITIES } from "../types";
import { capabilityStatus } from "../status";
import { capabilityEnvRequirement } from "../providers/capability-env";
import {
  capabilityConnectivity,
  capabilityEnvRequirementFor,
  derivedProviderGate,
  isCapabilityConnected,
} from "../providers/capability-connectivity";

const KEY_ENV = "REPLICATE_API_TOKEN";
const SET_IN_TEST = "block8_in_test_placeholder_not_a_real_key";
const saved = process.env[KEY_ENV];
afterEach(() => {
  if (saved === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = saved;
});

describe("block 8 — capability connectivity is one derivation, read live", () => {
  test("every registered capability agrees with /api/ai/status", () => {
    for (const capability of AI_CAPABILITIES) {
      const conn = capabilityConnectivity(capability);
      const status = capabilityStatus(capability);
      expect(`${capability}:${conn.status}`).toBe(`${capability}:${status.status}`);
      expect(`${capability}:${conn.connected}`).toBe(`${capability}:${status.status === "connected"}`);
      expect(`${capability}:${conn.requiredEnv.join(",")}`).toBe(`${capability}:${status.requiredEnv.join(",")}`);
      // The per-slot view and the capability flag are the same fact.
      const anyConnected = conn.wiredSlots.some((s) => s.configured);
      expect(`${capability}:${conn.connected}`).toBe(`${capability}:${anyConnected}`);
      expect(conn.connected).toBe(isCapabilityConnected(capability));
      // The reason is always a sentence, never empty, and never a stored claim
      // about keys when the capability is in fact connected.
      expect(conn.reason.length).toBeGreaterThan(20);
      if (conn.connected) expect(conn.reason.toLowerCase()).not.toContain("no key");
    }
  });

  test("a single-capability requirement is unchanged; a union names every derived var", () => {
    for (const capability of AI_CAPABILITIES) {
      expect(capabilityEnvRequirementFor([capability])).toBe(capabilityEnvRequirement(capability));
    }
    const union = capabilityEnvRequirementFor(["speech_recognition", "scene_detection"]);
    expect(union).toContain("ELEVENLABS_API_KEY");
    expect(union).toContain("AZURE_SPEECH_KEY");
    expect(union).toContain("Wired slots: none");
    expect(union).not.toContain("TRANSCRIPTION_API_KEY");
  });

  test("the gate is re-derived per call, and `engineDispatches` stays a code fact", () => {
    delete process.env[KEY_ENV];
    const spec = {
      capability: "video_enhancement",
      what: "Encoding a file",
      notProduced: "no file was produced.",
      engineDispatches: false,
    } as const;
    const before = derivedProviderGate(spec);
    process.env[KEY_ENV] = SET_IN_TEST;
    const during = derivedProviderGate(spec);
    delete process.env[KEY_ENV];
    const after = derivedProviderGate(spec);
    expect(`${before.connected}/${during.connected}/${after.connected}`).toBe("false/true/false");
    expect(during.connectedBasis).toContain("configured AND wired");
    expect(before.connectedBasis).toContain("Not reachable right now");
    // The note reads differently in each state — nothing is memoised.
    expect(during.note).not.toBe(before.note);
    expect(after.note).toBe(before.note);
    // A key CANNOT make this engine produce work it has no code path for.
    expect(during.engineDispatches).toBe(false);
    expect(during.note).toContain("no code path that dispatches");
  });

  test("an unregistered capability is reported as such instead of naming a variable", () => {
    const conn = capabilityConnectivity("media_analysis");
    expect(`${conn.registered}/${conn.connected}`).toBe("false/false");
    expect(conn.requiredEnv).toEqual([]);
    expect(conn.envHint).toBeNull();
    expect(conn.reason).toContain("not a registered capability");
    const gate = derivedProviderGate({
      capability: "media_analysis",
      what: "Analysing",
      notProduced: "no analysis was produced.",
      engineDispatches: false,
    });
    expect(gate.requiredEnv).toEqual([]);
    expect(JSON.stringify(gate)).not.toContain("API_KEY");
  });
});
