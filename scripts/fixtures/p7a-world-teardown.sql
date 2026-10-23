-- ===========================================================================
-- P7-7a FIXTURE WORLD — teardown.
-- ===========================================================================
--
-- Removes EXACTLY the rows `p7a-world.sql` creates and nothing else:
--   * the project `p7a_fix_project` and everything that hangs off it
--     (ProjectSettings, Script, Chapter, Scene, Asset, StockAsset,
--      LicensingMetadata, Subtitle, PublishingPackage) — by foreign-key cascade;
--   * the proof account `p7a-fixture@cavs.test`, and its sessions, but ONLY if
--     that account owns no project other than the fixture one. If a human ever
--     put a real project under the fixture account, the account is left alone
--     and this script says so.
--
-- It prints the counts it is about to delete, deletes, then prints the counts
-- again so the caller can see the world is gone.
--
-- APPLY:  bash scripts/fixtures/p7a-world.sh --teardown
--    or:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/fixtures/p7a-world-teardown.sql
-- ===========================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Before.
SELECT 'before' AS when_stage,
  (SELECT count(*) FROM "Project" WHERE id = 'p7a_fix_project') AS fixture_projects,
  (SELECT count(*) FROM "Project" WHERE "userId" = (SELECT id FROM "User" WHERE email = 'p7a-fixture@cavs.test')) AS projects_owned_by_fixture_account,
  (SELECT count(*) FROM "Chapter" WHERE "projectId" = 'p7a_fix_project') AS chapters,
  (SELECT count(*) FROM "Scene"   WHERE "projectId" = 'p7a_fix_project') AS scenes,
  (SELECT count(*) FROM "Asset"   WHERE "projectId" = 'p7a_fix_project') AS assets,
  (SELECT count(*) FROM "Subtitle" s JOIN "Asset" a ON a.id = s."assetId" WHERE a."projectId" = 'p7a_fix_project') AS subtitles,
  (SELECT count(*) FROM "LicensingMetadata" l JOIN "Asset" a ON a.id = l."assetId" WHERE a."projectId" = 'p7a_fix_project') AS licence_rows,
  (SELECT count(*) FROM "StockAsset" s JOIN "Asset" a ON a.id = s."assetId" WHERE a."projectId" = 'p7a_fix_project') AS stock_rows,
  (SELECT count(*) FROM "PublishingPackage" WHERE "projectId" = 'p7a_fix_project') AS packages;

-- The project and every child row, by cascade.
DELETE FROM "Project" WHERE id = 'p7a_fix_project';

-- The account, only when the fixture project was the only thing it owned.
DELETE FROM "User" u
WHERE u.email = 'p7a-fixture@cavs.test'
  AND NOT EXISTS (
    SELECT 1 FROM "Project" p
    WHERE p."userId" = u.id AND p.id <> 'p7a_fix_project'
  );

COMMIT;

-- After: every number that should now be zero, and the account state.
SELECT 'after' AS when_stage,
  (SELECT count(*) FROM "Project" WHERE id = 'p7a_fix_project') AS fixture_projects,
  (SELECT count(*) FROM "Chapter" WHERE "projectId" = 'p7a_fix_project') AS chapters,
  (SELECT count(*) FROM "Scene"   WHERE "projectId" = 'p7a_fix_project') AS scenes,
  (SELECT count(*) FROM "Asset"   WHERE "projectId" = 'p7a_fix_project') AS assets,
  (SELECT count(*) FROM "PublishingPackage" WHERE "projectId" = 'p7a_fix_project') AS packages,
  (SELECT count(*) FROM "User" WHERE email = 'p7a-fixture@cavs.test') AS fixture_account_remaining;

-- Say plainly which case happened, so a reader does not have to infer it.
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT count(*) INTO remaining FROM "User" WHERE email = 'p7a-fixture@cavs.test';
  IF remaining = 0 THEN
    RAISE NOTICE 'teardown complete: fixture project and fixture account both removed';
  ELSE
    RAISE NOTICE 'teardown complete for the fixture project; the fixture account was KEPT because it owns another project — remove it by hand if that is not what you want';
  END IF;
END
$$;
