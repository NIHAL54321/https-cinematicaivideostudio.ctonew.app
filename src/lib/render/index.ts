/**
 * The render pipeline's own barrel. Deliberately does NOT export `./store` or
 * `./service`: those touch Prisma and belong to the server, and this barrel is
 * importable from a client component that only needs the declaration.
 */
export * from "./pipeline";
export type { ProjectFacts, RenderJobFacts, RenderSceneFact, StageFile, StageOutcome } from "./types";
