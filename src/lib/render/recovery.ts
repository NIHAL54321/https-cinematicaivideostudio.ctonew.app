/**
 * WHERE DOES A RETRY START? — computed from the rows, never chosen by hand.
 *
 * THE RULE. A retry begins at the FIRST DECLARED STAGE THAT DID NOT SUCCEED.
 * Everything before it is HONOURED: the work was done, it is recorded on an
 * earlier attempt's rows, and running it again would be doing the same work
 * twice and paying for it twice. Nothing after it has run.
 *
 * WHY IT IS COMPUTED RATHER THAN PASSED IN. "Resume at the stage that failed" is
 * a claim about history, so it is read from history: for each declared stage in
 * pipeline order, the LATEST row across every attempt decides. A stage whose
 * latest row says SUCCEEDED is honoured. The first stage whose latest row says
 * anything else — or that has no row at all — is where the new attempt starts.
 *
 * A SUCCEEDED FILE STAGE IS ONLY HONOURED IF ITS FILE IS STILL THERE. A row
 * saying "the master is at /tmp/…/master.mp4 with SHA-256 abc…" is worth nothing
 * if that file was wiped by a reset. Each honoured file stage's artefact is
 * re-hashed here, and when it does not match the row, the stage is NOT honoured
 * and the resume point moves back to it. That is why the same function serves
 * both the retry endpoint and the runner: the runner re-checks at the moment it
 * actually uses the file.
 *
 * WHAT THIS FUNCTION NEVER DOES. It reads. It does not write, delete, or edit any
 * attempt's rows — a retry is a new attempt beside the old one, and the old one
 * stays exactly as it was left.
 */
import type { RenderStage, StageState } from "./pipeline";

/** One stage row from any attempt of one job. */
export interface HistoryRow {
  attemptId: string;
  attemptNumber: number;
  stageId: string;
  sequence: number;
  state: StageState;
}

/** One artefact row from any attempt of one job. */
export interface HistoryArtefact {
  attemptId: string;
  stageId: string;
  kind: string;
  path: string;
  bytes: number;
  sha256: string;
}

/** What a real look at the file behind an artefact row found. */
export interface ArtefactProbeResult {
  present: boolean;
  bytes: number | null;
  sha256: string | null;
  /** The observation in words, always naming what was measured. */
  detail: string;
}

export type ArtefactProbe = (artefact: HistoryArtefact) => ArtefactProbeResult;

export interface HonouredStage {
  stageId: string;
  sequence: number;
  fromAttemptId: string;
  fromAttemptNumber: number;
  /** Why it is honoured, in words. */
  reason: string;
}

export interface ReusedArtefact {
  stageId: string;
  kind: string;
  path: string;
  bytes: number;
  sha256: string;
  fromAttemptId: string;
  fromAttemptNumber: number;
  /** The digest re-measured from the file at retry time. */
  measuredSha256: string | null;
  measuredBytes: number | null;
}

export interface RefusedReuse {
  stageId: string;
  kind: string;
  path: string;
  detail: string;
}

export interface ResumePoint {
  /**
   * The stage the next attempt must start at, or `null` when every declared
   * stage is already honoured (there is nothing to retry).
   */
  startStageId: string | null;
  honoured: HonouredStage[];
  reused: ReusedArtefact[];
  refused: RefusedReuse[];
  /** The arithmetic of the decision, printed for a reader to check. */
  basis: string;
}

/**
 * Compute the resume point for a job.
 *
 * `attempts` may be in any order; `rows` may contain several attempts' rows for
 * the same stage. The latest attempt wins.
 */
export function computeResumePoint(input: {
  stages: readonly RenderStage[];
  attempts: ReadonlyArray<{ id: string; attemptNumber: number }>;
  rows: readonly HistoryRow[];
  artefacts: readonly HistoryArtefact[];
  probe: ArtefactProbe;
}): ResumePoint {
  const { stages, attempts, rows, artefacts, probe } = input;
  const attemptNumberById = new Map(attempts.map((a) => [a.id, a.attemptNumber]));
  const ranked = rows
    .map((r) => ({ ...r, attemptNumber: attemptNumberById.get(r.attemptId) ?? r.attemptNumber }))
    .sort((a, b) => a.attemptNumber - b.attemptNumber || a.sequence - b.sequence);

  const honoured: HonouredStage[] = [];
  const reused: ReusedArtefact[] = [];
  const refused: RefusedReuse[] = [];
  let startStageId: string | null = null;
  let stoppedAt: string | null = null;

  for (const stage of stages) {
    const forStage = ranked.filter((r) => r.stageId === stage.id);
    const latest = forStage.length > 0 ? forStage[forStage.length - 1] : null;

    if (!latest) {
      startStageId = stage.id;
      stoppedAt = `"${stage.id}" has no row on any attempt, so it never ran`;
      break;
    }
    if (latest.state !== "SUCCEEDED") {
      startStageId = stage.id;
      stoppedAt = `"${stage.id}" is ${latest.state} on attempt ${latest.attemptNumber}`;
      break;
    }

    // A succeeded FILE stage is only honoured when the file it recorded is still
    // the file on disk.
    if (stage.produces.kind === "file") {
      const kind = stage.produces.artefactKind;
      const row = artefacts.find((a) => a.attemptId === latest.attemptId && a.kind === kind);
      if (!kind || !row) {
        startStageId = stage.id;
        refused.push({
          stageId: stage.id,
          kind: kind ?? "(the stage declares no artefact kind)",
          path: "(none recorded)",
          detail: `"${stage.id}" succeeded on attempt ${latest.attemptNumber} but no "${kind}" artefact row exists for that attempt, so there is no file to reuse`,
        });
        stoppedAt = `"${stage.id}" has no artefact row to reuse`;
        break;
      }
      const measured = probe(row);
      const matches =
        measured.present && measured.bytes === row.bytes && measured.sha256 === row.sha256;
      if (!matches) {
        startStageId = stage.id;
        refused.push({ stageId: stage.id, kind, path: row.path, detail: measured.detail });
        stoppedAt = `"${stage.id}" recorded a file that no longer matches its row (${measured.detail})`;
        break;
      }
      reused.push({
        stageId: stage.id,
        kind,
        path: row.path,
        bytes: row.bytes,
        sha256: row.sha256,
        fromAttemptId: row.attemptId,
        fromAttemptNumber: latest.attemptNumber,
        measuredSha256: measured.sha256,
        measuredBytes: measured.bytes,
      });
      honoured.push({
        stageId: stage.id,
        sequence: stage.sequence,
        fromAttemptId: latest.attemptId,
        fromAttemptNumber: latest.attemptNumber,
        reason: `SUCCEEDED on attempt ${latest.attemptNumber}; its "${kind}" file was re-measured at ${measured.bytes} bytes / ${String(measured.sha256).slice(0, 16)}… and matches the row, so the file is reused rather than produced again`,
      });
      continue;
    }

    honoured.push({
      stageId: stage.id,
      sequence: stage.sequence,
      fromAttemptId: latest.attemptId,
      fromAttemptNumber: latest.attemptNumber,
      reason: `SUCCEEDED on attempt ${latest.attemptNumber}; its recorded output stays on that attempt's row and is not recomputed`,
    });
  }

  const basis =
    startStageId === null
      ? `every one of the ${stages.length} declared stage(s) is honoured by a SUCCEEDED row with a usable artefact — there is nothing to retry`
      : `${honoured.length} of ${stages.length} declared stage(s) are honoured and will NOT run again (${honoured
          .map((h) => h.stageId)
          .join(", ") || "none"}); the retry starts at "${startStageId}" because ${stoppedAt}. ` +
        `${reused.length} file artefact(s) are reused and ${refused.length} could not be.`;

  return { startStageId, honoured, reused, refused, basis };
}
