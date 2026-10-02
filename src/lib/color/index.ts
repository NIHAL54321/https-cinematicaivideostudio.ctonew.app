/**
 * Phase 5 Block 4 — Colour system barrel.
 *
 * `./presets` (the nine-grade catalogue + the render-plan builder) and
 * `./assignment` (the project/scene assignment model) are BOTH pure and
 * client-safe: the editor UI imports them to render the grade picker, show each
 * grade's real parameters verbatim and read the current assignment. Their
 * provider gate is a static, honest object built from an env var NAME (no
 * orchestrator import, no secrets, no IO).
 *
 * IO lives in ./store (server only) and the store-injected logic in ./service
 * (server only — it imports the timeline snapshot reader).
 */
export * from "./presets";
export * from "./assignment";
