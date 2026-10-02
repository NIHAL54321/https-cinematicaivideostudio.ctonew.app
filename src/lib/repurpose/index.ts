/**
 * Phase 5 Block 5a — Long-form → shorts repurposing barrel.
 *
 * `./moments` (the deterministic moment analysis), `./targets` (the platform
 * output sets and their validation), `./clips` (the clip-window builder) and
 * `./assignment` (the persisted set model) are ALL pure and client-safe: the
 * editor UI imports them to render the candidate list, the kind badges, the
 * score and the reason text verbatim, and to show the target config that was
 * used. Their provider gates are static, honest objects built from env var NAMES
 * (no orchestrator import, no secrets, no IO).
 *
 * IO lives in ./store (server only) and the store-injected logic in ./service
 * (server only — it imports the timeline snapshot reader).
 *
 * Block 5b (smart 16:9 → 9:16 reframing and multi-format output) extends this
 * module: `PLATFORM_ASPECT` already records the frame each target is delivered
 * in, and `videoClipsInWindow` gives the reframer the clips a window spans.
 */
export * from "./moments";
export * from "./targets";
export * from "./clips";
export * from "./assignment";
