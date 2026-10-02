/**
 * Phase 3 — Media Sources & Stock Footage Engine.
 *
 * Barrel export. Provider-independent stock abstraction, semantic scene →
 * query builder, deterministic ranking, and the typed asset/licensing data
 * layer. Nothing here fakes AI — providers that are not configured return an
 * honest "not_connected" state with the env var names that would enable them.
 */
export * from "./types";
export * from "./semantic";
export * from "./ranking";
export * from "./assets";
export * from "./uploads";
export * from "./providers";
