-- AlterTable
ALTER TABLE "RenderArtefact" ADD COLUMN     "syntheticProof" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RenderJob" ADD COLUMN     "syntheticProof" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syntheticSource" JSONB;

-- AlterTable
ALTER TABLE "RenderStageRun" ADD COLUMN     "syntheticProof" BOOLEAN NOT NULL DEFAULT false;
