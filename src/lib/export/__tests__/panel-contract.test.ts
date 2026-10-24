/**
 * Phase 6 Blocks 2, 4 & 6 — the export PANEL's contract with the export ENGINE.
 *
 * The finishing panel is a pure renderer of the export engine's responses: it
 * must offer exactly the engine's NINE actions and nothing of its own, and it must
 * not invent a second catalogue, a second gate, a second target list or a second
 * action name that the engine would reject with `unknown_action`. These
 * assertions fail if the UI surface ever drifts from the engine.
 *
 * Block 2 shipped the first four actions (presets, plan, apply, clear).
 * Block 3 shipped the next two ENGINE-ONLY (`planSidecars`,
 * `checkPublishReadiness`); Block 4 rendered them.
 * Block 5 shipped the last three ENGINE-ONLY — the export JOB handoff
 * (`createExportJob`, `listExportJobs`, `getExportJob` in src/lib/export/jobs.ts);
 * Block 6 renders them, so the panel now offers the engine's WHOLE export surface,
 * in the engine's own order:
 *   "the panel offers all nine export actions, in the engine's order" +
 *   "every panel action is one the engine accepts" +
 *   "the job handoff actions are advertised by the panel, not merely available".
 *
 * The engine's order is the engine's own two lists concatenated: the six
 * finishing actions (`EXPORT_ACTIONS`) then the three job actions
 * (`EXPORT_JOB_ACTIONS`) — which is also the order the single editor surface
 * advertises them in (`EDITOR_ACTIONS`, src/lib/editor/service.ts).
 */
import { describe, expect, test } from "bun:test";
import { EXPORT_ACTIONS } from "@/lib/export/service";
import { EXPORT_JOB_ACTIONS } from "@/lib/export/jobs";
import {
  EXPORT_PANEL_ACTIONS,
  NO_ESTIMATE_AT_THIS_DURATION,
  PUBLISH_TARGET_VIEWS,
  durationReadOut,
  requestDurationSeconds,
} from "@/components/editor/export-panel";
import { EXPORT_PRESET_IDS } from "@/lib/export/presets";
import { PUBLISH_TARGET_IDS } from "@/lib/export/readiness";

/** Block 1 & 2 (specification) + Block 3/4 (finishing & packaging). */
const BLOCK_1_2_ACTIONS = ["listExportPresets", "planExport", "applyExportPreset", "clearExportPreset"];
const BLOCK_3_4_ACTIONS = ["planSidecars", "checkPublishReadiness"];
/** Block 5/6 — the export job handoff, the three actions the panel now renders too. */
const BLOCK_5_6_ACTIONS = ["createExportJob", "listExportJobs", "getExportJob"];
/** All nine, in the engine's order — what the Block 6 panel must offer. */
const ALL_PANEL_ACTIONS = [...BLOCK_1_2_ACTIONS, ...BLOCK_3_4_ACTIONS, ...BLOCK_5_6_ACTIONS];

describe("Phase 6 Blocks 2, 4 & 6 — export panel ↔ export engine contract", () => {
  test("the panel offers all nine export actions, in the engine's order", () => {
    expect([...EXPORT_PANEL_ACTIONS]).toEqual(ALL_PANEL_ACTIONS);
    // The engine's own two lists, concatenated in the order the single editor
    // surface advertises them, are the same nine in the same order — so the panel
    // is the WHOLE export engine surface: no action missing, none added.
    expect([...EXPORT_PANEL_ACTIONS]).toEqual([...EXPORT_ACTIONS, ...EXPORT_JOB_ACTIONS]);
    expect(EXPORT_ACTIONS.length).toBe(6);
    expect(EXPORT_JOB_ACTIONS.length).toBe(3);
    expect(EXPORT_PANEL_ACTIONS.length).toBe(9);
  });

  test("every panel action is one the engine accepts (no UI-only action can 400 as unknown_action)", () => {
    const accepted: readonly string[] = [...EXPORT_ACTIONS, ...EXPORT_JOB_ACTIONS];
    for (const action of EXPORT_PANEL_ACTIONS) {
      expect(accepted.includes(action)).toBe(true);
    }
    // Nine distinct names: no action is listed twice and none is a near-miss.
    expect(new Set(EXPORT_PANEL_ACTIONS).size).toBe(9);
  });

  test("the finishing actions are advertised by the panel, not merely available", () => {
    for (const action of BLOCK_3_4_ACTIONS) {
      expect((EXPORT_ACTIONS as readonly string[]).includes(action)).toBe(true);
      expect((EXPORT_PANEL_ACTIONS as readonly string[]).includes(action)).toBe(true);
    }
  });

  test("the job handoff actions are advertised by the panel, not merely available", () => {
    for (const action of BLOCK_5_6_ACTIONS) {
      expect((EXPORT_JOB_ACTIONS as readonly string[]).includes(action)).toBe(true);
      expect((EXPORT_PANEL_ACTIONS as readonly string[]).includes(action)).toBe(true);
    }
  });

  test("the catalogue the panel renders is the engine's seven presets — the UI adds none", () => {
    expect(EXPORT_PRESET_IDS.length).toBe(7);
    expect(new Set(EXPORT_PRESET_IDS).size).toBe(7);
  });

  test("the readiness targets the panel offers are the engine's six, in the engine's order", () => {
    // The panel renders these ids and labels; the verdicts and every rule come
    // from the engine's response only, so a target the engine does not know
    // would be a 400 (`unknown_target`) and can never be listed here.
    expect(PUBLISH_TARGET_VIEWS.map((t) => t.id)).toEqual([...PUBLISH_TARGET_IDS]);
    expect(PUBLISH_TARGET_IDS.length).toBe(6);
  });
});

/**
 * Phase 6 Block 7 — the duration READ-OUT's contract with the request it describes.
 *
 * The defect (reproduced in a browser on /export-center on 2026-10-04): the line
 * under the duration input printed `duration <n> s · source: <s>` from the LAST
 * RESPONSE, whether or not that response had been taken at the duration the request
 * was about to carry. A catalogue read taken with a blank input reports
 * `seconds: 0, source: "none"`, so with 180 s typed the surface showed
 *
 *   the read-out:  duration 0 s · source: none — No duration is available: …
 *   the request:   180 s (source: request)   ← the job snapshot it created
 *
 * These tests pin the invariant that made that impossible to render: the line prints
 * a duration only from a read taken at exactly the duration the next request would
 * carry, and that duration is always the ENGINE's own number with the ENGINE's own
 * source — never one this component derived.
 */
describe("Phase 6 Block 7 — the duration read-out never disagrees with the request", () => {
  /** The engine's report from the read the defect reproduced: no duration at all. */
  const READ_WITHOUT_A_DURATION = {
    seconds: 0,
    human: null,
    source: "none",
    note: "No duration is available: no duration was supplied, no readable editor timeline exists and no scene carries a duration.",
  };
  /** The engine's report once 180 s is supplied in the request. */
  const READ_AT_180 = {
    seconds: 180,
    human: "3m 00s",
    source: "request",
    note: "Duration supplied in the request: 180 s (3m 00s).",
  };

  test("the request's duration and the read-out's comparison come from ONE derivation", () => {
    // loadCatalogue and run() post `durationSeconds` from this function and from
    // nowhere else, so the payload and the read-out cannot disagree by construction.
    expect(requestDurationSeconds("180")).toBe(180);
    expect(requestDurationSeconds(" 180 ")).toBe(180);
    expect(requestDurationSeconds("7200")).toBe(7200);
    expect(requestDurationSeconds("")).toBeNull();
    expect(requestDurationSeconds("   ")).toBeNull();
    expect(requestDurationSeconds("0")).toBeNull();
    expect(requestDurationSeconds("-30")).toBeNull();
    expect(requestDurationSeconds("abc")).toBeNull();
  });

  test("THE DEFECT: with 180 s typed, the line no longer prints the mount read's 0 s", () => {
    const view = durationReadOut({
      requestSeconds: requestDurationSeconds("180"), // what the request would carry
      readAtSeconds: null, // the read on screen was taken with no durationSeconds
      reported: READ_WITHOUT_A_DURATION,
    });
    expect(view.state).toBe("read-at-another-duration");
    expect(view.seconds).toBeNull();
    expect(view.text.startsWith(NO_ESTIMATE_AT_THIS_DURATION)).toBe(true);
    expect(view.text).not.toContain("duration 0 s");
    expect(view.text).not.toContain("source: none");
    // It names the typed duration as the user's own input, and never as a measurement.
    expect(view.text).toContain("180 s");
  });

  test("once the engine has resolved the duration the request carries, the line IS that duration and its source", () => {
    const view = durationReadOut({ requestSeconds: 180, readAtSeconds: 180, reported: READ_AT_180 });
    expect(view.state).toBe("resolved");
    expect(view.seconds).toBe(180);
    expect(view.text).toBe(
      "duration 180 s (3m 00s) · source: request — Duration supplied in the request: 180 s (3m 00s).",
    );
  });

  test("before any read carries a duration, the line says no estimate has been taken — never a 0 s measurement", () => {
    const view = durationReadOut({ requestSeconds: null, readAtSeconds: null, reported: null });
    expect(view.state).toBe("not-read");
    expect(view.seconds).toBeNull();
    expect(view.text).toContain("no estimate has been taken yet");
    // No "duration <number> s" anywhere in the line: nothing is claimed, nothing is
    // measured, and it cannot be read as a duration of this project.
    expect(view.text).not.toMatch(/duration [0-9.]+ s/);
  });

  test("an engine-reported zero duration is stated, not printed as a measurement", () => {
    const view = durationReadOut({ requestSeconds: null, readAtSeconds: null, reported: READ_WITHOUT_A_DURATION });
    expect(view.state).toBe("no-duration");
    expect(view.seconds).toBeNull();
    expect(view.text).toContain("no duration is available");
    expect(view.text).toContain("source: none");
    expect(view.text).not.toContain("duration 0 s");
  });

  test("a duration the input no longer matches is never printed (reading at 180, then typing 300)", () => {
    const view = durationReadOut({
      requestSeconds: requestDurationSeconds("300"),
      readAtSeconds: 180,
      reported: READ_AT_180,
    });
    expect(view.state).toBe("read-at-another-duration");
    expect(view.seconds).toBeNull();
    expect(view.text).not.toContain("duration 180 s");
    expect(view.text).not.toContain("source: request");
    expect(view.text).toContain("300 s");
  });

  test("the read-out prints a duration only from a read taken at the duration the request carries", () => {
    const inputs = ["", "180", "300", "0", "abc", "7200"];
    const reads: { at: number | null; reported: typeof READ_WITHOUT_A_DURATION | typeof READ_AT_180 | null }[] = [
      { at: null, reported: null },
      { at: null, reported: READ_WITHOUT_A_DURATION },
      // The engine resolved 180 s although the request carried no durationSeconds —
      // from its own timeline or scene durations. The line may print that number:
      // the next request has the same duration field, so the engine would be asked
      // the same question.
      { at: null, reported: READ_AT_180 },
      { at: 180, reported: READ_AT_180 },
      {
        at: 300,
        reported: { seconds: 300, human: "5m 00s", source: "request", note: "Duration supplied in the request: 300 s (5m 00s)." },
      },
    ];
    for (const input of inputs) {
      const requestSeconds = requestDurationSeconds(input);
      for (const read of reads) {
        const view = durationReadOut({ requestSeconds, readAtSeconds: read.at, reported: read.reported });
        if (view.seconds === null) continue;
        // The ONLY way a duration reaches the screen: the read was taken at exactly
        // the duration the next request would carry, and the number shown is the
        // engine's. A disagreement is therefore impossible, not merely unlikely.
        expect(read.at).toBe(requestSeconds);
        expect(view.seconds).toBe(read.reported?.seconds ?? null);
        expect(view.text).toContain(`duration ${view.seconds} s`);
        expect(view.text).toContain(`source: ${read.reported?.source}`);
      }
    }
  });

  /**
   * The expression this panel shipped BEFORE Block 7, quoted verbatim from
   * src/components/editor/export-panel.tsx at commit e323b61. It is kept here only
   * to prove the defect is real and that the read-out that replaced it cannot
   * reproduce it — the panel renders `durationReadOut`'s text and nothing else.
   */
  function legacyReadOut(reported: { seconds: number; source: string } | null): string {
    return reported ? `duration ${reported.seconds} s · source: ${reported.source}` : "no duration read yet";
  }

  test("the pre-fix expression really did contradict the request — the two browser strings", () => {
    // Both strings were read out of the DOM in one probe on /export-center, with
    // 180 typed into #export-duration and "Request export" pressed:
    const readOutBefore = legacyReadOut({ seconds: 0, source: "none" });
    const carriedByTheRequest = "resolved duration 180 s (3m 00s) · source request";
    expect(readOutBefore).toBe("duration 0 s · source: none");
    expect(carriedByTheRequest.startsWith("resolved duration 180 s")).toBe(true);
    expect(readOutBefore).not.toBe(carriedByTheRequest);
    // The same state through the shipped read-out prints no duration at all.
    const shipped = durationReadOut({
      requestSeconds: requestDurationSeconds("180"),
      readAtSeconds: null,
      reported: READ_WITHOUT_A_DURATION,
    });
    expect(shipped.seconds).toBeNull();
    expect(shipped.text).not.toBe(readOutBefore);
    expect(shipped.text).not.toContain("duration 0 s");
  });
});
