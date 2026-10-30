/**
 * THE WORDS THE METERING AND LEDGER MODULES USE (Phase 8, block 5).
 *
 * These are deliberately narrow. A usage row says what the app DID (a render
 * job created, a stage run, an encoder probe, a provider call attempted) and
 * never what it might have been worth. A ledger row says a number of credits
 * moved and why — and the reason is a required string, not an enum, because a
 * reason that can only be one of five words stops being a reason.
 */

/** The kinds of metered action this build can record. */
export const USAGE_KINDS = [
  "RENDER_JOB_CREATED",
  "RENDER_STAGE_RUN",
  "ENCODER_PROBE",
  "PROVIDER_CALL_ATTEMPT",
  "EXPORT_DOWNLOAD",
] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** What happened when the action was attempted — recorded even when it failed. */
export const USAGE_OUTCOMES = ["SUCCEEDED", "FAILED", "BLOCKED", "STOPPED", "NOT_APPLICABLE"] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

export const LEDGER_KINDS = ["GRANT", "SPEND", "ADJUST"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** One metered action, as the code path that did the work describes it. */
export interface UsageEventInput {
  userId: string;
  projectId?: string | null;
  renderJobId?: string | null;
  stageId?: string | null;
  kind: UsageKind;
  /** Never negative. A reversal is a new row, not an edit of this one. */
  quantity: number;
  /** What `quantity` counts, in the producer's own words ("stage run", "call"). */
  unit: string;
  outcome?: UsageOutcome;
  /** True only for a declared synthetic encoder proof. */
  synthetic: boolean;
  /** The file that wrote this row — a fact about the code, not a claim. */
  source: string;
  /** The action's own evidence (exit code, provider error, stage reason...). */
  detail?: Record<string, unknown> | null;
  occurredAt?: Date;
}

export interface UsageEventRecord extends UsageEventInput {
  id: string;
  outcome: UsageOutcome;
  occurredAt: Date;
}

/** One credit movement. `amount` is signed; the kind fixes the sign. */
export interface LedgerEntryInput {
  userId: string;
  kind: LedgerKind;
  amount: number;
  /** Why this row exists. Blank is refused here AND by a database CHECK. */
  reason: string;
  /** Required for SPEND: the usage row that caused it. */
  usageEventId?: string | null;
  occurredAt?: Date;
}

export interface LedgerEntryRecord extends LedgerEntryInput {
  id: string;
  usageEventId: string | null;
  occurredAt: Date;
}

/** The label a reader sees for each kind — derived from the constant above. */
export const USAGE_KIND_LABEL: Record<UsageKind, string> = {
  RENDER_JOB_CREATED: "Render job created",
  RENDER_STAGE_RUN: "Pipeline stage run",
  ENCODER_PROBE: "Encoder probe",
  PROVIDER_CALL_ATTEMPT: "Provider call attempted",
  EXPORT_DOWNLOAD: "File downloaded",
};
