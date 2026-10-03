/**
 * Phase 6 Block 2 — the export PANEL's contract with the export ENGINE.
 *
 * The finishing panel is a pure renderer of the Block 1 engine's responses: it
 * must offer exactly the engine's Block 1 & 2 actions and nothing of its own, and
 * it must not invent a second catalogue, a second gate or a second action name
 * that the engine would reject with `unknown_action`. These assertions fail if
 * the UI surface ever drifts from src/lib/export/service.ts.
 *
 * Phase 6 Block 3 (`planSidecars`, `checkPublishReadiness`) ships ENGINE-ONLY in
 * this block — its panel is the next block — so the assertion below is "every
 * panel action is one the engine accepts" plus "the panel advertises none of the
 * engine's Block 3 actions", not "the panel offers the whole engine".
 */
import { describe, expect, test } from "bun:test";
import { EXPORT_ACTIONS } from "@/lib/export/service";
import { EXPORT_PANEL_ACTIONS } from "@/components/editor/export-panel";
import { EXPORT_PRESET_IDS } from "@/lib/export/presets";

/** The actions Block 1 + Block 2 shipped, and the only ones the panel may offer. */
const BLOCK_1_2_ACTIONS = ["listExportPresets", "planExport", "applyExportPreset", "clearExportPreset"];

describe("Phase 6 Block 2 — export panel ↔ export engine contract", () => {
  test("the panel offers exactly the four Block 1/2 export actions, in the engine's order", () => {
    expect([...EXPORT_PANEL_ACTIONS]).toEqual(BLOCK_1_2_ACTIONS);
    // The engine's advertised list starts with those same four, so the panel is
    // a prefix of the engine surface: the UI can never look like it lost an action.
    expect([...EXPORT_PANEL_ACTIONS]).toEqual(EXPORT_ACTIONS.slice(0, BLOCK_1_2_ACTIONS.length));
  });
  test("every panel action is one the engine accepts (no UI-only action can 400 as unknown_action)", () => {
    for (const action of EXPORT_PANEL_ACTIONS) {
      expect((EXPORT_ACTIONS as readonly string[]).includes(action)).toBe(true);
    }
  });
  test("the engine's Block 3 actions are real but are not advertised by the Block 2 panel", () => {
    for (const action of ["planSidecars", "checkPublishReadiness"]) {
      expect((EXPORT_ACTIONS as readonly string[]).includes(action)).toBe(true);
      expect((EXPORT_PANEL_ACTIONS as readonly string[]).includes(action)).toBe(false);
    }
  });
  test("the catalogue the panel renders is the engine's eight presets — the UI adds none", () => {
    expect(EXPORT_PRESET_IDS.length).toBe(8);
    expect(new Set(EXPORT_PRESET_IDS).size).toBe(8);
  });
});
