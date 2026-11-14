/**
 * The shapes the render pipeline passes between its stages, its store and its
 * runner. Kept in one file so the store, the executors and the tests cannot
 * drift apart on what "the project's facts" means.
 */

/**
 * Where a scene's source media came from, as its own rows state it — the
 * provenance a delivered file may quote, and nothing more.
 */
export interface RenderSceneSourceFact {
  /** How `sourcePath` is to be read: an object key, an absolute path, or a URL. */
  pathKind: "object-key" | "local-path" | "url";
  /** Bytes and SHA-256 recorded on the asset when its object was stored. */
  storedBytes: number | null;
  storedSha256: string | null;
  /** Provider provenance, copied from StockAsset. Null when the asset has none. */
  provider: string | null;
  providerAssetId: string | null;
  pageUrl: string | null;
  author: string | null;
  /** Licence as the LicensingMetadata row states it. */
  licenseType: string | null;
  licenseSource: string | null;
  licenseUrl: string | null;
  attribution: string | null;
  /** Null unless the provider stated a date — a null here is not "never expires". */
  purchasedAt: string | null;
  expiresAt: string | null;
}

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
  /**
   * Provenance of the same asset, when the store could read it. Optional so a
   * test double that predates it still type-checks; the encode stage treats a
   * missing value as "no provenance recorded", never as "no provider".
   */
  source?: RenderSceneSourceFact | null;
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

/** One attempt at a job, as the runner and the read-out see it (Phase 8 block 6). */
export interface RenderAttemptFacts {
  id: string;
  jobId: string;
  attemptNumber: number;
  state: "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "STOPPED";
  /** The first stage this attempt set out to run. */
  startStageId: string;
  continuedFromId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  heartbeatAt: Date;
  heartbeatCount: number;
  lastStageId: string | null;
  ownerHost: string | null;
  ownerPid: number | null;
  ownerProcStart: string | null;
  endedReason: string | null;
  reusedArtefacts: unknown;
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

/**
 * Thrown when a render attempt is delivered to the runner a second time.
 *
 * `RenderStageRun` is unique on `(attemptId, stageId)`, so an attempt that has
 * already written rows has already run: running it again would collide with its
 * own record (the P2002 the retry path used to log) and could overwrite what it
 * wrote. The runner refuses before anything is written, and this error says
 * exactly which attempt it refused and what it had already recorded.
 */
export class AttemptAlreadyRunError extends Error {
  /** A stable code, so a caller can tell this refusal from any other failure. */
  readonly code = "attempt_already_run" as const;
  constructor(
    readonly jobId: string,
    readonly attemptId: string,
    readonly stageRows: number,
  ) {
    super(
      `render attempt ${attemptId} for job ${jobId} has already run: it already has ${stageRows} stage ` +
        `row${stageRows === 1 ? "" : "s"}, and an attempt runs at most once. Nothing was written. ` +
        `A retry is a NEW attempt — queue one with a new attemptId instead of re-delivering this one.`,
    );
    this.name = "AttemptAlreadyRunError";
  }
}
