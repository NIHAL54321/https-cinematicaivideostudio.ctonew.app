-- Remove exactly what the Phase 8 block 1 proof created.
--
-- The render job rows are FIXTURE rows (RenderJob.fixture = true) belonging to
-- the P7-7a fixture project; the stage runs and artefacts cascade with them.
-- The intruder account exists only for the tenant-isolation probe.
--
--   psql postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio \
--        -f scripts/fixtures/p8b1-render-teardown.sql
--
-- Nothing else is touched: no other user, project, asset or row is named here.
DELETE FROM "RenderJob" WHERE fixture = true AND "projectId" = 'p7a_fix_project';
DELETE FROM "User" WHERE email = 'p8b1-intruder@cavs.test';
