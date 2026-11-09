# Phase 8 — the demo project "The Future of Artificial Intelligence": created and sourced, render NOT delivered

Branch `phase8/demo-project` (from `master` = `f1b4c22`). Produced 2026-11-09 between 16:10 and 16:30 UTC.

**Status in one line: the project exists, all six scenes are sourced from six real Pixabay clips stored in
our own object storage, the render was enqueued through the app's own route and ran four of its seven
stages — and the encode was killed by the machine (no memory), so there is NO delivered file, no
download proof and no screenshots. The retry was enqueued and was still encoding when the session's
budget ran out.**

---

## 1. Machine capacity, before and after

| | before | after (with the failed attempt's files on disk) |
|---|---|---|
| `df -h /` | 1008 M available (68 %) | 640 M available (80 %) |
| `df -h /home` | 780 M available (36 %) | 780 M available |
| `free -m` available | 806 MB | 139 MB free during the encode, **602 MB after `drop_caches`** |

A 120 s delivery was expected to need ~115 MB delivered + ~115 MB master. **The limit that stopped this
run was memory, not disk.** The first encode attempt ran with 139 MB free; `ffmpeg` was killed by a signal
(`ffmpeg exited null`) after ~3.5 minutes. The retry ran with 602 MB free (page cache dropped first) and
was still running when the session ended.

**No preset or encoder setting was weakened, and the timeline was NOT shortened** — the six scenes the
brief specified are the six scenes in the project.

## 2. The project — created through the app's own routes

| | |
|---|---|
| account | `demo@cavs.test` (user `cmw9gm49000b4ffw6hc2fwsy6`, created by `POST /api/auth/signup` → 201) |
| project id | **`cmw9gm8tm00bbffw6pj1up5fa`** |
| title | **The Future of Artificial Intelligence** |
| created by | `POST /api/studio/magic-create` → 200 (`inputType: SCRIPT`, `format: LONG`, `durationSeconds: 120`) |
| structure | Timeline / Chronological · 3 chapters · **6 scenes** · 120 s |
| AI step | `script` step **blocked**: *"Provider Not Connected: no provider is configured and wired for capability `script_generation`"* — the honest answer, recorded in the response |
| description | written by `PATCH /api/projects/:id` (724 chars): the script was **written by the team**, not by a model; the clips are keyword-matched and **not illustrations**; no narration/music/subtitles; nothing screened |
| scenes | title, narration and `durationSeconds: 20` each, written by `PATCH /api/projects/:id/scenes/:sceneId` (6 × 200) |

**One thing was not done through the API, and it is stated rather than hidden:** the six **visual prompts**
(the text the sourcing query is built from) were written straight into the `Scene` rows by the fixture
script, because the product's scene PATCH accepts `narration`, `title` and `durationSeconds` only — there
is no `visualPrompt` field on that route. **That is a product gap worth a small block**: a user can edit
everything about a scene's words but not the prompt its footage is chosen by. (`scripts/fixtures/p8demo-project.ts`, `create` mode.)

### The six scenes

| # | title | narration (text only — nothing speaks it) | visual prompt (sourcing hint) |
|---|---|---|---|
| 1 | A model writes a paragraph | A decade ago, a machine that could finish a sentence was a research curiosity. | a person typing at a laptop in a dim room |
| 2 | The scale of the training | Then the models got bigger, and the data got wider, and something that looked like fluency appeared. | server racks in a data centre, blinking lights |
| 3 | More than words | Now the same systems read images, hear speech and watch video. | a camera lens close up, light through glass |
| 4 | Where it still breaks | And they still invent things with total confidence, which is the part nobody has solved. | a screen full of garbled text or static |
| 5 | Working with it, not instead of it | The useful version is not replacement. It is a fast, tireless assistant you have to check. | a person sketching on a tablet at a desk |
| 6 | What we choose | The future of artificial intelligence is not a date. It is a series of choices about who checks the work. | a city skyline at dusk, wide |

**`Scene.order` is per chapter, not per project** (three chapters of two scenes each all carry orders 1 and
2). The script position above is chapter order then scene order; the fixture script numbers it 1..6. A
first authoring pass keyed on the raw `order` and put the wrong line on four scenes — it was re-run and all
six were corrected (`p8demo_create.log`).

## 3. Sourcing — six clips, each from its own scene's search

`GET /api/media?sceneId=…&mediaType=video&count=20` → **200, `status: "ok"`, 20 candidates per scene** from
the real provider; then `POST /api/media/select` (201, Asset + StockAsset + LicensingMetadata + SceneAsset
rows) and `POST /api/media/ingest` (200, the provider's bytes stored in our own object storage, read back
and hashed). The chosen id is always one the provider actually returned in the recorded search run — the
script refuses an id that was never offered.

| # | query the app built (visual prompt first, 8-term cap) | clip | author | bytes | sha256 | licence |
|---|---|---|---|---|---|---|
| 1 | person typing laptop dim room model writes decade room cinematic | pixabay/43559 | PhotoDhaba | 9,940,811 | `b80c25a2a0358752…` | ROYALTY_FREE |
| 2 | server racks data centre blinking scale training then cinematic | pixabay/14907 | cipnt | 9,419,607 | `2990933b4a2865e8…` | ROYALTY_FREE |
| 3 | camera lens close light through more than now cinematic | pixabay/9038 | padrinan | 2,746,499 | `683e69579e50256a…` | ROYALTY_FREE |
| 4 | screen full garbled text static where still they cinematic | pixabay/45242 | simovina | 4,241,433 | `d12dc2bef68e2b0f…` | ROYALTY_FREE |
| 5 | person sketching tablet desk working not useful instead cinematic | pixabay/130209 | Amorn_mimi | 6,821,441 | `94fbffca5ac79a3c…` | ROYALTY_FREE |
| 6 | city skyline dusk wide choose future artificial intelligence city future cinematic | pixabay/343478 | monirulislam_bd | 71,796,255 | `f479773536225c69…` | ROYALTY_FREE |

Full candidate lists, provider responses and page URLs: `p8demo_search.log`; the ingest transcript with
every `storedKey`: `p8demo_source.log`. Licence is `ROYALTY_FREE` per Pixabay's own summary; **no licence
was verified beyond that, and nothing was screened or cleared.**

**These clips do not illustrate their scenes.** They are keyword matches: #4 is a VHS-glitch effect on a
house, not a screen of garbled text from a model; #3 is a vintage reflex camera, not light through glass;
#1 is a laptop keyboard, not a person in a dim room. The delivered file, when there is one, must say so in
its own metadata.

## 4. The render — four of seven stages, then the machine killed the encoder

`POST /api/studio/render {action:"enqueue", projectId, presetId:"youtube-1080p"}` → **202**.

| job id | `cmw9go52e00ekffw62310ysd0` |
|---|---|
| preset | `youtube-1080p` |
| declared timeline | 6 × 20 s = **120 s**, all six scenes sourced (`everySceneHasSource` precondition met — the encode does not refuse for missing media) |

**Attempt 1** (`attemptId` recorded on the job), 210 s:

| # | stage | state |
|---|---|---|
| 1 | resolve-inputs | **SUCCEEDED** |
| 2 | assemble-timeline | **SUCCEEDED** |
| 3 | audio-mix-plan | **SUCCEEDED** |
| 4 | subtitle-plan | **SUCCEEDED** |
| 5 | encode-master | **FAILED** — `encode-master: ffmpeg exited null` (killed by a signal, not a non-zero exit), stderr truncated at the concat demuxer's input probe; `master.mp4` left partially written at 85,196,848 B |
| 6 | container-mux | not reached |
| 7 | checksum-artefact | not reached |

Stage rows verbatim: `p8demo_attempt1_stages.json`; the poller's transcript: `p8demo_render_attempt1.log`.

**Attempt 2** — `POST /api/studio/render {action:"retry", jobId}` → **202**, `attemptNumber: 2`,
`startStageId: "encode-master"`, the four succeeded stages honoured rather than re-run (the block-6
resumable retry doing its job). Response: `p8demo_retry_attempt2.json`. It was still encoding when the
session ended; **it may have finished or failed after this pack was written — check the job before
concluding anything.**

## 5. What is NOT in this pack, and why

- **No delivered container, no `RenderArtefact` row, no durable copy, no download proof, no
  `/export-center` or `/downloads` screenshots, no ffprobe read-back, no frame sheet.** All of these
  depend on `encode-master` and `container-mux` completing, and neither did in the time available.
- **`CAVS_TEST_MODE=1 bun test` was not run** in this session (the machine was at 139–600 MB available and
  the suite is memory-hungry alongside the resident server).
- **`npx tsc --noEmit` returned rc=0** on the tree as it stood mid-session (after the script's first
  refactor); the later position-numbering refactor was not re-type-checked. **`bun run build` was not run** —
  no file under `src/` was changed, so the served build still corresponds to this source.

## 6. Served build identity (checked, not assumed)

| | |
|---|---|
| served chunk | `/_next/static/chunks/main-app-4b240cd1ab7e1e9a.js` |
| SHA-256 on the wire | `3df96f4ddbb01b20624ec4b7ee8b665837d55c540cdc76cb9723f2e5920cd7f3` |
| SHA-256 on disk (`/opt/cavs-deps/.next/…`) | `3df96f4ddbb01b20624ec4b7ee8b665837d55c540cdc76cb9723f2e5920cd7f3` — **equal** |
| `BUILD_ID` | `HaJ3HYlDo1amWbZhq-wd3` |

## 7. Regenerating it

```bash
# 1. the project + the six scenes (idempotent: P8D_PROJECT re-authors an existing project)
bun scripts/fixtures/p8demo-project.ts create            # new project
P8D_PROJECT=cmw9gm8tm00bbffw6pj1up5fa bun scripts/fixtures/p8demo-project.ts create   # re-author

# 2. the search the six queries came from, then one clip per scene
bun scripts/fixtures/p8demo-project.ts search /tmp/p8demo_candidates.json
bun scripts/fixtures/p8demo-project.ts source 1 43559
bun scripts/fixtures/p8demo-project.ts source 2 14907
bun scripts/fixtures/p8demo-project.ts source 3 9038
bun scripts/fixtures/p8demo-project.ts source 4 45242
bun scripts/fixtures/p8demo-project.ts source 5 130209
bun scripts/fixtures/p8demo-project.ts source 6 343478

# 3. the render (drop the page cache first — this is the memory limit that killed attempt 1)
sync; echo 3 > /proc/sys/vm/drop_caches; free -m
bun scripts/fixtures/p8demo-project.ts render

# 4. once a container exists: the download proof (200, digest of the written file == row == header,
#    410 for the freed master, foreign 404, then the local copy DELETED and re-downloaded from
#    object storage with the identical digest)
bash scripts/fixtures/p8demo-download-proof.sh
```

## 8. What this demo is, and is not

It **is** a real project on this deployment, authored through the app's own routes, with six scenes whose
footage came from six real provider searches and is stored in this business's own object storage, rendered
through the pipeline's own seven-stage job.

It is **not** an AI-generated video, not a customer's video, and — as of this pack — **not a delivered
video at all**. The script is team-written; the clips are keyword-matched rather than illustrations; there
is no narration, music, sound effect or subtitle anywhere in it; nothing has been screened or cleared; and
the one thing the block was asked to prove — a delivered, digest-verified, downloadable file — is exactly
the thing the machine's memory would not let it finish.
