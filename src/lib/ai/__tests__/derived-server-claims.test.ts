/**
 * BLOCK 9 — CONFIRMATION (not assumption) that the server-side claims already
 * shipped in Block 8 are gated on LIVE connectivity in BOTH branches.
 *
 * Two sentences were named for this check:
 *   - `src/lib/ai/providers/capability-connectivity.ts`'s
 *     "…is wired for "X" but no key for a wired slot (…) is set on this server
 *     right now" — the sentence a gate prints when nothing is connected;
 *   - `src/lib/export/service.ts`'s
 *     "…IS wired (provider slot …) but no key for a wired slot is set on this
 *     server, so nothing was attempted" — the same sentence one layer up.
 *
 * "Gated on live connectivity in BOTH branches" means: with no key set the
 * sentence IS produced and names the registry's own env var; with the wired
 * slot's key set the SAME code path produces a different sentence that reports
 * the connection instead, and the key-absent wording is gone. Both directions are
 * executed here by mutating `process.env` in-test and cleaning up in `afterEach`
 * (never a value on disk; a placeholder only).
 *
 * What was checked by reading, and is asserted below by running:
 *   - capability-connectivity.ts:126 is inside `connectivityReason`, reached only
 *     when `connectedSlots.length === 0 && wired.length > 0`, where both are
 *     computed from the registry's live `configured`/`wired` flags in the same
 *     call (`capabilityConnectivity`, line 151: `s.configured && s.wired`);
 *   - export/service.ts:220 is the `:` arm of `connected ? … : …`, and `connected`
 *     is `exportProviderConnected()` (line 163/165 of the same file) — a call, not
 *     a constant — so the arm is only reachable when no serving slot is both
 *     configured and wired at response time.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { capabilityConnectivity } from "../providers/capability-connectivity";
import { capabilityStatus } from "../status";
import { exportProviderGate } from "../../export/service";

const KEY_ENV = "REPLICATE_API_TOKEN";
const SET_IN_TEST = "block9_in_test_placeholder_not_a_real_key";
/** The wording both sentences use; only derivable, never declarable. */
const KEY_ABSENT_SENTENCE = "no key for a wired slot";
const CONNECTED_SENTENCE = "configured AND wired";

const saved = process.env[KEY_ENV];
afterEach(() => {
  if (saved === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = saved;
});

describe("block 9 — the shipped derived server claims answer in both directions", () => {
  test("capability-connectivity's reason: key-absent unkeyed, connected keyed", () => {
    delete process.env[KEY_ENV];
    const unkeyed = capabilityConnectivity("video_enhancement");
    expect(capabilityStatus("video_enhancement").status).toBe("not_connected");
    expect(unkeyed.connected).toBe(false);
    expect(unkeyed.reason).toContain(KEY_ABSENT_SENTENCE);
    // and it names the registry's own var, not an invented one
    expect(unkeyed.reason).toContain("REPLICATE_API_TOKEN");

    process.env[KEY_ENV] = SET_IN_TEST;
    try {
      const keyed = capabilityConnectivity("video_enhancement");
      expect(capabilityStatus("video_enhancement").status).toBe("connected");
      expect(keyed.connected).toBe(true);
      expect(keyed.reason).toContain(CONNECTED_SENTENCE);
      expect(keyed.reason).toContain("replicate");
      // THE OTHER BRANCH: the key-absent sentence is NOT produced here.
      expect(keyed.reason).not.toContain(KEY_ABSENT_SENTENCE);
      expect(keyed.connectedSlots).toEqual(["replicate"]);
    } finally {
      delete process.env[KEY_ENV];
    }
    // re-derived per call: the same module instance answers unkeyed again
    expect(capabilityConnectivity("video_enhancement").reason).toContain(KEY_ABSENT_SENTENCE);
  });

  test("the export gate's note: key-absent unkeyed, hand-off-not-a-file keyed", () => {
    delete process.env[KEY_ENV];
    const unkeyed = exportProviderGate("Encoding the master");
    expect(unkeyed.connected).toBe(false);
    expect(unkeyed.note).toContain(KEY_ABSENT_SENTENCE);
    expect(unkeyed.note).toContain("REPLICATE_API_TOKEN");
    // The no-file claim is made in BOTH states.
    expect(unkeyed.note).toContain("filesProduced stays 0 until this app verifies an output");

    process.env[KEY_ENV] = SET_IN_TEST;
    try {
      const keyed = exportProviderGate("Encoding the master");
      expect(keyed.connected).toBe(true);
      expect(keyed.note).toContain("served by a connected, wired provider");
      expect(keyed.note).not.toContain(KEY_ABSENT_SENTENCE);
      // ...and it still refuses to imply an output: a hand-off is not a file.
      expect(keyed.note).toContain("A hand-off is NOT a produced file");
      expect(keyed.note).toContain("filesProduced stays 0 until this app verifies an output");
      expect(keyed.note).not.toMatch(/\bprogress\b|\bpercent\b|\beta\b|\bcompleted\b/i);
      expect(keyed.connectedProviders.map((p) => p.id)).toEqual(["replicate"]);
    } finally {
      delete process.env[KEY_ENV];
    }
  });
});
