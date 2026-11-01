-- Phase 8 block 6 — FAILURE RECOVERY.
--
-- A render job's executions become ATTEMPTS, and every stage row belongs to one.
-- The unique key on RenderStageRun moves from [jobId, stageId] to
-- [attemptId, stageId], so a retry can run a stage an earlier attempt failed at
-- without editing the earlier attempt's row. Nothing that exists is deleted.
--
-- Existing stage rows are attached to a backfilled attempt 1 per job. That
-- attempt carries NO owning process (it predates attempt tracking), so the
-- read-out treats it with the timestamp fallback and says so rather than
-- pretending it observed anything (src/lib/render/attempt.ts).

-- CreateEnum
CREATE TYPE "RenderAttemptState" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED');

-- CreateTable
CREATE TABLE "RenderAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "state" "RenderAttemptState" NOT NULL DEFAULT 'RUNNING',
    "startStageId" TEXT NOT NULL,
    "continuedFromId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatCount" INTEGER NOT NULL DEFAULT 0,
    "lastStageId" TEXT,
    "ownerHost" TEXT,
    "ownerPid" INTEGER,
    "ownerProcStart" TEXT,
    "endedReason" TEXT,
    "reusedArtefacts" JSONB,

    CONSTRAINT "RenderAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RenderAttempt_jobId_attemptNumber_key" ON "RenderAttempt"("jobId", "attemptNumber");
CREATE INDEX "RenderAttempt_jobId_startedAt_idx" ON "RenderAttempt"("jobId", "startedAt");

ALTER TABLE "RenderAttempt" ADD CONSTRAINT "RenderAttempt_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "RenderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: attemptId arrives nullable so the backfill can fill it.
ALTER TABLE "RenderStageRun" ADD COLUMN "attemptId" TEXT;

-- Backfill attempt 1 for every job that already left stage rows behind. The
-- state is DERIVED FROM THE ROWS, using the same precedence the read-out uses
-- (a failure outranks a block, a block outranks a stop).
INSERT INTO "RenderAttempt" (
  "id", "jobId", "attemptNumber", "state", "startStageId", "startedAt", "finishedAt",
  "heartbeatAt", "heartbeatCount", "lastStageId", "endedReason"
)
SELECT
  'legacy-' || md5(j."id"),
  j."id",
  1,
  CASE
    WHEN EXISTS (SELECT 1 FROM "RenderStageRun" r WHERE r."jobId" = j."id" AND r."state" = 'FAILED')  THEN 'FAILED'::"RenderAttemptState"
    WHEN EXISTS (SELECT 1 FROM "RenderStageRun" r WHERE r."jobId" = j."id" AND r."state" = 'BLOCKED') THEN 'BLOCKED'::"RenderAttemptState"
    WHEN EXISTS (SELECT 1 FROM "RenderStageRun" r WHERE r."jobId" = j."id" AND r."state" = 'STOPPED') THEN 'STOPPED'::"RenderAttemptState"
    WHEN EXISTS (SELECT 1 FROM "RenderStageRun" r WHERE r."jobId" = j."id" AND r."state" = 'RUNNING') THEN 'RUNNING'::"RenderAttemptState"
    ELSE 'SUCCEEDED'::"RenderAttemptState"
  END,
  (SELECT r."stageId" FROM "RenderStageRun" r WHERE r."jobId" = j."id" ORDER BY r."sequence" ASC  LIMIT 1),
  COALESCE(j."startedAt", j."requestedAt"),
  j."finishedAt",
  COALESCE((SELECT max(r."startedAt") FROM "RenderStageRun" r WHERE r."jobId" = j."id"), COALESCE(j."startedAt", j."requestedAt")),
  0,
  (SELECT r."stageId" FROM "RenderStageRun" r WHERE r."jobId" = j."id" ORDER BY r."sequence" DESC LIMIT 1),
  'this attempt predates attempt tracking (phase 8 block 6): it carries no owning process and no heartbeat, so its liveness is read with the timestamp fallback and its state was derived from the stage rows it left behind'
FROM "RenderJob" j
WHERE EXISTS (SELECT 1 FROM "RenderStageRun" r WHERE r."jobId" = j."id");

UPDATE "RenderStageRun" r
SET "attemptId" = a."id"
FROM "RenderAttempt" a
WHERE a."jobId" = r."jobId" AND a."attemptNumber" = 1;

-- Fail loudly rather than drop or orphan evidence: SET NOT NULL refuses the
-- whole migration if even one stage row could not be attached to an attempt.
ALTER TABLE "RenderStageRun" ALTER COLUMN "attemptId" SET NOT NULL;

-- The old key would forbid a retry from re-running a stage.
DROP INDEX "RenderStageRun_jobId_stageId_key";
CREATE UNIQUE INDEX "RenderStageRun_attemptId_stageId_key" ON "RenderStageRun"("attemptId", "stageId");
CREATE INDEX "RenderStageRun_attemptId_sequence_idx" ON "RenderStageRun"("attemptId", "sequence");

ALTER TABLE "RenderStageRun" ADD CONSTRAINT "RenderStageRun_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "RenderAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
