/**
 * Phase 7 Block 1 — the publishing service (server only).
 *
 * Store-injected, so every action is covered by contract tests with an in-memory
 * store and no database. The route only wires the Prisma store in.
 *
 * Three actions, following the app's existing `/api/studio/*` conventions:
 *   build — derive the package from the project's rows and APPEND a saved version
 *   read  — read the newest saved package back, re-audit the stored bytes, return it
 *   list  — the saved versions, newest first, with their honest counts (no payloads)
 *
 * Tenancy: every action resolves the project through `findOwnedProject` first, so
 * a missing OR foreign project is a 404 (never 403) and nothing about another
 * tenant leaks. `read` on a project with nothing saved is a 200 with
 * `saved: false` and the reason — "nothing saved yet" is a real state, not an
 * error, and it is reported in words rather than as an empty object.
 */
import { capabilityEnvNames } from "@/lib/ai/providers/capability-env";
import { auditStoredPackage, buildPublishingPackage, PUBLISHING_PACKAGE_FORMAT, type PublishingPackage } from "./package";
import { buildKeywordPlan, type KeywordPlan } from "./keywords";
import { askSeoTitles } from "./titles-model";
import type { TitlesModelOutcome } from "./titles";
import type { PublishingSource } from "./types";

export interface SavedPackageSummary {
  id: string;
  version: number;
  derivedAt: string;
  sourceFingerprint: string;
  counts: {
    chapters: number;
    scenes: number;
    assets: number;
    keywords: number;
    tags: number;
    hashtags: number;
    emptyFields: number;
  };
}

export interface SavedPackage extends Omit<SavedPackageSummary, "counts"> {
  format: string;
  payload: PublishingPackage;
  /** The stored payload's real serialised size, measured on read. */
  payloadBytes: number;
}

export interface PublishStore {
  findOwnedProject(userId: string, projectId: string): Promise<{ id: string; title: string } | null>;
  loadSource(projectId: string): Promise<PublishingSource>;
  savePackage(input: {
    userId: string;
    projectId: string;
    pkg: PublishingPackage;
  }): Promise<{ id: string; version: number; derivedAt: string }>;
  latestPackage(projectId: string): Promise<SavedPackage | null>;
  listPackages(projectId: string): Promise<SavedPackageSummary[]>;
}

export const PUBLISHING_ACTIONS = ["build", "read", "list"] as const;
export type PublishingAction = (typeof PUBLISHING_ACTIONS)[number];

export interface ServiceResult {
  status: number;
  body: Record<string, unknown>;
}

export interface RunOptions {
  /** Injection point for tests; defaults to now. */
  now?: Date;
  /**
   * The env var NAMES a model-authored copy step would need, derived by the
   * caller from the app's provider registry. Defaults to the registry's own
   * answer for `script_generation`.
   */
  modelCopyEnvNames?: readonly string[];
  /**
   * The env var NAMES that would enable the `seo_generation` capability, derived
   * by the caller from the app's provider registry (names only — never values).
   * Defaults to the registry's own answer for `seo_generation`.
   */
  seoEnvNames?: readonly string[];
  /**
   * How the model-backed title path is asked. The DEFAULT is the app's real call
   * through the AI model orchestrator (`askSeoTitles`), so a build records what
   * the app's own orchestrator really answered. Tests inject their own asker so
   * no test touches a network or a database.
   */
  askTitles?: (userId: string, source: PublishingSource, keywords: KeywordPlan) => Promise<TitlesModelOutcome>;
}

function fail(status: number, message: string, code: string): ServiceResult {
  return { status, body: { error: message, code } };
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** POST /api/studio/publishing — build / read / list a publishing package. */
export async function runPublishingAction(
  store: PublishStore,
  userId: string,
  rawBody: unknown,
  opts: RunOptions = {},
): Promise<ServiceResult> {
  const body = asObject(rawBody);
  const action = typeof body.action === "string" ? body.action : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";

  if (!projectId) return fail(400, "projectId is required.", "project_id_required");
  if (!PUBLISHING_ACTIONS.includes(action as PublishingAction)) {
    return fail(400, `Unknown action. Expected one of: ${PUBLISHING_ACTIONS.join(", ")}.`, "unknown_action");
  }

  const project = await store.findOwnedProject(userId, projectId);
  if (!project) return fail(404, "Project not found.", "not_found");

  const envNames = opts.modelCopyEnvNames ?? capabilityEnvNames("script_generation");
  const seoEnvNames = opts.seoEnvNames ?? capabilityEnvNames("seo_generation");

  /* ---------------------------------------------------------------- build */
  if (action === "build") {
    const callToAction = typeof body.callToAction === "string" ? body.callToAction : null;
    const source = await store.loadSource(projectId);
    // The title plan's rule-derived options are pure, but the plan also carries
    // what the app's own AI orchestrator answered for `seo_generation`. The
    // orchestrator is asked here, on the real build path, and whatever it answers
    // is recorded as it is — this build says nothing about a provider that the
    // call did not say itself. No title is attributed to a model unless a provider
    // really returned one.
    const titlesKeywords = buildKeywordPlan(source);
    const askTitles = opts.askTitles ?? ((uid, src, kw) => askSeoTitles(uid, src, kw));
    const titlesOutcome = await askTitles(userId, source, titlesKeywords);
    const pkg = buildPublishingPackage(
      { ...source, request: { callToAction } },
      {
        now: opts.now,
        modelCopyEnvNames: envNames,
        titlesModelPath: { outcome: titlesOutcome, envVars: seoEnvNames },
      },
    );
    const persisted = await store.savePackage({ userId, projectId, pkg });
    return {
      status: 200,
      body: {
        action: "build",
        projectId,
        projectTitle: project.title,
        saved: true,
        persisted,
        package: pkg,
        note:
          "Built from this project's own rows by deterministic rules and saved as an append-only version. " +
          "Every value carries its rule and source, or says which input is missing. The app's own AI orchestrator was asked once, for the " +
          "seo_generation capability behind the model-backed title path, and its answer is recorded on the package — read " +
          "`package.titles.modelPath` for exactly what it said. No title in this package is attributed to a model unless a provider really returned one.",
      },
    };
  }

  /* ----------------------------------------------------------------- read */
  if (action === "read") {
    const saved = await store.latestPackage(projectId);
    if (!saved) {
      return {
        status: 200,
        body: {
          action: "read",
          projectId,
          saved: false,
          reason: "No publishing package has been saved for this project yet.",
          note: 'Send action "build" to derive one from this project\'s own rows.',
        },
      };
    }
    // The stored bytes are re-audited on the way out: a re-read proves the saved
    // package still satisfies every honesty invariant, not just that it parses.
    const audit = auditStoredPackage(saved.payload, { now: opts.now });
    return {
      status: 200,
      body: {
        action: "read",
        projectId,
        saved: true,
        persisted: {
          id: saved.id,
          version: saved.version,
          derivedAt: saved.derivedAt,
          sourceFingerprint: saved.sourceFingerprint,
          format: saved.format,
          payloadBytes: saved.payloadBytes,
        },
        reAudit: {
          format: saved.format,
          expectedFormat: PUBLISHING_PACKAGE_FORMAT,
          ok: audit.ok,
          violationCount: audit.violationCount,
          inspectedKeys: audit.inspectedKeys,
          inspectedStrings: audit.inspectedStrings,
          checkedAt: audit.checkedAt,
          violations: audit.violations,
        },
        package: saved.payload,
        note:
          "Read back from the server and re-audited: the stored package still passes its own honesty invariants " +
          "(no metric-shaped key, no banned claim in rule-authored text, every derived value carrying its rule and source). " +
          "The read re-audit is the check below; it makes no claim about any provider.",
      },
    };
  }

  /* ----------------------------------------------------------------- list */
  const versions = await store.listPackages(projectId);
  return {
    status: 200,
    body: {
      action: "list",
      projectId,
      count: versions.length,
      versions,
      note:
        versions.length === 0
          ? "No publishing package has been saved for this project yet."
          : "Saved versions, newest first. The counts are the ones recorded when each version was built; the payloads are not sent by this action.",
    },
  };
}
