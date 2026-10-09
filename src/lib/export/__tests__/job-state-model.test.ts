/**
 * The export job STATE MODEL is DERIVED FROM LIVE CONNECTIVITY — regression test
 * for the contradiction fixed on 2026-10-09 (commit follows c45f150).
 *
 * THE DEFECT THIS PINS: `EXPORT_JOB_STATE_INFO` hard-coded
 * `reachableWithoutProvider: false` on `handed_off` and `provider_failed`, each
 * carrying the sentence "requires a connected, wired video_enhancement provider —
 * no provider key is set on this server", and `stateModelView()` never consulted
 * live connectivity. On a server where REPLICATE_API_TOKEN WAS set — where
 * GET /api/ai/status correctly said video_enhancement `connected`, and where
 * `provider_failed` had in fact been REACHED — the job/panel state model still
 * declared those two states unreachable "because no provider key is set". A
 * false sentence, printed by the same server that disagreed with it.
 *
 * HOW IT IS PINNED: the split must follow the SAME predicate /api/ai/status uses
 * (configured AND wired — a key alone is not enough), and must change when that
 * predicate changes, in BOTH directions:
 *
 *   unkeyed  → exactly [queued, blocked] reachable; the reason names the provider
 *              slots that advertise the capability, never "no key is set".
 *   keyed    → all four states reachable, nothing declared unreachable.
 *   back     → the unkeyed split returns (it is re-derived, not cached).
 *
 * The key is set in `process.env` INSIDE THESE TESTS ONLY and removed again in a
 * `finally`. It is a deliberately invalid placeholder — no request is made, and
 * no key is ever written to .env, to a fixture or to any evidence file.
 *
 * WHAT IS STILL NOT CLAIMED: a state being *reachable* is not a state being
 * reached, and nothing here claims a produced file. `handed_off` still means
 * "accepted, not verified as produced", and no progress/percent/ETA/completion
 * field exists in the model or the response.
 */
process.env.CAVS_TEST_MODE = "1";

import { afterEach, describe, expect, test } from "bun:test";
import { runExportJobAction, type ExportJobStore } from "../job-service";
import { EXPORT_JOB_CAPABILITY, EXPORT_JOB_STATES, JOB_PROVIDER_ONLY_FIELDS } from "../jobs";
import { REPLICATE_TOKEN_ENV } from "../../ai/providers/replicate";

/** The env var NAME the registry declares (never a value is read here). */
const KEY_ENV = REPLICATE_TOKEN_ENV;
/** In-test placeholder only: never written to .env, never sent anywhere. */
const SET_IN_TEST = "deliberately-not-a-real-token-in-test";

interface StatesView {
  reachable: { state: string; label: string; terminal?: boolean; means?: string }[];
  unreachable: { state: string; label: string; means?: string; reason: string | null }[];
  providerOnlyFields: string[];
  connectivity: {
    capability: string;
    status: "connected" | "not_connected";
    connectedProviders: string[];
    candidateProviders: string[];
    note: string;
  };
  note: string;
}

/** The minimum store `listExportJobs` needs (no presets, no jobs, no database). */
function store(): ExportJobStore {
  return {
    async findOwnedProject(userId, projectId) {
      if (userId !== "u1" || projectId !== "p1") return null;
      return { id: "p1", title: "The City Wakes" };
    },
    async listScenes() {
      return [];
    },
    async readRawTimeline() {
      return null;
    },
    async readProjectMeta() {
      return {
        description: null,
        targetAspect: null,
        targetDurationSeconds: null,
        seoDefaults: null,
        seoDefaultsSource: null,
      };
    },
    async listThumbnailAssets() {
      return [];
    },
    async readExportPreset() {
      return null;
    },
    async writeExportPreset() {},
    async readExportJobs() {
      return null;
    },
    async writeExportJobs() {},
  };
}

async function statesNow(): Promise<StatesView> {
  const res = await runExportJobAction(store(), "u1", { action: "listExportJobs", projectId: "p1" });
  expect(res.status).toBe(200);
  return (res.body as Record<string, unknown>).states as StatesView;
}

const savedKey = process.env[KEY_ENV];
const savedPresent = KEY_ENV in process.env;

afterEach(() => {
  // Leave the process exactly as it was found — no key survives a test.
  if (savedPresent) process.env[KEY_ENV] = savedKey as string;
  else delete process.env[KEY_ENV];
});

describe("export job state model — the reachable/unreachable split is derived, never declared", () => {
  test("UNKEYED: two states reachable, and no sentence ever claims a key is missing", async () => {
    delete process.env[KEY_ENV];
    const s = await statesNow();
    expect(s.connectivity.capability).toBe(EXPORT_JOB_CAPABILITY);
    expect(s.connectivity.status).toBe("not_connected");
    expect(s.connectivity.connectedProviders).toEqual([]);
    // The slots that DO advertise the capability are named instead of a claim
    // about a key — the honest replacement for "no provider key is set".
    expect(s.connectivity.candidateProviders).toContain("replicate");
    expect(s.reachable.map((e) => e.state)).toEqual(["queued", "blocked"]);
    expect(s.unreachable.map((e) => e.state)).toEqual(["handed_off", "provider_failed"]);
    for (const u of s.unreachable) {
      expect(String(u.reason)).toContain("provider");
      expect(String(u.reason)).toContain("video_enhancement");
      // THE OLD SENTENCE. This single assertion is the defect, stated once.
      expect(String(u.reason)).not.toContain("no provider key is set");
    }
    expect(s.note).toContain("can reach exactly 2 of the 4 states");
    // Still no progress, percent, ETA or completion anywhere in the model.
    expect(s.providerOnlyFields).toEqual([...JOB_PROVIDER_ONLY_FIELDS]);
    expect(s.note).toContain("no progress, percentage, ETA or completion state");
    expect(s.reachable.map((e) => e.state)).not.toContain("completed");
  });

  test("KEYED (in-test only): every declared state is reachable, none is declared unreachable", async () => {
    process.env[KEY_ENV] = SET_IN_TEST;
    try {
      const s = await statesNow();
      // The SAME predicate /api/ai/status reports — configured AND wired.
      expect(s.connectivity.status).toBe("connected");
      expect(s.connectivity.connectedProviders).toEqual(["replicate"]);
      expect(s.reachable.map((e) => e.state)).toEqual([...EXPORT_JOB_STATES]);
      expect(s.unreachable).toEqual([]);
      expect(s.note).toContain(`can reach exactly ${EXPORT_JOB_STATES.length} of the 4 states`);
      expect(s.note).toContain("configured, wired video_enhancement provider exists");
      // A key does NOT make the states true by itself: the meaning of
      // `handed_off` stays "accepted, not verified as produced".
      const handedOff = s.reachable.find((e) => e.state === "handed_off")!;
      expect(String(handedOff.means)).toContain("has not verified that an encoded file exists");
    } finally {
      delete process.env[KEY_ENV];
    }
  });

  test("the split is re-derived per call — removing the key puts the split back", async () => {
    process.env[KEY_ENV] = SET_IN_TEST;
    const keyed = await statesNow();
    delete process.env[KEY_ENV];
    const unkeyed = await statesNow();
    // Same process, same module instance, two different answers: nothing about
    // this split is cached, hard-coded, or decided at import time.
    expect(keyed.connectivity.status).toBe("connected");
    expect(keyed.unreachable).toEqual([]);
    expect(unkeyed.connectivity.status).toBe("not_connected");
    expect(unkeyed.unreachable.map((e) => e.state)).toEqual(["handed_off", "provider_failed"]);
  });

  test("a key with NO wired capability in the model stays unreachable — a key alone is not enough", async () => {
    // RUNWAY_API_KEY: Runway advertises video_enhancement but has no adapter, so
    // the capability-cleared answer must stay not_connected. (This is why the
    // reason sentence speaks of configured AND wired, not of a key.)
    const runwaySaved = process.env.RUNAWAY_API_KEY;
    const runwayPresent = "RUNAWAY_API_KEY" in process.env;
    process.env.RUNAWAY_API_KEY = SET_IN_TEST;
    try {
      const s = await statesNow();
      expect(s.connectivity.candidateProviders).toContain("runway");
      expect(s.connectivity.connectedProviders).not.toContain("runway");
      expect(s.connectivity.status).toBe("not_connected");
      expect(s.unreachable.map((e) => e.state)).toEqual(["handed_off", "provider_failed"]);
    } finally {
      if (runwayPresent) process.env.RUNAWAY_API_KEY = runwaySaved as string;
      else delete process.env.RUNAWAY_API_KEY;
    }
  });
});
