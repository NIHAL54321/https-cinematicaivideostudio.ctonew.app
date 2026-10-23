/**
 * The SEO Studio page's description — one owner, so it can be tested.
 *
 * WHY THIS FILE EXISTS (P7-7b sweep, 2026-10-23): the description used to read
 * "Titles, descriptions, tags and transcript-based chapters that help your video
 * get found. All of it is provider-backed: this build produces no title, tag or
 * chapter text until an SEO provider is wired."
 *
 * Both halves of that were false against this build, and a visitor read them on
 * screen:
 *
 *   - Titles, tags, chapters and keywords ARE produced with no provider at all:
 *     ./publishing/titles.ts fills 30 fixed templates from the project's own
 *     words, ./publishing/chapters.ts derives chapters from its own rows, and
 *     ./publishing/tags.ts and ./publishing/keywords.ts derive from its text.
 *     Every one of those values names the rule that produced it.
 *   - "that help your video get found" is an outcome promise, and this product
 *     holds no search, ranking or traffic data of any kind to make it.
 *
 * The one genuinely provider-backed step is the `seo_generation` capability
 * (model-written title variants), and it is gated: unkeyed it reports its own
 * status and names the environment variable a key would go in.
 */
export const SEO_STUDIO_DESCRIPTION =
  "Titles, descriptions, tags and chapters are derived here by this app's own rules from the project's " +
  "own rows — no provider needed, and every value carries the rule that produced it. The one step that " +
  "uses a provider is seo_generation, which would write title variants from a model: it reports its own " +
  "status and names the environment variable a key would go in.";
