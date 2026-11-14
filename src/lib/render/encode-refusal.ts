/**
 * THE SENTENCE `encode-master` GIVES WHEN IT REFUSES A PROJECT (Phase 8, Export
 * panel block, 2026-11-14).
 *
 * WHY THIS IS ITS OWN MODULE
 * The encode stage refuses to encode a project while any scene carries no source
 * media, and it names the scenes. Until now that sentence existed only inside
 * `executors.ts`, so a page that wanted to warn a user BEFORE they pressed Render
 * could only paraphrase it — and a paraphrase is exactly how a surface starts
 * claiming something the pipeline does not say.
 *
 * So the sentence is written once, here, and used twice: the stage throws it, and
 * the Export panel prints it beside the disabled queue button. A test asserts the
 * two are the same string, so the warning cannot drift from the refusal it warns
 * about.
 *
 * Pure: no file, no env, no network, no Prisma. Client-safe, because the panel
 * imports it.
 */

export interface UnsourcedScene {
  /** The Scene row's own id — the same id the stage names. */
  id: string;
  /** The scene's 1-based position in the project, in chapter then scene order. */
  order: number;
}

/**
 * The refusal, in the encode stage's own words. `missing` must be the scenes that
 * carry NO source media, and `sceneCount` the project's whole scene count: the
 * sentence states both numbers, and a caller that guesses either would produce a
 * refusal that is not the one the stage gives.
 */
export function encodeRefusalSentence(input: { sceneCount: number; missing: readonly UnsourcedScene[] }): string {
  const { sceneCount, missing } = input;
  const sourced = sceneCount - missing.length;
  return (
    `encode-master REFUSES to encode this project: ${missing.length} of ${sceneCount} scene(s) carry no source media — ` +
    `scene(s) ${missing.map((s) => `#${s.order} (${s.id})`).join(", ")}. ` +
    `A master built from ${sourced} of ${sceneCount} scenes would be delivered as the ` +
    `project's video while missing the rest of it, so no encode runs. Attach footage to every scene, or encode a project that has one.`
  );
}
