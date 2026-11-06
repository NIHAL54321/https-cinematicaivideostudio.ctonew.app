# Phase 8 — the nine-scene project video, delivered and downloaded back (block 10)

Job `cmw5amjtb0003ffpncsz0xz7a` · project `p7a_fix_project` (fixture) · preset `youtube-1080p`
Account `p7a-fixture@cavs.test` · branch `phase8/deliver-project-video`
Commits: `e760ff7` (the proof script) → `fcd7965` (scene durations as trims, durable store,
restore-before-serving) → `d9b1a91` (the encode, the delivery, the first download back) → the
evidence commit at the tip of the branch.
Produced and measured 2026-11-06 between 18:13:44 and 18:21 UTC; the download proof and the browser
work re-run 18:33–18:52 UTC on the same machine and the same served build.

**This is the first project video this business has produced.** Nine scenes, each a real Pixabay clip
stored in our own object storage, cut or held to 20 s each by the pipeline's own seven ordered
stages, encoded at the shipped `youtube-1080p` preset, delivered, stored durably, and downloaded
back out again as a verified transfer.

---

## 1. The delivered file, measured with ffprobe

| fact | measured |
|---|---|
| path | `/tmp/cavs-render-output/cmw5amjtb0003ffpncsz0xz7a/container-mux/delivered.mp4` |
| bytes | **172,271,154** |
| SHA-256 | **`a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22`** |
| container | `mov,mp4,m4a,3gp,3g2,mj2`, `major_brand=isom`, `faststart` |
| duration | **180.033333 s** |
| overall bit rate | 7,655,078 b/s |
| video | `h264`, profile **High**, level **40 (4.0)**, **1920×1080**, `yuv420p`, `r_frame_rate=30/1`, `avg_frame_rate=30/1`, **5401 frames**, 7,601,162 b/s |
| audio | `aac`, profile **LC**, **48000 Hz**, **2 channels (stereo)**, 44,976 b/s, 180.032 s, 8443 frames |
| other streams | one `data` stream (index 2) with no codec name, 1 packet, 180.033 s — carried by the mux, not a picture or a sound |
| encoder tag | `Lavf61.1.100` |
| title | `The tide gauge at Ardnish (P7-7a FIXTURE project)` |

Raw `ffprobe` output: `p8b10_ffprobe.txt` (4,161 B, SHA-256
`fc5f517a8fa2a8ca34b2a247cc5ac6d7d3e7f82a745c7eafff8fd8a7538985be`).

**The 172 MB file is not in this directory and not under `/home`.** `/home` had ~33 MB free when this
block started; a copy of the delivered mp4 was briefly placed in
`/home/team/shared/evidence/phase8_project_video/` and was **removed again** (its digest matched the
row exactly, so it was a redundant duplicate). The archive is the object-storage copy in §4. To get
the bytes back onto this machine in one command, see §9.

## 2. The `comment` tag, read back out of the container

Present and complete. It carries:

- **the nine actual sources, named**: provider, provider asset id, author, page URL and licence —
  e.g. `scene #1: pixabay id 383541 by Mario_Krimer — https://pixabay.com/videos/id-383541/; licence
  ROYALTY_FREE per Pixabay (https://pixabay.com/service/terms/); no purchase and no expiry stated by
  the provider` — and the same shape for scenes #2–#9 (136740 fotoblend, 10824 Coverr-Free-Footage,
  283533 BlenderTimer, 16160 Macb3t, 87715 Fronbondi_Skegs, 8256 Coverr-Free-Footage, 9772 HazarMan,
  10809 Coverr-Free-Footage).
- **the keyword-search sentence**: "each scene's clip was selected by a keyword search of a
  stock-footage provider … the clips are NOT commissioned, directed or model-matched illustrations of
  the narration, and a clip may show something related by keyword rather than the exact subject a
  scene describes."
- **what the audio actually is**: "the only sound this file can contain is the source clips' own
  audio, re-encoded to AAC at the delivery preset's layout; a clip served without an audio track
  contributes silence, and nothing was mixed or generated for this file."
- **what is not in it**: no narration (no voice provider produced one), no music, no sound effects,
  no burned-in subtitles and no timed-text track, and no screening or clearance was performed.

**The synthetic marker is ABSENT.** A scan of every container tag for `synthetic` and `testsrc`
returns false; the mux stage's own `containerMarkedSynthetic` is `false` and `syntheticProof` is
`false`. The file is labelled `Not AI-generated: … no image or video model produced any frame`.

The comment is the file's own claim, quoted here; it was not edited.

## 3. What the timeline actually did — nine segments, from the stage records

Full table, basis strings and extractor: **`p8b10_segment_table.md`** (5,414 B, SHA-256
`f5a7a154b8c1afc8cd91831bece1925df2a12db3585ba473df2d0b45474727aa`). Read from the
`RenderStageRun` rows (`encode-master.source.clips[]` and `assemble-timeline`), **not** from the
encoder argv.

| # | scene | policy | trimmed s | held s | clip measured s | segment target s | audio |
|---|---|---|---|---|---|---|---|
| 1 | `p7a_fix_sc1` | `last-frame-held-to-scene-duration` | 0 | 9.292 | 10.708333 | 20 | silent track added |
| 2 | `p7a_fix_sc2` | `last-frame-held-to-scene-duration` | 0 | 5.367 | 14.633333 | 20 | clip audio kept |
| 3 | `p7a_fix_sc3` | `last-frame-held-to-scene-duration` | 0 | 4.96 | 15.04 | 20 | silent track added |
| 4 | `p7a_fix_sc4` | `trimmed-to-scene-duration` | 20.067 | 0 | 40.066667 | 20 | silent track added |
| 5 | `p7a_fix_sc5` | `trimmed-to-scene-duration` | 19.957 | 0 | 39.956667 | 20 | clip audio kept |
| 6 | `p7a_fix_sc6` | `trimmed-to-scene-duration` | 10.4 | 0 | 30.4 | 20 | clip audio kept |
| 7 | `p7a_fix_sc7` | `last-frame-held-to-scene-duration` | 0 | 5.28 | 14.72 | 20 | silent track added |
| 8 | `p7a_fix_sc8` | `last-frame-held-to-scene-duration` | 0 | 10 | 10 | 20 | silent track added |
| 9 | `p7a_fix_sc9` | `last-frame-held-to-scene-duration` | 0 | 7.696 | 12.303958 | 20 | silent track added |

- **Six scenes were held, three were cut.** A clip shorter than its 20 s scene has its last frame held
  (`tpad stop_mode=clone`) for exactly the shortfall — 42.595 s of held time in total; a clip longer
  than its scene is cut at the scene's duration (`-t`) — 50.424 s removed in total.
- **Six of the nine clips carried no audio stream**, so a silent AAC 48 kHz stereo track was generated
  per segment and cut to the picture; three kept their own audio. That is the whole of the sound.

### Duration arithmetic

| quantity | value |
|---|---|
| per-scene segment target | **20 s × 9** (`segmentDurationSeconds`, all nine scenes) |
| planned timeline (`assemble-timeline`) | `clipCount 9`, `totalDurationMs 180000`, `lastEndMs 180000` |
| sum of the nine declared targets | **180.000000 s** |
| measured master duration | 180.033333 s |
| measured delivered duration | **180.033333 s** |
| difference | **+0.033333 s = exactly one frame at 30 fps** (1/30 = 0.0333333); `ffprobe` counts **5401** frames, not 5400 |

So the file is one frame longer than the nine targets sum to, and that is reported rather than
rounded away. **Which segment carries the extra frame is not proved by anything on this machine**:
the stage records a per-scene *target*, not a per-scene *measured* duration, and the nine segment
files were deleted when the encode finished (only `encode-master/timeline.ffconcat`, listing the nine
normalised inputs, remains). Frame-boundary rounding in the concat demuxer is a plausible cause — it
is a hypothesis and is not asserted here as the explanation.

## 4. The durable copy, and the master that was freed

Stored by the mux stage, read back out and hashed by the pipeline itself:

| | |
|---|---|
| bucket | `cinema-studio` |
| key | `renders/cmw5aj2hs0000ffya657nkt8x/cmw5amjtb0003ffpncsz0xz7a/delivered-container-a05f3f60fbd0d889.mp4` |
| bytes storage reports | 172,271,154 |
| read-back SHA-256 | `a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22` |
| verified | `true` |

The **master was freed**: `master.mp4` (172,268,097 B, SHA-256
`a363b0f77c5eb23f26af56f1f2dac445699fbf06b974684a21dc43ec9b204651`) was deleted at
`2026-11-06T18:19:56.467Z` once the delivered container had been measured and stored. Its artefact
row **remains**, and the download centre reports it as "produced but gone" — which is what it is.
Keeping both would have doubled the disk on a machine with ~1.3 GB free.

## 5. The download, proved as a verified transfer

`bash scripts/fixtures/p8b10-download-proof.sh` → **RC=0, every check passed** on this run.
Transcript: `p8b10_download_proof.log` (2,775 B, SHA-256
`494f1a5d3d0925ecfb871a9cd49d1ae024a188c2a3f9991179ee32d9f07e2d92`).

| case | result |
|---|---|
| `GET /api/studio/downloads/cmw5aujbs001dffpnodjma8b7` | **200**, **172,271,154 bytes** written (`size_download`), `Content-Length` 172,271,154 |
| `sha256sum` of the bytes on disk | `a05f3f60…de6d22` — equal to the `RenderArtefact` row **and** the `x-cavs-verified-sha256` header |
| `x-cavs-source` | `render-output` |
| produced-but-gone (`master-video`) | **410**, code `file_gone`, `durable.state = no-object`, with the sentence naming the recorded size and digest |
| foreign account asking for the same artefact | **404** (never 403), after proving that account's session is real (`GET /api/studio/downloads` → 200 for it) |
| **durable restore**: local file moved aside, downloaded again | **200**, **172,271,154 bytes**, `x-cavs-source: object-storage`, digest identical, `x-cavs-durable-key` naming the key in §4, and the file **back at the path the row names** |

The bytes came back **out of object storage** and were re-checked by the same size+digest gate before
being served: the download route fetches the stored object, hashes it, refuses it if the digest
differs from the recorded one, and only then writes it to the render path and streams it.

A **third** restore was run at the end, from the state §6 created (the local copy deleted outright,
not moved aside):

```
local before: ABSENT
download=200 bytes=172271154
x-cavs-source      : object-storage
x-cavs-verified-sha: a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22
content-length     : 172271154
sha256 written     : a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22
local after        : 172271154 a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22
```

So the local file named by the artefact row is back on this machine, restored from the stored copy,
at the recorded size and digest.

### A real failure found in the script, and fixed

The first run of the script in this session **failed**, and the failure was in the proof, not the
product:

```
== 5. a foreign account asking for the same artefact
signup_foreign=409
foreign_download=401
FAIL  foreign account gets 404, never 403: got '401', expected '404'
RESULT: 1 check(s) FAILED
RC=1
```

The foreign account is created on the first run, so on every later run `POST /api/auth/signup`
answers **409** and the cookie jar stays empty — the "foreign" request was then simply
**unauthenticated**, and a 401 tells you nothing about tenant isolation. The script now falls back to
`POST /api/auth/signin` when signup does not answer 201, **and** proves the session is real by
fetching that account's own download centre and requiring **200** before asking for the foreign
artefact. Nothing was weakened: a check was added. The re-run passes with `signup_foreign=409`,
`signin_foreign=200`, `foreign_own_downloads=200`, `foreign_download=404`.

## 6. What the browser shows

Signed in as the fixture account in a real browser (agent-browser) against `:3100`. Log:
`p8b10_browser_drive.log` (1,092 B, SHA-256 `884378b32b26350c13d75941ffffada7c4503e93d7798b3f49128fd0ebd8503c`).

| shot | what it is | bytes / SHA-256 |
|---|---|---|
| `p8b10_render_panel.png` | `/export-center`, the render panel | 243,191 B / `79b82cba4097bc793cd372de0175c619c65c1b6a3a2aebf471dcf1c20c6285e2` |
| `p8b10_download_centre.png` | `/downloads`, delivered file **present on this machine** | 174,505 B / `7653b870a8b6cbf206262e7fde92db3341bc6350ca37a6540907d15ea4ecdb3b` |
| `p8b10_download_centre_durable.png` | `/downloads` with the local copy **deleted** — the durable state | 176,921 B / `9f3847ff5ed0aa3524b414c78fff7f8f71a2b6aeae0cd9f34bd8cd3a038d455b` |

The download centre reads correctly in both states, and the two readings are the proof that the state
is derived rather than fixed:

- **present** — `2 artefact rows for your projects: 1 present on this machine, 0 stored durably in
  object storage, 1 whose file is gone, 0 not at the recorded size. 172,271,154 B in total can be
  downloaded right now.` with the badge `ON THIS MACHINE`, the recorded size `172,271,154 B`, the
  recorded SHA-256 `a05f3f60…` and a `Download 172,271,154 B` link to
  `/api/studio/downloads/cmw5aujbs001dffpnodjma8b7`.
- **durable** (local file deleted, page reloaded) — `0 present on this machine, 1 stored durably in
  object storage, 1 whose file is gone`, the badge `STORED DURABLY`, and the sentence naming the key:
  "Not on this machine's disk, but stored durably in this deployment's own object storage at
  `renders/cmw5aj2hs0000ffya657nkt8x/cmw5amjtb0003ffpncsz0xz7a/delivered-container-a05f3f60fbd0d889.mp4`
  (172,271,154 B, the recorded size). The download fetches that copy back, checks it against the
  recorded SHA-256 `a05f3f60fbd0d889…` and refuses it if the bytes differ." The master row still reads
  `PRODUCED, FILE GONE` with its own sentence and **no** download link.

### Two things the panels get wrong — reported, not polished around

1. **The `/export-center` copy asserts something this block has made false.** The rendered page still
   says: *"No project's video has been produced on this build and none can be yet: a project holds no
   source media until a media provider is connected, so its render reaches the encode stage and stops
   there, naming that missing input."* Every clause of that is now wrong — a project's video **has**
   been produced on this build, from nine clips of a connected media provider. The same claim lives in
   `SPEC_DELIVERY_STATEMENT` (`src/lib/export/spec-matrix.ts`), `NO_PROJECT_VIDEO_SENTENCE`
   (`src/lib/render/encoder-facts.ts`) and `producedOnThisBuild: false` in the spec matrix, with
   assertions in `encoder-facts.test.ts`, `spec-matrix.test.ts`, `presets-resolve.test.ts` and
   `recommend-master.test.ts` pinned to the old text. **It was deliberately not fixed in this block**:
   changing `src/` without rebuilding would make the served build no longer match the source, and
   `bun run build` OOMs while the server is resident (see §7). It is the first thing the next block
   should take, and it needs a rebuild to land.
2. **The summary line under-reports durable storage.** When a file is both on this machine and in
   object storage, the artefact's state is `present`, and the summary counts only artefacts whose
   state is `durable` — so the line reads "0 stored durably in object storage" while a durable copy
   demonstrably exists and would be served. The per-file rows are right; the summary sentence is
   misleading. Also a `src/` change, so also left for the next block.

## 7. Gates on this commit

| gate | result |
|---|---|
| `npx tsc --noEmit` | **rc=0** |
| `CAVS_TEST_MODE=1 bun test` (full suite) | **1611 pass, 0 fail, 35,775 expect() calls, 108 files** |
| served build identity | served chunk `/_next/static/chunks/main-app-4b240cd1ab7e1e9a.js`, 559 B, SHA-256 `3df96f4ddbb01b20624ec4b7ee8b665837d55c540cdc76cb9723f2e5920cd7f3` — **equal to the same file on disk** (`/opt/cavs-deps/.next/…`) |
| source newer than the build | `.next/BUILD_ID` = `n4QcCzGKVCm4DPfij7APC`, written `2026-11-06 18:26:02`; **0 files under `src/` are newer than it** (newest: `2026-11-06 18:10`). The build on disk is the build for this source. |
| `git status --porcelain` at the proved commit | only this block's evidence files |

**`bun run build` was NOT re-run, deliberately.** The server is resident on `:3100` and a build
alongside it OOMs on this machine. `tsc` itself was **killed (exit 137) on the first attempt** with a
640 MB heap cap while the app was serving; it returned **rc=0** once the browser daemon was closed and
835 MB was available, with the app still serving. That is the machine's stated limit, not a retried
loop: one attempt failed for memory, memory was freed by closing something I owned, the next attempt
passed. Build identity is therefore proved by **chunk digest** plus the `src/`-vs-`BUILD_ID` mtime
comparison above, not by a fresh build.

## 8. Every artefact in this pack

| file | bytes | SHA-256 |
|---|---|---|
| `p8b10_download_proof.log` | 2,775 | `494f1a5d3d0925ecfb871a9cd49d1ae024a188c2a3f9991179ee32d9f07e2d92` |
| `p8b10_segment_table.md` | 5,414 | `f5a7a154b8c1afc8cd91831bece1925df2a12db3585ba473df2d0b45474727aa` |
| `p8b10_render_panel.png` | 243,191 | `79b82cba4097bc793cd372de0175c619c65c1b6a3a2aebf471dcf1c20c6285e2` |
| `p8b10_download_centre.png` | 174,505 | `7653b870a8b6cbf206262e7fde92db3341bc6350ca37a6540907d15ea4ecdb3b` |
| `p8b10_download_centre_durable.png` | 176,921 | `9f3847ff5ed0aa3524b414c78fff7f8f71a2b6aeae0cd9f34bd8cd3a038d455b` |
| `p8b10_browser_drive.log` | 1,092 | `884378b32b26350c13d75941ffffada7c4503e93d7798b3f49128fd0ebd8503c` |
| `p8b10_ffprobe.txt` | 4,161 | `fc5f517a8fa2a8ca34b2a247cc5ac6d7d3e7f82a745c7eafff8fd8a7538985be` |
| `p9_provenance_table.md` (nine-row source table) | 3,295 | `ed258ecc8b7a08961348a41c36a6a78b992ad710adc928500679434ada48728a` |
| `p8b10_mux_stage_output.txt` (container-mux stage output) | 6,122 | (see the commit) |
| `p8b10_render_panel_probe.json`, `p8b10_download_centre_probe.json`, `p8b10_download_centre_durable_probe.json` | 4,362 / 2,868 / 2,939 | page text as read in the browser |

The delivered video itself: **172,271,154 B**, SHA-256
`a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22` — **not** in this repository and
not under `/home`. Archive copy: bucket `cinema-studio`, key
`renders/cmw5aj2hs0000ffya657nkt8x/cmw5amjtb0003ffpncsz0xz7a/delivered-container-a05f3f60fbd0d889.mp4`.

## 9. Regenerating it

```bash
# the measurements
ffprobe -v error -show_entries format=format_name,duration,size,bit_rate:format_tags -of default=noprint_wrappers=1 <file>
ffprobe -v error -show_entries stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,avg_frame_rate,sample_rate,channels,nb_frames -of default=noprint_wrappers=1 <file>
sha256sum <file>

# the download proof (signs in, downloads, 410, foreign 404, durable restore)
bash scripts/fixtures/p8b10-download-proof.sh

# put the bytes back on this machine from object storage, through the app's own route
curl -s -c /tmp/jar -H 'content-type: application/json' \
  -d '{"email":"p7a-fixture@cavs.test","password":"p7a-fixture-password-2026"}' \
  http://127.0.0.1:3100/api/auth/signin
curl -b /tmp/jar -D /tmp/h.txt -o /tmp/out.mp4 \
  http://127.0.0.1:3100/api/studio/downloads/cmw5aujbs001dffpnodjma8b7
sha256sum /tmp/out.mp4    # a05f3f60…de6d22

# the per-segment table
psql "$DB" -A -t -c "select output::text from \"RenderStageRun\" \
  where \"jobId\"='cmw5amjtb0003ffpncsz0xz7a' and \"stageId\"='encode-master';" > /tmp/encmaster.json
# then the extractor printed in p8b10_segment_table.md

# build identity by chunk digest
CH=$(curl -s http://127.0.0.1:3100/signin | grep -o '/_next/static/chunks/main-app-[^"]*' | head -1)
curl -s "http://127.0.0.1:3100$CH" -o /tmp/served.js
sha256sum /tmp/served.js "/opt/cavs-deps/.next${CH#/_next}"
find src -type f -newer /opt/cavs-deps/.next/BUILD_ID | wc -l   # must be 0
```

## 10. The duplicate job

`cmw5an5i3000xffpn72zsbij6` was enqueued a second time by a fixture script while the first job was
already encoding. It was stopped before it could start a second concurrent encode on a machine that
cannot hold two. Because the encoder runs under `spawnSync`, the server's event loop was blocked and
`POST /api/studio/render {"action":"stop"}` could not be answered, so the stop was written straight to
`RenderJob.stopRequestedAt`/`stopReason` — the same two fields the API sets. The pipeline re-reads
that flag before every stage, and the job recorded exactly what happened:

> attempt `cmw5an5i4000zffpnct6fdymv` — **STOPPED**, stage 1 `resolve-inputs` **STOPPED**:
> "stopped before stage \"resolve-inputs\" ran: duplicate enqueue superseded by
> cmw5amjtb0003ffpncsz0xz7a (the nine-scene project render); stopped by the operator before it could
> start a second concurrent encode"

No stage row was rewritten to pretend it had run. **It was left stopped.**

## 11. What this does NOT prove

- **No narration, music, sound effect or subtitle** is in this file. No provider for those is wired.
  The audio is the clips' own, re-encoded, plus generated silence where a clip had none.
- The clips are **keyword matches, not illustrations**: scene 2 is a brass pocket-watch mechanism
  where the script says a brass scale, scene 3 is a hand sketching where the script says a paper
  drum, scene 8 is a file folder where the script says a map drawer. The provenance table and the
  container comment both say so.
- **No licence was verified beyond reading Pixabay's own terms summary**, and nothing has been
  screened or cleared. A licence record is not a clearance.
- The **duration agreement is one frame short of exact**, and which segment carries the extra frame
  is not measured (see §3).
- This is a **fixture project on fixture data**; it is not a customer's video and nothing is live.
- The **export-centre copy still denies that any project video exists** (§6) — a stale claim in the
  product surface, not in the file.
