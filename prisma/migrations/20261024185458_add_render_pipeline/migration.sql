-- CreateEnum
CREATE TYPE "RenderStageState" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED');

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "presetLabel" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "fixture" BOOLEAN NOT NULL DEFAULT false,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "stopRequestedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "queueJobId" TEXT,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderStageRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "state" "RenderStageState" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "missingInput" TEXT,
    "errorMessage" TEXT,
    "artefactCount" INTEGER NOT NULL DEFAULT 0,
    "output" JSONB,

    CONSTRAINT "RenderStageRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderArtefact" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "stageRunId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderArtefact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenderJob_userId_requestedAt_idx" ON "RenderJob"("userId", "requestedAt");

-- CreateIndex
CREATE INDEX "RenderJob_projectId_idx" ON "RenderJob"("projectId");

-- CreateIndex
CREATE INDEX "RenderJob_fixture_idx" ON "RenderJob"("fixture");

-- CreateIndex
CREATE INDEX "RenderStageRun_jobId_sequence_idx" ON "RenderStageRun"("jobId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RenderStageRun_jobId_stageId_key" ON "RenderStageRun"("jobId", "stageId");

-- CreateIndex
CREATE INDEX "RenderArtefact_jobId_idx" ON "RenderArtefact"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderArtefact_jobId_kind_key" ON "RenderArtefact"("jobId", "kind");

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderStageRun" ADD CONSTRAINT "RenderStageRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RenderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderArtefact" ADD CONSTRAINT "RenderArtefact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "RenderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderArtefact" ADD CONSTRAINT "RenderArtefact_stageRunId_fkey" FOREIGN KEY ("stageRunId") REFERENCES "RenderStageRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
