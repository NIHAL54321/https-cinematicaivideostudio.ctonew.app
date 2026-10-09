/**
 * BLOCK 9 — the pacing note's provider half is DERIVED, and it agrees with
 * /api/ai/status in BOTH directions.
 *
 * The defect: `src/lib/editor/pacing.ts` hard-coded "no provider is connected" in
 * two note branches (and in the file header). That is a claim about THIS SERVER:
 * on a server with a wired adapter and its key set it would print a falsehood
 * while `GET /api/ai/status` printed "connected" — and the pacing read-out is
 * rendered verbatim in the editor, next to other panels that report the derived
 * gate. The note now carries `paceProviderRequirement()` instead.
 *
 * The tests assert AGREEMENT, not a fixed value:
 *   - unkeyed: every clause names the live registry reason for the capabilities an
 *     AI pacing pass would need, and no FIXED claim about keys is present;
 *   - keyed (in-test only, always cleaned up): with EVERY wired slot's own key set
 *     — the names derived from the registry — every capability that has a wired
 *     slot flips to "configured AND wired" and the sentence that said no wired slot
 *     has a key is gone; and with only the export path's key set, the script slot is
 *     honestly reported as keyless rather than implied to be connected;
 *   - the two kinds of clause are separated: the engine half is a code fact, the
 *     provider half is live.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { analyzePacing, paceProviderRequirement, PACE_AI_CAPABILITIES } from "../pacing";
import { buildTimelineFromScenes, type SceneInput } from "../timeline";
import { capabilityConnectivity } from "../../ai/providers/capability-connectivity";
import { capabilityEnvPath } from "../../ai/providers/capability-env";
import { capabilityStatus } from "../../ai/status";
import { allProviderEnvVars } from "../../ai/providers/env-keys";

/**
 * The env var NAMES that key every slot which really has an adapter, for the
 * capabilities an AI pacing pass would need — derived from the registry, so a new
 * adapter changes this set with no edit here.
 */
function wiredSlotEnvNames(): string[] {
  return [
    ...new Set(
      PACE_AI_CAPABILITIES.flatMap((c) =>
        capabilityEnvPath(c)
          .providers.filter((p) => p.wired)
          .flatMap((p) => p.envKeys),
      ),
    ),
  ];
}

/** The registry's own name for the one slot that IS wired for video_enhancement. */
const KEY_ENV = "REPLICATE_API_TOKEN";
/** A placeholder, never a real key: it only has to be a non-empty string. */
const SET_IN_TEST = "block9_in_test_placeholder_not_a_real_key";

/** Sentence shapes that assert a FIXED fact about this server's keys. */
const FIXED_KEY_CLAIMS = ["no provider is connected", "no key is set", "no keys are set", "no provider key is set"];

function fixedClaimsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return FIXED_KEY_CLAIMS.filter((p) => lower.includes(p));
}

const SCENES: SceneInput[] = [
  { id: "s1", title: "Cold open", narration: "This is the opening narration of the film.", durationSeconds: 5 },
  { id: "s2", title: "The problem", narration: "Now the difficulty appears.", durationSeconds: 5 },
];
const TIMELINE = buildTimelineFromScenes(SCENES);

const saved = process.env[KEY_ENV];
afterEach(() => {
  if (saved === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = saved;
});

describe("block 9 — the pacing note's provider half is derived from the registry", () => {
  test("UNKEYED: the note carries the live reason for every capability an AI pass would need", () => {
    delete process.env[KEY_ENV];
    const note = analyzePacing(TIMELINE, SCENES).note;
    for (const capability of PACE_AI_CAPABILITIES) {
      // The status API's own answer, word for word — they cannot disagree.
      expect(note).toContain(capabilityConnectivity(capability).reason);
    }
    // The old hard-coded sentence is gone (it is what the old source contained).
    expect(fixedClaimsIn(note)).toEqual([]);
    // The engine half is still stated, as a code fact.
    expect(note).toContain("no code path that dispatches to a provider");
    expect(note).toContain("no score here is AI-refined");
    // Env var NAMES only, straight from the registry.
    for (const name of capabilityConnectivity("video_enhancement").requiredEnv) {
      expect(allProviderEnvVars()).toContain(name);
    }
  });

  test("KEYED (in-test only): every wired slot keyed → the absent-key claim is gone", () => {
    // The invariant is "no wired slot is left without a key" — derived from the
    // registry, never the name of one provider (Block 13 added a second adapter,
    // so keying only the export path no longer satisfies it).
    const wiredEnvNames = wiredSlotEnvNames();
    expect(wiredEnvNames.length).toBeGreaterThan(0);
    const savedKeys: Record<string, string | undefined> = {};
    for (const name of wiredEnvNames) {
      savedKeys[name] = process.env[name];
      process.env[name] = SET_IN_TEST;
    }
    try {
      const note = analyzePacing(TIMELINE, SCENES).note;
      // The video_enhancement half reports the connection, not a missing key…
      expect(note).toContain('replicate (REPLICATE_API_TOKEN) is configured AND wired for "video_enhancement" right now');
      // …and with every wired slot keyed, no absent-key clause is produced at all.
      expect(note).not.toContain("no key for a wired slot");
      expect(fixedClaimsIn(note)).toEqual([]);
      // The note still agrees, word for word, with the status API's own reason.
      for (const capability of PACE_AI_CAPABILITIES) {
        expect(note).toContain(capabilityConnectivity(capability).reason);
      }
    } finally {
      for (const name of wiredEnvNames) {
        if (savedKeys[name] === undefined) delete process.env[name];
        else process.env[name] = savedKeys[name];
      }
    }
  });

  test("KEYED with the export path's key only: the script slot is honestly reported as keyless", () => {
    process.env[KEY_ENV] = SET_IN_TEST;
    try {
      // Sanity: the key really does clear the capability it belongs to.
      expect(capabilityStatus("video_enhancement").status).toBe("connected");
      const note = analyzePacing(TIMELINE, SCENES).note;
      expect(note).toContain('replicate (REPLICATE_API_TOKEN) is configured AND wired for "video_enhancement" right now');
      // OpenAI's adapter IS wired for script_generation, and its key is NOT set
      // here — so the note must say exactly that, not imply the step is connected
      // and not fall back to a fixed claim about keys.
      expect(note).toContain("script_generation");
      expect(note).not.toContain('is configured AND wired for "script_generation"');
      expect(note).toContain("no key for a wired slot");
      expect(fixedClaimsIn(note)).toEqual([]);
      // music_generation has no adapter at all: a code fact, stated as one.
      expect(note).toContain("music_generation");
    } finally {
      delete process.env[KEY_ENV];
    }
  });

  test("the requirement is re-derived per call — removing the key puts the answer back", () => {
    delete process.env[KEY_ENV];
    const before = paceProviderRequirement().note;
    process.env[KEY_ENV] = SET_IN_TEST;
    const keyed = paceProviderRequirement();
    delete process.env[KEY_ENV];
    const after = paceProviderRequirement().note;
    expect(`${paceProviderRequirement().connected}`).toBe("false");
    expect(keyed.connected).toBe(false); // script_generation/music_generation are unwired
    expect(before).not.toBe(keyed.note);
    expect(after).toBe(before);
  });

  test("all three note branches carry the derived half, including the empty timeline", () => {
    delete process.env[KEY_ENV];
    const empty = analyzePacing(buildTimelineFromScenes([]), []).note;
    expect(empty).toContain("The timeline is empty");
    expect(empty).toContain("no code path that dispatches to a provider");
    expect(fixedClaimsIn(empty)).toEqual([]);
    for (const branch of [empty, analyzePacing(TIMELINE, SCENES).note]) {
      expect(branch).toContain(capabilityConnectivity("video_enhancement").reason);
    }
  });
});
