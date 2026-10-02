/**
 * Camera Engine — deterministic per-scene camera selection.
 *
 * Builds on the existing 15 shot types in `cameras.ts` (SHOT_TYPES /
 * pickCamera) and adds the `CAMERA_MOVES` vocabulary — the block-standard
 * camera move + motion language (wide establishing, tracking, dolly, aerial,
 * slow motion, etc.) and an `applyCameraToPrompt` helper that turns a pick
 * into prompt wording. Pure and deterministic, never random.
 */
import { getShotType, pickCamera as phaseTwoPickCamera, type ShotType } from "./cameras";

export interface CameraMove {
  /** The camera-move id (also the prompt word). */
  move: string;
  /** Preferred underlying shot type, when one maps cleanly. */
  shotType?: string;
  /** Human-readable description. */
  description: string;
  /** Motion language appended to a prompt. */
  motion?: string;
  /** Depth-of-field hint. */
  depthOfField?: string;
  /** Suggested duration hint (seconds) when this move needs screen time. */
  durationHint?: number;
}

/** The 13 supported camera moves. */
export const CAMERA_MOVES: CameraMove[] = [
  { move: "wide establishing", shotType: "wide", description: "Sweeping wide shot that orients the viewer in place and scale.", motion: "locked, slow drift", depthOfField: "deep", durationHint: 4 },
  { move: "medium", shotType: "medium", description: "Comfortable mid-distance framing for explanation.", motion: "slow, stable", depthOfField: "moderate", durationHint: 3 },
  { move: "close-up", shotType: "close-up", description: "Forces attention on a detail or reaction.", motion: "locked, intimate", depthOfField: "shallow", durationHint: 3 },
  { move: "macro", shotType: "macro", description: "Magnifies extreme texture and detail.", motion: "slow push-in", depthOfField: "very shallow", durationHint: 4 },
  { move: "pov", shotType: "pov", description: "Puts the viewer inside the action.", motion: "first-person glide", depthOfField: "moderate", durationHint: 4 },
  { move: "drone", shotType: "drone", description: "Smooth airborne reveal over a wide space.", motion: "soaring, gliding", depthOfField: "deep", durationHint: 5 },
  { move: "tracking", shotType: "tracking", description: "Moves with the subject; momentum and progression.", motion: "dolly-track alongside subject", depthOfField: "moderate", durationHint: 4 },
  { move: "dolly", shotType: "dolly", description: "Slow push-in as a realization approaches.", motion: "slow push-in", depthOfField: "moderate", durationHint: 4 },
  { move: "crane", shotType: "crane", description: "Rises above the scene for a concluding sweep.", motion: "rising crane sweep", depthOfField: "deep", durationHint: 5 },
  { move: "aerial", shotType: "aerial", description: "God's-eye overview of a place or era.", motion: "high overhead drift", depthOfField: "deep", durationHint: 5 },
  { move: "rack focus", shotType: "rack-focus", description: "Shifts focus between planes — a reveal.", motion: "rack focus pull", depthOfField: "shallow", durationHint: 3 },
  { move: "slow motion", shotType: "slow-motion", description: "Dwells on a pivotal, emotional moment.", motion: "slow-motion capture", depthOfField: "shallow", durationHint: 4 },
  { move: "time-lapse", shotType: "time-lapse", description: "Compresses long change into seconds.", motion: "time-lapse compression", depthOfField: "deep", durationHint: 3 },
];

export function getCameraMove(move: string | undefined | null): CameraMove {
  return CAMERA_MOVES.find((m) => m.move === move) ?? CAMERA_MOVES[0];
}

export interface PickCameraInput {
  beatId?: string;
  beatName?: string;
  mediaType?: string;
  format?: string;
  emotion?: string;
  /** Optional explicit move override. */
  move?: string;
}

export interface CameraPick {
  move: CameraMove;
  /** Underlying shot decision (resolved deterministically from the scene). */
  shot: ShotType;
  /** Human-readable rationale. */
  rationale: string;
}

/**
 * A smarter per-scene picker over the existing 15 shot types. It first runs the
 * Phase 2 `pickCamera` heuristic to choose a shot type, then maps that shot to
 * the most fitting camera move. An explicit `move` override wins. Deterministic.
 */
export function pickCamera(input: PickCameraInput): CameraPick {
  // Respect an explicit move override.
  const explicit = input.move ? getCameraMove(input.move) : null;
  // Run the existing deterministic shot heuristic.
  const decision = phaseTwoPickCamera({
    beatId: input.beatId,
    beatName: input.beatName,
    mediaType: input.mediaType,
    format: input.format,
    emotion: input.emotion,
  });
  const shotId = explicit?.shotType ?? decision.shot.id;
  const shot = getShotType(shotId) ?? decision.shot;
  const move = explicit ?? moveForShot(shot.id);
  return {
    move,
    shot,
    rationale: `${move.move} · ${shot.name.toLowerCase()} — ${shot.rationale.toLowerCase()}`,
  };
}

function moveForShot(shotId: string): CameraMove {
  const byShot: Record<string, string> = {
    wide: "wide establishing",
    establishing: "wide establishing",
    medium: "medium",
    "close-up": "close-up",
    "extreme-close-up": "close-up",
    macro: "macro",
    pov: "pov",
    tracking: "tracking",
    dolly: "dolly",
    crane: "crane",
    drone: "drone",
    aerial: "aerial",
    "rack-focus": "rack focus",
    "slow-motion": "slow motion",
    "time-lapse": "time-lapse",
  };
  return getCameraMove(byShot[shotId]);
}

/** Append the camera/motion wording to a prompt string. */
export function applyCameraToPrompt(prompt: string, pick: CameraPick): string {
  const m = pick.move;
  const segments = [
    prompt.trim(),
    `camera move: ${m.move}`,
    ...(m.motion ? [`motion: ${m.motion}`] : []),
    ...(m.depthOfField ? [`depth of field: ${m.depthOfField}`] : []),
  ].filter(Boolean);
  return Array.from(new Set(segments)).join(", ");
}
