/**
 * The shapes the render pipeline passes between its stages, its store and its
 * runner. Kept in one file so the store, the executors and the tests cannot
 * drift apart on what "the project's facts" means.
 */

/** One scene, as the pipeline sees it. */
export interface RenderSceneFact {
  id: string;
  order: number;
  durationSeconds: number | null;
  narrationChars: number;
  subtitleCount: number;
  assetCount: number;
  /** s3Key or url of the scene's first visual asset — null when it has none. */
  sourcePath: string | null;
}

/** Everything the pipeline reads from the project's own rows. */
export interface ProjectFacts {
  projectId: string;
  title: string;
  sceneCount: number;
  scenes: RenderSceneFact[];
  /** Characters of narration across all scenes (the spoken text). */
  scriptChars: number;
  /** Subtitle rows attached to the project's scenes. */
  subtitleCueCount: number;
  /** Scenes that carry at least one asset with a real path. */
  sourceMediaCount: number;
}

export interface RenderJobFacts {
  id: string;
  projectId: string;
  userId: string;
  presetId: string;
  presetLabel: string;
  /**
   * The RESOLVED export specification recorded when the job was enqueued
   * (`resolvedSpecCore` from src/lib/export/presets), so the job's numbers stay
   * the job's numbers even if a preset is edited afterwards. Null only for a job
   * enqueued before Phase 8 block 2a.
   */
  presetSpec: unknown;
  /** SHA-256 of the canonical JSON of `presetSpec`. */
  presetSpecSha256: string | null;
  /** The export-specification matrix version the spec was resolved against. */
  specVersion: string | null;
  /** FIXTURE marker — true only for the scripted proof world. */
  fixture: boolean;
  /**
   * SYNTHETIC ENCODER PROOF marker — true only for a job whose input is a source
   * the encoder generated itself. A different fact from `fixture`: the fixture
   * jobs are the scripted proof world's projects, and this is never one of them.
   */
  syntheticProof: boolean;
  /**
   * The declared synthetic source recorded on the job at enqueue time (pattern,
   * tone, duration, resolution, frame rate, frame count, argv, path, bytes,
   * SHA-256). Null for every ordinary job.
   */
  syntheticSource: unknown;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  stopRequestedAt: Date | null;
  stopReason: string | null;
  pipelineVersion: string;
}

/** A file a stage really wrote. */
export interface StageFile {
  artefactKind: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface StageOutcome {
  /** What the stage computed — recorded on its own stage row. Never empty. */
  record: Record<string, unknown>;
  /** Required when the stage declares a `file` produce; verified by the runner. */
  files?: StageFile[];
}

export interface StageExecContext {
  job: RenderJobFacts;
  facts: ProjectFacts;
  /** Directory this stage may write into (created by the runner). */
  stageDir: string;
  /** Artefacts earlier stages really produced, by artefact kind. */
  artefacts: Record<string, StageFile>;
}

/** Thrown by an executor that cannot do its work. The runner marks the row FAILED. */
export class StageFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageFailure";
  }
}
