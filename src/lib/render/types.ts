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
  /** FIXTURE marker — true only for the scripted proof world. */
  fixture: boolean;
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
