-- Remove exactly what the Phase 8 block 1 proof left behind — and NOT the one
-- job later blocks still want.
--
-- WHAT THIS REMOVES
--   * the two incidental probe jobs (enqueue probes from the proof run), and
--   * the intruder account, which exists only for the tenant-isolation probe.
--
-- WHAT THIS DELIBERATELY KEEPS
--   cmvmru9v80003ffwv8t1ashup — the STANDING LABELLED FIXTURE JOB. It is the
--   one real job with a real BLOCKED `encode-master` stage row naming the
--   missing input, and later blocks (the admin dashboard) need a genuine
--   blocked job to display. It stays until someone decides otherwise; the exact
--   command to remove it is in the evidence pack's README.
--
-- All three rows are RenderJob.fixture = true on project 'p7a_fix_project'.
-- Stage runs and artefacts cascade with the job rows (onDelete: Cascade), so
-- nothing is orphaned.
--
--   psql postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio \
--        -f scripts/fixtures/p8b1-render-teardown.sql
--
-- Nothing else is touched: no other user, project, asset or row is named here.

\echo '--- BEFORE'
SELECT 'RenderJob' AS what, count(*)::text AS n FROM "RenderJob"
UNION ALL SELECT 'RenderStageRun', count(*)::text FROM "RenderStageRun"
UNION ALL SELECT 'RenderArtefact', count(*)::text FROM "RenderArtefact"
UNION ALL SELECT 'User(p8b1-intruder)', count(*)::text FROM "User" WHERE email = 'p8b1-intruder@cavs.test';

DELETE FROM "RenderJob"
 WHERE fixture = true
   AND "projectId" = 'p7a_fix_project'
   AND id <> 'cmvmru9v80003ffwv8t1ashup';   -- the standing fixture job: KEPT

DELETE FROM "User" WHERE email = 'p8b1-intruder@cavs.test';

\echo '--- AFTER'
SELECT 'RenderJob' AS what, count(*)::text AS n FROM "RenderJob"
UNION ALL SELECT 'RenderStageRun', count(*)::text FROM "RenderStageRun"
UNION ALL SELECT 'RenderArtefact', count(*)::text FROM "RenderArtefact"
UNION ALL SELECT 'User(p8b1-intruder)', count(*)::text FROM "User" WHERE email = 'p8b1-intruder@cavs.test';

\echo '--- WHAT REMAINS'
SELECT j.id, j.fixture, j."pipelineVersion", count(s.id) AS stage_rows
  FROM "RenderJob" j LEFT JOIN "RenderStageRun" s ON s."jobId" = j.id
 GROUP BY j.id, j.fixture, j."pipelineVersion"
 ORDER BY j.id;
