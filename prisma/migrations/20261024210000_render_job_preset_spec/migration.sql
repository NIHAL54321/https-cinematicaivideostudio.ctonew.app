-- Phase 8 block 2a — the resolved export specification a render job ran with.
--
-- A job used to record only `presetId` and `presetLabel`: a NAME. A name is not
-- reproducible — if the preset catalogue is edited afterwards, the name still
-- resolves, to different numbers. These three columns record the numbers
-- themselves at enqueue time:
--
--   presetSpec       the resolved specification core (JSON), exactly as computed
--   presetSpecSha256 SHA-256 of its canonical JSON, so a reader can re-check it
--   specVersion      the export-specification matrix version it was resolved against
--
-- All three are nullable: jobs enqueued before this block have no recorded spec,
-- and the read-out says "not recorded" rather than inventing one.
ALTER TABLE "RenderJob" ADD COLUMN "presetSpec" JSONB;
ALTER TABLE "RenderJob" ADD COLUMN "presetSpecSha256" TEXT;
ALTER TABLE "RenderJob" ADD COLUMN "specVersion" TEXT;
