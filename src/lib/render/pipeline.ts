/**
 * THE RENDER PIPELINE — one declaration, and the only one.
 *
 * From a finished project to a delivered master there are seven stages. This
 * file declares them in order, says what each one consumes and produces, gives
 * each one a weight, and says WHERE ITS RUNNABILITY COMES FROM: a probe id from
 * `./probes`, never a boolean typed here. The API, the worker, the UI and the
 * tests all read this list — so the page cannot describe a pipeline the runner
 * does not execute, and a stage cannot claim a capability the machine lacks.
 *
 * TWO KINDS OF OUTPUT, AND WHY THE DISTINCTION IS THE WHOLE POINT
 *   - `record` — the stage computes a PLAN and records it on its own stage row
 *     (counts, timings, a fingerprint). Plans are real work and are provable
 *     without a media tool: the timeline arithmetic, the mix plan and the
 *     subtitle plan are all computed by modules in this repo.
 *   - `file`   — the stage must leave a FILE on disk. A `file` stage that
 *     returns without writing one is marked FAILED by the runner
 *     (`./runner.ts`), and no artefact row is written for it. There is no
 *     third outcome, and no stage can "succeed" on a promise.
 *
 * The three `file` stages — encode, container/mux and checksum — are exactly
 * the ones this machine cannot run today: there is no `ffmpeg`, no `ffprobe`
 * and no keyed encode provider. They are therefore GATED, and the gate names
 * the missing input (`./probes` reports the errno). The pipeline as a whole
 * carries that through: a job stops at the first stage whose requisite is
 * absent, the later stages get NO row at all, and the job's status is derived
 * from the rows that exist (`deriveJobStatus`) instead of being stored as a
 * second, driftable field.
 */
import type { ProbeId } from "./probes";

/** Bump when the stage list or a weight changes: jobs record the version they ran under. */
export const PIPELINE_VERSION = "render-pipeline/1";

export type StageProduceKind = "record" | "file";

export interface StageProduce {
  kind: StageProduceKind;
  /** What it produces, in the product's own words. */
  label: string;
  /** For `file`: the artefact kind written to the RenderArtefact row. */
  artefactKind?: string;
}

export interface StageRequisiteRef {
  probeId: ProbeId;
  /** What the read-out calls the missing input when this probe fails. */
  missingLabel: string;
}

export interface RenderStage {
  id: string;
  /** 1-based position in the pipeline. Order is the execution order. */
  sequence: number;
  title: string;
  consumes: string[];
  produces: StageProduce;
  /** Contribution to the progress percentage. All weights sum to 100. */
  weight: number;
  /** ALL must pass before this stage may run. Empty = nothing external needed. */
  requires: StageRequisiteRef[];
  /** Probed and recorded in the evidence, but not gating (e.g. an alternative route). */
  reports?: ProbeId[];
  /** Also needs an earlier stage's artefact to exist on disk. */
  requiresArtefactOf?: { stageId: string; artefactKind: string; label: string };
  /** Why the stage exists and what it deliberately does NOT do. */
  note: string;
}

export const PIPELINE_STAGES: readonly RenderStage[] = [
  {
    id: "resolve-inputs",
    sequence: 1,
    title: "Resolve inputs",
    consumes: ["the project's Scene rows", "its script text", "its subtitle cues", "the requested export preset"],
    produces: { kind: "record", label: "render input manifest (counts + a SHA-256 fingerprint of the inputs)" },
    weight: 10,
    requires: [{ probeId: "project-has-scenes", missingLabel: "scenes on the project" }],
    note:
      "Reads what the project actually holds and fingerprints it. No file: this stage's output is the manifest recorded on its own stage row.",
  },
  {
    id: "assemble-timeline",
    sequence: 2,
    title: "Assemble timeline",
    consumes: ["the resolved scenes and their durations"],
    produces: { kind: "record", label: "ordered clip timeline (clip count, total duration, first/last marks)" },
    weight: 15,
    requires: [],
    note:
      "Cumulative timeline arithmetic over the project's own scene order. It plans the cut; it does not cut anything.",
  },
  {
    id: "audio-mix-plan",
    sequence: 3,
    title: "Audio mix plan",
    consumes: ["the voice, music and SFX the project has"],
    produces: { kind: "record", label: "audio mix plan from src/lib/mix (tracks, gains, loudness target)" },
    weight: 10,
    requires: [],
    note:
      "buildMix() computes the plan. The MIXDOWN itself needs an encoder, so no mixed audio file exists — the plan says so in its own record.",
  },
  {
    id: "subtitle-plan",
    sequence: 4,
    title: "Subtitle burn-in plan",
    consumes: ["the project's script text and subtitle cues"],
    produces: { kind: "record", label: "subtitle plan from src/lib/subtitles (cue count, timing model, style)" },
    weight: 10,
    requires: [],
    note:
      "buildSubtitles() plans the cues and their timing model. Burning them into pixels is the encode stage's job and is gated with it.",
  },
  {
    id: "encode-master",
    sequence: 5,
    title: "Encode master",
    consumes: ["the timeline", "the mix plan", "the subtitle plan", "a real encoder"],
    produces: { kind: "file", label: "master video file on disk, with bytes and SHA-256", artefactKind: "master-video" },
    weight: 35,
    requires: [
      { probeId: "storage-writable", missingLabel: "writable render storage" },
      { probeId: "ffmpeg-binary", missingLabel: "the ffmpeg binary" },
    ],
    reports: ["encode-provider-keyed"],
    note:
      "The first stage that must leave a file. It spawns ffmpeg with declared arguments and verifies the output exists with bytes > 0. No provider substitute is used today: the encode-provider probe is REPORTED, not gating, because the video_enhancement adapter does not take a whole timeline.",
  },
  {
    id: "container-mux",
    sequence: 6,
    title: "Container / mux",
    consumes: ["the master video file", "the planned audio and subtitle tracks"],
    produces: { kind: "file", label: "delivered container (MP4) with muxed tracks", artefactKind: "delivered-container" },
    weight: 15,
    requires: [
      { probeId: "storage-writable", missingLabel: "writable render storage" },
      { probeId: "ffmpeg-binary", missingLabel: "the ffmpeg binary" },
      { probeId: "ffprobe-binary", missingLabel: "the ffprobe binary" },
    ],
    requiresArtefactOf: { stageId: "encode-master", artefactKind: "master-video", label: "the encoded master file" },
    note:
      "Muxes the container and reads it back with ffprobe to confirm the streams it claims. Needs the encode stage's file to exist — which is why it can never run before it.",
  },
  {
    id: "checksum-artefact",
    sequence: 7,
    title: "Checksum & artefact record",
    consumes: ["the delivered container"],
    produces: { kind: "file", label: "SHA-256 sidecar next to the delivered container", artefactKind: "checksum-sidecar" },
    weight: 5,
    requires: [{ probeId: "storage-writable", missingLabel: "writable render storage" }],
    requiresArtefactOf: { stageId: "container-mux", artefactKind: "delivered-container", label: "the delivered container" },
    note:
      "Writes the checksum sidecar and records the delivered file's real bytes and digest. A digest over a file that does not exist is not written.",
  },
];

/** Total weight — asserted to be 100 by the tests, so a percentage means something. */
export const PIPELINE_WEIGHT_TOTAL = PIPELINE_STAGES.reduce((n, s) => n + s.weight, 0);

export function stageById(id: string): RenderStage | undefined {
  return PIPELINE_STAGES.find((s) => s.id === id);
}

/** The stage that must run next, given the stage ids that already have rows. */
export function nextStage(afterStageId: string | null): RenderStage | null {
  if (afterStageId === null) return PIPELINE_STAGES[0] ?? null;
  const current = stageById(afterStageId);
  if (!current) return null;
  return PIPELINE_STAGES.find((s) => s.sequence === current.sequence + 1) ?? null;
}

/* ------------------------------------------------------------------ */
/* Status and progress, DERIVED from the stage rows — never stored     */
/* ------------------------------------------------------------------ */

/** The state of one stage row. There is no sixth state. */
export type StageState = "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "STOPPED";

/** The job status a person sees. DERIVED, never a column. */
export type DerivedJobStatus = "queued" | "running" | "blocked" | "failed" | "stopped" | "succeeded";

export interface StageRowView {
  stageId: string;
  sequence: number;
  state: StageState;
}

/**
 * The job's status, computed from the stage rows that exist.
 *
 * Precedence is deliberate: a failure outranks a block (something ran and broke
 * is worse news than something that could not start), a block outranks a stop,
 * and `succeeded` requires EVERY declared stage to have a SUCCEEDED row — a
 * pipeline that stopped after four of seven stages is not "done" by any
 * reading. With no rows at all the job is `queued`, which is the only state a
 * job can be in before the worker touches it.
 */
export function deriveJobStatus(
  rows: readonly StageRowView[],
  stages: readonly RenderStage[] = PIPELINE_STAGES,
): DerivedJobStatus {
  if (rows.length === 0) return "queued";
  if (rows.some((r) => r.state === "FAILED")) return "failed";
  if (rows.some((r) => r.state === "BLOCKED")) return "blocked";
  if (rows.some((r) => r.state === "STOPPED")) return "stopped";
  if (rows.some((r) => r.state === "RUNNING")) return "running";
  const succeeded = new Set(rows.filter((r) => r.state === "SUCCEEDED").map((r) => r.stageId));
  const all = stages.every((s) => succeeded.has(s.id));
  return all ? "succeeded" : "running";
}

export interface ProgressReadout {
  /** 0-100, floor of earned weight / total weight. Never a timer, never a guess. */
  percent: number;
  earnedWeight: number;
  totalWeight: number;
  /** The arithmetic, printed: "45% = (10 + 15 + 10 + 10) / 100 …". */
  arithmetic: string;
  /** The stages that earned weight, in pipeline order. */
  countedStages: Array<{ stageId: string; weight: number }>;
  /** Stages with a row that did NOT earn weight, and why. */
  uncounted: Array<{ stageId: string; state: StageState; weight: number; why: string }>;
}

/**
 * Progress is the sum of the weights of stages whose row says SUCCEEDED, over
 * the total. A blocked or failed stage contributes nothing; a stage with no row
 * contributes nothing; nothing else contributes anything. The read-out prints
 * this arithmetic so a percentage can be checked by hand rather than trusted.
 */
export function deriveProgress(
  rows: readonly StageRowView[],
  stages: readonly RenderStage[] = PIPELINE_STAGES,
): ProgressReadout {
  const weightOf = (stageId: string) => stages.find((s) => s.id === stageId)?.weight ?? 0;
  const totalWeight = stages.reduce((n, s) => n + s.weight, 0);
  const counted = rows
    .filter((r) => r.state === "SUCCEEDED")
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => ({ stageId: r.stageId, weight: weightOf(r.stageId) }));
  const uncounted = rows
    .filter((r) => r.state !== "SUCCEEDED")
    .sort((a, b) => a.sequence - b.sequence)
    .map((r) => ({
      stageId: r.stageId,
      state: r.state,
      weight: weightOf(r.stageId),
      why: `${r.state} — a stage that did not succeed earns no weight`,
    }));
  const earnedWeight = counted.reduce((n, c) => n + c.weight, 0);
  const percent = Math.floor((earnedWeight / totalWeight) * 100);
  const sum = counted.length > 0 ? counted.map((c) => c.weight).join(" + ") : "0";
  const arithmetic =
    `${percent}% = (${sum}) / ${totalWeight} — weights of the ${counted.length} stage(s) that actually ` +
    `succeeded (${counted.map((c) => c.stageId).join(", ") || "none"}); no timer, no estimate, no animation`;
  return { percent, earnedWeight, totalWeight, arithmetic, countedStages: counted, uncounted };
}
