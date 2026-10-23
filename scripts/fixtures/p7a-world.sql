-- ===========================================================================
-- P7-7a FIXTURE WORLD — the smallest honest world the P7-7a proof needs.
-- ===========================================================================
--
-- WHY THIS FILE EXISTS
--   The machine has been replaced five times. Each time the database came back
--   empty, and the browser proof had to rebuild its world by hand. This file is
--   that world, written down: apply it and the proof target exists again.
--
-- WHAT IT IS, AND WHAT IT IS NOT
--   Every row here is a FIXTURE and says so in its own data: the project title,
--   the asset names and each asset's `metadata.fixture` flag. Nothing here was
--   produced by a provider, nothing here is an export, and nothing here is a
--   caption or an image the app generated. The rows say what they say; the
--   publishing package derives from them and claims nothing else.
--
-- WHAT IT DELIBERATELY CONTAINS (each one is the input a rule needs)
--   1. One project with its own title and description, one Script (title +
--      logline), 3 chapters and 9 scenes with narration and durations that sum
--      to the project's own targetDurationSeconds (600 s), so the chapter and
--      quality sections have real rows to read.
--   2. ONE asset whose NAME contains a copyright symbol and which has NO
--      LicensingMetadata row. That single row is what makes
--        - R-SCR-COPY-RIGHTS fire with an exact character span, and
--        - R-SCR-LICENCE-GAP fire with "unknown and unverified".
--      It is the ONLY `©` in the world, so the span is unambiguous.
--   3. One STOCK asset WITH a StockAsset origin sub-row AND a LicensingMetadata
--      row whose attribution text is NOT in the assembled description, so
--      R-SCR-ATTRIBUTION-MISSING has a real row to read.
--   4. ONE subtitle track whose own SRT carries a DELIBERATE 1.000 s cue
--      overlap (cue 2 starts at 3.000 s while cue 1 ends at 4.000 s), so the
--      quality checker's subtitle_overlap check genuinely FAILS from stored data
--      instead of being theoretically capable of failing. ONE track, because the
--      checker reads the project's first subtitle track (quality.ts:
--      `source.subtitleTracks[0]`) — a second, clean track would be silently
--      unread and would make the read-out look like both were examined.
--      The subtitle asset carries a licence row (LicenseType ORIGINAL, source
--      naming this fixture script) so it does not also raise a licence-gap flag:
--      it was written by this script, not by a provider and not by the app.
--
-- IDEMPOTENCY
--   Fixed ids prefixed `p7a_fix_`; every insert is an upsert on its id, so
--   running this twice leaves the same rows. It touches nothing it did not
--   create. Re-running updates `updatedAt`, which changes the package's
--   sourceFingerprint — the package store is append-only, so a rebuild appends a
--   new version rather than rewriting the old one.
--
-- PRECONDITION
--   The proof account must already exist. It is created by
--   `scripts/fixtures/p7a-world.sh` through the app's OWN sign-up route, so this
--   file never invents a password hash and no app code changes.
--
-- APPLY:    bash scripts/fixtures/p7a-world.sh
-- REMOVE:   bash scripts/fixtures/p7a-world.sh --teardown
--           (or psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f p7a-world-teardown.sql)
-- ===========================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) The proof account must exist already. Fail loudly if it does not, rather
--    than creating a user row with a hash this file made up.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'p7a-fixture@cavs.test') THEN
    RAISE EXCEPTION 'p7a fixture account p7a-fixture@cavs.test does not exist: run scripts/fixtures/p7a-world.sh, which creates it through the app''s own sign-up route';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1) The project. Title and description are the project's OWN text — they are
--    the words the package derives its titles, description and screening scan
--    from, and the word FIXTURE is in them so no reader can mistake the row.
-- ---------------------------------------------------------------------------
INSERT INTO "Project" (id, "userId", title, description, status, "targetAspectRatio", "targetDurationSeconds", "createdAt", "updatedAt")
SELECT
  'p7a_fix_project',
  u.id,
  'The tide gauge at Ardnish (P7-7a FIXTURE project)',
  'P7-7a FIXTURE project. A short documentary about the tide gauge that has stood at the harbour mouth since 1897: the instrument, the storm that nearly took it, and the reading that followed. Every sentence in this description is this project''s own stored text.',
  'DRAFT',
  'SIXTEEN_NINE',
  600,
  now(),
  now()
FROM "User" u
WHERE u.email = 'p7a-fixture@cavs.test'
ON CONFLICT (id) DO UPDATE SET
  "userId" = EXCLUDED."userId",
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  "targetAspectRatio" = EXCLUDED."targetAspectRatio",
  "targetDurationSeconds" = EXCLUDED."targetDurationSeconds",
  "updatedAt" = now();

-- Project settings: language, tone, audience and the stored subtitle defaults
-- the safe-area check is computed FROM. No seoDefaults row: this fixture does
-- not pretend to have an SEO default it never had.
INSERT INTO "ProjectSettings" (id, "projectId", "defaultAspectRatio", language, "targetAudience", tone, style, "subtitleDefaults", "createdAt", "updatedAt")
VALUES (
  'p7a_fix_settings',
  'p7a_fix_project',
  'SIXTEEN_NINE',
  'en',
  'viewers of short observational documentary',
  'calm, documentary',
  'observational, natural light',
  '{"enabled": true, "styleId": "cinematic-lower-third", "position": "bottom"}'::jsonb,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  language = EXCLUDED.language,
  "targetAudience" = EXCLUDED."targetAudience",
  tone = EXCLUDED.tone,
  style = EXCLUDED.style,
  "subtitleDefaults" = EXCLUDED."subtitleDefaults",
  "updatedAt" = now();

-- ---------------------------------------------------------------------------
-- 2) The Script (title + logline).
-- ---------------------------------------------------------------------------
INSERT INTO "Script" (id, "projectId", title, logline, language, "targetAudience", tone, style, "createdAt", "updatedAt")
VALUES (
  'p7a_fix_script',
  'p7a_fix_project',
  'The tide gauge at Ardnish',
  'A gauge, a storm, and one reading that outlasted both.',
  'en',
  'viewers of short observational documentary',
  'calm, documentary',
  'observational, natural light',
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  logline = EXCLUDED.logline,
  language = EXCLUDED.language,
  "targetAudience" = EXCLUDED."targetAudience",
  tone = EXCLUDED.tone,
  style = EXCLUDED.style,
  "updatedAt" = now();

-- ---------------------------------------------------------------------------
-- 3) Three chapters, nine scenes, durations summing to 600 s.
-- ---------------------------------------------------------------------------
INSERT INTO "Chapter" (id, "scriptId", "projectId", title, "order", summary, "createdAt", "updatedAt")
VALUES
  ('p7a_fix_ch1', 'p7a_fix_script', 'p7a_fix_project', 'The gauge', 1,
   'A brass instrument on a concrete plinth, and the people who read it.', now(), now()),
  ('p7a_fix_ch2', 'p7a_fix_script', 'p7a_fix_project', 'The storm', 2,
   'The night the sea came over the plinth and the gauge kept recording.', now(), now()),
  ('p7a_fix_ch3', 'p7a_fix_script', 'p7a_fix_project', 'The reading', 3,
   'What the paper roll shows, and who is still reading it.', now(), now())
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  "order" = EXCLUDED."order",
  summary = EXCLUDED.summary,
  "updatedAt" = now();

INSERT INTO "Scene" (id, "chapterId", "projectId", "order", title, narration, "visualPrompt", "aspectRatio", "durationSeconds", status, "createdAt", "updatedAt")
VALUES
  -- Chapter 1 — 70 + 65 + 65 = 200 s
  ('p7a_fix_sc1', 'p7a_fix_ch1', 'p7a_fix_project', 1,
   'The plinth at first light',
   'The gauge stands on a concrete plinth at the harbour mouth. At first light the brass is the only warm colour on the quay.',
   'A brass tide gauge on a concrete plinth, dawn, sea mist, natural light',
   'SIXTEEN_NINE', 70, 'DRAFT', now(), now()),
  ('p7a_fix_sc2', 'p7a_fix_ch1', 'p7a_fix_project', 2,
   'Reading the scale',
   'The scale is engraved in feet and metres. The reader writes both down, because the harbour board asks for feet and the survey asks for metres.',
   'Close on an engraved brass scale, fingers holding a pencil',
   'SIXTEEN_NINE', 65, 'DRAFT', now(), now()),
  ('p7a_fix_sc3', 'p7a_fix_ch1', 'p7a_fix_project', 3,
   'The paper roll',
   'Inside the housing a paper roll turns once a week. The pen draws a line that nobody looks at until something goes wrong.',
   'A slow paper drum with an ink pen drawing a line, interior, low light',
   'SIXTEEN_NINE', 65, 'DRAFT', now(), now()),
  -- Chapter 2 — 70 + 70 + 60 = 200 s
  ('p7a_fix_sc4', 'p7a_fix_ch2', 'p7a_fix_project', 4,
   'The forecast',
   'The forecast on the Thursday put the swell well above the plinth. The harbour master closed the quay at four in the afternoon.',
   'Harbour wall at dusk, swell breaking over stone, wind',
   'SIXTEEN_NINE', 70, 'DRAFT', now(), now()),
  ('p7a_fix_sc5', 'p7a_fix_ch2', 'p7a_fix_project', 5,
   'Water over the plinth',
   'By eleven the sea was coming over the plinth and running back through the drain. The housing held, and the pen kept drawing.',
   'Waves washing over a concrete plinth at night, lamp light',
   'SIXTEEN_NINE', 70, 'DRAFT', now(), now()),
  ('p7a_fix_sc6', 'p7a_fix_ch2', 'p7a_fix_project', 6,
   'The morning after',
   'The morning after, the quay was covered in weed and one plank of the walkway was gone. The gauge had not moved.',
   'A storm-strewn quay at grey dawn, seaweed on stone',
   'SIXTEEN_NINE', 60, 'DRAFT', now(), now()),
  -- Chapter 3 — 70 + 65 + 65 = 200 s
  ('p7a_fix_sc7', 'p7a_fix_ch3', 'p7a_fix_project', 7,
   'Reading the roll',
   'The paper roll shows a flat line for six hours and then a spike that goes off the scale. The spike is the storm arriving.',
   'A paper chart on a table, a hand tracing a spike in the line',
   'SIXTEEN_NINE', 70, 'DRAFT', now(), now()),
  ('p7a_fix_sc8', 'p7a_fix_ch3', 'p7a_fix_project', 8,
   'The survey',
   'The survey office in the city has the same line on file, sent by post. Two copies of one week, made in two places.',
   'A map drawer opening, paper charts filed by year',
   'SIXTEEN_NINE', 65, 'DRAFT', now(), now()),
  ('p7a_fix_sc9', 'p7a_fix_ch3', 'p7a_fix_project', 9,
   'Who reads it now',
   'The gauge is still read on weekday mornings. The person who reads it has done so for nineteen years, and has never met the survey office.',
   'A person with a notebook at a harbour wall, morning light, wide',
   'SIXTEEN_NINE', 65, 'DRAFT', now(), now())
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  narration = EXCLUDED.narration,
  "visualPrompt" = EXCLUDED."visualPrompt",
  "durationSeconds" = EXCLUDED."durationSeconds",
  status = EXCLUDED.status,
  "updatedAt" = now();

-- ---------------------------------------------------------------------------
-- 4) ASSET A — the copyright symbol with NO licence row.
--    Its name carries `©` so R-SCR-COPY-RIGHTS has an exact span to quote, and
--    it has no LicensingMetadata row so R-SCR-LICENCE-GAP fires on the asset's
--    own id. Nothing here claims the asset is licensed, unlicensed or infringing:
--    the row records that this app holds no licence record for it.
-- ---------------------------------------------------------------------------
INSERT INTO "Asset" (id, "projectId", "userId", kind, name, status, "mimeType", metadata, "createdAt", "updatedAt")
SELECT
  'p7a_fix_asset_no_licence',
  'p7a_fix_project',
  u.id,
  'IMAGE',
  'P7-7a FIXTURE still (© Ardnish Harbour Trust) — no licence row on purpose',
  'READY',
  'image/jpeg',
  '{"fixture": true, "fixturePack": "P7-7a", "fixtureBy": "scripts/fixtures/p7a-world.sql", "note": "Written directly to Postgres. Not uploaded, not generated, not exported. Exists so the copyright rule has a real character span and the licence-gap rule has a real asset with no licence record."}'::jsonb,
  now(),
  now()
FROM "User" u
WHERE u.email = 'p7a-fixture@cavs.test'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  metadata = EXCLUDED.metadata,
  "updatedAt" = now();

-- Belt and braces: if a previous run (or a human) gave this asset a licence row,
-- remove it. The gap is the whole point of this row.
DELETE FROM "LicensingMetadata" WHERE "assetId" = 'p7a_fix_asset_no_licence';

-- ---------------------------------------------------------------------------
-- 5) ASSET B — a STOCK asset WITH an origin sub-row and a licence row whose
--    attribution text the assembled description does NOT contain, so
--    R-SCR-ATTRIBUTION-MISSING has a real row to read.
-- ---------------------------------------------------------------------------
INSERT INTO "Asset" (id, "projectId", "userId", kind, name, status, "mimeType", metadata, "createdAt", "updatedAt")
SELECT
  'p7a_fix_asset_stock',
  'p7a_fix_project',
  u.id,
  'STOCK',
  'P7-7a FIXTURE stock still — harbour wall at dusk',
  'READY',
  'image/jpeg',
  '{"fixture": true, "fixturePack": "P7-7a", "fixtureBy": "scripts/fixtures/p7a-world.sql", "note": "Written directly to Postgres. No provider was called and no bytes exist for it: the row exists so the licence report has a real origin row and a real licence row to read."}'::jsonb,
  now(),
  now()
FROM "User" u
WHERE u.email = 'p7a-fixture@cavs.test'
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  metadata = EXCLUDED.metadata,
  "updatedAt" = now();

INSERT INTO "StockAsset" (id, "assetId", provider, "externalId", "stockType", "pageUrl")
VALUES (
  'p7a_fix_stock',
  'p7a_fix_asset_stock',
  'pexels',
  'p7a-fixture-0001',
  'image',
  'https://www.pexels.com/photo/p7a-fixture-0001/'
)
ON CONFLICT (id) DO UPDATE SET
  provider = EXCLUDED.provider,
  "externalId" = EXCLUDED."externalId",
  "stockType" = EXCLUDED."stockType",
  "pageUrl" = EXCLUDED."pageUrl";

INSERT INTO "LicensingMetadata" (id, "assetId", "licenseType", source, attribution, "licenseUrl", "purchasedAt", "expiresAt")
VALUES (
  'p7a_fix_lic_stock',
  'p7a_fix_asset_stock',
  'ROYALTY_FREE',
  'Pexels (P7-7a FIXTURE record, not a copy of the licence)',
  'P7-7a FIXTURE credit: Ardnish Harbour Trust photo archive',
  'https://www.pexels.com/license/',
  now(),
  now() + interval '400 days'
)
ON CONFLICT (id) DO UPDATE SET
  "licenseType" = EXCLUDED."licenseType",
  source = EXCLUDED.source,
  attribution = EXCLUDED.attribution,
  "licenseUrl" = EXCLUDED."licenseUrl",
  "expiresAt" = EXCLUDED."expiresAt";

-- ---------------------------------------------------------------------------
-- 6) ONE subtitle track with a DELIBERATE 1.000 s cue overlap.
--    Cue 1 runs 0.000–4.000 s; cue 2 starts at 3.000 s, one second before cue 1
--    ends. Cue 3 starts at 10.000 s, after cue 2 ends at 7.000 s, and the last
--    cue ends at 14 s — inside the 600 s timeline. So the track is well formed
--    and inside the timeline, and exactly ONE cue pair overlaps.
--    The cue text is neutral on purpose: this fixture is here to make a timing
--    check fail, not to plant claims in the project's text.
-- ---------------------------------------------------------------------------
-- Superseded rows from an earlier revision of this file (two tracks: one clean,
-- one overlapping). Deleted first so a re-run leaves exactly one world. The
-- delete is by id, so it can only ever touch rows this script's earlier
-- revision created.
DELETE FROM "Asset" WHERE id IN ('p7a_fix_asset_sub_clean', 'p7a_fix_asset_sub_overlap');

INSERT INTO "Asset" (id, "projectId", "userId", kind, name, status, "mimeType", "durationSeconds", metadata, "createdAt", "updatedAt")
SELECT
  'p7a_fix_asset_subtitles', 'p7a_fix_project', u.id, 'SUBTITLE',
  'P7-7a FIXTURE subtitle track, DELIBERATE 1.000 s cue overlap (written by the fixture script)',
  'READY', 'application/x-subrip', 14,
  '{"fixture": true, "fixturePack": "P7-7a", "fixtureBy": "scripts/fixtures/p7a-world.sql", "note": "Written directly to Postgres because the only Subtitle-writing route needs a connected provider. Deliberate 1.000 s cue overlap so the quality checker subtitle_overlap check really fails from stored data. Not an export. Not a caption this app produced."}'::jsonb,
  now(), now()
FROM "User" u WHERE u.email = 'p7a-fixture@cavs.test'
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, metadata = EXCLUDED.metadata, "updatedAt" = now();

INSERT INTO "Subtitle" (id, "assetId", language, format, text)
VALUES (
  'p7a_fix_subtitles',
  'p7a_fix_asset_subtitles',
  'en',
  'SRT',
  E'1\n00:00:00,000 --> 00:00:04,000\nBy eleven the sea was coming over the plinth\n\n2\n00:00:03,000 --> 00:00:07,000\nThe housing held, and the pen kept drawing\n\n3\n00:00:10,000 --> 00:00:14,000\nThe morning after, the gauge had not moved\n'
)
ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, language = EXCLUDED.language, format = EXCLUDED.format;

-- The subtitle track is the fixture's own writing, so its licence record says
-- exactly that. It is NOT marked GENERATED: no provider and no app step made it,
-- and a row claiming otherwise would be a false claim inside the fixture.
INSERT INTO "LicensingMetadata" (id, "assetId", "licenseType", source, attribution, "licenseUrl", "purchasedAt", "expiresAt")
VALUES (
  'p7a_fix_lic_subtitles',
  'p7a_fix_asset_subtitles',
  'ORIGINAL',
  'Written by scripts/fixtures/p7a-world.sql (P7-7a FIXTURE)',
  NULL, NULL, NULL, NULL
)
ON CONFLICT (id) DO UPDATE SET
  "licenseType" = EXCLUDED."licenseType",
  source = EXCLUDED.source,
  attribution = EXCLUDED.attribution;

COMMIT;

-- ---------------------------------------------------------------------------
-- 7) Report what the world now is. The shell script captures this output.
-- ---------------------------------------------------------------------------
SELECT 'project' AS what, p.id, p.title, u.email AS owner
FROM "Project" p JOIN "User" u ON u.id = p."userId"
WHERE p.id = 'p7a_fix_project';

SELECT 'counts' AS what,
  (SELECT count(*) FROM "Chapter" WHERE "projectId" = 'p7a_fix_project') AS chapters,
  (SELECT count(*) FROM "Scene"   WHERE "projectId" = 'p7a_fix_project') AS scenes,
  (SELECT coalesce(sum("durationSeconds"), 0) FROM "Scene" WHERE "projectId" = 'p7a_fix_project') AS scene_seconds,
  (SELECT count(*) FROM "Asset"   WHERE "projectId" = 'p7a_fix_project' AND "deletedAt" IS NULL) AS assets,
  (SELECT count(*) FROM "Asset" a WHERE a."projectId" = 'p7a_fix_project' AND a."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "LicensingMetadata" l WHERE l."assetId" = a.id)) AS assets_without_licence,
  (SELECT count(*) FROM "Asset" a WHERE a."projectId" = 'p7a_fix_project' AND a.name LIKE '%©%') AS assets_named_with_copyright_symbol,
  (SELECT count(*) FROM "StockAsset" s JOIN "Asset" a ON a.id = s."assetId" WHERE a."projectId" = 'p7a_fix_project') AS stock_origin_rows,
  (SELECT count(*) FROM "Subtitle" s JOIN "Asset" a ON a.id = s."assetId" WHERE a."projectId" = 'p7a_fix_project') AS subtitle_tracks;

-- The two flags this world exists to raise, asserted here so the script fails
-- before a browser is ever opened if the world is wrong.
DO $$
DECLARE
  gaps int;
  marks int;
  stock int;
  attrib text;
  subs int;
  sub_text text;
BEGIN
  SELECT count(*) INTO gaps
  FROM "Asset" a
  WHERE a."projectId" = 'p7a_fix_project' AND a."deletedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "LicensingMetadata" l WHERE l."assetId" = a.id);
  IF gaps <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 asset with no licence row, found %', gaps;
  END IF;

  SELECT count(*) INTO marks
  FROM "Asset" a
  WHERE a."projectId" = 'p7a_fix_project' AND a.name LIKE '%©%';
  IF marks <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 asset name containing the copyright symbol, found %', marks;
  END IF;

  SELECT count(*) INTO stock
  FROM "StockAsset" s JOIN "Asset" a ON a.id = s."assetId"
  WHERE a."projectId" = 'p7a_fix_project';
  IF stock <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 stock origin row, found %', stock;
  END IF;

  SELECT l.attribution INTO attrib
  FROM "LicensingMetadata" l JOIN "Asset" a ON a.id = l."assetId"
  WHERE a."projectId" = 'p7a_fix_project' AND a.id = 'p7a_fix_asset_stock';
  IF attrib IS NULL OR length(attrib) = 0 THEN
    RAISE EXCEPTION 'the stock asset licence row must store an attribution string';
  END IF;

  -- The subtitle track the quality checker will read (the project's first by id)
  -- must exist, and its own SRT must carry the deliberate overlap: cue 1 ending
  -- at 04.000 s while cue 2 starts at 03.000 s.
  SELECT count(*) INTO subs FROM "Subtitle" s JOIN "Asset" a ON a.id = s."assetId"
  WHERE a."projectId" = 'p7a_fix_project' AND a."deletedAt" IS NULL;
  IF subs <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 subtitle track (the checker reads only the first), found %', subs;
  END IF;

  SELECT s.text INTO sub_text
  FROM "Subtitle" s JOIN "Asset" a ON a.id = s."assetId"
  WHERE a."projectId" = 'p7a_fix_project'
  ORDER BY s.id ASC LIMIT 1;
  IF position('00:00:04,000' in sub_text) = 0 OR position('00:00:03,000' in sub_text) = 0 THEN
    RAISE EXCEPTION 'the first subtitle track does not carry the deliberate 1.000 s cue overlap (cue 1 ends 04,000 and cue 2 starts 03,000)';
  END IF;

  RAISE NOTICE 'p7a fixture world OK: 1 licence gap, 1 copyright-symbol name, 1 stock origin row, attribution stored, 1 subtitle track with a deliberate overlap';
END
$$;
