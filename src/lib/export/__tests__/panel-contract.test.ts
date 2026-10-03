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
import { EXPORT_PANEL_ACTIONS, PUBLISH_TARGET_VIEWS } from "@/components/editor/export-panel";
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

  test("the catalogue the panel renders is the engine's eight presets — the UI adds none", () => {
    expect(EXPORT_PRESET_IDS.length).toBe(8);
    expect(new Set(EXPORT_PRESET_IDS).size).toBe(8);
  });

  test("the readiness targets the panel offers are the engine's six, in the engine's order", () => {
    // The panel renders these ids and labels; the verdicts and every rule come
    // from the engine's response only, so a target the engine does not know
    // would be a 400 (`unknown_target`) and can never be listed here.
    expect(PUBLISH_TARGET_VIEWS.map((t) => t.id)).toEqual([...PUBLISH_TARGET_IDS]);
    expect(PUBLISH_TARGET_IDS.length).toBe(6);
  });
});
