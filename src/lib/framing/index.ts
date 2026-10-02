/**
 * Phase 5 Block 5b — Framing barrel.
 *
 * `./formats` (the four delivery formats, their resolutions and safe areas),
 * `./geometry` (the pure crop math: cover crop, travel, retention, safe-area
 * mapping, keyframe paths), `./policies` (the stated framing rules, the
 * deterministic selection that cites the data behind each choice, and
 * `anchorCheck()` — the honest enumeration of every field that could have held a
 * subject position and what each of them really holds) and `./assignment` (the
 * persisted per-project / per-scene / per-clip overrides) are ALL pure and
 * client-safe: the editor UI imports them to render the format picker, the crop
 * window, the safe areas, the keyframes, the policy name and its reason verbatim.
 * Their provider gates are static, honest objects built from env var NAMES (no
 * orchestrator import, no secrets, no IO).
 *
 * IO lives in ./store (server only) and the store-injected logic in ./service
 * (server only — it imports the timeline snapshot reader and the Prisma store).
 * Neither is exported here, exactly like ./color and ./repurpose.
 */
export * from "./formats";
export * from "./geometry";
export * from "./policies";
export * from "./assignment";
