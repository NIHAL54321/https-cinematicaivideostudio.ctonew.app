-- Phase 8 block 4 — the operator role.
--
-- Two values, defaulting to USER. An existing row becomes USER on the ADD COLUMN,
-- so the migration can never promote an account by itself: the grant is a
-- separate, explicit act (`scripts/fixtures/grant-admin.ts <email>`).
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';
