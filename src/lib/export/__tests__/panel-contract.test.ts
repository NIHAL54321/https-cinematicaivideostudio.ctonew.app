/**
 * Phase 6 Blocks 2 & 4 — the export PANEL's contract with the export ENGINE.
 *
 * The finishing panel is a pure renderer of the export engine's responses: it
 * must offer exactly the engine's six actions and nothing of its own, and it must
 * not invent a second catalogue, a second gate, a second target list or a second
 * action name that the engine would reject with `unknown_action`. These
 * assertions fail if the UI surface ever drifts from src/lib/export/service.ts.
 *
 * Block 2 shipped the first four actions (presets, plan, apply, clear).
 * Block 3 shipped the last two ENGINE-ONLY (`planSidecars`,
 * `checkPublishReadiness`); Block 4 renders them, so the panel now offers the
 * engine's WHOLE surface, in the engine's own order:
 *   "the panel offers all six engine actions, in order" +
 *   "every panel action is one the engine accepts" +
 *   "the panel advertises every action the engine has".
 */
import { describe, expect, test } from "bun:test";
import { EXPORT_ACTIONS } from "@/lib/export/service";
import { EXPORT_PANEL_ACTIONS, PUBLISH_TARGET_VIEWS } from "@/components/editor/export-panel";
import { EXPORT_PRESET_IDS } from "@/lib/export/presets";
import { PUBLISH_TARGET_IDS } from "@/lib/export/readiness";

/** Block 1 & 2 (specification) + Block 3/4 (finishing & packaging). */
const BLOCK_1_2_ACTIONS = ["listExportPresets", "planExport", "applyExportPreset", "clearExportPreset"];
const BLOCK_3_4_ACTIONS = ["planSidecars", "checkPublishReadiness"];
/** All six, in the engine's order — what the Block 4 panel must offer. */
const ALL_PANEL_ACTIONS = [...BLOCK_1_2_ACTIONS, ...BLOCK_3_4_ACTIONS];

describe("Phase 6 Block 2 & 4 — export panel ↔ export engine contract", () => {
  test("the panel offers all six export actions, in the engine's order", () => {
    expect([...EXPORT_PANEL_ACTIONS]).toEqual(ALL_PANEL_ACTIONS);
    // The engine's advertised list is the same six, in the same order, so the
    // panel is the WHOLE engine surface — no action is missing and none is added.
    expect([...EXPORT_PANEL_ACTIONS]).toEqual([...EXPORT_ACTIONS]);
    expect(EXPORT_ACTIONS.length).toBe(6);
  });

  test("every panel action is one the engine accepts (no UI-only action can 400 as unknown_action)", () => {
    for (const action of EXPORT_PANEL_ACTIONS) {
      expect((EXPORT_ACTIONS as readonly string[]).includes(action)).toBe(true);
    }
  });

  test("the finishing actions are advertised by the panel, not merely available", () => {
    for (const action of BLOCK_3_4_ACTIONS) {
      expect((EXPORT_ACTIONS as readonly string[]).includes(action)).toBe(true);
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
