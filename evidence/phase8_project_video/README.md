# Phase 8 — the nine-scene project video, delivered (block 10)

Job `cmw5amjtb0003ffpncsz0xz7a` · project `p7a_fix_project` (fixture) · preset `youtube-1080p`
Account `p7a-fixture@cavs.test` · commit `e760ff7` + this block's commit
Produced and measured 2026-11-06 between 18:13:44 and 18:21 UTC on this machine.

**This is the first project video this business has produced.** Nine scenes, each a real
Pixabay clip stored in our own object storage, cut to 20 s each by the pipeline's own seven
ordered stages, encoded at the shipped `youtube-1080p` preset, delivered, stored durably, and
downloaded back out again as a verified transfer.

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

Copy kept for the owner (not committed): `/home/team/shared/evidence/phase8_project_video/p8b10_project_video_9scenes_youtube-1080p.mp4`,
172,271,154 B, SHA-256 `a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22` — the same digest as the row.

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

## 3. Duration arithmetic

| quantity | value |
|---|---|
| declared scene durations | 9 × 20 s = **180.000000 s** |
| measured master duration | 180.033333 s |
| measured delivered duration | **180.033333 s** |
| difference | **+0.033333 s = exactly 1 frame at 30 fps** (5401 frames, not 5400) |

The two agree to within one frame. The extra frame is a real property of the encode, not a rounding
of the report: `nb_frames=5401` at `avg_frame_rate=30/1`. Nothing is trimmed to hide it.

Scene durations were **applied as trims**, per scene, and each clip is shorter than its 20 s scene,
so the pipeline states what it did with the remainder rather than hiding it — scene #1's clip is
10.708 s and its **last frame is held for 9.292 s** (`policy: last-frame-held-to-scene-duration`,
`tpad stop_mode=clone`) so the picture freezes rather than filling with black. Each clip carries no
audio stream, so a **silent AAC 48 kHz stereo track was generated** per segment and cut to the
picture — the pipeline says so in the stage output (`plan: silent-track-added`) instead of claiming
sound the clip does not have.

## 4. The durable copy, and the master that was freed

Stored by the mux stage, read back out and hashed:

| fact | value |
|---|---|
| bucket | `cinema-studio` |
| key | `renders/cmw5aj2hs0000ffya657nkt8x/cmw5amjtb0003ffpncsz0xz7a/delivered-container-a05f3f60fbd0d889.mp4` |
| bytes storage reports | 172,271,154 |
| read-back SHA-256 | `a05f3f60fbd0d889fc24c0dfdf4cc04ec1f6f859025e065d55592562d2de6d22` |
| verified | `true` |

The **master was freed**: `master.mp4` (172,268,097 B, SHA-256 `a363b0f77c5eb23f26af56f1f2dac445699fbf06b974684a21dc43ec9b204651`)
was deleted at `2026-11-06T18:19:56.467Z` once the delivered container had been measured and stored.
Its artefact row **remains**, and the download centre reports it as "produced but gone" — which is
what it is. Keeping both would have doubled the disk on a machine with ~1.3 GB free.

## 5. The download, proved as a verified transfer

`bash scripts/fixtures/p8b10-download-proof.sh` → **RC=0, every check passed** (log: `p8b10_download_proof.log`):

| case | result |
|---|---|
| `GET /api/studio/downloads/<delivered>` | **200**, 172,271,154 bytes written |
| `sha256sum` of the written file | `a05f3f60…de6d22` — equal to the DB row **and** the `x-cavs-verified-sha256` header |
| `x-cavs-source` | `render-output` |
| produced-but-gone (`master-video`) | **410**, code `file_gone`, `durable.state = no-object`, with the sentence naming the recorded size and digest |
| foreign account asking for the same artefact | **404** (never 403) |
| **durable restore**: local file moved aside, downloaded again | **200**, `x-cavs-source: object-storage`, digest identical, `x-cavs-durable-key` naming the key above, and the file **back at the path the row names** (172,271,154 B) |

The script was extended in this block: it previously *claimed* a 410 in its header comment while
never exercising one. It now proves the 410 against the real freed master and adds the durable-restore
case.

## 6. What the browser shows

Signed in as the fixture account in a real browser (agent-browser) at `:3100`:

- `p8b10_render_panel.png` — `/export-center`, the render panel.
- `p8b10_download_centre.png` — `/downloads`.

The download centre matches the measurements exactly: 1 file downloadable, 172,271,154 B, digest
`a05f3f60…`, the master row "PRODUCED, FILE GONE" with its own sentence explaining that
`/tmp/cavs-render-output` is wiped by a reset and no file is served in its place.

### Two things the panel gets wrong — reported, not polished around

1. **The export-centre copy asserts something this block has made false.** `SPEC_DELIVERY_STATEMENT`
   (`src/lib/export/spec-matrix.ts`), `NO_PROJECT_VIDEO_SENTENCE` (`src/lib/render/encoder-facts.ts`)
   and the `/export-center` page description all still say *"No project's video has been produced on
   this build … no source media exists for a real project without a media provider."* That sentence
   was true at block 9 and is **false now**. `producedOnThisBuild: false` in the spec matrix is false
   for the same reason. Fixing it means changing three exported constants plus the assertions in
   `encoder-facts.test.ts`, `spec-matrix.test.ts`, `presets-resolve.test.ts` and
   `recommend-master.test.ts`; it is deliberately left undone rather than half-done at the end of a
   session, and it is the first thing the next block should take.
2. **The download centre's summary line reads "0 stored durably in object storage"** while the
   delivered container demonstrably *is* stored durably and is served from it. The per-file rows are
   right; the count is not.

## 7. The duplicate job

`cmw5an5i3000xffpn72zsbij6` was enqueued a second time by a fixture script while the first job was
already encoding. It was stopped before it could start a second concurrent encode on a machine that
cannot hold two. Because the encoder runs under `spawnSync`, the server's event loop was blocked and
`POST /api/studio/render {"action":"stop"}` could not be answered, so the stop was written straight to
`RenderJob.stopRequestedAt`/`stopReason` — the same two fields the API sets. The pipeline re-reads
that flag before every stage, and the job recorded exactly what happened:

> attempt `cmw5an5i4000zffpnct6fdymv` — **STOPPED**, stage 1 `resolve-inputs` **STOPPED**:
> "stopped before stage "resolve-inputs" ran: duplicate enqueue superseded by
> cmw5amjtb0003ffpncsz0xz7a (the nine-scene project render); stopped by the operator before it could
> start a second concurrent encode"

No stage row was rewritten to pretend it had run.

## 8. What this does NOT prove

- **No narration, music, sound effect or subtitle** is in this file. No provider for those is wired.
  The audio is the clips' own, re-encoded, plus generated silence where a clip had none.
- The clips are **keyword matches, not illustrations**: scene 2 is a brass pocket-watch mechanism
  where the script says a brass scale, scene 3 is a hand sketching where the script says a paper
  drum, scene 8 is a file folder where the script says a map drawer. The provenance table and the
  container comment both say so.
- **No licence was verified beyond reading Pixabay's own terms summary**, and nothing has been
  screened or cleared. A licence record is not a clearance.
- This is a **fixture project on fixture data**; it is not a customer's video and nothing is live.

## 9. Regenerating it

```bash
# the encode (job already exists; a fresh enqueue of the same project)
curl -b jar -H 'content-type: application/json' \
  -d '{"action":"enqueue","projectId":"<p7a_fix_project id>","presetId":"youtube-1080p"}' \
  http://127.0.0.1:3100/api/studio/render

# the measurements
ffprobe -v error -show_entries format=format_name,duration,size,bit_rate:format_tags -of default=noprint_wrappers=1 <file>
ffprobe -v error -show_entries stream=index,codec_type,codec_name,profile,level,width,height,pix_fmt,avg_frame_rate,sample_rate,channels,nb_frames -of default=noprint_wrappers=1 <file>
sha256sum <file>

# the download proof
bash scripts/fixtures/p8b10-download-proof.sh
```
