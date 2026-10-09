-- Phase 7 Block 1: the publishing package (additive only).
--
-- One new table plus its indexes and its foreign key to the project. No existing
-- table, column, index or constraint is altered or dropped; the only change to
-- an existing model is the back-relation on Project, which is a list relation
-- and therefore creates no column anywhere.
CREATE TABLE "PublishingPackage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'cavs.publishing-package/v1',
    "sourceFingerprint" TEXT NOT NULL,
    "chapterCount" INTEGER NOT NULL DEFAULT 0,
    "sceneCount" INTEGER NOT NULL DEFAULT 0,
    "assetCount" INTEGER NOT NULL DEFAULT 0,
    "keywordCount" INTEGER NOT NULL DEFAULT 0,
    "tagCount" INTEGER NOT NULL DEFAULT 0,
    "hashtagCount" INTEGER NOT NULL DEFAULT 0,
    "emptyFieldCount" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "derivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishingPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PublishingPackage_projectId_version_key" ON "PublishingPackage"("projectId", "version");

-- CreateIndex
CREATE INDEX "PublishingPackage_projectId_derivedAt_idx" ON "PublishingPackage"("projectId", "derivedAt");

-- CreateIndex
CREATE INDEX "PublishingPackage_userId_createdAt_idx" ON "PublishingPackage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PublishingPackage" ADD CONSTRAINT "PublishingPackage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
