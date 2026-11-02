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
