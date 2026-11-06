/**
 * THE DOWNLOAD CENTRE (Phase 8, block 3).
 *
 * "What has been produced for my projects, and can I have it?" There are exactly
 * four honest answers on this build, and every one of them is derived from a row
 * plus a `stat()` — never from a flag, a template or a hope:
 *
 *   nothing produced yet  — the reason comes from the job's own stage rows: the
 *                           stage that stopped and the input it named.
 *   produced and present  — the artefact row plus a file on disk at its recorded
 *                           size. The digest is re-checked at download time.
 *   produced but gone     — the artefact row, no file. Render output lives in
 *                           /tmp/cavs-render-output, which a machine reset wipes,
 *                           so this state is expected and is stated plainly. The
 *                           recorded bytes and SHA-256 are shown because they are
 *                           still true things the job produced.
 *   synthetic proof       — NEVER in this list. Excluded by `rule.ts`, which is
 *                           the same rule the render list and the project
 *                           selectors use; the proof read-out is a separate,
 *                           labelled surface.
 *
 * The derivation is a PURE function over rows + disk facts so a test can drive all
 * four states without a database or a running server; `loadDownloadCentre` is the
 * thin Prisma/`stat` wrapper around it.
 */
import { prisma } from "@/lib/db";
import {
  excludeSyntheticProjects,
  syntheticProjectIds as loadSyntheticProjectIds,
} from "@/lib/render/synthetic-projects";
import { listRenderJobs, type RenderReadout } from "@/lib/render/service";
import {
  PRIMARY_ARTEFACT_KINDS,
  SIDECAR_ARTEFACT_KIND,
  deliverableWhereForUser,
  isDeliverableRow,
} from "./rule";
import { checkOnDisk } from "./verify";
import { deliveryObjectKey } from "@/lib/render/delivery-store";
import { statObjectSize, storageBucket, storageIsConfigured } from "@/lib/storage";

/* ------------------------------------------------------------------ */
/* Filenames                                                           */
/* ------------------------------------------------------------------ */

/** A filename a person can read in a downloads folder and recognise. */
export function slugify(value: string, max = 60): string {
  const slug = (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "untitled").slice(0, max).replace(/-+$/g, "");
}

const KIND_FILENAME: Record<string, string> = {
  "delivered-container": "delivered",
  "master-video": "master",
  "checksum-sidecar": "sha256",
};

function extensionFor(path: string, kind: string): string {
  if (kind === SIDECAR_ARTEFACT_KIND) return "sha256";
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return ext;
  return "mp4";
}

/**
 * `<project>--<preset>--<what>.<ext>`. A synthetic proof carries a filename that
 * says so before a byte is written, so renaming the download cannot make it look
 * like a project's video.
 */
export function downloadFilename(input: {
  projectTitle: string;
  presetId: string;
  kind: string;
  path: string;
  synthetic?: boolean;
}): string {
  const parts = [
    slugify(input.projectTitle),
    slugify(input.presetId, 32),
    KIND_FILENAME[input.kind] ?? slugify(input.kind, 24),
  ];
  const stem = parts.join("--");
  const prefix = input.synthetic === true ? "SYNTHETIC-PROOF--" : "";
  return `${prefix}${stem}.${extensionFor(input.path, input.kind)}`;
}

/* ------------------------------------------------------------------ */
/* Numbers, printed the same way everywhere                            */
/* ------------------------------------------------------------------ */

export function fmtBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  return `${String(Math.trunc(bytes)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} B`;
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

export type DeliverableState = "present" | "durable" | "gone" | "altered";

/**
 * WHERE THE BYTES ACTUALLY ARE (Phase 8 block 11).
 *
 * Until block 11 a file that was BOTH on this machine and stored in object
 * storage read only as `present`, and the summary counted one copy — so the
 * durable copy the pipeline really made was invisible. `state` still says which
 * copy is being served (the local one, when it is there, because that is what the
 * download reads first); `copies` says where every copy is, so a reader is told
 * both facts instead of the louder one.
 */
export type CopyLocation = "local-and-durable" | "local" | "durable" | "none";

export interface DeliverableFile {
  artefactId: string;
  jobId: string;
  projectId: string;
  projectTitle: string;
  presetId: string;
  presetLabel: string;
  kind: string;
  kindLabel: string;
  path: string;
  recordedBytes: number;
  recordedSha256: string;
  createdAt: string;
  state: DeliverableState;
  /** Where every copy of these bytes is — local, durable, both, or neither. */
  copies: CopyLocation;
  /** The durable copy's own location, when one was found at the recorded size. */
  durableCopy: { key: string; bucket: string; objectBytes: number | null } | null;
  diskBytes: number | null;
  filename: string;
  /** The download, through this app's own route. */
  href: string;
  /** The digest sidecar's own download — null unless the sidecar is on disk too. */
  sidecarHref: string | null;
  sidecarArtefactId: string | null;
  /** The sidecar row's own state: null when the job wrote no sidecar. */
  sidecarState: DeliverableState | null;
  sidecarBytes: number | null;
  /** One honest sentence about these bytes, in this state. */
  sentence: string;
}

export type AwaitingReasonCode = "no-render" | "blocked" | "failed" | "running" | "stopped" | "succeeded-no-file";

export interface AwaitingProject {
  projectId: string;
  projectTitle: string;
  jobId: string | null;
  jobStatus: string | null;
  reasonCode: AwaitingReasonCode;
  missingStage: string | null;
  missingInput: string | null;
  sentence: string;
}

export interface DownloadCentreView {
  files: DeliverableFile[];
  awaiting: AwaitingProject[];
  counts: {
    total: number;
    present: number;
    durable: number;
    gone: number;
    altered: number;
    /** Present locally AND stored durably — counted once in each of the two above, and named here. */
    presentAndDurable: number;
    /** Present locally with no durable copy recorded. */
    localOnly: number;
    projectsAwaiting: number;
    bytesPresent: number;
  };
  /** The summary sentence, built from the counts — so the page cannot drift from them. */
  summary: string;
  /** Present only when there is genuinely nothing to download. */
  emptyState: { headline: string; reason: string; note: string } | null;
}

export interface ArtefactRow {
  id: string;
  jobId: string;
  stageId: string;
  kind: string;
  path: string;
  bytes: number;
  sha256: string;
  syntheticProof: boolean;
  createdAt: Date;
  job: {
    id: string;
    userId: string;
    presetId: string;
    presetLabel: string;
    syntheticProof: boolean;
    project: { id: string; title: string; deletedAt: Date | null };
  };
}

export interface DiskFact {
  present: boolean;
  diskBytes: number | null;
  sizeMatches: boolean;
}

const KIND_LABEL: Record<string, string> = {
  "delivered-container": "Delivered container",
  "master-video": "Encoded master",
  "checksum-sidecar": "Digest sidecar (sha256sum format)",
};

/** The stage's own words for what it stopped for, or null. */
function firstStoppedStage(job: RenderReadout) {
  const stopped = job.stages.find((s) => s.state === "BLOCKED") ?? job.stages.find((s) => s.state === "FAILED");
  return stopped ?? null;
}

/**
 * The reason a project has nothing to download — built ONLY from what the job's
 * stage rows say. No stage ran → no claim is made about why.
 */
export function awaitingFromJob(job: RenderReadout | null, project: { id: string; title: string }): AwaitingProject {
  const base = { projectId: project.id, projectTitle: project.title };
  if (!job) {
    return {
      ...base,
      jobId: null,
      jobStatus: null,
      reasonCode: "no-render",
      missingStage: null,
      missingInput: null,
      sentence:
        `No render has been requested for this project, so nothing has been produced to download. Whether a ` +
        `render would produce a file is not predicted here: its own stage rows say what happened, stage by stage.`,
    };
  }
  const jobRef = `Render job ${job.job.id} (${job.job.presetLabel})`;
  const stop = firstStoppedStage(job);
  if (job.status === "blocked" && stop) {
    return {
      ...base,
      jobId: job.job.id,
      jobStatus: job.status,
      reasonCode: "blocked",
      missingStage: stop.id,
      missingInput: stop.missingInput,
      sentence:
        `${jobRef} stopped at the ${stop.title} stage, naming the missing input: ` +
        `"${stop.missingInput ?? stop.note ?? "an input this stage requires"}". No file was produced, so ` +
        `there is nothing to download.`,
    };
  }
  if (job.status === "failed" && stop) {
    return {
      ...base,
      jobId: job.job.id,
      jobStatus: job.status,
      reasonCode: "failed",
      missingStage: stop.id,
      missingInput: stop.missingInput,
      sentence:
        `${jobRef} failed at the ${stop.title} stage: ${stop.errorMessage ?? stop.note ?? "the stage reported a failure"}` +
        ` No file was produced, so there is nothing to download.`,
    };
  }
  if (job.status === "stopped") {
    return {
      ...base,
      jobId: job.job.id,
      jobStatus: job.status,
      reasonCode: "stopped",
      missingStage: stop?.id ?? null,
      missingInput: stop?.missingInput ?? null,
      sentence:
        `${jobRef} was stopped${job.job.stopReason ? ` (${job.job.stopReason})` : ""} before it produced a file, ` +
        `so there is nothing to download.`,
    };
  }
  if (job.status === "succeeded") {
    return {
      ...base,
      jobId: job.job.id,
      jobStatus: job.status,
      reasonCode: "succeeded-no-file",
      missingStage: null,
      missingInput: null,
      sentence:
        `${jobRef} reports every stage succeeded but recorded no artefact row, so there is no file to ` +
        `download and none is invented to fill the gap.`,
    };
  }
  return {
    ...base,
    jobId: job.job.id,
    jobStatus: job.status,
    reasonCode: "running",
    missingStage: null,
    missingInput: null,
    sentence: `${jobRef} is ${job.status} — it has not produced a file yet. Nothing is listed until it does.`,
  };
}

/**
 * The whole surface, derived. `disk` is keyed by artefact id; a missing entry is
 * treated as "not checked", which can only ever downgrade a row to `gone`, never
 * upgrade it to `present`.
 */
export function deriveDownloadCentre(input: {
  userId: string;
  syntheticProjectIds: readonly string[];
  artefacts: readonly ArtefactRow[];
  sidecars: readonly ArtefactRow[];
  jobs: readonly RenderReadout[];
  projects: readonly { id: string; title: string }[];
  disk: Readonly<Record<string, DiskFact>>;
  /**
   * The durable copies found in object storage, keyed by artefact id (block 8).
   * A row whose local file is gone but whose object is stored at the recorded size
   * is `durable`, not `gone` — the user can still have the bytes, and saying
   * otherwise would be the same kind of lie as offering a file that is not there.
   */
  durable?: Readonly<Record<string, { key: string; bucket: string; objectBytes: number | null }>>;
  /** Disk facts for the sidecar rows, keyed by artefact id. Absent = not checked. */
  sidecarDisk?: Readonly<Record<string, DiskFact>>;
}): DownloadCentreView {
  const sidecarByJob = new Map(input.sidecars.map((s) => [s.jobId, s]));

  const files: DeliverableFile[] = [];
  for (const a of input.artefacts) {
    // The rule again, on rows a query already returned — see rule.ts.
    if (!isDeliverableRow(a, input.userId, input.syntheticProjectIds)) continue;
    if (!(PRIMARY_ARTEFACT_KINDS as readonly string[]).includes(a.kind)) continue;
    const fact = input.disk[a.id];
    const durableFact = input.durable?.[a.id] ?? null;
    const durableHoldsRecordedBytes = durableFact !== null && durableFact.objectBytes === a.bytes;
    const state: DeliverableState = fact && fact.present
      ? fact.sizeMatches
        ? "present"
        : "altered"
      : durableHoldsRecordedBytes
        ? "durable"
        : "gone";
    const sidecar = sidecarByJob.get(a.jobId) ?? null;
    const sidecarFact = sidecar ? input.sidecarDisk?.[sidecar.id] : undefined;
    const sidecarState: DeliverableState | null = !sidecar
      ? null
      : !sidecarFact || !sidecarFact.present
        ? "gone"
        : sidecarFact.sizeMatches
          ? "present"
          : "altered";
    // A sidecar link is offered only when the sidecar's own bytes are on disk at
    // the recorded size — a link to a file that is gone is the same lie as a
    // download of one.
    const sidecarHref = sidecar && sidecarState === "present" ? `/api/studio/downloads/${sidecar.id}/sidecar` : null;
    /* Block 11: a local file does not erase the durable copy. Both facts are
     * carried, and the sentence says both — the summary counts both. */
    const copies: CopyLocation =
      fact && fact.present && fact.sizeMatches && durableHoldsRecordedBytes
        ? "local-and-durable"
        : fact && fact.present
          ? "local"
          : durableHoldsRecordedBytes
            ? "durable"
            : "none";
    const durableCopy = durableHoldsRecordedBytes ? durableFact : null;
    const durableClause = durableCopy
      ? ` The same bytes are also stored durably in this deployment's own object storage at ${durableCopy.key} ` +
        `(${fmtBytes(durableCopy.objectBytes)}, the recorded size), so a reset that wipes /tmp does not lose them.`
      : "";
    const sentence =
      state === "present"
        ? `On this machine: ${fmtBytes(fact.diskBytes)} at the recorded size. The SHA-256 is checked against ` +
          `the recorded ${a.sha256.slice(0, 16)}… when you download, and the download is refused if it differs.` +
          durableClause
        : state === "durable"
          ? `Not on this machine's disk, but stored durably in this deployment's own object storage at ` +
            `${durableFact?.key} (${fmtBytes(durableFact?.objectBytes ?? null)}, the recorded size). The download ` +
            `fetches that copy back, checks it against the recorded SHA-256 ${a.sha256.slice(0, 16)}… and refuses ` +
            `it if the bytes differ.`
          : state === "altered"
            ? `A file is at the recorded path but it is ${fmtBytes(fact?.diskBytes ?? null)}, not the ` +
              `${fmtBytes(a.bytes)} the job recorded. It is not served in this state.` +
              durableClause
            : `Job ${a.jobId} produced ${fmtBytes(a.bytes)} with SHA-256 ${a.sha256}, and the file is no longer ` +
              `on this machine. Render output lives in /tmp/cavs-render-output, which a machine reset wipes; the ` +
              `record above is what was produced, and no file is served in its place.`;
    files.push({
      artefactId: a.id,
      jobId: a.jobId,
      projectId: a.job.project.id,
      projectTitle: a.job.project.title,
      presetId: a.job.presetId,
      presetLabel: a.job.presetLabel,
      kind: a.kind,
      kindLabel: KIND_LABEL[a.kind] ?? a.kind,
      path: a.path,
      recordedBytes: a.bytes,
      recordedSha256: a.sha256,
      createdAt: a.createdAt.toISOString(),
      state,
      copies,
      durableCopy,
      diskBytes: fact?.present ? fact.diskBytes : null,
      filename: downloadFilename({
        projectTitle: a.job.project.title,
        presetId: a.job.presetId,
        kind: a.kind,
        path: a.path,
      }),
      href: `/api/studio/downloads/${a.id}`,
      sidecarHref,
      sidecarArtefactId: sidecar?.id ?? null,
      sidecarState,
      sidecarBytes: sidecar?.bytes ?? null,
      sentence,
    });
  }

  // A project that has a deliverable is answered; a project that has none gets the
  // reason its own latest job gives, or the honest "no render has been requested".
  const projectsWithFiles = new Set(files.map((f) => f.projectId));
  const jobsByProject = new Map<string, RenderReadout[]>();
  for (const job of input.jobs) {
    if (job.job.syntheticProof) continue;
    const list = jobsByProject.get(job.job.projectId) ?? [];
    list.push(job);
    jobsByProject.set(job.job.projectId, list);
  }
  const awaiting: AwaitingProject[] = [];
  for (const project of input.projects) {
    if (projectsWithFiles.has(project.id)) continue;
    const jobs = (jobsByProject.get(project.id) ?? [])
      .slice()
      .sort((a, b) => b.job.requestedAt.localeCompare(a.job.requestedAt));
    awaiting.push(awaitingFromJob(jobs[0] ?? null, project));
  }

  const present = files.filter((f) => f.state === "present");
  const durable = files.filter((f) => f.state === "durable");
  const gone = files.filter((f) => f.state === "gone");
  const altered = files.filter((f) => f.state === "altered");
  /* Block 11: a row can be in BOTH places. Counting it only as `present` hid the
   * durable copy the pipeline actually made, so the two are counted separately
   * and the overlap is named rather than dropped. */
  const presentAndDurable = present.filter((f) => f.durableCopy !== null);
  const counts = {
    total: files.length,
    present: present.length,
    durable: durable.length,
    gone: gone.length,
    altered: altered.length,
    presentAndDurable: presentAndDurable.length,
    localOnly: present.length - presentAndDurable.length,
    projectsAwaiting: awaiting.length,
    /** Bytes a user can actually have right now: on this disk, or in durable storage. */
    bytesPresent: [...present, ...durable].reduce((n, f) => n + f.recordedBytes, 0),
  };

  const emptyState =
    files.length === 0
      ? {
          headline: "Nothing has been produced for you yet, so there is nothing to download.",
          reason:
            `No delivered container belongs to this account in the rows read for this request. The reasons below ` +
            `are read from each project's own render job and its stage rows — not written for this page.`,
          note:
            `No placeholder row, sample file, disabled link or greyed-out entry stands in for a file: a download ` +
            `centre that listed something you could not download would be lying about what exists.`,
        }
      : null;

  return { files, awaiting, counts, summary: summarySentence(counts), emptyState };
}

/**
 * The summary sentence, built from the counts and nothing else. It names BOTH
 * copies of a row that has both — the under-count block 11 fixed — and it is
 * generated here so the page cannot drift from the numbers beside it.
 */
export function summarySentence(counts: DownloadCentreView["counts"]): string {
  const rows = `${counts.total} artefact row${counts.total === 1 ? "" : "s"} for your projects`;
  const local = `${counts.localOnly} present on this machine only`;
  const both = `${counts.presentAndDurable} present on this machine AND stored durably in object storage`;
  const durableOnly = `${counts.durable} stored durably in object storage only`;
  const gonePart = `${counts.gone} whose file is gone`;
  const alteredPart = `${counts.altered} not at the recorded size`;
  const available = `${fmtBytes(counts.bytesPresent)} in total can be downloaded right now`;
  const copies =
    counts.presentAndDurable > 0
      ? `${counts.present} on this machine (${counts.presentAndDurable} of them also stored durably in object storage), ${durableOnly}`
      : `${local}, ${durableOnly}`;
  return (
    `${rows}: ${copies}, ${gonePart}, ${alteredPart}. ${available}.` +
    (counts.presentAndDurable > 0
      ? ` ${both} — one copy on disk, one in object storage, both of the same bytes at the recorded size.`
      : "")
  );
}

/* ------------------------------------------------------------------ */
/* The Prisma + stat wrapper                                           */
/* ------------------------------------------------------------------ */

const MAX_ARTEFACTS = 200;

const artefactInclude = {
  job: {
    select: {
      id: true,
      userId: true,
      presetId: true,
      presetLabel: true,
      syntheticProof: true,
      project: { select: { id: true, title: true, deletedAt: true } },
    },
  },
} as const;

export async function loadDownloadCentre(input: { userId: string }): Promise<DownloadCentreView> {
  const userId = input.userId;
  const syntheticIds = await loadSyntheticProjectIds(userId);

  const [artefacts, sidecars, jobsReadout, projectsRaw] = await Promise.all([
    prisma.renderArtefact.findMany({
      where: deliverableWhereForUser(userId, syntheticIds),
      include: artefactInclude,
      orderBy: { createdAt: "desc" },
      take: MAX_ARTEFACTS,
    }),
    prisma.renderArtefact.findMany({
      where: deliverableWhereForUser(userId, syntheticIds, [SIDECAR_ARTEFACT_KIND]),
      include: artefactInclude,
      orderBy: { createdAt: "desc" },
      take: MAX_ARTEFACTS,
    }),
    listRenderJobs({ userId }),
    prisma.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, title: true },
    }),
  ]);

  const projects = excludeSyntheticProjects(projectsRaw, syntheticIds);

  const disk: Record<string, DiskFact> = {};
  for (const a of artefacts) {
    disk[a.id] = await checkOnDisk({ id: a.id, path: a.path, bytes: a.bytes, sha256: a.sha256 });
  }
  /* For every artefact, ask object storage whether the durable copy the mux stage
   * stored is there, at the recorded size — including the rows whose local file is
   * still present. Block 11: asking only about the rows whose local file was gone
   * is exactly why a file that had BOTH copies read as one. The key is derived
   * from the row's own facts, so this cannot find a different file. */
  const durable: Record<string, { key: string; bucket: string; objectBytes: number | null }> = {};
  if (storageIsConfigured()) {
    for (const a of artefacts) {
      const key = deliveryObjectKey({
        userId,
        jobId: a.jobId,
        kind: a.kind,
        sha256: a.sha256,
        path: a.path,
      });
      let objectBytes: number | null = null;
      try {
        objectBytes = await statObjectSize(key);
      } catch {
        objectBytes = null;
      }
      if (objectBytes !== null) durable[a.id] = { key, bucket: storageBucket(), objectBytes };
    }
  }
  const sidecarDisk: Record<string, DiskFact> = {};
  for (const s of sidecars) {
    sidecarDisk[s.id] = await checkOnDisk({ id: s.id, path: s.path, bytes: s.bytes, sha256: s.sha256 });
  }

  return deriveDownloadCentre({
    userId,
    syntheticProjectIds: syntheticIds,
    artefacts: artefacts as unknown as ArtefactRow[],
    sidecars: sidecars as unknown as ArtefactRow[],
    jobs: jobsReadout,
    projects,
    disk,
    durable,
    sidecarDisk,
  });
}
