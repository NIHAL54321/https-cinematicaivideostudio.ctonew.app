/**
 * WHAT THIS ACCOUNT HAS ACTUALLY PRODUCED — derived from its rows, every request
 * (Phase 8, block 11).
 *
 * WHY THIS MODULE EXISTS
 * Until block 11 the product said, on four surfaces, that no project's video had
 * been produced on this build. That sentence was true when it was written (block
 * 2b) and it stopped being true in block 10, when the pipeline encoded, muxed and
 * delivered a nine-scene project video and stored it durably. A hard-coded
 * absence is still a claim, and a claim that outlives its facts is a lie — the
 * exact failure this business has spent eight blocks guarding against, pointed
 * the other way.
 *
 * So the absence claim is gone and this derivation replaces it. Nothing here is
 * typed at a call site and nothing is cached:
 *
 *   - the DELIVERED CONTAINER is a `RenderArtefact` row of kind
 *     `delivered-container`, read through the same tenancy + synthetic rule the
 *     download centre uses (`src/lib/downloads/rule.ts`) — so this module cannot
 *     see a row a download could not serve;
 *   - every MEASURED property (duration, width, height, codec, profile, level,
 *     pixel format, frame rate, audio) is read from the job's own `container-mux`
 *     stage `output` JSON, which recorded what `ffprobe` said when the file was
 *     read back — not from a preset, and not from this file;
 *   - the DURABLE copy is read from that same stage row's `durable` object;
 *   - what the file does NOT contain is read from that row's `deliveryFacts`.
 *
 * A row that carries none of those fields produces a sentence that says so,
 * rather than a sentence that assumes. If the derivation cannot state something,
 * it states less.
 *
 * WHAT IT STILL REFUSES TO SAY
 * One fixture account on this deployment has a delivered container. That is not
 * "the product has produced videos for customers", not usage, not a live service
 * — none of which exist — and every sentence this module builds ends by saying
 * which rows it was derived from and that it is not evidence of any of them.
 *
 * The pure function (`deriveProductionStatement`) takes rows and returns text, so
 * a test can drive an empty account and a populated one through the same code and
 * require the words to follow the rows. `loadProductionStatement` is the thin
 * Prisma wrapper.
 */
import { prisma } from "@/lib/db";
import { deliverableWhereForUser } from "@/lib/downloads/rule";
import { syntheticProjectIds as loadSyntheticProjectIds } from "@/lib/render/synthetic-projects";

/** The artefact kind a delivered video is recorded under. */
export const DELIVERED_ARTEFACT_KIND = "delivered-container";

/** The stage whose `output` records ffprobe's read-back of the delivered file. */
export const MUX_STAGE_ID = "container-mux";

/* ------------------------------------------------------------------ */
/* The rows, as this module needs them                                 */
/* ------------------------------------------------------------------ */

/** What `ffprobe` said when the delivered file was read back (mux stage output). */
export interface MeasuredFileFacts {
  durationSeconds: number | null;
  widthPx: number | null;
  heightPx: number | null;
  videoCodec: string | null;
  profile: string | null;
  /** ffprobe's own integer (`level=40`), never converted to a marketing label. */
  level: number | null;
  pixelFormat: string | null;
  frameRate: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioSampleRateHz: number | null;
  /** The command the numbers were read with, from the row. */
  measuredBy: string | null;
}

/** The durable copy the mux stage recorded storing. */
export interface DurableCopyFact {
  bucket: string;
  key: string;
  objectBytes: number | null;
  /** True only when the stage recorded reading the object back out and hashing it. */
  verified: boolean;
}

/** What the mux stage recorded the file does NOT contain. */
export interface DeliveryAbsences {
  narration: string | null;
  music: string | null;
  subtitles: string | null;
  screening: string | null;
  aiGeneration: string | null;
}

/** One delivered container, with everything the row says about it. */
export interface DeliveredVideoRow {
  jobId: string;
  projectId: string;
  projectTitle: string;
  presetId: string;
  presetLabel: string;
  /** Bytes the artefact row records. */
  bytes: number;
  /** SHA-256 the artefact row records. */
  sha256: string;
  createdAt: string;
  measured: MeasuredFileFacts | null;
  durable: DurableCopyFact | null;
  absences: DeliveryAbsences | null;
}

/** Which rows the statement is about. */
export type ProductionScope =
  | { kind: "account" }
  | { kind: "project"; projectId: string; projectTitle: string };

export interface ProductionStatement {
  scope: "account" | "project";
  /** True only when the derivation found a delivered-container row. */
  exists: boolean;
  count: number;
  /** A short line for a heading or a badge. */
  headline: string;
  /** The paragraph a surface prints. Built from the rows, never typed. */
  sentence: string;
  /** One line per delivered container: its job, its bytes, its digest, its measurements. */
  deliveryLines: string[];
  /** What the file does not contain — from the mux stage's own `deliveryFacts`. */
  absenceLines: string[];
  /** The job ids this statement was derived from, so a reader can check it. */
  jobIds: string[];
}

/* ------------------------------------------------------------------ */
/* Formatting — one way to print a number                              */
/* ------------------------------------------------------------------ */

function group(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function bytesLabel(bytes: number | null): string {
  return bytes === null || !Number.isFinite(bytes) ? "a size the row does not record" : `${group(bytes)} B`;
}

function secondsLabel(seconds: number | null): string {
  return seconds === null || !Number.isFinite(seconds) ? "a duration the row does not record" : `${seconds.toFixed(3)} s`;
}

/** One measurement line per delivered container, from the row alone. */
function deliveryLineFor(row: DeliveredVideoRow): string {
  const m = row.measured;
  const facts = m
    ? [
        secondsLabel(m.durationSeconds),
        m.widthPx !== null && m.heightPx !== null ? `${m.widthPx}×${m.heightPx}` : "dimensions the row does not record",
        m.videoCodec ? `${m.videoCodec}${m.profile ? ` ${m.profile}` : ""}${m.level !== null ? ` (ffprobe level=${m.level})` : ""}` : "a codec the row does not record",
        m.pixelFormat ?? "a pixel format the row does not record",
        m.frameRate ? `${m.frameRate} fps` : "a frame rate the row does not record",
        m.audioCodec
          ? `${m.audioCodec}${m.audioChannels !== null ? ` ${m.audioChannels} ch` : ""}${m.audioSampleRateHz !== null ? ` ${group(m.audioSampleRateHz)} Hz` : ""}`
          : "an audio codec the row does not record",
      ].join(", ")
    : "no measurement: the job's container-mux stage recorded no ffprobe read-back, so this surface states none";

  const durable = row.durable
    ? ` Stored durably at bucket ${row.durable.bucket}, key ${row.durable.key} (${bytesLabel(row.durable.objectBytes)}` +
      `${row.durable.verified ? ", read back out and hashed at mux time" : ", which the stage did not record verifying"}).`
    : " No durable copy is recorded on the job's mux stage.";

  return (
    `Project "${row.projectTitle}" — job ${row.jobId}, preset ${row.presetId} (${row.presetLabel}): ` +
    `${bytesLabel(row.bytes)}, sha256 ${row.sha256.slice(0, 16)}…, measured by the job's own container-mux stage as ${facts}.` +
    durable
  );
}

/** What the file does not contain, in the mux stage's own words. */
function absenceLinesFor(row: DeliveredVideoRow): string[] {
  const a = row.absences;
  if (!a || (!a.narration && !a.music && !a.subtitles && !a.screening && !a.aiGeneration)) {
    return [
      `Job ${row.jobId} recorded no statement of what its delivered file does not contain, so this surface states nothing ` +
        `about its contents beyond the measurements above — and its silence is not a claim that narration, music, subtitles ` +
        `or a screening are in it.`,
    ];
  }
  const lines: string[] = [];
  if (a.aiGeneration) lines.push(`Picture: ${a.aiGeneration}.`);
  if (a.narration) lines.push(`Narration: ${a.narration}.`);
  if (a.music) lines.push(`Music and sound effects: ${a.music}.`);
  if (a.subtitles) lines.push(`Subtitles: ${a.subtitles}.`);
  if (a.screening) lines.push(`Screening: ${a.screening}.`);
  return lines;
}

/* ------------------------------------------------------------------ */
/* The derivation — pure, over rows                                    */
/* ------------------------------------------------------------------ */

/**
 * The statement for these rows. Every sentence it returns is a function of the
 * rows passed in: hand it none and it says none; hand it one and it names that
 * one, with that row's bytes, digest and measurements. A negative control in
 * `__tests__/production-state.test.ts` drives both through this same function.
 */
export function deriveProductionStatement(
  rows: readonly DeliveredVideoRow[],
  scope: ProductionScope,
): ProductionStatement {
  const delivered = rows.filter((r) => typeof r.bytes === "number" && r.sha256.length === 64);
  const forPhrase = scope.kind === "account" ? "this account" : `project "${scope.projectTitle}"`;

  if (delivered.length === 0) {
    return {
      scope: scope.kind,
      exists: false,
      count: 0,
      headline: scope.kind === "account" ? "No delivered video for this account" : "No delivered video for this project",
      sentence:
        `No delivered container exists for ${forPhrase} in the rows read for this request: no RenderArtefact row of kind ` +
        `"${DELIVERED_ARTEFACT_KIND}" belongs to any of ${scope.kind === "account" ? "this account's" : "this project's"} ` +
        `non-synthetic render jobs. What stopped a render is stated on that job's own stage rows — the download centre prints ` +
        `it, stage by stage — and no file is invented here to fill the gap.`,
      deliveryLines: [],
      absenceLines: [],
      jobIds: [],
    };
  }

  const deliveryLines = delivered.map(deliveryLineFor);
  const absenceLines = delivered.flatMap(absenceLinesFor);
  const jobIds = delivered.map((r) => r.jobId);

  const countPhrase =
    delivered.length === 1
      ? `One delivered container exists for ${forPhrase}`
      : `${delivered.length} delivered containers exist for ${forPhrase}`;

  const sentence =
    `${countPhrase}, read from ${scope.kind === "account" ? "this account's" : "this project's"} own RenderArtefact and ` +
    `RenderStageRun rows on this request — not from a template, a flag or a preset. ` +
    `${deliveryLines.join(" ")} ` +
    `What it does not contain: ${absenceLines.join(" ")} ` +
    `Nothing in this paragraph is evidence of customers, usage, revenue or a live service: it describes rows that belong to ` +
    `the account signed in, on this deployment, and nothing else.`;

  return {
    scope: scope.kind,
    exists: true,
    count: delivered.length,
    headline:
      delivered.length === 1
        ? "1 delivered video exists for this account"
        : `${delivered.length} delivered videos exist for this account`,
    sentence,
    deliveryLines,
    absenceLines,
    jobIds,
  };
}

/* ------------------------------------------------------------------ */
/* Reading the rows out of a mux stage's output JSON                   */
/* ------------------------------------------------------------------ */
type Json = Record<string, unknown> | null;

function obj(value: unknown): Json {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The measured facts out of a `container-mux` (or `encode-master`) stage output.
 * The mux stage writes `ffprobeReadBack`; the encode stage writes `measured`.
 * Both are the encoder's own read-back, so either is a measurement — this reads
 * the mux one first because it measured the file that was DELIVERED.
 */
export function measuredFromStageOutput(output: unknown): MeasuredFileFacts | null {
  const root = obj(output);
  if (!root) return null;
  const probe = obj(root.ffprobeReadBack) ?? obj(root.measured);
  if (!probe) return null;
  const video = obj(probe.video);
  const audio = obj(probe.audio);
  const facts: MeasuredFileFacts = {
    durationSeconds: num(probe.durationSeconds),
    widthPx: num(video?.widthPx),
    heightPx: num(video?.heightPx),
    videoCodec: str(video?.codecName),
    profile: str(video?.profile),
    level: num(video?.level),
    pixelFormat: str(video?.pixFmt),
    frameRate: str(video?.avgFrameRate),
    audioCodec: str(audio?.codecName),
    audioChannels: num(audio?.channels),
    audioSampleRateHz: num(audio?.sampleRateHz),
    measuredBy: str(probe.measuredBy) ?? "ffprobe, read back from the file (the stage recorded no command line)",
  };
  const anyFact = Object.entries(facts).some(([k, v]) => k !== "measuredBy" && v !== null);
  return anyFact ? facts : null;
}

/** The durable copy the mux stage recorded storing, if it recorded one. */
export function durableFromStageOutput(output: unknown): DurableCopyFact | null {
  const root = obj(output);
  if (!root) return null;
  const durable = obj(root.durable);
  if (!durable) return null;
  const bucket = str(durable.bucket);
  const key = str(durable.key);
  if (!bucket || !key) return null;
  return {
    bucket,
    key,
    objectBytes: num(durable.objectBytesInStorage) ?? num(durable.bytes),
    verified: durable.verified === true,
  };
}

/** What the mux stage recorded the delivered file does not contain. */
export function absencesFromStageOutput(output: unknown): DeliveryAbsences | null {
  const root = obj(output);
  if (!root) return null;
  const facts = obj(root.deliveryFacts);
  if (!facts) return null;
  const absences: DeliveryAbsences = {
    narration: str(facts.narration),
    music: str(facts.music),
    subtitles: str(facts.subtitles),
    screening: str(facts.screening),
    aiGeneration: str(facts.aiGeneration),
  };
  return absences;
}

/* ------------------------------------------------------------------ */
/* When the rows cannot be read at all                                 */
/* ------------------------------------------------------------------ */

/**
 * The statement a surface prints when the query itself failed. It says exactly
 * that, and nothing about output — a read failure is not evidence of absence,
 * and the block-2b mistake was reading a typed absence into everything.
 */
export function unreadableProductionStatement(scope: ProductionScope = { kind: "account" }): ProductionStatement {
  return {
    scope: scope.kind,
    exists: false,
    count: 0,
    headline: "Whether a delivered video exists could not be read on this request",
    sentence:
      "This surface could not read the render rows for this account on this request, so it states nothing about whether a " +
      "delivered video exists — a failed read is not evidence that none does. Reload the page, or open the download centre, " +
      "which reads the same rows.",
    deliveryLines: [],
    absenceLines: [],
    jobIds: [],
  };
}

/* ------------------------------------------------------------------ */
/* The Prisma wrapper                                                  */
/* ------------------------------------------------------------------ */

const MAX_DELIVERIES = 20;

/**
 * The statement for an account (or one of its projects), read now.
 *
 * Tenancy and the synthetic exclusion come from `deliverableWhereForUser` — the
 * same rule the download centre and the download route use — so a row this
 * cannot see is a row no download could serve either.
 */
export async function loadProductionStatement(input: {
  userId: string;
  projectId?: string | null;
  projectTitle?: string | null;
}): Promise<ProductionStatement> {
  const scope: ProductionScope =
    input.projectId != null
      ? { kind: "project", projectId: input.projectId, projectTitle: input.projectTitle ?? input.projectId }
      : { kind: "account" };

  const syntheticIds = await loadSyntheticProjectIds(input.userId);
  const base = deliverableWhereForUser(input.userId, syntheticIds, [DELIVERED_ARTEFACT_KIND]);
  const where =
    scope.kind === "project" ? { ...base, job: { ...base.job, projectId: scope.projectId } } : base;

  const artefacts = await prisma.renderArtefact.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: MAX_DELIVERIES,
    include: {
      job: {
        select: {
          id: true,
          projectId: true,
          presetId: true,
          presetLabel: true,
          project: { select: { id: true, title: true } },
        },
      },
    },
  });

  if (artefacts.length === 0) return deriveProductionStatement([], scope);

  const jobIds = artefacts.map((a) => a.jobId);
  // The mux stage measured the DELIVERED file. A retried job has one row per
  // attempt, so the newest SUCCEEDED row per job is the one that describes the
  // file the artefact row belongs to.
  const stageRows = await prisma.renderStageRun.findMany({
    where: { jobId: { in: jobIds }, stageId: MUX_STAGE_ID, state: "SUCCEEDED" },
    orderBy: { startedAt: "desc" },
    select: { jobId: true, output: true },
  });
  const muxByJob = new Map<string, unknown>();
  for (const row of stageRows) {
    if (!muxByJob.has(row.jobId)) muxByJob.set(row.jobId, row.output);
  }

  const rows: DeliveredVideoRow[] = artefacts.map((a) => {
    const output = muxByJob.get(a.jobId) ?? null;
    return {
      jobId: a.jobId,
      projectId: a.job.projectId,
      projectTitle: a.job.project.title,
      presetId: a.job.presetId,
      presetLabel: a.job.presetLabel,
      bytes: a.bytes,
      sha256: a.sha256,
      createdAt: a.createdAt.toISOString(),
      measured: measuredFromStageOutput(output),
      durable: durableFromStageOutput(output),
      absences: absencesFromStageOutput(output),
    };
  });

  return deriveProductionStatement(rows, scope);
}
