/**
 * Phase 5 Block 1 + 2 + 3 — Editor barrel.
 * Pure deterministic timeline engine + history + serialisation + transitions +
 * the Block 3 auto-editor commands and the pacing analysis.
 *
 * PHASE 5 BLOCK 2: `./transitions` and `./scene-control-meta` are exported here
 * (both pure + client-safe). `./scenes` (the seven scene controls) is NOT: it
 * reads the AI orchestrator's capability status, which is server-only — import
 * it directly (`@/lib/editor/scenes`) from the API service only.
 *
 * PHASE 5 BLOCK 3: `./auto-editor` (the twelve auto-edit commands) and
 * `./pacing` (the five-dimension pacing read) are BOTH pure + client-safe and
 * are exported here: their provider gates are static, honest objects built from
 * env var NAMES (no orchestrator import, no secrets, no IO), so the editor UI
 * can import the command catalog and run a dry analysis locally.
 *
 * IO lives in ./store (server only) and ./service (store-injected logic).
 */
export * from "./timeline";
export * from "./history";
export * from "./versions";
export * from "./transitions";
export * from "./scene-control-meta";
export * from "./auto-editor";
export * from "./pacing";
