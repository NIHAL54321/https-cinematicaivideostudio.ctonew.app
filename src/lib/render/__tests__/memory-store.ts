/**
 * AN IN-MEMORY `RenderStore` FOR TESTS — and it REFUSES to rewrite a closed
 * attempt (Phase 8, block 6).
 *
 * WHY THIS IS ONE FILE RATHER THAN A DOUBLE PER TEST. The `RenderStore` contract
 * grew an attempt surface in block 6 (`createAttempt`, `readAttempt`,
 * `latestAttempt`, `heartbeat`, `finishAttempt`, `stageHistory`, and an
 * `attemptId` on every stage row). A test that hand-rolls four of those methods
 * is a test that silently stops exercising the code the moment the contract
 * changes again — which is exactly how the suite went red between the schema
 * change and this file. So there is ONE double, it is typed as `RenderStore`, and
 * a missing method is a type error in this file rather than a `TypeError` in
 * somebody's test at runtime.
 *
 * WHAT IT ENFORCES RATHER THAN PRETENDS. The same rule the database has to keep
 * for a retry — that a previous attempt's rows are never rewritten — is enforced
 * HERE, by refusal, the way block 5's ledger trigger refuses an UPDATE:
 *
 *   - once an attempt has ended (state !== RUNNING) every write aimed at its
 *     rows throws `RenderStoreRefusal`: `finishStageRun`, `createArtefact`,
 *     `heartbeat`, a second `finishAttempt`, and the explicit `deleteStageRun` /
 *     `deleteAttempt` helpers;
 *   - every accepted write is logged with the attempt it touched, so a test can
 *     assert that the retry path never even ATTEMPTED such a write;
 *   - every refusal is logged too, so a negative control can show the refusal
 *     firing instead of trusting that it would.
 *
 * A double that silently accepted the write would let the very bug the block
 * exists to prevent pass the suite.
 */
import type { RenderStore } from "../runner";
import type { HistoryArtefact, HistoryRow } from "../recovery";
import type { ProjectFacts, RenderAttemptFacts, RenderJobFacts, StageFile } from "../types";
import type { StageState } from "../pipeline";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Thrown when something tries to write a row belonging to a CLOSED attempt. */
export class RenderStoreRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderStoreRefusal";
  }
}

export interface MemStageRow {
  id: string;
  jobId: string;
  attemptId: string;
  stageId: string;
  sequence: number;
  state: StageState;
  startedAt: Date;
  finishedAt: Date | null;
  blockedReason: string | null;
  missingInput: string | null;
  errorMessage: string | null;
  output: unknown;
  artefactCount: number;
  syntheticProof: boolean;
}

export interface MemArtefact {
  attemptId: string;
  stageRunId: string;
  stageId: string;
  artefactKind: string;
  path: string;
  bytes: number;
  sha256: string;
  createdAt: Date;
}

export interface MemAttempt {
  id: string;
  jobId: string;
  attemptNumber: number;
  state: RenderAttemptFacts["state"];
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

export interface MemWrite {
  seq: number;
  op: string;
  attemptId: string | null;
  rowId: string | null;
}

export interface MemRefusal {
  op: string;
  attemptId: string | null;
  reason: string;
}

export interface MemoryStoreOptions {
  /** The job the store answers `readJob` with. Missing fields get honest defaults. */
  job?: Partial<RenderJobFacts>;
  facts?: ProjectFacts;
  now?: () => Date;
  /**
   * NEGATIVE-CONTROL SEAM. When true, `stageHistory` answers with nothing — as if
   * every earlier attempt's rows had been lost. The runner then computes a resume
   * point as though the job had never run, which is precisely the regression the
   * "a retry never re-runs a succeeded stage" guard must catch.
   */
  hideHistory?: boolean;
}

const DEFAULT_FACTS: ProjectFacts = {
  projectId: "proj1",
  title: "FIXTURE — memory-store test project",
  sceneCount: 1,
  scenes: [
    { id: "s1", order: 0, durationSeconds: 5, narrationChars: 20, subtitleCount: 1, assetCount: 1, sourcePath: "s3://a.mp4" },
  ],
  scriptChars: 20,
  subtitleCueCount: 1,
  sourceMediaCount: 1,
};

export function memoryRenderStore(opts: MemoryStoreOptions = {}) {
  const now = opts.now ?? (() => new Date());
  const facts = opts.facts ?? DEFAULT_FACTS;
  let job: RenderJobFacts = {
    id: "job1",
    projectId: facts.projectId,
    userId: "user1",
    presetId: "youtube-2160p",
    presetLabel: "YouTube 4K (2160p SDR)",
    presetSpec: null,
    presetSpecSha256: null,
    specVersion: null,
    pipelineVersion: "render-pipeline/1",
    fixture: true,
    syntheticProof: false,
    syntheticSource: null,
    requestedAt: new Date(0),
    startedAt: null,
    finishedAt: null,
    stopRequestedAt: null,
    stopReason: null,
    ...opts.job,
  };

  const attempts: MemAttempt[] = [];
  const rows: MemStageRow[] = [];
  const artefacts: MemArtefact[] = [];
  const writes: MemWrite[] = [];
  const refusals: MemRefusal[] = [];
  /** The write-log length at the moment each attempt ended. */
  const closedAtIndex = new Map<string, number>();
  let seq = 0;
  let writeSeq = 0;

  function attemptOf(attemptId: string): MemAttempt | undefined {
    return attempts.find((a) => a.id === attemptId);
  }

  function logWrite(op: string, attemptId: string | null, rowId: string | null = null) {
    writes.push({ seq: ++writeSeq, op, attemptId, rowId });
  }

  function refuse(op: string, attemptId: string | null, reason: string): never {
    refusals.push({ op, attemptId, reason });
    throw new RenderStoreRefusal(reason);
  }

  /** Every write path goes through here: an ended attempt's rows are final. */
  function assertOpen(attemptId: string, op: string) {
    const attempt = attemptOf(attemptId);
    if (!attempt) refuse(op, attemptId, `${op}: there is no attempt ${attemptId} to write`);
    if (attempt.state !== "RUNNING") {
      refuse(
        op,
        attemptId,
        `${op} is refused: attempt ${attempt.attemptNumber} is CLOSED (state ${attempt.state}${
          attempt.endedReason ? ` — ${attempt.endedReason}` : ""
        }), and a closed attempt's rows are append-only — a retry writes its OWN rows beside them`,
      );
    }
    return attempt;
  }

  const store: RenderStore = {
    async readJob() {
      return job;
    },
    async startJob(_jobId, at) {
      job = { ...job, startedAt: job.startedAt ?? at };
    },
    async finishJob(_jobId, at) {
      job = { ...job, finishedAt: at };
    },

    /* --- attempts ---------------------------------------------------- */
    async createAttempt({ jobId, attemptNumber, startStageId, continuedFromId, startedAt, owner }) {
      const id = `attempt${attempts.length + 1}`;
      attempts.push({
        id,
        jobId,
        attemptNumber,
        state: "RUNNING",
        startStageId,
        continuedFromId,
        startedAt,
        finishedAt: null,
        heartbeatAt: startedAt,
        heartbeatCount: 0,
        lastStageId: startStageId,
        ownerHost: owner.host,
        ownerPid: owner.pid,
        ownerProcStart: owner.procStart,
        endedReason: null,
        reusedArtefacts: null,
      });
      logWrite("createAttempt", id);
      return id;
    },

    async readAttempt(attemptId) {
      const a = attemptOf(attemptId);
      return a ? { ...a } : null;
    },

    async latestAttempt(jobId) {
      const mine = attempts.filter((a) => a.jobId === jobId).sort((x, y) => y.attemptNumber - x.attemptNumber);
      return mine.length > 0 ? { ...mine[0] } : null;
    },

    async heartbeat(attemptId, at, lastStageId) {
      const attempt = assertOpen(attemptId, "heartbeat");
      attempt.heartbeatAt = at;
      attempt.heartbeatCount += 1;
      if (lastStageId) attempt.lastStageId = lastStageId;
      logWrite("heartbeat", attemptId);
    },

    async finishAttempt(attemptId, patch) {
      const attempt = assertOpen(attemptId, "finishAttempt");
      attempt.state = patch.state;
      attempt.finishedAt = patch.finishedAt;
      attempt.endedReason = patch.endedReason;
      if (patch.reusedArtefacts !== undefined) attempt.reusedArtefacts = patch.reusedArtefacts;
      logWrite("finishAttempt", attemptId);
      closedAtIndex.set(attemptId, writeSeq);
    },

    async stageHistory(jobId) {
      if (opts.hideHistory) return { rows: [], artefacts: [] };
      const numberById = new Map(attempts.map((a) => [a.id, a.attemptNumber]));
      const historyRows: HistoryRow[] = rows
        .filter((r) => r.jobId === jobId)
        .map((r) => ({
          attemptId: r.attemptId,
          attemptNumber: numberById.get(r.attemptId) ?? 0,
          stageId: r.stageId,
          sequence: r.sequence,
          state: r.state,
        }));
      const historyArtefacts: HistoryArtefact[] = artefacts.map((a) => ({
        attemptId: a.attemptId,
        stageId: a.stageId,
        kind: a.artefactKind,
        path: a.path,
        bytes: a.bytes,
        sha256: a.sha256,
      }));
      return { rows: historyRows, artefacts: historyArtefacts };
    },

    /* --- stage rows --------------------------------------------------- */
    async createStageRun({ jobId, attemptId, stageId, sequence, startedAt, syntheticProof }) {
      assertOpen(attemptId, "createStageRun");
      const id = `run${++seq}`;
      rows.push({
        id,
        jobId,
        attemptId,
        stageId,
        sequence,
        state: "RUNNING",
        startedAt,
        finishedAt: null,
        blockedReason: null,
        missingInput: null,
        errorMessage: null,
        output: null,
        artefactCount: 0,
        syntheticProof,
      });
      logWrite("createStageRun", attemptId, id);
      return id;
    },

    async finishStageRun(runId, patch) {
      const row = rows.find((r) => r.id === runId);
      if (!row) throw new Error(`no stage row ${runId}`);
      assertOpen(row.attemptId, "finishStageRun");
      row.state = patch.state;
      row.finishedAt = patch.finishedAt;
      row.blockedReason = patch.blockedReason ?? null;
      row.missingInput = patch.missingInput ?? null;
      row.errorMessage = patch.errorMessage ?? null;
      row.output = patch.output ?? null;
      row.artefactCount = patch.artefactCount;
      logWrite("finishStageRun", row.attemptId, runId);
    },

    async createArtefact({ stageRunId, stageId, file, createdAt }) {
      const run = rows.find((r) => r.id === stageRunId);
      if (!run) throw new Error(`no stage row ${stageRunId}`);
      assertOpen(run.attemptId, "createArtefact");
      artefacts.push({
        attemptId: run.attemptId,
        stageRunId,
        stageId,
        artefactKind: file.artefactKind,
        path: file.path,
        bytes: file.bytes,
        sha256: file.sha256,
        createdAt,
      });
      logWrite("createArtefact", run.attemptId, stageRunId);
    },

    async projectFacts() {
      return facts;
    },
  };

  return {
    store,
    attempts,
    rows,
    artefacts,
    writes,
    refusals,
    job: () => job,
    now,
    /* --- explicit write paths a retry must never take ------------------ */

    /** A DELETE of a stage row. Refused for a closed attempt — nothing deletes one. */
    deleteStageRun(runId: string): void {
      const row = rows.find((r) => r.id === runId);
      if (!row) throw new Error(`no stage row ${runId}`);
      assertOpen(row.attemptId, "deleteStageRun");
      // Reachable only for an OPEN attempt, which no retry path ever targets.
      rows.splice(rows.indexOf(row), 1);
      logWrite("deleteStageRun", row.attemptId, runId);
    },

    /** A DELETE of an attempt row. Refused once the attempt has ended. */
    deleteAttempt(attemptId: string): void {
      const attempt = attemptOf(attemptId);
      if (!attempt) throw new Error(`no attempt ${attemptId}`);
      assertOpen(attemptId, "deleteAttempt");
      attempts.splice(attempts.indexOf(attempt), 1);
      logWrite("deleteAttempt", attemptId);
    },

    /** Writes logged against an attempt AFTER it ended — must always be empty. */
    writesAfterClose(attemptId: string): MemWrite[] {
      const at = closedAtIndex.get(attemptId);
      if (at === undefined) return [];
      return writes.filter((w) => w.attemptId === attemptId && w.seq > at);
    },

    /** A structural snapshot of one attempt's rows, for a before/after compare. */
    snapshot(attemptId: string): string {
      const a = attemptOf(attemptId);
      return JSON.stringify({
        attempt: a ?? null,
        rows: rows.filter((r) => r.attemptId === attemptId),
        artefacts: artefacts.filter((r) => r.attemptId === attemptId),
      });
    },

    rowsOf(attemptId: string): MemStageRow[] {
      return rows.filter((r) => r.attemptId === attemptId);
    },
  };
}

export type MemoryRenderStore = ReturnType<typeof memoryRenderStore>;

/** A real file on disk with its real byte count and digest, as a stage would return it. */
export function realStageFile(dir: string, name: string, body: string, artefactKind: string): StageFile {
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return { artefactKind, path, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
}
