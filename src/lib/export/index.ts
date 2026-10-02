/**
 * Phase 6 Block 1 — Export / finishing barrel.
 *
 * `./presets` (the eight delivery presets with every declared number and the SDR
 * / HDR colour tagging, built from the Phase 5 colour system's own targets),
 * `./sizing` (the size arithmetic and its units), `./manifest` (the deliverable
 * manifest and the explicit NOT_PRODUCED list) and `./assignment` (the persisted
 * per-project preset choice) are ALL pure and client-safe: the editor UI imports
 * them to render the preset picker, the spec table, the size estimate and the
 * manifest verbatim. Their provider gate is a static, honest object built from an
 * env var NAME (no orchestrator import, no secrets, no IO).
 *
 * IO lives in ./store (server only) and the store-injected logic in ./service
 * (server only — it imports the timeline snapshot reader and the Prisma store).
 * Neither is exported here, exactly like ./color, ./repurpose and ./framing.
 */
export * from "./presets";
export * from "./sizing";
export * from "./manifest";
export * from "./assignment";
