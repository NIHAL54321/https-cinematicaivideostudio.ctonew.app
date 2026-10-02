/**
 * Phase 3 — Scene → Visual Assignment wiring.
 *
 * Connects the Visual Selection engine (rankVisualsForScene) with the Visual
 * Continuity layer (extractContinuity / augmentScenesWithContinuity): it walks
 * scenes in order, extracts cross-scene continuity, ranks visuals per scene and
 * attaches a primary + alternates to each scene without changing its narration,
 * script, camera, ordering or timing.
 *
 * Pure and deterministic — operates on plain scene objects, never the DB, and
 * never calls a provider. The output is a STRUCTURE (proposals + anchors), not
 * fabricated media.
 */
import { rankVisualsForScene, type VisualCandidate, type VisualScene, type VisualSelectionOptions } from "./visual-selection";
import {
  extractContinuity,
  augmentScenesWithContinuity,
  entitiesIn,
  type ContinuityState,
} from "./continuity";

export interface SceneVisualAssignment {
  sceneId: string;
  order: number;
  title: string | null;
  chosen: VisualCandidate;
  alternates: VisualCandidate[];
  /** Continuity anchors that apply to this scene (as human notes). */
  continuityNotes: string[];
}

export interface VisualAssignmentResult {
  /** Scenes with continuity anchors appended to their visual prompts (all
   * other fields — narration, titles, order, timing — preserved unchanged). */
  scenes: VisualScene[];
  /** Per-scene primary + ranked alternates. */
  assignments: SceneVisualAssignment[];
  continuity: ContinuityState;
}

/**
 * Attach ranked visuals to every scene and add continuity anchors.
 *
 * - Existing user choice (`scene.chosen`) is kept and re-scored when it can be
 *   matched to a freshly-ranked candidate; otherwise the top new candidate
 *   becomes the primary.
 * - Story/narration/timing are preserved (only visualPrompt receives anchors).
 * - Scene IDs and order are never modified.
 */
export function assignVisualsToStoryboard(
  scenes: VisualScene[],
  options: VisualSelectionOptions = {},
): VisualAssignmentResult {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return { scenes: [], assignments: [], continuity: extractContinuity([], options) };
  }

  const continuity = extractContinuity(scenes, { presetId: options.presetId });

  const assignments: SceneVisualAssignment[] = scenes.map((scene, idx) => {
    const ranked = rankVisualsForScene(scene, options);
    // Re-match an existing choice to a freshly-ranked candidate by its stable id.
    let chosen: VisualCandidate;
    if (scene.chosen?.id) {
      const rematch = ranked.find((c) => c.id === scene.chosen!.id);
      if (rematch) chosen = rematch; // re-scored with current continuity intact
      else chosen = scene.chosen; // keep the user's pick, prefer it over new proposals
    } else {
      chosen = ranked[0];
    }
    const alternates = ranked.filter((c) => c.id !== chosen.id).slice(0, 4);

    const { characters, locations, props } = entitiesIn(scene, continuity);
    const notes: string[] = [];
    for (const c of characters) notes.push(`Character "${c.name}" recurs in scenes ${c.scenes.join(", ")} — keep appearance consistent.`);
    for (const l of locations) notes.push(`Location "${l.name}" recurs — keep architecture/lighting consistent.`);
    for (const p of props) notes.push(`Prop "${p.name}" recurs — keep its look consistent.`);
    if (!notes.length) notes.push("No recurring continuity entities in this scene.");

    return {
      sceneId: scene.id ?? `scene-${idx}`,
      order: scene.order ?? idx + 1,
      title: scene.title ?? null,
      chosen,
      alternates,
      continuityNotes: notes,
    };
  });

  const augmented = augmentScenesWithContinuity(scenes, continuity);

  return { scenes: augmented, assignments, continuity };
}
