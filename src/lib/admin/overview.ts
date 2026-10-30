/**
 * THE OPERATOR SURFACE'S DATA, DERIVED ON EVERY REQUEST (Phase 8, block 4).
 *
 * `loadAdminOverview()` is the only thing the page and the API read, and it is
 * the same function for both — so the JSON a reader captures from
 * `GET /api/studio/admin/overview` and the page they look at are the same
 * object, not two implementations that happen to agree today.
 *
 * NOTHING HERE IS CACHED OR STORED:
 *   - counts come from COUNT/groupBy queries executed now;
 *   - a render job's status comes from `deriveJobStatus()` over its own stage
 *     rows (`readRenderJob`, the same read-out the download centre uses) —
 *     there is no status column to drift;
 *   - an artefact's state comes from `checkArtefactOnDisk()`, the same function
 *     the download route gates on, so there is one rule about bytes and not two;
 *   - the encoder's presence comes from `runProbe()`, which spawns the binary;
 *   - the capability matrix comes from `capabilityStatus()`;
 *   - the money section comes from three probes (env, source scan, one query)
 *     and is given no revenue figure to print.
 *
 * The synthetic half of every count is derived from the marking that already
 * exists (`RenderJob.syntheticProof` / `RenderArtefact.syntheticProof`, and for
 * projects/scenes/chapters/assets through the project's own marking via
 * `isSyntheticProject`) — this module invents no new marking.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { allCapabilityStatus } from "@/lib/ai/status";
import { prisma } from "@/lib/db";
import { awaitingFromJob } from "@/lib/downloads/centre";
import { PRIMARY_ARTEFACT_KINDS } from "@/lib/downloads/rule";
import { checkArtefactOnDisk, type DiskCheck } from "@/lib/downloads/verify";
import { isSyntheticProject, SYNTHETIC_PROJECT_TITLE_PREFIX } from "@/lib/render/synthetic-projects";
import { readRenderJob, type RenderReadout } from "@/lib/render/service";
import { renderOutputDir, runProbe, type ProbeResult } from "@/lib/render/probes";
import type { DerivedJobStatus } from "@/lib/render/pipeline";
import {
  assertCountsCoherent,
  buildCapabilityMatrix,
  buildEncoderSection,
  buildFailuresSection,
  buildMoneySection,
  deriveJobStatusCounts,
  derivePresetFit,
  summariseArtefactStates,
  type ArtefactStateLine,
  type CapabilityMatrix,
  type CountLine,
  type EncoderSection,
  type FailuresSection,
  type JobStatusLine,
  type MoneySection,
  type ProbeFact,
} from "./sections";

/** How many render jobs' stage rows are read for the status breakdown. */
export const ADMIN_MAX_JOBS = 50;
/** How many artefact rows are read back off disk (each one is hashed). */
export const ADMIN_MAX_ARTEFACTS = 200;
/** How many recent failures the list carries. */
export const ADMIN_MAX_FAILURES = 5;

export interface AdminOverview {
  /** When this object was computed. Every probe below carries its own stamp too. */
  generatedAt: string;
  operator: { id: string; email: string; role: string };
  counts: CountLine[];
  jobs: {
    total: number;
    synthetic: number;
    statuses: JobStatusLine[];
    /** How much of the total the status breakdown actually covers. */
    statusCovers: { derived: number; total: number; partial: boolean; sentence: string };
  };
  artefacts: {
    total: number;
    synthetic: number;
    checked: number;
    states: ArtefactStateLine[];
    /** Set only when there is genuinely nothing to check. */
    empty: string | null;
    basis: string;
    kinds: string[];
  };
  encoder: EncoderSection;
  capabilities: CapabilityMatrix;
  money: MoneySection;
  failures: FailuresSection;
  /** Standing statements this surface will not let a reader forget. */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Live machine facts                                                  */
/* ------------------------------------------------------------------ */

/** MemAvailable / MemTotal in kB, read from /proc/meminfo on this request. */
export function readMemory(): { availableKb: number | null; totalKb: number | null } {
  try {
    const text = readFileSync("/proc/meminfo", "utf8");
    const pick = (key: string): number | null => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
      return m ? Number(m[1]) : null;
    };
    return { availableKb: pick("MemAvailable"), totalKb: pick("MemTotal") };
  } catch {
    return { availableKb: null, totalKb: null };
  }
}

/**
 * Walks the app's own API source for a route that could take a payment. A
 * payment surface would have to live under `src/app/api` to be reachable, so its
 * absence there is a real fact about this build rather than an assertion.
 */
export function scanForPaymentRoutes(root = process.cwd()): { found: boolean; matches: string[]; scanned: number } {
  const base = join(root, "src", "app", "api");
  const matches: string[] = [];
  let scanned = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, depth + 1);
      } else if (entry === "route.ts" || entry === "route.tsx") {
        scanned += 1;
        if (/(checkout|billing|payment|stripe|invoice)/i.test(full)) matches.push(full.slice(root.length + 1));
      }
    }
  };
  walk(base, 0);
  return { found: matches.length > 0, matches, scanned };
}

/* ------------------------------------------------------------------ */
/* The overview                                                        */
/* ------------------------------------------------------------------ */

const PROBE_IDS = ["ffmpeg-binary", "ffprobe-binary", "storage-writable"] as const;

function probeFact(r: ProbeResult) {
  return { probeId: r.probeId, ok: r.ok, detail: r.detail, missing: r.missing, checkedAt: r.checkedAt };
}

export async function loadAdminOverview(operatorId: string): Promise<AdminOverview> {
  const generatedAt = new Date().toISOString();

  const operator = await prisma.user.findUnique({
    where: { id: operatorId },
    select: { id: true, email: true, role: true },
  });
  if (!operator) throw new Error("the operator account disappeared between the guard and the read");

  /* ---- synthetic marking, derived from what already exists ---- */
  const [syntheticJobProjectRows, allProjects] = await Promise.all([
    prisma.renderJob.findMany({ where: { syntheticProof: true }, select: { projectId: true }, distinct: ["projectId"] }),
    prisma.project.findMany({ select: { id: true, title: true } }),
  ]);
  const syntheticProjectIdSet = new Set(syntheticJobProjectRows.map((r) => r.projectId));
  const syntheticProjects = allProjects.filter((p) => isSyntheticProject(p, syntheticProjectIdSet));
  const syntheticProjectIds = new Set(syntheticProjects.map((p) => p.id));

  /* ---- counts ---- */
  const [
    userTotal,
    projectTotal,
    chapterTotal,
    sceneTotal,
    assetTotal,
    jobTotal,
    jobSynthetic,
    stageRunTotal,
    stageRunSynthetic,
    artefactTotal,
    artefactSynthetic,
    sceneGroups,
    chapterGroups,
    assetGroups,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.chapter.count(),
    prisma.scene.count(),
    prisma.asset.count(),
    prisma.renderJob.count(),
    prisma.renderJob.count({ where: { syntheticProof: true } }),
    prisma.renderStageRun.count(),
    prisma.renderStageRun.count({ where: { syntheticProof: true } }),
    prisma.renderArtefact.count(),
    prisma.renderArtefact.count({ where: { syntheticProof: true } }),
    prisma.scene.groupBy({ by: ["projectId"], _count: { _all: true } }),
    prisma.chapter.groupBy({ by: ["projectId"], _count: { _all: true } }),
    prisma.asset.groupBy({ by: ["projectId"], _count: { _all: true } }),
  ]);

  const syntheticIn = (groups: Array<{ projectId: string; _count: { _all: number } }>) =>
    groups.filter((g) => syntheticProjectIds.has(g.projectId)).reduce((n, g) => n + g._count._all, 0);

  const counts: CountLine[] = [
    {
      key: "accounts",
      label: "Accounts",
      total: userTotal,
      synthetic: null,
      syntheticBasis: "an account carries no synthetic marking — there is no such column, and an account is never a synthetic proof",
      note: "rows in User, every one of which signed up through the app's own /api/auth/signup",
    },
    {
      key: "projects",
      label: "Projects",
      total: projectTotal,
      synthetic: syntheticProjects.length,
      syntheticBasis: `counted with isSyntheticProject(): a project carried by a RenderJob with syntheticProof = true, or titled "${SYNTHETIC_PROJECT_TITLE_PREFIX}…"`,
      note: "rows in Project, including soft-deleted ones — the count is of rows, not of what a user's list shows",
    },
    {
      key: "chapters",
      label: "Chapters",
      total: chapterTotal,
      synthetic: syntheticIn(chapterGroups),
      syntheticBasis: "chapters whose project is a synthetic proof project (the project's own marking, joined by projectId)",
      note: "rows in Chapter",
    },
    {
      key: "scenes",
      label: "Scenes",
      total: sceneTotal,
      synthetic: syntheticIn(sceneGroups),
      syntheticBasis: "scenes whose project is a synthetic proof project (the project's own marking, joined by projectId)",
      note: "rows in Scene — the pipeline's resolve-inputs stage counts these per project",
    },
    {
      key: "assets",
      label: "Assets",
      total: assetTotal,
      synthetic: syntheticIn(assetGroups),
      syntheticBasis: "assets whose project is a synthetic proof project (the project's own marking, joined by projectId)",
      note: "rows in Asset — user uploads and generated media alike; no asset row is a rendered file",
    },
    {
      key: "renderJobs",
      label: "Render jobs",
      total: jobTotal,
      synthetic: jobSynthetic,
      syntheticBasis: "the job's own RenderJob.syntheticProof column",
      note: "rows in RenderJob — a job has no status column; its status is derived from its stage rows below",
    },
    {
      key: "stageRuns",
      label: "Stage runs",
      total: stageRunTotal,
      synthetic: stageRunSynthetic,
      syntheticBasis: "the stage row's own RenderStageRun.syntheticProof column, carried from its job",
      note: "rows in RenderStageRun — one per stage the pipeline actually reached",
    },
    {
      key: "artefacts",
      label: "Artefacts",
      total: artefactTotal,
      synthetic: artefactSynthetic,
      syntheticBasis: "the artefact's own RenderArtefact.syntheticProof column, carried from its job",
      note: "rows in RenderArtefact — a record of a file, not the file; whether the bytes are still there is checked below",
    },
  ];
  assertCountsCoherent(counts);

  /* ---- render jobs: status derived from their own stage rows ---- */
  const jobRows = await prisma.renderJob.findMany({
    orderBy: { requestedAt: "desc" },
    take: ADMIN_MAX_JOBS,
    select: { id: true, userId: true },
  });
  const readouts: RenderReadout[] = [];
  for (const row of jobRows) {
    // Sequential on purpose: each read-out loads a job's stage rows and
    // artefacts, and this machine's memory ceiling is real.
    readouts.push(await readRenderJob({ userId: row.userId, jobId: row.id }));
  }
  const statuses: DerivedJobStatus[] = readouts.map((r) => r.status);
  const partial = readouts.length < jobTotal;

  /* ---- artefacts: state derived by the download route's own check ---- */
  const artefactRows = await prisma.renderArtefact.findMany({
    orderBy: { createdAt: "desc" },
    take: ADMIN_MAX_ARTEFACTS,
    select: { id: true, path: true, bytes: true, sha256: true, kind: true, syntheticProof: true },
  });
  const checks: DiskCheck[] = [];
  for (const row of artefactRows) {
    checks.push(
      await checkArtefactOnDisk({ id: row.id, path: row.path, bytes: row.bytes, sha256: row.sha256, kind: row.kind }),
    );
  }
  const syntheticById = new Map(artefactRows.map((r) => [r.id, r.syntheticProof]));
  const states = summariseArtefactStates(checks, syntheticById);

  /* ---- the encoder, probed live ---- */
  const probeCtx = {
    projectId: "(admin overview — no project)",
    outputDir: renderOutputDir(),
    projectFacts: async () => ({ sceneCount: 0 }),
  };
  const probes: ProbeFact[] = [];
  for (const id of PROBE_IDS) probes.push(probeFact(await runProbe(id, probeCtx)));
  const memory = readMemory();
  const encoder = buildEncoderSection({
    checkedAt: generatedAt,
    probes,
    memoryAvailableKb: memory.availableKb,
    memoryTotalKb: memory.totalKb,
    presetFit: derivePresetFit(memory.availableKb),
  });

  /* ---- capabilities, from the existing status source ---- */
  const capabilities = buildCapabilityMatrix(allCapabilityStatus());

  /* ---- money: three probes, and no figure to print ---- */
  const paymentScan = scanForPaymentRoutes();
  const providerLinkedSubscriptions = await prisma.subscription.count({ where: { provider: { not: null } } });
  const money = buildMoneySection({
    stripeKeyPresent: Boolean(process.env.STRIPE_SECRET_KEY?.trim()),
    providerLinkedSubscription: providerLinkedSubscriptions > 0,
    paymentRouteFound: paymentScan.found,
    paymentRouteScan: "walked every route file under src/app/api looking for checkout, billing, payment, stripe or invoice",
    envNamesChecked: ["STRIPE_SECRET_KEY"],
    checkedAt: generatedAt,
  });

  /* ---- recent failures: the download centre's own sentences ---- */
  const failures = buildFailuresSection(
    readouts
      .filter((r) => r.status === "failed" || r.status === "blocked" || r.status === "stopped")
      .slice(0, ADMIN_MAX_FAILURES)
      .map((r) => {
        const awaiting = awaitingFromJob(r, { id: r.job.projectId, title: r.job.projectTitle });
        return {
          jobId: r.job.id,
          projectTitle: r.job.projectTitle,
          status: r.status,
          stage: awaiting.missingStage,
          sentence: awaiting.sentence,
          missingInput: awaiting.missingInput,
          syntheticProof: r.job.syntheticProof,
          requestedAt: r.job.requestedAt,
        };
      }),
  );

  return {
    generatedAt,
    operator: { id: operator.id, email: operator.email, role: operator.role },
    counts,
    jobs: {
      total: jobTotal,
      synthetic: jobSynthetic,
      statuses: deriveJobStatusCounts(statuses),
      statusCovers: {
        derived: readouts.length,
        total: jobTotal,
        partial,
        sentence: partial
          ? `the derived status covers the ${readouts.length} most recent of ${jobTotal} job(s) — the remaining jobs are in the totals above but their stage rows were not read on this request`
          : `the derived status covers all ${readouts.length} job(s) on this deployment — every job's stage rows were read on this request`,
      },
    },
    artefacts: {
      total: artefactTotal,
      synthetic: artefactSynthetic,
      checked: artefactRows.length,
      states,
      empty:
        artefactTotal === 0
          ? "No artefact row exists on this deployment: no render job has recorded a file. There is nothing to check and nothing is drawn as a zero."
          : null,
      basis:
        "each row's recorded path, byte size and SHA-256 were checked on this request with checkArtefactOnDisk() — the same function the download route refuses to serve without",
      kinds: [...PRIMARY_ARTEFACT_KINDS],
    },
    encoder,
    capabilities,
    money,
    failures,
    notes: [
      "Every number on this page was computed on this request. Nothing is cached between requests and nothing is stored on a row.",
      "A synthetic encoder proof is never a project's video: the files that exist were encoded from a source the encoder generated itself, and no project's or customer's video has ever been produced on this build.",
      "This page cannot tell you the business has customers, revenue or a balance, because it has none of those records — it can only tell you what is in the database and on the machine right now.",
    ],
  };
}
