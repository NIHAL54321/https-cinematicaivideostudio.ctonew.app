-- Phase 8, block 5 — usage metering and the credit ledger.
--
-- Two append-only tables, and the invariants the block promises are enforced
-- HERE as well as in TypeScript, because a rule that only exists in the
-- application is a rule the next code path can skip:
--
--   * a usage row cannot be negative and cannot have a blank `source`;
--   * a ledger row cannot have a blank `reason`;
--   * a SPEND must name the usage row that caused it;
--   * GRANT is positive, SPEND is negative, ADJUST is non-zero;
--   * UPDATE and DELETE are refused on BOTH tables by a trigger.
--
-- There is no balance column anywhere: a balance is the SUM of the ledger rows.

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('RENDER_JOB_CREATED', 'RENDER_STAGE_RUN', 'ENCODER_PROBE', 'PROVIDER_CALL_ATTEMPT', 'EXPORT_DOWNLOAD');

-- CreateEnum
CREATE TYPE "UsageOutcome" AS ENUM ('SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('GRANT', 'SPEND', 'ADJUST');

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "renderJobId" TEXT,
    "stageId" TEXT,
    "kind" "UsageKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "outcome" "UsageOutcome" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "usageEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageEvent_userId_occurredAt_idx" ON "UsageEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_kind_occurredAt_idx" ON "UsageEvent"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "UsageEvent_renderJobId_idx" ON "UsageEvent"("renderJobId");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_userId_occurredAt_idx" ON "CreditLedgerEntry"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_usageEventId_idx" ON "CreditLedgerEntry"("usageEventId");

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_usageEventId_fkey" FOREIGN KEY ("usageEventId") REFERENCES "UsageEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants, enforced by the database.
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_source_not_blank" CHECK (length(btrim("source")) > 0);
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_reason_not_blank" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_spend_has_cause" CHECK ("kind" <> 'SPEND' OR "usageEventId" IS NOT NULL);
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_amount_sign" CHECK (
    ("kind" = 'GRANT' AND "amount" > 0)
    OR ("kind" = 'SPEND' AND "amount" < 0)
    OR ("kind" = 'ADJUST' AND "amount" <> 0)
);

-- Append-only, enforced by the database: a rewrite is refused, not logged.
CREATE OR REPLACE FUNCTION cavs_refuse_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is refused on row %',
        TG_TABLE_NAME, TG_OP, COALESCE(OLD."id", '(unknown)')
        USING HINT = 'A correction is a NEW row (kind ADJUST) carrying its own reason, never an edit of an existing row.';
END;
$$;

CREATE TRIGGER "UsageEvent_append_only"
    BEFORE UPDATE OR DELETE ON "UsageEvent"
    FOR EACH ROW EXECUTE FUNCTION cavs_refuse_mutation();

CREATE TRIGGER "CreditLedgerEntry_append_only"
    BEFORE UPDATE OR DELETE ON "CreditLedgerEntry"
    FOR EACH ROW EXECUTE FUNCTION cavs_refuse_mutation();
