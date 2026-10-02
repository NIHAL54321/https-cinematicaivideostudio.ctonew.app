/**
 * Phase 2 studio engines — pure, deterministic, typed.
 *
 * Barrel export. These modules never touch the network, the database, or an
 * AI provider; anything that needs real AI generation routes through
 * src/lib/ai (the orchestrator) and honestly reports "Provider Not Connected".
 */
export * from "./types";
export * from "./video-types";
export * from "./structures";
export * from "./budgeting";
export * from "./hooks";
export * from "./tones";
export * from "./cinematic";
export * from "./cameras";
export * from "./scene-intelligence";
export * from "./visual-prompts";
export * from "./charts";
export * from "./retention";
export * from "./presets";
export * from "./effects";
export * from "./restyle";
// Phase 3 — Visual Selection + Continuity (deterministic). `camera.ts` is still
// NOT re-exported here (its `pickCamera` collides with `cameras.ts`); both
// visual-selection.ts and continuity.ts import it directly.
export * from "./visual-selection";
export * from "./continuity";
export * from "./visual-assignment";
// NOTE: `camera.ts` is intentionally NOT re-exported here — it exports a
// second `pickCamera` that would collide with the Phase 2 `cameras.ts` one in
// a `export *` barrel. Import it directly from "@/lib/studio/camera".
