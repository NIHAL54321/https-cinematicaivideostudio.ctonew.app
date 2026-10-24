/**
 * The Subtitle Studio page's copy — one owner, so it can be tested.
 *
 * WHY THIS FILE EXISTS (P7-7c tail, 2026-10-23): the page's description used to
 * end "... and smart positioning that never covers faces or on-screen text."
 *
 * That is an absolute about a RENDERED FRAME, and this build has never rendered
 * one. What the app actually holds:
 *
 *   - ./subtitles/engine.ts builds a SubtitlePlan — cue text and timings — from
 *     the script or the Directed Voice Plan, by rules it owns.
 *   - ./subtitles/positioning.ts is a pure planner: it computes cue coordinates
 *     from the regions it is HANDED and moves a cue off them. Its own header
 *     says region detection "arrives with provider-based vision in a later
 *     phase" — so no face, chart, subject or on-screen text is ever detected
 *     here, and nothing in the app reads a pixel.
 *   - The page's SRT comes from that deterministic plan; it is a text file, not
 *     a picture.
 *
 * So "never covers faces" was a promise about an outcome the product has no
 * capability to observe: no frame exists, no caption has ever been laid over a
 * picture by this app, and no placement has ever been checked against one. The
 * sentence is now true about what the app does (it plans placement from its own
 * rules over the rows it is given) and states plainly what it has never done
 * (rendered or verified a frame).
 *
 * ./product/__tests__/ai-tool-description-sweep.test.ts holds this: an absolute
 * about rendering fails the suite, and a negative control feeds it the exact
 * sentence that shipped to prove the guard catches it.
 */
export const SUBTITLE_STUDIO_DESCRIPTION =
  "Caption plans are built here by this app's own rules over the rows you give it — word and sentence " +
  "timing, line breaks at readable lengths, safe margins per format, dynamic cues and an SRT file to " +
  "download. Placement is computed against the regions you supply; this app detects no face, text, " +
  "chart or subject itself, and it has never rendered or checked a frame, so no placement here has " +
  "been seen on a screen.";

/**
 * The page's capability bullets MOVED (block 0, 2026-10-24) to
 * `./ai-tool-capabilities`, because every `/ai` page's list now carries a basis
 * per item and a heading derived from it. The words are the same claims, with
 * one correction the move made visible: "Safe margins per format" is computed
 * here (`DEFAULT_SAFE_MARGINS`), while "smart positioning" is the planner that
 * dodges the regions it is HANDED — so the bullet now says exactly that.
 *
 * Keeping a second copy of the list here is what this team's dead-copy guard
 * exists to prevent: a claim-bearing string with no surface renders nowhere and
 * is tested by nothing.
 */
