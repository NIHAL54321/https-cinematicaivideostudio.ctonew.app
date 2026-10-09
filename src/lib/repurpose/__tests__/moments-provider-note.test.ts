import { describe, expect, test } from "bun:test";
import { analyzeMoments, MOMENT_ANALYSIS_CAPABILITIES, momentProviderRequirement } from "../moments";
import { buildTimelineFromScenes, type SceneInput } from "../../editor/timeline";
import {
  capabilityConnectivity,
  capabilityEnvRequirementFor,
} from "../../ai/providers/capability-connectivity";
import { capabilityStatus } from "../../ai/status";
import { capabilityEnvNamesFor } from "../../ai/providers/capability-env";

/**
 * Block 8 (remainder) — the moments note must never state a fixed claim about
 * THIS server's keys.
 *
 * The note used to end with the hard-coded sentence "no provider is connected"
 * in both branches (the empty-lane one and the scored one). That is a claim
 * about the machine the code happens to be running on: on a server whose wired
 * slots are configured it would print a falsehood in the same response where
 * `GET /api/ai/status` prints "connected" for the very capabilities the note
 * names. Every assertion below fails against that pre-change source.
 *
 * What is asserted instead:
 *   - the live half of the note IS the registry's own reason for each named
 *     capability, so it agrees with /api/ai/status by construction;
 *   - with keys present the note does not fall back to a key-absence claim;
 *   - the requirement half names env vars the registry actually reads;
 *   - the CODE half (no dispatch call site) is stated as such, and stays true
 *     whichever way the keys go.
 */

const SCENES: SceneInput[] = [
  { id: "s1", title: "Cold open", narration: "This is the opening narration of the film.", durationSeconds: 8 },
  { id: "s2", title: "The problem", narration: "Now the difficulty appears and it matters.", durationSeconds: 8 },
];

const TIMELINE = buildTimelineFromScenes(SCENES);

const EMPTY: SceneInput[] = [];

/** Every env var the registry says could serve either capability. */
const CANDIDATE_ENV_NAMES = capabilityEnvNamesFor([...MOMENT_ANALYSIS_CAPABILITIES]);

const LIVE_ABSENCE_CLAIMS = [
  "no provider is connected",
  "no provider key is set",
  "no key for a wired slot",
];

describe("moments — the provider note is derived, never a claim about this server", () => {
  test("the note carries the registry's live reason for BOTH capabilities it names", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    expect(analysis.note).toContain("no transcript");
    for (const capability of MOMENT_ANALYSIS_CAPABILITIES) {
      const live = capabilityConnectivity(capability);
      // The note names the capability and repeats its live reason verbatim.
      expect(analysis.note).toContain(capability);
      expect(analysis.note).toContain(live.reason);
      // ...and that reason agrees with what the status API reports.
      const status = capabilityStatus(capability);
      expect(live.status).toBe(status.status === "connected" ? "connected" : "not_connected");
      expect(live.connected).toBe(live.status === "connected");
    }
    for (const claim of LIVE_ABSENCE_CLAIMS) expect(analysis.note).not.toContain(claim);
  });

  test("the empty-lane branch states the same derived requirement (no hard-coded absence)", () => {
    const analysis = analyzeMoments(buildTimelineFromScenes(EMPTY), EMPTY);
    expect(analysis.note).toContain("nothing to score");
    for (const capability of MOMENT_ANALYSIS_CAPABILITIES) {
      expect(analysis.note).toContain(capabilityConnectivity(capability).reason);
    }
    for (const claim of LIVE_ABSENCE_CLAIMS) expect(analysis.note).not.toContain(claim);
  });

  test("the operator requirement is the registry's own naming, not a literal", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    expect(CANDIDATE_ENV_NAMES.length).toBeGreaterThan(0);
    // At least one name the registry reads appears, so an operator can act on it.
    expect(CANDIDATE_ENV_NAMES.some((name) => analysis.note.includes(name))).toBe(true);
    // ...and the requirement text is the shared implementation's, verbatim.
    expect(analysis.note).toContain(capabilityEnvRequirementFor([...MOMENT_ANALYSIS_CAPABILITIES]));
  });

  test("with keys set for every name the registry reads, the note never claims a key is missing", () => {
    const saved = new Map<string, string | undefined>();
    try {
      for (const name of CANDIDATE_ENV_NAMES) {
        saved.set(name, process.env[name]);
        process.env[name] = "placeholder-not-a-real-key";
      }
      // The live answer is re-read per call, so the note must reflect THIS state.
      const requirement = momentProviderRequirement();
      const analysis = analyzeMoments(TIMELINE, SCENES);
      expect(analysis.note).toContain(requirement.note);
      for (const capability of MOMENT_ANALYSIS_CAPABILITIES) {
        expect(analysis.note).toContain(capabilityConnectivity(capability).reason);
      }
      for (const claim of LIVE_ABSENCE_CLAIMS) expect(analysis.note).not.toContain(claim);
      // The CODE half is unaffected by keys, and says so.
      expect(analysis.note).toContain("no code path that dispatches to a provider");
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  test("connected is the AND over the required capabilities, and the note says which way it went", () => {
    const requirement = momentProviderRequirement();
    const derived = MOMENT_ANALYSIS_CAPABILITIES.map((c) => capabilityConnectivity(c).connected).every(Boolean);
    expect(requirement.connected).toBe(derived);
    if (requirement.connected) {
      // Only reachable on a server whose wired slots are configured: it must then
      // say so instead of the "would each need a provider" wording.
      expect(requirement.note).toContain("configured AND wired right now");
      expect(requirement.note).not.toContain("would each need a provider");
    } else {
      expect(requirement.note).toContain("would each need a provider that is configured AND wired");
      expect(requirement.note).toContain("Right now ");
    }
  });
});
