/**
 * Phase 7 Block 1 — PROVENANCE, the data model itself.
 *
 * The point of this module: a consumer of a publishing package must be able to
 * tell a DERIVED value from a GATED one WITHOUT reading the code that produced
 * it. So no value in a package is ever a bare string or number. Every value is
 * wrapped in a `Field` that carries:
 *
 *   - `state`   — "derived" (this app computed it from rows it really has),
 *                 "empty_no_input" (a real, stored input is missing, so the
 *                 field is deliberately empty and says which input), or
 *                 "gated_provider" (it would need a provider/credential that
 *                 does not exist on this server — the env var NAMES, never
 *                 values, are named).
 *   - `rule`    — the rule id that produced the value (see ./rules).
 *   - `sources` — the rows/fields/text spans it was derived FROM, by id.
 *   - `reason`  — for the two non-derived states, why the field is empty.
 *   - `requires`/`envVars` — what input would fill it.
 *
 * Strings additionally carry `textOrigin`:
 *   - "source_verbatim" — the characters came from the project's own text (a
 *     normalisation like lower-casing is allowed and stated). The honesty audit
 *     does not phrase-scan these: a user's own words are the user's.
 *   - "rule_authored"   — this library wrote the words. The honesty audit DOES
 *     phrase-scan these, so no rule-authored sentence can ever contain a
 *     banned claim.
 *   - "template_filled" — a fixed template's words with the project's own text
 *     substituted in. The audit scans the TEMPLATE (which every such field also
 *     carries, as `templateText`) and not the filled result, so a project whose
 *     own words contain a phrase the audit bans cannot fail a build through no
 *     fault of its own — while our own words are still fully scanned.
 *
 * There is deliberately no way to construct a Field with a value but no rule,
 * or a value with no source: `derived()` requires both.
 */
import type { PublishingRuleId } from "./rules";

/** The three states a field can be in. Nothing else is representable. */
export type FieldState = "derived" | "empty_no_input" | "gated_provider";

/** Where a value came from. `kind` names the table/row family; `id` the row. */
export type SourceKind =
  | "project"
  | "project_settings"
  | "script"
  | "chapter"
  | "scene"
  | "asset"
  | "licensing"
  | "request"
  | "keyword";

export interface SourceRef {
  kind: SourceKind;
  /** The row id (or a request/field marker) this value came from. */
  id: string;
  /** The field/JSON path inside that row, when the value is narrower than it. */
  path?: string;
  /** Character span inside that field's text, when the value is a text span. */
  span?: { start: number; end: number };
}

/** Where the characters of a string value came from. */
export type TextOrigin = "source_verbatim" | "rule_authored" | "template_filled" | "provider_verbatim";

export interface DerivedField<T> {
  state: "derived";
  value: T;
  rule: PublishingRuleId;
  sources: SourceRef[];
  /** Required for string values; null for non-string values. */
  textOrigin: TextOrigin | null;
  note?: string;
}

export interface EmptyField {
  state: "empty_no_input";
  value: null;
  rule: null;
  sources: [];
  /** Why it is empty, in plain words. Never empty. */
  reason: string;
  /** Which stored input(s) would fill it. Never empty. */
  requires: string[];
  textOrigin: null;
  note?: string;
}

export interface GatedField {
  state: "gated_provider";
  value: null;
  rule: null;
  sources: [];
  reason: string;
  requires: string[];
  /** Env var NAMES only (never values) that would enable the step. */
  envVars: string[];
  textOrigin: null;
  note?: string;
}

export type Field<T> = DerivedField<T> | EmptyField | GatedField;

export type FieldLike = Field<unknown> | DerivedField<unknown[]> | EmptyField | GatedField;

/** True when the object is one of the three Field shapes (used by the audit). */
export function isFieldLike(v: unknown): v is Field<unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const state = (v as { state?: unknown }).state;
  return state === "derived" || state === "empty_no_input" || state === "gated_provider";
}

/**
 * A DERIVED value. Both `rule` and a non-empty `sources` are required, and for
 * string values a `textOrigin` is required — so a derived value can never be
 * anonymous about where it came from.
 */
export function derived<T>(
  value: T,
  rule: PublishingRuleId,
  sources: SourceRef[],
  opts: { textOrigin?: TextOrigin; note?: string } = {},
): Field<T> {
  if (sources.length === 0) {
    throw new Error(`derived(): rule ${rule} produced a value with no source`);
  }
  const textOrigin = typeof value === "string" ? (opts.textOrigin ?? null) : null;
  if (typeof value === "string" && textOrigin === null) {
    throw new Error(`derived(): string value from rule ${rule} must declare a textOrigin`);
  }
  const field: DerivedField<T> = { state: "derived", value, rule, sources, textOrigin };
  if (opts.note) field.note = opts.note;
  return field;
}

/** An EMPTY-WITH-REASON value: a real input this app does not have. */
export function emptyNoInput(
  reason: string,
  requires: string[],
  opts: { note?: string } = {},
): EmptyField {
  if (!reason.trim()) throw new Error("emptyNoInput(): a reason is required");
  if (requires.length === 0) throw new Error("emptyNoInput(): `requires` must name the missing input");
  const field: EmptyField = {
    state: "empty_no_input",
    value: null,
    rule: null,
    sources: [],
    reason,
    requires,
    textOrigin: null,
  };
  if (opts.note) field.note = opts.note;
  return field;
}

/**
 * A GATED value: the step would need a provider this server cannot reach.
 * `envVars` carries env var NAMES only — a gate must never print a value, and
 * must never print a name that no code reads (they come from the app's own
 * provider registry via the caller, never from a literal list here).
 */
export function gatedProvider(
  reason: string,
  requires: string[],
  envVars: string[],
  opts: { note?: string } = {},
): GatedField {
  if (!reason.trim()) throw new Error("gatedProvider(): a reason is required");
  if (requires.length === 0) throw new Error("gatedProvider(): `requires` must name what is needed");
  const field: GatedField = {
    state: "gated_provider",
    value: null,
    rule: null,
    sources: [],
    reason,
    requires,
    envVars,
    textOrigin: null,
  };
  if (opts.note) field.note = opts.note;
  return field;
}

/** Counts of how every field in a package ended up. Derived by walking. */
export interface FieldStats {
  total: number;
  derived: number;
  emptyNoInput: number;
  gatedProvider: number;
}

/** Walks any JSON-ish value and counts the Fields inside it. */
export function fieldStats(root: unknown): FieldStats {
  const stats: FieldStats = { total: 0, derived: 0, emptyNoInput: 0, gatedProvider: 0 };
  const visit = (node: unknown): void => {
    if (isFieldLike(node)) {
      stats.total += 1;
      if (node.state === "derived") stats.derived += 1;
      else if (node.state === "empty_no_input") stats.emptyNoInput += 1;
      else stats.gatedProvider += 1;
      // A Field's payload may itself contain Fields (e.g. a chapter entry).
      if (node.state === "derived") visit(node.value);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const value of Object.values(node as Record<string, unknown>)) visit(value);
    }
  };
  visit(root);
  return stats;
}

/**
 * A deterministic, dependency-free fingerprint of the rows a package was
 * derived from. Purpose: prove two packages were built from the SAME source
 * state, and that a saved package was not silently re-used as if it were fresh.
 * FNV-1a 64-bit, hex — pure JS so it is identical on every machine and needs no
 * crypto import (and so it can be recomputed in a test from the same strings).
 */
export function fnv1a64(parts: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      hash ^= BigInt(part.charCodeAt(i));
      hash = (hash * prime) & mask;
    }
    // a separator so ["ab","c"] and ["a","bc"] differ
    hash ^= 0x1fn;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
