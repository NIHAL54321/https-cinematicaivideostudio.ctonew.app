/**
 * THE EXPORT TAB'S OWN VIEW OF A PROJECT, AS A PURE DERIVATION.
 * Phase 8 Export panel block, 2026-11-14.
 *
 * The Export tab used to be the placeholder "no panel on this tab in this build".
 * Two things on it must never be invented, so they are isolated here and tested
 * without a database, a browser or an encoder:
 *
 *  1. READINESS — how many scenes carry a source row, and, when any do not, the
 *     EXACT refusal `encode-master` gives. That sentence is not written twice:
 *     `encodeRefusalSentence()` is the same function the stage throws with
 *     (src/lib/render/encode-refusal.ts), so the warning beside the disabled
 *     button cannot drift from the refusal it warns about.
 *  2. THE DELIVERY GATE — a job is shown as delivered only once its
 *     `checksum-artefact` stage row says SUCCEEDED. A render that reached
 *     `container-mux` and then died has produced bytes and no verified delivery,
 *     and calling that "done" would be the same class of lie as offering a
 *     download for a file nobody has.
 *
 * Counts come from `scenesView()` (src/lib/studio/scenes-view.ts) — the SAME
 * derivation the Scenes tab counts with — so the two tabs cannot disagree about
 * how many scenes are sourced. A scene is sourced only when a `SceneAsset` row is
 * attached to it: the row the encode stage reads.
 *
 * Pure: no env, no file, no network, no Prisma. Client-safe.
 */
import type { ScriptTree } from "./pipeline";
import { scenesView, summarySentence } from "./scenes-view";
import { encodeRefusalSentence, type UnsourcedScene } from "@/lib/render/encode-refusal";

/** The stage whose SUCCEEDED row is the only thing that makes a delivery real. */
export const DELIVERY_GATE_STAGE_ID = "checksum-artefact";

export interface ExportReadinessView {
  kind: "empty" | "scenes";
  /** Scene rows in this project. */
  total: number;
  /** Scenes carrying at least one SceneAsset row. */
  sourced: number;
  unsourced: number;
  /** How many scenes have a source, in words. */
  summary: string;
  /**
   * The encode stage's own refusal, present only when a scene is unsourced (or
   * when the project has no scenes at all). Null when the project can be queued.
   */
  refusal: string | null;
  /** True only when there is at least one scene and every scene is sourced. */
  canQueue: boolean;
  /** Why the queue button is disabled. Null when it is not disabled. */
  blockedReason: string | null;
  /** The scenes that carry no source media, in project order. */
  unsourcedScenes: UnsourcedScene[];
}

/**
 * Readiness from the project's own structure tree. An unreadable tree (`null`) is
 * NOT treated as "ready": it is treated as nothing known, and the button stays
 * disabled with a reason that says the tree could not be read.
 */
export function exportReadiness(tree: ScriptTree | null): ExportReadinessView {
  if (!tree) {
    return {
      kind: "empty",
      total: 0,
      sourced: 0,
      unsourced: 0,
      summary: "This project's scene list could not be read, so nothing is stated about its readiness.",
      refusal: null,
      canQueue: false,
      blockedReason:
        "The queue button is disabled because this project's scenes could not be read. Nothing is claimed about them either way.",
      unsourcedScenes: [],
    };
  }

  const view = scenesView(tree);
  if (view.kind === "empty") {
    return {
      kind: "empty",
      total: 0,
      sourced: 0,
      unsourced: 0,
      summary: view.body,
      refusal: null,
      canQueue: false,
      blockedReason:
        "The queue button is disabled: this project has no Scene rows, so the pipeline's project-has-scenes probe blocks it before any encode.",
      unsourcedScenes: [],
    };
  }

  const unsourcedScenes: UnsourcedScene[] = view.scenes
    .filter((s) => !s.sourced)
    .map((s) => ({ id: s.id, order: s.number }));
  const unsourced = unsourcedScenes.length;
  const refusal = unsourced > 0 ? encodeRefusalSentence({ sceneCount: view.total, missing: unsourcedScenes }) : null;

  // A chapter with no scenes is not a renderable project either: the pipeline's
  // project-has-scenes probe counts Scene rows, and there are none.
  const noScenes = view.total === 0;

  return {
    kind: view.total === 0 ? "empty" : "scenes",
    total: view.total,
    sourced: view.sourced,
    unsourced,
    summary: summarySentence(view.sourced, view.total),
    refusal,
    canQueue: !noScenes && unsourced === 0,
    blockedReason: noScenes
      ? "The queue button is disabled: this project has no Scene rows, so the pipeline's project-has-scenes probe blocks it before any encode."
      : unsourced > 0
        ? "The queue button is disabled: the encode stage refuses this project while any scene carries no source media, and the sentence below is the refusal it would give."
        : null,
    unsourcedScenes,
  };
}

export interface DeliveryGate {
  /** True only when the checksum stage's row says SUCCEEDED. */
  allowed: boolean;
  /** The checksum row's own state, or null when the pipeline never reached it. */
  state: string | null;
  /** Why nothing is shown as delivered, in words. Empty when `allowed`. */
  reason: string;
}

/**
 * Whether a job's produced file may be shown as a delivery.
 *
 * Read from the stage rows alone: the `checksum-artefact` row's state. A job
 * whose status is `succeeded` but whose checksum row is missing or not SUCCEEDED
 * is NOT delivered here — the job status is derived from the same rows, and this
 * gate is the stricter of the two on purpose.
 */
export function deliveryGate(input: {
  stages: readonly { id: string; state: string | null }[];
}): DeliveryGate {
  const row = input.stages.find((s) => s.id === DELIVERY_GATE_STAGE_ID) ?? null;
  if (row && row.state === "SUCCEEDED") {
    return { allowed: true, state: row.state, reason: "" };
  }
  const state = row ? row.state : null;
  return {
    allowed: false,
    state,
    reason:
      state === null
        ? `The pipeline never reached ${DELIVERY_GATE_STAGE_ID}, so no file is shown as delivered — there is no row that says one was verified.`
        : `The ${DELIVERY_GATE_STAGE_ID} row says ${state}, so no file is shown as delivered. A rendered file that was never checksum-verified is not a delivery.`,
  };
}
