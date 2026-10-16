/**
 * Phase 7 Block 3b — WHICH CHARACTERS IN A RENDERED VALUE ARE THE PROJECT'S.
 *
 * `./quotation` is the data half of the fix: a sentence this app wrote with the
 * project's own characters inside it declares the app's own template and the
 * fragments substituted into it, and ./audit refuses to exempt the sentence
 * unless it reproduces that declaration character for character. This module is
 * the half a READER sees: given a value the view model produced, it returns the
 * value split into the stretches that are the project's own and the stretches
 * that are this app's fixed wording, so a surface can mark the first kind and let
 * the second read as the app's.
 *
 * WHY IT IS A SEPARATE MODULE. It is imported by the Creator Studio client
 * component, so it must stay free of anything server-side. It therefore imports
 * `./quotation` (which imports nothing at all) and TYPES only — the view model
 * itself is never pulled into the browser bundle.
 *
 * THE TWO SHAPES IT MARKS, and they are the same mechanism:
 *
 *   1. A TEMPLATE-FILLED SENTENCE — this app's own words with the project's
 *      characters substituted into them (../thumbnails' overlay text inside a
 *      verdict, ../titles' first-word measurement, ../tags' comma-separated line).
 *      The app's wording around the substitution is unmarked and the project's
 *      characters are marked.
 *   2. A WHOLE-VALUE COPY — a value whose entire text is one of the project's own
 *      rows, copied character for character (`source_verbatim`), or a provider's
 *      own answer recorded verbatim (`provider_verbatim`). Here the app's own
 *      template is the PLACEHOLDER ALONE: the app contributed no character, so
 *      every character of the value is marked and none of it reads as ours.
 *      (P7-4 follow-up D: before this, these values rendered as plain unmarked
 *      text — the project's own words shown as though this app had written them,
 *      which is the same defect ./quotation was written to fix, on the other
 *      shape. The three values that fired live were a thumbnail concept's Overlay
 *      text (×2) and its Dominant subject, each a copy of the project's title.)
 *
 * WHAT IT REFUSES. `null` — "this value quotes nothing, render it as a sentence of
 * this app's" — unless every one of these holds:
 *
 *   - the value is `derived` (or is a group item, which is always a derived copy),
 *     so it claims to carry real characters;
 *   - it declares an `textOrigin` that may be quoted at all — `template_filled`,
 *     `source_verbatim` or `provider_verbatim`. A `rule_authored` value quotes
 *     nothing by definition;
 *   - it carries a `templateText` and at least one declared fragment;
 *   - at least one character was actually substituted (a template with no
 *     fragment in it quotes nothing);
 *   - for a whole-value copy, NOTHING of the app's wording is left over: a
 *     copied value may only be marked if the marking covers all of it, because
 *     "part of this value is the project's and the rest is ours" is exactly the
 *     claim the declaration does not support there;
 *   - the segments concatenate back to the value's own text, character for
 *     character — a value carrying characters no fragment accounts for is NOT
 *     marked, because there would be no way to say whose they are.
 *
 * The last rule is the reason a reader can trust the marking rather than the
 * code: nothing is inferred from the characters themselves, and no character is
 * presented as the project's own unless the value's own declaration puts it there.
 */
import { quotationSegments, type QuotationSegment } from "./quotation";
import type { QuotedFragment } from "./quotation";
import type { TextOrigin } from "./provenance";
import type { StudioValue } from "./studio-view";

/** The stretches of a value's sentence, with the project's own characters marked. */
export type QuotedSegments = readonly QuotationSegment[];

/** The origins that may be quoted at all. `rule_authored` is not one of them. */
export const QUOTABLE_TEXT_ORIGINS: readonly TextOrigin[] = [
  "template_filled",
  "source_verbatim",
  "provider_verbatim",
];

/**
 * Everything the marking needs, structurally: every `StudioValue` satisfies this,
 * and so does a group item that carries the same declaration and no state.
 */
export interface QuotableValue {
  state?: "derived" | "empty_no_input" | "gated_provider";
  value: string | number | boolean | null;
  textOrigin: TextOrigin | null;
  templateText?: string | null;
  fragments?: readonly QuotedFragment[];
}

/**
 * The value's sentence as segments, or `null` when this value quotes nothing (see
 * the module note for the exact conditions). Never throws, never invents a
 * source, and never marks a character the value did not declare.
 */
export function quotedSegments(value: QuotableValue): QuotedSegments | null {
  if (value.state !== undefined && value.state !== "derived") return null;
  const origin = value.textOrigin;
  if (origin === null || !QUOTABLE_TEXT_ORIGINS.includes(origin)) return null;
  if (typeof value.value !== "string" || value.value.length === 0) return null;
  if (!value.templateText) return null;
  const fragments = value.fragments ?? [];
  if (fragments.length === 0) return null;
  const segments = quotationSegments(value.templateText, fragments);
  if (!segments.some((segment) => segment.quoted)) return null;
  if (segments.map((segment) => segment.text).join("") !== value.value) return null;
  if (origin !== "template_filled") {
    // A whole-value copy: the app's own template is the placeholder alone, so
    // any unquoted characters left over would be this app's wording inside a
    // value declared as a copy. That is not what the declaration says, so
    // nothing is marked.
    if (segments.some((segment) => !segment.quoted)) return null;
  }
  return segments;
}

/**
 * True when the segments cover the whole value — the whole-value-copy shape
 * (shape 2 above). A surface uses this to say the right thing under the value:
 * "this value is the project's own characters in full" is a different statement
 * from "the highlighted characters inside this sentence are the project's".
 */
export function isWholeValueCopy(segments: QuotedSegments): boolean {
  return segments.length > 0 && segments.every((segment) => segment.quoted);
}

/** The characters on a set of segments that were substituted in, in order. */
export function quotedCharacters(segments: QuotedSegments): string[] {
  return segments.filter((segment) => segment.quoted).map((segment) => segment.text);
}

/**
 * Whose characters the marked stretches are: `source_verbatim` (the project's
 * own) unless every marked stretch is a provider's own, which is the one case a
 * surface must not describe as the project's. Never guessed from the text.
 */
export function quotedOrigin(segments: QuotedSegments): "source_verbatim" | "provider_verbatim" {
  const marked = segments.filter((segment) => segment.quoted);
  return marked.length > 0 && marked.every((segment) => segment.textOrigin === "provider_verbatim")
    ? "provider_verbatim"
    : "source_verbatim";
}
