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
 * `./pacing` (the five-dimension pacing read) are BOTH pure and are exported
 * here (no orchestrator import, no secrets, no IO), so the editor UI can import
 * the command catalog and run a dry analysis locally.
 *
 * BLOCK 9: `./auto-editor`'s gates and `./pacing`'s provider note are DERIVED,
 * not static — both read `../ai/providers/capability-connectivity`, which reads
 * the provider registry's live `configured`/`wired` flags (env var names only,
 * never values) and returns the same verdict `/api/ai/status` reports. Nothing
 * is cached, so a key added or removed mid-process changes the next answer. The
 * engine's own analysis stays pure: the registry is consulted only for the
 * honest note attached to its output.
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
