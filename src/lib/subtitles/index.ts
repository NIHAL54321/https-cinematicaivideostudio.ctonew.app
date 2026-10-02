/**
 * Phase 4 Block 3 — Subtitle engines barrel export (pure, deterministic).
 * engine.ts = plan builder + word/sentence timing + line breaks + SRT.
 * styles.ts = 8 caption styles + deterministic auto-choice.
 * positioning.ts = smart safe-margin placement that avoids face/text/chart/subject regions.
 */
export * from "./engine";
export * from "./styles";
export * from "./positioning";