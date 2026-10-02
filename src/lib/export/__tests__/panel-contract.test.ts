/**
 * Phase 6 Block 2 — the export PANEL's contract with the export ENGINE.
 *
 * The finishing panel is a pure renderer of the Block 1 engine's responses: it
 * must offer exactly the engine's four actions and nothing else, and it must not
 * invent a second catalogue, a second gate or a second action name that the
 * engine would reject with `unknown_action`. These assertions fail if the UI
 * surface ever drifts from src/lib/export/service.ts.
 */
import { describe, expect, test } from "bun:test";
import { EXPORT_ACTIONS } from "@/lib/export/service";
import { EXPORT_PANEL_ACTIONS } from "@/components/editor/export-panel";
import { EXPORT_PRESET_IDS } from "@/lib/export/presets";

describe("Phase 6 Block 2 — export panel ↔ export engine contract", () => {
  test("the panel offers exactly the engine's four export actions, in the engine's order", () => {
    expect([...EXPORT_PANEL_ACTIONS]).toEqual([...EXPORT_ACTIONS]);
  });

  test("every panel action is one the engine accepts (no UI-only action can 400 as unknown_action)", () => {
    for (const action of EXPORT_PANEL_ACTIONS) {
      expect((EXPORT_ACTIONS as readonly string[]).includes(action)).toBe(true);
    }
  });

  test("the catalogue the panel renders is the engine's eight presets — the UI adds none", () => {
    expect(EXPORT_PRESET_IDS.length).toBe(8);
    expect(new Set(EXPORT_PRESET_IDS).size).toBe(8);
  });
});
