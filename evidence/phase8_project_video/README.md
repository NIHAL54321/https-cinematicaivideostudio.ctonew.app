# Phase 8 block 9 — all nine scenes sourced, the query bug fixed, the machine left able to encode

**Branch `phase8/source-nine-scenes`, from `master` = `07f776e`.** No encode ran in this block: the lead's
decision (state it, don't relitigate it) is that a 180 s timeline is the most this machine can hold, and the
preset is not weakened to fit.

## 1. The semantic query bug — fixed, with the regression named as a test

`buildSemanticQuery` concatenated narration + visualPrompt + title and took the first 8 tokens, so the
**narration ate the cap** and the concrete subject never reached the provider. Scene 2 ("Reading the scale",
visual prompt "Close on an engraved brass scale, fingers holding a pencil") queried:

    before: scale engraved feet metres. reader writes both down cinematic     ← no brass, no fingers, no pencil
    after : close engraved brass scale fingers reading feet holding cinematic  ← the scale survives

`src/lib/media/semantic.ts` now draws the subject from **visual prompt (5 guaranteed terms) → title (2) →
narration (1)**, topping up in that order to the same cap of 8; unused share rolls forward. Pure and
deterministic (tested). A term also loses sentence punctuation at its ends — a sentence-final `metres.` could
never match `metres` at a provider or in the ranker; internal punctuation (`close-up`, `time-lapse`) is kept.

Tests: `src/lib/media/__tests__/semantic-subject-order.test.ts` — the named regression (scale, not feet), plus
ordering with every combination of supplied fields, dedupe across fields, the cap, purity, determinism.
**Negative control:** the test `the query is not the old narration-only string` fails against the old code.

The before/after table for all nine scenes is `p9_queries_before.txt` / `p9_queries_after.txt`, produced by
`bun scripts/fixtures/p8b9-query-table.ts <out>` against the real scene rows — regenerated, never typed.

## 2. Nine of nine scenes carry their own stored, digest-verified clip

Every clip was sourced through the app's own routes: `GET /api/media?sceneId=…&mediaType=video` →
`POST /api/media/select` → `POST /api/media/ingest` (fetch once, store under a digest-derived key, **read it
back out of storage and hash what came back**). Driver: `scripts/fixtures/p8b9-source-nine.ts`.
Full provenance (query sent → provider id → author → page URL → stored key → bytes → sha256 → licence):
**`p9_provenance_table.md`**. Raw provider answers: `p9_candidates.log`.

| # | clip | honest judgement of the match |
|---|------|-------------------------------|
| 1 | pixabay/3713 bellergy, 20 s, 11,749,650 B | **Loosely related.** A cruise ship in a harbour. Kept from block 8 per the brief (scene 1 was not in the re-source list) and ingested here for the first time — it had a CDN URL and **no stored bytes** until this block. No gauge, no plinth. |
| 2 | pixabay/136740 fotoblend, 14 s, 29,325,269 B | **Replaced the flagged mismatch** (old: pixabay/254, stairs and feet). A brass pocket-watch mechanism in close-up: brass, engraved metal and close framing match; **it is a clock, not a scale.** The old asset row is kept in the library; its SceneAsset link is deleted, so it is not the scene's visual. |
| 3 | pixabay/10824 Coverr, 15 s, 9,053,653 B | A hand sketching with a pen on paper — the drawing action matches; **no paper drum, no housing.** |
| 4 | pixabay/283533 BlenderTimer, 40 s, 38,263,129 B | A wave breaking on a coast — the breaking swell matches; **no harbour wall, no dusk.** |
| 5 | pixabay/16160 Macb3t, 40 s, 25,746,330 B | A storm sea at night — night, wind and waves match; **no plinth, no lamp light.** |
| 6 | pixabay/87715 Fronbondi_Skegs, 30 s, 18,685,891 B | A shoreline at sunrise — sea and dawn match; **no quay, no seaweed, no storm damage.** (The best keyword match, 206271 with seaweed, is 414,533,220 B — see §4.) |
| 7 | pixabay/8256 Coverr, 15 s, 8,312,094 B | A hand writing on paper at a table — paper, table and hand match; **no chart, no traced spike.** |
| 8 | pixabay/9772 HazarMan, 10 s, 842,891 B | A file folder and paperwork — filing and archive match; **no map drawer, no charts.** |
| 9 | pixabay/10809 Coverr, 12 s, 7,727,538 B | A jogger on a coastline in the morning — a person by the sea in morning light; **no notebook, no harbour wall.** |

**Stated plainly: no clip is a literal illustration of its scene.** Pixabay's library has no tide gauge, no
paper drum and no map drawer, and this is recorded per row rather than called a match. Every row is real
footage the provider served, stored in this business's own object storage with its digest verified on read-back.

Verification query (re-runnable): **9 of 9 scenes have a stored clip**; scene-duration sum **180 s** over
**9 scenes**.

## 3. The 180 s timeline is a MACHINE-CAPACITY decision, not a product limit

Every scene is declared at **20 s**, so the timeline totals **180 s**. That is a decision about what this
machine can hold at once — a ~180 MB master plus a ~180 MB delivered file plus the upload copy — and it is
**NOT a product limit**: the product targets long-form up to 120 minutes. The same sentence is written into
the project's own record (`Project.targetDurationSeconds = 180` and its `description`), so nobody later reads
the 180 s timeline as the product's capability.

## 4. A real product bug this block hit and fixed: ingest buffered before it checked size

The best keyword match for scene 6 was `pixabay/206271` — 4K, 49 s, tagged *seaweed, algae, seashore, morning*.
Its `_large` rendition is **414,533,220 bytes**. `MAX_FOOTAGE_BYTES` is 200 MB, but the check ran **after**
`await res.arrayBuffer()`, so the clip was read into this machine's memory first and **took the whole app
process down** — the request never got as far as a 413 and every later request got ECONNREFUSED.

Fixed in `src/lib/media/footage.ts`: the declared `content-length` is now checked **before** a single body byte
is buffered, and the refusal is a typed 413 that says nothing was downloaded and nothing was stored. The
post-buffer check stays, because a chunked response declares no length. Regression test:
`src/lib/media/__tests__/footage-size-guard.test.ts` asserts the ordering (guard before buffer), the 413, and
that the body is not read when the guard fires. **Scene 6 was then sourced from the next-best 1080p candidate.**

## 5. Disk reclaimed and the budget for the next block

`/tmp/cavs-render-output` held **260,086,760 B** of re-creatable render output (30 mp4s from the synthetic
encoder proofs and block 7b's delivered file — every one already recorded in evidence with its digest, none
unique). The full manifest is `p9_disk_before.txt`. Cleared, along with stale block logs, the re-fetchable
`/tmp/pixabay-3713.mp4`, and `/tmp/node-compile-cache`.

- `/` before: **3.1 G total, 2.0 G used, 1.2 G free**. After: **3.1 G total, 1.9 G used, 1.3 G free**.
- `/home` unchanged: 600 M total, 199 M free (the app's `node_modules`/`.next` live in `/opt`).
- `/tmp` went from ~297 MB to 9.9 MB.
- The nine stored clips total **131,642,801 B** in object storage (`/opt/minio/data`).
- Memory while the app serves: ~700–1,000 MB available.

**The next block can hold a ~180 MB master plus a ~180 MB delivered file plus the upload copy at once**
(~540 MB) inside the 1.3 GB free, but nothing else may be running while it encodes.

## 6. Gates, in order (all run on this tree)

- `npx tsc --noEmit` → **rc=0**, run with the app stopped (with it running at 685 MB free it was OOM-killed
  twice). That run was on the tree at commit `9c7df89`; after the `footage.ts` fix the type-check that ran was
  Next's own (`next build` → "Linting and checking validity of types" → **rc=0**), and `tsc` was **not**
  re-run on the final commit — stated rather than glossed.
- `CAVS_TEST_MODE=1 bun test` → **1591 pass, 0 fail, 105 files** (was 1575/104; +16 tests, +1 file). The media
  subset (`bun test src/lib/media`) after the footage fix: **76 pass, 0 fail, 7 files**.
- `bun run build` → **rc=0**.
- `scripts/restart-3100.sh` → **13 [PASS], 0 [FAIL], rc=0**, "RESULT: OK — the server on :3100 was replaced".
- Served-build identity by **chunk digest**: `main-app-4b240cd1ab7e1e9a.js` served over HTTP hashes to
  `3df96f4ddbb01b20624ec4b7ee8b665837d55c540cdc76cb9723f2e5920cd7f3`, **equal to the file on disk**
  (`p9_chunk_digest.txt`). `/api/health` → 200.

## 7. What is still NOT proved

**No encode ran in this block** and no master or delivered file exists for this project. Nothing has been
sourced beyond these nine clips, no narration/music/subtitles exist (no provider is wired for them), no
thumbnail exists, and no licence has been verified beyond reading Pixabay's own summary. Scene durations are
declared, not yet applied as trims. `pixabay/206271` remains in the asset library with **no stored bytes** and
no scene link. Scene 1's clip is honestly only loosely related to its scene.

---

# Phase 8 block 8 — the 9-scene project video (PARTIAL)

**Read this before redoing anything.**

## What is proved (commit `b61eb3d` on `phase8/project-video-9-scenes`)

The refusal guard, fired against the REAL project on the served build — not a test.

- Account: p7a-fixture@cavs.test · project `p7a_fix_project` (9 scenes, 60–70 s each, 600 s declared)
- `POST /api/studio/render {action:"enqueue", projectId:"p7a_fix_project", presetId:"youtube-1080p"}` → **202**, job `cmvzf1ls8001xffil51ntup6g`
- Stages 1–4 SUCCEEDED (resolve-inputs, assemble-timeline, audio-mix-plan, subtitle-plan); progress derived **45 % = (10+15+10+10)/100**
- Stage 5 `encode-master` **REFUSED**, verbatim:

  > encode-master REFUSES to encode this project: 8 of 9 scene(s) carry no source media — scene(s) #2 (p7a_fix_sc2),
  > #3 (p7a_fix_sc3), #4 (p7a_fix_sc4), #5 (p7a_fix_sc5), #6 (p7a_fix_sc6), #7 (p7a_fix_sc7), #8 (p7a_fix_sc8),
  > #9 (p7a_fix_sc9). A master built from 1 of 9 scenes would be delivered as the project's video while missing the
  > rest of it, so no encode runs. Attach footage to every scene, or encode a project that has one.

  (1 of 9 was already sourced from block 7b, so the refusal is proved on a PARTIALLY sourced project — the harder case.)

Artefacts: `p1_job.json` (full read-out, 8 unsourced scenes named), `p1_summary.txt` (stage rows), `p1_enqueue.json`, `p1.log`.
Regenerate: sign in as the fixture account, then `POST /api/studio/render` with the body above and `GET /api/studio/render?jobId=…`.

## What is NOT done

Priority 2 (source all 9), priority 3 (encode + durable delivery + download proof + browser), priority 4
(gates `tsc` / `bun test` / `build` / restart / chunk-digest, full evidence pack).

## State left behind

- Scene `p7a_fix_sc2` now HAS footage: Pixabay 254 (1920×1080, 45 s, by Life-Of-Vids),
  asset `cmvzf2y8a002rffilmyijuoly`, 26,471,623 B, sha256 `e9c6802c45c16e219dd88f5d8327b50375340474d95bb3bbd8de6acf1949f993`,
  key `footage/cmvv8g5ow0000ffphqnyrfyf9/cmvzf2y8a002rffilmyijuoly-e9c6802c45c16e21.mp4`.
  **The query that produced it is poor**: `buildSemanticQuery` concatenates narration + visualPrompt + title and
  caps at 8 terms, so the NARRATION consumes the cap and the concrete visual subject never reaches the provider
  ("Reading the scale" → `scale engraved feet metres. reader writes both down cinematic` → a clip of *stairs and feet*).
  Fix before sourcing the rest: lead the subject with `visualPrompt`, then `title`, then `narration`
  (`src/lib/media/semantic.ts`, `const subject = termsFromText(raw, 8)`). Good queries return good clips — proved
  by hand: `harbour storm waves` → storm breakwater lighthouse; `old paper chart map` → old map, calligraphy, old book.
  Also prefer candidates whose duration ≥ the scene's (45–76 s clips exist) so scenes are TRIMMED, not held.
- Branch `wip/phase8-project-video-9-scenes` (= `eb32242`) holds the **unverified** code work: `planSegmentTrim` +
  `-t`/`tpad` segment length in `source-clip.ts`, the length check and per-clip `trim` record in `executors.ts`,
  a chunked `sha256File` (a 200 MB master must not be read into a 730 MB machine), and `delivery-store.ts`
  (durable copy at `renders/<userId>/<jobId>/<kind>-<sha256:16>.<ext>`, uploaded from a stream, read back and hashed).
  **It is not type-checked** — `npx tsc --noEmit` was OOM-killed twice (`rc=137`) with ~730 MB free.
  Finish it there, do not merge it as-is.

## Machine facts this block learned (measured, not guessed)

- 2 vCPUs, ~730 MB available while the app serves. `tsc` needs more than that → stop the dev server, or run it
  before anything else in the block.
- Preset encode speed measured on a real 70 s 1080p segment: **~6 fps** (libx264 default `medium`, `-b:v 8000k`)
  → a 600 s master is roughly **50 minutes**. The 70 s normalisation (`veryfast`, CRF 18) took 23 s and wrote 35 MB.
- Static/held content lands well under the 8 Mbps target (measured 2.3 Mbps), so a mostly-held 600 s master is
  ~170 MB, not 600 MB. Disk: 1.2 GB free on `/` (MinIO data included), 199 MB on `/home`.
