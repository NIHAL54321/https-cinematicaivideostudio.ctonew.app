/**
 * Phase 7 Block 1 — publishing package barrel.
 *
 * Everything exported here is PURE and CLIENT-SAFE: the provenance model, the
 * rule catalogue, the honesty audit and the six derivation modules (chapters,
 * keywords, tags, description, pinned comment, asset licences) plus the package
 * assembler. None of them reads `process.env`, opens a socket or touches the
 * database, so a UI (P7-5) can render the package and resolve a rule id against
 * the catalogue without any server round trip.
 *
 * IO lives in ./store (server only) and the store-injected logic in ./service
 * (server only — it derives provider env var names from the registry). Neither
 * is exported here, exactly like ./export, ./color, ./repurpose and ./framing.
 */
export * from "./provenance";
export * from "./rules";
export * from "./audit";
export * from "./types";
export * from "./chapters";
export * from "./keywords";
export * from "./tags";
export * from "./description";
export * from "./pinned-comment";
export * from "./licensing";
export * from "./package";
