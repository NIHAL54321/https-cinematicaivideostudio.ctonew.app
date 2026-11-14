/**
 * The Scenes tab's view of a project, as a PURE derivation.
 * Phase 8 Scenes-panel block, 2026-11-09.
 *
 * The Scenes tab used to be the placeholder "no panel on this tab in this
 * build". It is now the first place in this product where a video can be
 * SOURCED AND EDITED BY CLICKING, so the two things that must not be invented
 * are isolated here and unit-tested without a database or a provider:
 *
 *  1. WHAT IS SOURCED. A scene is sourced only when a `SceneAsset` row is
 *     attached to it — the same row the encode stage reads. Nothing is counted
 *     from a provider's result list, a search, or an intention.
 *  2. WHAT A SEARCH ANSWERED. `GET /api/media` answers four materially
 *     different things — candidates, an empty result set, "no provider is
 *     configured", and "the provider refused, and here is its message". They
 *     are read apart here so a refusal can never be rendered as "no results",
 *     which is the failure the Media Library banner made in reverse.
 *
 * Every sentence produced here is a statement of fact about this database and
 * this server. The one label every clip carries — keyword-found stock, not an
 * illustration of the scene — is the same honesty the delivered container
 * carries in its own metadata.
 */
import type { ScriptTree, ScriptTreeSceneAsset } from "./pipeline";
import type { ProviderAsset } from "@/lib/media/types";

/** The label every attached clip carries. Never softened, never scored. */
export const SOURCE_LABEL = "Keyword-found stock — not an illustration of this scene";

export interface SceneRow {
  id: string;
  chapterId: string;
  chapterTitle: string;
  /** 1-based position across the whole project, in chapter then scene order. */
  number: number;
  title: string | null;
  narration: string | null;
  durationSeconds: number | null;
  visualPrompt: string | null;
  assets: ScriptTreeSceneAsset[];
  /** True only when at least one SceneAsset row is attached (the row the render reads). */
  sourced: boolean;
}

export type ScenesView =
  | { kind: "empty"; title: string; body: string }
  | {
      kind: "scenes";
      scenes: SceneRow[];
      total: number;
      sourced: number;
      unsourced: number;
      /** The plain summary sentence shown at the top of the panel. */
      summary: string;
    };

/**
 * The sentence that says an unsourced scene blocks the render — because it
 * does: `encode-master` throws rather than deliver a partial timeline, naming
 * the scenes that carry no source media.
 */
export function summarySentence(sourced: number, total: number): string {
  const unsourced = Math.max(0, total - sourced);
  if (total === 0) return "This project has no scenes, so there is nothing to source.";
  if (unsourced === 0) {
    return (
      `All ${total} scene${total === 1 ? "" : "s"} have a sourced clip. ` +
      `That is a sourcing fact and nothing more: each clip is keyword-found stock, not an illustration of its scene.`
    );
  }
  return (
    `${sourced} of ${total} scene${total === 1 ? "" : "s"} have a sourced clip, ${unsourced} do not. ` +
    `An unsourced scene blocks the render: the encode stage refuses to encode a project while any scene carries ` +
    `no source media, so all ${total} scenes must be sourced before this project can render.`
  );
}

export function scenesView(tree: ScriptTree | null): ScenesView {
  const chapters = tree?.script?.chapters ?? [];
  if (chapters.length === 0) {
    return {
      kind: "empty",
      title: "No scenes to source yet",
      body:
        "This project has no Scene rows, so there is nothing to edit or source here. " +
        "Scenes are created by the script and structure-plan steps; nothing is invented to fill this panel.",
    };
  }

  const scenes: SceneRow[] = [];
  let number = 0;
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      number += 1;
      scenes.push({
        id: scene.id,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        number,
        title: scene.title,
        narration: scene.narration,
        durationSeconds: scene.durationSeconds,
        visualPrompt: scene.visualPrompt,
        assets: scene.assets ?? [],
        sourced: (scene.assets ?? []).length > 0,
      });
    }
  }

  const sourced = scenes.filter((s) => s.sourced).length;
  return {
    kind: "scenes",
    scenes,
    total: scenes.length,
    sourced,
    unsourced: scenes.length - sourced,
    summary: summarySentence(sourced, scenes.length),
  };
}

// ---------------------------------------------------------------------------
// Reading a search answer
// ---------------------------------------------------------------------------

export type SearchOutcome =
  | { kind: "ok"; candidates: ProviderAsset[]; query: string | null; notes: string[] }
  | { kind: "empty"; query: string | null; message: string; notes: string[] }
  | { kind: "not_connected"; requiredEnv: string[]; message: string }
  | { kind: "provider_error"; message: string; notes: string[] }
  | { kind: "error"; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Turns `GET /api/media`'s body into exactly one of the five states above.
 * A provider's own refusal message is carried through verbatim; it is never
 * replaced by "no results" and never softened into a neutral sentence.
 */
export function readSearchOutcome(body: unknown): SearchOutcome {
  if (!isRecord(body)) {
    return { kind: "error", message: "The media route returned no readable body, so no result is reported." };
  }
  const status = typeof body.status === "string" ? body.status : "";
  const query = typeof body.query === "object" && isRecord(body.query) && typeof body.query.keywords === "string"
    ? body.query.keywords
    : typeof body.query === "string"
      ? body.query
      : null;

  const responses = Array.isArray(body.providerResponses) ? body.providerResponses : [];
  const answered = responses.filter((r) => isRecord(r) && r.status === "ok");
  /** Every refusal, verbatim, as the provider wrote it (the adapter prefixes its id). */
  const refusals = responses
    .filter((r): r is Record<string, unknown> => isRecord(r) && r.status === "error" && typeof r.message === "string")
    .map((r) => r.message as string);

  // A refusal is never reported as an empty result. When NOTHING answered and
  // something refused, the provider's own message is the answer — even though
  // the route's top-level status says "not_connected" in that case (it only
  // counts providers that returned results as "ok").
  if (answered.length === 0 && refusals.length > 0) {
    return { kind: "provider_error", message: refusals[0], notes: refusals };
  }

  if (status === "not_connected") {
    const requiredEnv = stringList(body.requiredEnv);
    return {
      kind: "not_connected",
      requiredEnv,
      message:
        "No stock provider is configured on this server" +
        (requiredEnv.length ? ` (set one of ${requiredEnv.join(", ")} server-side)` : "") +
        ". No search was made and no candidate is shown.",
    };
  }

  if (status === "ok") {
    const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];
    const candidates = rawCandidates.filter(
      (c): c is ProviderAsset =>
        isRecord(c) &&
        typeof c.provider === "string" &&
        typeof c.externalId === "string" &&
        typeof c.title === "string" &&
        typeof c.url === "string" &&
        isRecord(c.license),
    );
    if (candidates.length > 0) return { kind: "ok", candidates, query, notes: refusals };
    return {
      kind: "empty",
      query,
      notes: refusals,
      message:
        "The provider answered and returned no candidate for this query. " +
        "Nothing is invented to fill the list — try different words in the search box.",
    };
  }

  if (status === "not_found") {
    return {
      kind: "error",
      message: typeof body.message === "string" ? body.message : "The scene was not found for this account.",
    };
  }

  return {
    kind: "error",
    message:
      typeof body.message === "string"
        ? body.message
        : `The media route answered with status "${status || "unknown"}", which carries no candidates.`,
  };
}

/** What the stored record says about an attached clip's licence — nothing more. */
export function licenceSentence(asset: ScriptTreeSceneAsset): string {
  if (!asset.licenseType) return "The stored record names no licence type for this clip.";
  const source = asset.licenseSource ? ` from ${asset.licenseSource}` : " (the record names no licence source)";
  return `Licence on record: ${asset.licenseType}${source}.`;
}
