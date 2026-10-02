-- Brand Kit foundation (Phase 3): watermark on/off toggle and intro/outro
-- clip durations. Asset refs already exist (logoAssetId / introAssetId /
-- outroAssetId / watermarkAssetId); these columns complete the media model.
ALTER TABLE "BrandKit" ADD COLUMN "watermarkEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BrandKit" ADD COLUMN "introDurationSeconds" DOUBLE PRECISION;
ALTER TABLE "BrandKit" ADD COLUMN "outroDurationSeconds" DOUBLE PRECISION;