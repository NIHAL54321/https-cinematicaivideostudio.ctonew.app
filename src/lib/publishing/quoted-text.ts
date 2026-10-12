/**
 * Phase 7 Block 3b — WHICH CHARACTERS IN A RENDERED SENTENCE ARE THE PROJECT'S.
 *
 * `./quotation` is the data half of the fix: a sentence this app wrote with the
 * project's own characters inside it declares the app's own template and the
 * fragments substituted into it, and ./audit refuses to exempt the sentence
 * unless it reproduces that declaration character for character. This module is
 * the half a READER sees: given a value the view model produced, it returns the
 * value's sentence split into the stretches that are the project's own and the
 * stretches that are this app's fixed wording, so a surface can mark the first
 * kind and let the second read as the app's.
 *
 * WHY IT IS A SEPARATE MODULE. It is imported by the Creator Studio client
 * component, so it must stay free of anything server-side. It therefore imports
 * `./quotation` (which imports nothing at runtime) and the `StudioValue` TYPE
 * only — the view model itself is never pulled into the browser bundle.
 *
 * WHAT IT REFUSES. `null` — "this value quotes nothing, render it as a sentence of
 * this app's" — unless every one of these holds:
 *
 *   - the value is `derived`, so it claims to carry real characters;
 *   - its declared `textOrigin` is `template_filled`, the only origin that quotes;
 *   - it carries a `templateText` and at least one declared fragment;
 *   - at least one character was actually substituted (a template with no
 *     fragment in it quotes nothing);
 *   - the segments concatenate back to the value's own text, character for
 *     character — a value carrying characters no fragment accounts for is NOT
 *     marked, because there would be no way to say whose they are.
 *
 * The last rule is the reason a reader can trust the marking rather than the
 * code: nothing is inferred from the characters themselves, and no character is
 * presented as the project's own unless the value's own declaration puts it there.
 */
import { quotationSegments, type QuotationSegment } from "./quotation";
import type { StudioValue } from "./studio-view";

/** The stretches of a value's sentence, with the project's own characters marked. */
export type QuotedSegments = readonly QuotationSegment[];

/**
 * The value's sentence as segments, or `null` when this value quotes nothing (see
 * the module note for the exact conditions). Never throws, never invents a
 * source, and never marks a character the value did not declare.
 */
export function quotedSegments(value: StudioValue): QuotedSegments | null {
  if (value.state !== "derived") return null;
  if (value.textOrigin !== "template_filled") return null;
  if (typeof value.value !== "string" || !value.templateText) return null;
  const fragments = value.fragments ?? [];
  if (fragments.length === 0) return null;
  const segments = quotationSegments(value.templateText, fragments);
  if (!segments.some((segment) => segment.quoted)) return null;
  if (segments.map((segment) => segment.text).join("") !== value.value) return null;
  return segments;
}

/** The characters on a set of segments that were substituted in, in order. */
export function quotedCharacters(segments: QuotedSegments): string[] {
  return segments.filter((segment) => segment.quoted).map((segment) => segment.text);
}
