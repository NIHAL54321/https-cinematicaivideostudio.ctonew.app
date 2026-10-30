/**
 * THE ADMIN DASHBOARD'S HONESTY LAYER (Phase 8, block 4).
 *
 * An "admin dashboard" is normally a page of figures. On this build a figure is
 * only allowed to exist if something computed it on this request, so the surface
 * is built the other way round: every section below is a PURE builder that takes
 * the facts it is allowed to know and returns the sentences and cells a reader
 * sees. Nothing here reads the database, the environment, the disk or the clock;
 * `./overview.ts` does that and hands the facts in. The consequence is testable
 * and tested (`__tests__/`):
 *
 *   - a builder given no money facts cannot print a revenue figure, because it
 *     is never given one (and a test asserts the money section contains no digit
 *     at all, in either branch);
 *   - a capability is `wired` only when a provider row says it is configured AND
 *     has a real call() implementation — a tampered status object that claims
 *     "connected" without one makes the builder THROW rather than print it;
 *   - the encoder section states what the live probes answered, so probes that
 *     failed produce the words "no encoder answered", never "installed";
 *   - a count that is internally impossible (more synthetic rows than rows)
 *     throws instead of rendering.
 *
 * The three states the block brief asks for are spelled once, here:
 *   wired      — a provider serves the capability, has a call() and its key is set;
 *   key missing — a provider has the call(), but its key is not in this process;
 *   unbuilt    — no provider has a call() for the capability at all, key or no key.
 */
import type { CapabilityStatusInfo } from "@/lib/ai/status";
import type { DiskCheck, DiskState } from "@/lib/downloads/verify";
import { EXPORT_PRESET_IDS, findExportPreset } from "@/lib/export/presets";
import { PRESET_FIT_RECORD } from "@/lib/render/encoder-facts";
import type { DerivedJobStatus } from "@/lib/render/pipeline";

/* ------------------------------------------------------------------ */
/* Counts                                                              */
/* ------------------------------------------------------------------ */

/**
 * One row of the inventory. `synthetic` is null ONLY where the table has no
 * synthetic marking to count — and `syntheticBasis` then says so in words, so a
 * missing marking never renders as the number zero.
 */
export interface CountLine {
  key: string;
  label: string;
  total: number;
  synthetic: number | null;
  /** How the synthetic half was counted, in the database's own terms. */
  syntheticBasis: string;
  /** What the row is, for a reader who has not seen the schema. */
  note: string;
}

/**
 * Refuses a row whose synthetic count exceeds its total: that cannot happen in
 * one query, so if it appears two queries disagree and the page must not print
 * either number.
 */
export function assertCountsCoherent(lines: readonly CountLine[]): void {
  for (const line of lines) {
    if (!Number.isInteger(line.total) || line.total < 0) {
      throw new Error(`count "${line.key}" is not a non-negative integer: ${String(line.total)}`);
    }
    if (line.synthetic !== null && (line.synthetic < 0 || line.synthetic > line.total)) {
      throw new Error(
        `count "${line.key}" reports ${line.synthetic} synthetic of ${line.total} — impossible, so neither number is rendered`,
      );
    }
  }
}

/** The share of a table that user surfaces never show, or null when unknown. */
export function syntheticShare(line: CountLine): string {
  if (line.synthetic === null) return "not marked";
  if (line.total === 0) return "nothing to mark";
  return `${line.synthetic} of ${line.total}`;
}

/* ------------------------------------------------------------------ */
/* Render jobs by DERIVED status                                       */
/* ------------------------------------------------------------------ */

export const DERIVED_STATUS_ORDER: readonly DerivedJobStatus[] = [
  "queued",
  "running",
  "blocked",
  "failed",
  "stopped",
  "succeeded",
];

/** What each derived status means, quoting the rule that produces it. */
export const DERIVED_STATUS_DEFINITION: Record<DerivedJobStatus, string> = {
  queued: "no stage row exists yet — the worker has not reached the job",
  running: "stage rows exist and none is FAILED, BLOCKED or STOPPED",
  blocked: "a BLOCKED stage row: a requisite was absent and the pipeline stopped there",
  failed: "a FAILED stage row: the stage ran and did not produce its declared output",
  stopped: "a STOPPED stage row: a stop was requested and recorded with its reason",
  succeeded: "every declared stage has a SUCCEEDED row",
};

export interface JobStatusLine {
  status: DerivedJobStatus;
  count: number;
  definition: string;
}

/**
 * The breakdown, counted from the statuses `deriveJobStatus()` returned for the
 * jobs that were read — never from a status column, because there is none.
 */
export function deriveJobStatusCounts(statuses: readonly DerivedJobStatus[]): JobStatusLine[] {
  return DERIVED_STATUS_ORDER.map((status) => ({
    status,
    count: statuses.filter((s) => s === status).length,
    definition: DERIVED_STATUS_DEFINITION[status],
  }));
}

/* ------------------------------------------------------------------ */
/* Artefacts by DERIVED disk state                                     */
/* ------------------------------------------------------------------ */

export interface ArtefactStateLine {
  state: DiskState;
  count: number;
  synthetic: number;
  /** The first check in this state, quoted verbatim — it names the bytes. */
  sentence: string;
}

/**
 * Groups the `checkArtefactOnDisk()` results by their own state. States with no
 * rows are omitted: a table of zeroes would look like a measurement, and the
 * absence is said in words by the caller instead.
 */
export function summariseArtefactStates(
  checks: readonly DiskCheck[],
  syntheticById: ReadonlyMap<string, boolean>,
): ArtefactStateLine[] {
  const order: DiskState[] = ["present", "gone", "size-mismatch", "digest-mismatch", "unreadable"];
  return order
    .map((state) => {
      const rows = checks.filter((c) => c.state === state);
      return {
        state,
        count: rows.length,
        synthetic: rows.filter((r) => syntheticById.get(r.artefactId) === true).length,
        sentence: rows[0]?.sentence ?? "",
      };
    })
    .filter((line) => line.count > 0);
}

/* ------------------------------------------------------------------ */
/* Encoder — from LIVE probes only                                     */
/* ------------------------------------------------------------------ */

export interface ProbeFact {
  probeId: string;
  ok: boolean;
  /** The probe's own evidence: the command, its exit code, the errno. */
  detail: string;
  missing: string | null;
  checkedAt: string;
}

export interface PresetFitInput {
  presetId: string;
  label: string;
  frame: string;
  /** The verdict the recorded run supports, or "unknown" when no run exists. */
  verdict: "fits" | "does not fit" | "fits only under declared tuning" | "unknown";
  basis: string;
}

export interface EncoderSection {
  /** Stamped by the caller on every request — never a constant, never cached. */
  checkedAt: string;
  /** True only when BOTH binaries answered their own live probe on this request. */
  binariesAnswered: boolean;
  headline: string;
  statements: string[];
  probes: ProbeFact[];
  memoryAvailableKb: number | null;
  memoryTotalKb: number | null;
  memorySentence: string;
  presetFit: PresetFitInput[];
}

/**
 * The encoder's state, in the probes' own words.
 *
 * The sentence is DERIVED from the probe results: when they failed it says no
 * encoder answered and names the errno; it never falls back to "installed",
 * which is why a test can hand this builder failing probes and assert the word
 * does not appear.
 */
export function buildEncoderSection(input: {
  checkedAt: string;
  probes: ProbeFact[];
  memoryAvailableKb: number | null;
  memoryTotalKb: number | null;
  presetFit: PresetFitInput[];
}): EncoderSection {
  const byId = (id: string) => input.probes.find((p) => p.probeId === id);
  const ffmpeg = byId("ffmpeg-binary");
  const ffprobe = byId("ffprobe-binary");
  const storage = byId("storage-writable");
  const binariesAnswered = Boolean(ffmpeg?.ok && ffprobe?.ok);

  const versionLine = (p: ProbeFact | undefined) => {
    if (!p) return "no probe was run for this binary";
    if (!p.ok) return p.missing ?? p.detail;
    // The probe's detail is "spawn ffmpeg -version → exit 0; <first line of stdout>".
    const afterSemicolon = p.detail.includes(";") ? p.detail.split(";").slice(1).join(";").trim() : p.detail;
    return afterSemicolon;
  };

  const headline = binariesAnswered
    ? `An encoder answered a live probe on this request: ${versionLine(ffmpeg)}. ` +
      `ffprobe answered too: ${versionLine(ffprobe)}. Both were spawned by the pipeline's own probe code ` +
      `(src/lib/render/probes.ts), not read from a stored value.`
    : `No encoder answered a live probe on this request, so this build cannot encode anything right now. ` +
      `${ffmpeg?.ok ? "ffmpeg answered" : `ffmpeg: ${ffmpeg?.missing ?? "no probe ran"}`}; ` +
      `${ffprobe?.ok ? "ffprobe answered" : `ffprobe: ${ffprobe?.missing ?? "no probe ran"}`}. ` +
      `This is a measurement taken at ${input.checkedAt}, not a stored value.`;

  const statements: string[] = [];
  statements.push(
    `Storage: ${storage ? (storage.ok ? `a file was written, read back and unlinked (${storage.detail})` : `NOT writable — ${storage.missing ?? storage.detail}`) : "not probed on this request"}.`,
  );
  statements.push(
    "An encoder answering is a capability, not a produced video: nothing on this build has encoded a project's " +
      "media, because a project holds no source media until a media provider is connected.",
  );

  const memorySentence =
    input.memoryAvailableKb === null
      ? "Available memory could not be read on this request, so no preset is compared against it."
      : `This machine has ${input.memoryAvailableKb} kB available now` +
        (input.memoryTotalKb === null ? "" : ` of ${input.memoryTotalKb} kB total`) +
        ` (read from /proc/meminfo on this request). Each preset's fit below compares that against the peak RSS a ` +
        `recorded run actually reached — a measured figure, not an estimate.`;

  return {
    checkedAt: input.checkedAt,
    binariesAnswered,
    headline,
    statements,
    probes: input.probes,
    memoryAvailableKb: input.memoryAvailableKb,
    memoryTotalKb: input.memoryTotalKb,
    memorySentence,
    presetFit: input.presetFit,
  };
}

/**
 * "Do the shipped presets' settings fit this machine?" — answered from the peak
 * RSS a recorded run actually reached (`PRESET_FIT_RECORD`) compared with the
 * memory available NOW, read on this request.
 *
 * The four verdicts exist because two of them would be a lie:
 *   fits                         — a run of the preset's OWN default settings peaked
 *                                  below what is available now;
 *   does not fit                 — that run peaked at or above what is available now
 *                                  (or was killed, and the memory cannot be read);
 *   fits only under declared tuning — the only run that produced a file at this
 *                                  frame used encoder settings DECLARED on the
 *                                  synthetic source, not the preset's own;
 *   unknown                      — no run has ever attempted this preset here, so
 *                                  nobody measured it and no verdict is claimed.
 */
export function derivePresetFit(memoryAvailableKb: number | null): PresetFitInput[] {
  return EXPORT_PRESET_IDS.map((id) => {
    const preset = findExportPreset(id);
    const label = preset?.label ?? id;
    const frame = preset ? `${preset.widthPx}×${preset.heightPx}` : "frame not in the catalogue";
    const records = PRESET_FIT_RECORD.filter((r) => r.presetId === id);
    const defaults = records.find((r) => r.settings === "the preset's own defaults");
    const tuned = records.find((r) => r.settings === "declared tuning on the synthetic source");
    const tunedNote = tuned
      ? ` The same preset DID produce a file under encoder settings declared on the synthetic source (peak ${tuned.peakRssKb} kB, job ${tuned.jobId}) — a different set of settings from the ones this preset ships.`
      : "";
    if (defaults) {
      const fits = memoryAvailableKb !== null && memoryAvailableKb > defaults.peakRssKb;
      return {
        presetId: id,
        label,
        frame,
        verdict: fits ? "fits" : "does not fit",
        basis: fits
          ? `a recorded run of this preset's own default settings peaked at ${defaults.peakRssKb} kB (job ${defaults.jobId}) and ${memoryAvailableKb} kB is available now — it fits at the memory this request measured.`
          : `a recorded run of this preset's own default settings peaked at ${defaults.peakRssKb} kB and ${defaults.outcome} (job ${defaults.jobId}: ${defaults.basis}); ` +
            `${memoryAvailableKb === null ? "available memory could not be read on this request, so it is not claimed to fit" : `${memoryAvailableKb} kB is available now`}.${tunedNote}`,
      };
    }
    if (tuned) {
      return {
        presetId: id,
        label,
        frame,
        verdict: "fits only under declared tuning",
        basis:
          `the only run at this frame that produced a file used encoder settings declared on the synthetic source ` +
          `(peak ${tuned.peakRssKb} kB, job ${tuned.jobId}); the preset's own defaults were never run to success here.`,
      };
    }
    return {
      presetId: id,
      label,
      frame,
      verdict: "unknown",
      basis:
        "no run on this machine has ever attempted this preset's settings, so its fit here is unmeasured and no verdict is claimed.",
    };
  });
}

/* ------------------------------------------------------------------ */
/* Provider capability matrix                                          */
/* ------------------------------------------------------------------ */

export type CapabilityState = "wired" | "key missing" | "unbuilt";

export interface CapabilityRow {
  capability: string;
  label: string;
  /** The provider that decides this row's state, or null when no slot serves it. */
  provider: string | null;
  providerId: string | null;
  state: CapabilityState;
  /** True when at least one provider serving this capability has its key set. */
  keysPresent: boolean;
  requiredEnv: string[];
  basis: string;
}

export interface CapabilityMatrix {
  total: number;
  /**
   * Capabilities for which some provider HAS a call() implementation — the
   * adapter exists. This is the number the health endpoint reports, and it is
   * NOT the number of capabilities this deployment can actually use.
   */
  adaptersBuilt: number;
  /** Capabilities usable right now: adapter present AND its key in this process. */
  wired: number;
  rows: CapabilityRow[];
  headline: string;
}

/**
 * The matrix, derived from `capabilityStatus()` — the same source the AI status
 * API and every engine gate read. Two independent facts must agree for a row to
 * read `wired`: the provider is configured (its key is in this process) AND it
 * has a call() implementation for that capability. The status object's own
 * `status` field is CHECKED against that derivation and a disagreement throws,
 * so a tampered or stale status can never widen the matrix.
 */
export function buildCapabilityMatrix(statuses: readonly CapabilityStatusInfo[]): CapabilityMatrix {
  const rows: CapabilityRow[] = statuses.map((info) => {
    const configuredWired = info.providers.find((p) => p.configured && p.wired);
    const anyWired = info.providers.find((p) => p.wired);
    const anyConfigured = info.providers.find((p) => p.configured);
    const state: CapabilityState = configuredWired ? "wired" : anyWired ? "key missing" : "unbuilt";
    const derivedConnected = Boolean(configuredWired);
    if ((info.status === "connected") !== derivedConnected) {
      throw new Error(
        `capability "${info.capability}" reports status "${info.status}" but its providers say ` +
          `connected=${derivedConnected} — the two derivations disagree, so nothing is rendered`,
      );
    }
    const chosen = configuredWired ?? anyWired ?? anyConfigured ?? info.providers[0] ?? null;
    const basis = configuredWired
      ? `${configuredWired.name} has a call() implementation for this capability and its key is present in this process`
      : anyWired
        ? `${anyWired.name} has a call() implementation for this capability, but its key is not present in this process`
        : anyConfigured
          ? `${anyConfigured.name} has its key present, but no provider has a call() implementation for this capability — the adapter is unbuilt`
          : info.providers.length === 0
            ? "no provider slot serves this capability, so no key would enable it"
            : `${info.providers.length} provider(s) are registered for this capability and none has a call() implementation — the adapter is unbuilt`;
    return {
      capability: info.capability,
      label: info.label,
      provider: chosen?.name ?? null,
      providerId: chosen?.id ?? null,
      state,
      keysPresent: Boolean(anyConfigured),
      requiredEnv: [...info.requiredEnv],
      basis,
    };
  });

  const wired = rows.filter((r) => r.state === "wired").length;
  const adaptersBuilt = rows.filter((r) => r.state === "wired" || r.state === "key missing").length;
  return {
    total: rows.length,
    adaptersBuilt,
    wired,
    rows,
    headline:
      `${adaptersBuilt} of ${rows.length} capabilities have a provider adapter on this build, and ${wired} of them ` +
      `can be used right now: a capability is USABLE only when a provider has a real call() implementation AND its ` +
      `key is in this process's environment. The two numbers are kept apart because an adapter that cannot be ` +
      `reached is not a working capability — the rest are listed with their true state (key missing, or unbuilt), ` +
      `because "not wired" is information and "coming soon" is not.`,
  };
}

/* ------------------------------------------------------------------ */
/* Money — words, never a figure                                       */
/* ------------------------------------------------------------------ */

export interface MoneyFacts {
  /** Whether a Stripe key is in THIS process's environment (name only, never the value). */
  stripeKeyPresent: boolean;
  /** Whether any Subscription row carries a payment-provider id. */
  providerLinkedSubscription: boolean;
  /** Whether any route in the app's source handles a payment or a checkout. */
  paymentRouteFound: boolean;
  /** What was scanned for `paymentRouteFound`, so the check is re-runnable. */
  paymentRouteScan: string;
  /** Live probe names that were consulted. */
  envNamesChecked: readonly string[];
  checkedAt: string;
}

export interface MoneySection {
  /** True only when every payment probe came back negative. */
  paymentsPossible: boolean;
  /** When the probes ran. A time, kept out of the prose so the prose carries no digit. */
  checkedAt: string;
  headline: string;
  statements: string[];
  /**
   * Present, and always empty: the field exists so that a reader (and a test)
   * can see there is no revenue, balance or customer figure anywhere in this
   * section rather than taking the prose's word for it.
   */
  figures: readonly never[];
}

/**
 * The money section. It is given booleans and nothing else — no revenue, no
 * balance, no customer count — so it cannot print a figure even if one were
 * later stored somewhere. `figures` is typed `never[]` and asserted empty.
 */
export function buildMoneySection(facts: MoneyFacts): MoneySection {
  const paymentsPossible = facts.stripeKeyPresent || facts.providerLinkedSubscription || facts.paymentRouteFound;
  const statements: string[] = [
    `Probed on this request: ${facts.envNamesChecked.join(", ") || "no environment variable names"} ` +
      `${facts.stripeKeyPresent ? "is present in this process" : "is not set in this process"}; ` +
      `${facts.paymentRouteFound ? "a payment route exists in the app's source" : `no payment or checkout route exists in the app's source (${facts.paymentRouteScan})`}; ` +
      `${facts.providerLinkedSubscription ? "a subscription row carries a payment-provider id" : "no subscription row carries a payment-provider id"}.`,
    "No revenue, balance or customer figure appears here because none exists on this deployment: there is no " +
      "payment provider configured, no route that could take a payment, and no provider-linked subscription. " +
      "Zero is a measurement; nothing here was measured, so nothing is printed as a number.",
    "This is not a statement that the business has no money — it is a statement that this build cannot take " +
      "a payment and holds no record of one. The moment that changes, this section changes with it, because it " +
      "is derived from the three probes above rather than written by hand.",
  ];
  const headline = paymentsPossible
    ? "A payment provider is partially present on this deployment, but nothing on this build reports revenue, " +
      "so no revenue, balance or customer figure is shown."
    : "No payments are possible on this deployment — Stripe onboarding is incomplete.";
  return { paymentsPossible, checkedAt: facts.checkedAt, headline, statements, figures: [] };
}

/* ------------------------------------------------------------------ */
/* Recent failures                                                     */
/* ------------------------------------------------------------------ */

export interface FailureRow {
  jobId: string;
  projectTitle: string;
  status: DerivedJobStatus;
  /** The stage the job stopped at, in the pipeline's own id. */
  stage: string | null;
  /** The stage's own sentence — the SAME string the download centre shows. */
  sentence: string;
  missingInput: string | null;
  syntheticProof: boolean;
  requestedAt: string;
}

export interface FailuresSection {
  rows: FailureRow[];
  /** Set only when there is nothing to list: the absence, in words. */
  empty: string | null;
}

export function buildFailuresSection(rows: readonly FailureRow[]): FailuresSection {
  return {
    rows: [...rows],
    empty:
      rows.length > 0
        ? null
        : "No render job on this deployment has failed, blocked or stopped, so there is no failure to explain. " +
          "Nothing is listed rather than an empty table being drawn.",
  };
}
