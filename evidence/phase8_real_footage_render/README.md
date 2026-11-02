# Phase 8 block 7b — the first real project video

A Pixabay stock clip was fetched once, stored in this business's own object storage,
encoded by the pipeline's own seven ordered stages at the 1080p preset, and delivered
with a container that names its sources.

**What this file is:** stock footage from Pixabay under its Content Licence, edited by
this pipeline. **What it is not:** AI-generated, narrated, scored, subtitled, screened,
or cleared. No image or video model produced any frame.

## The run

| | |
|---|---|
| account | p7a-fixture@cavs.test |
| project | `cmvzeotkx0001ffqppezpljbw9` — "Real footage, one scene — a Pixabay clip encoded by this pipeline" |
| scene | `cmvzeotl10007ffqpbo5fvxhm` (1 of 1 — every scene is on the timeline) |
| asset | `cmvzeotmv0005ffillpcwddp0` (POST /api/media/select → 201) |
| render job | `cmvzeou1q000dffilsietrogx`, preset `youtube-1080p`, `syntheticProof=false` |
| stages | all 7 SUCCEEDED (resolve-inputs → assemble-timeline → audio-mix-plan → subtitle-plan → encode-master → container-mux → checksum-artefact) |
| started by | `POST /api/studio/render {action:"enqueue"}` → 202, run by the served app's own worker |

## The stored footage (POST /api/media/ingest → 200)

| | |
|---|---|
| provider | pixabay, id 3713, author bellergy, https://pixabay.com/videos/id-3713/ |
| licence | ROYALTY_FREE per Pixabay (https://pixabay.com/service/terms/); purchasedAt / expiresAt **null** — Pixabay stated neither |
| object key | `footage/cmvv8g5ow0000ffphqnyrfyf9/cmvzeotmv0005ffillpcwddp0-0eb6160276151828.mp4` |
| bucket | cinema-studio |
| bytes | 11,749,650 |
| sha256 | `0eb61602761518281073ac95031d33fadec5bc9fe0181b457c18b840614e4fd7` |
| verification | fetched → stored → **read back out of storage and hashed again**; storage reports the same byte count and the read-back hash equals the fetched hash |

## The delivered file

| | |
|---|---|
| bytes | 20,114,274 |
| sha256 | `4f5f5c611c146d3733ec64658c0b8fbef8dd1dc48da0477dbb7bffdddd068829` |
| video | H.264 **High**, level **4.0**, **1920×1080**, yuv420p, **30/1 fps** |
| audio | AAC LC, 48,000 Hz, 2 channels — the clip's own audio; **no narration, music or SFX was mixed** |
| duration | 20.100 s |
| bitrate | 8,005,681 b/s |
| container tags | `title` = the project's title; `comment` = the provenance below; **no synthetic marker** |

Container comment, generated from the scene's own StockAsset / LicensingMetadata rows:

> Not AI-generated: the picture is stock footage as the providers served it, edited by this
> pipeline; no image or video model produced any frame. Sources: pixabay. scene #1: pixabay
> id 3713 by bellergy — https://pixabay.com/videos/id-3713/; licence ROYALTY_FREE per Pixabay
> (https://pixabay.com/service/terms/); no purchase and no expiry stated by the provider.
> No narration: no voice provider produced a voiceover for this file, so it carries none.
> No music or sound effects: nothing was mixed from a music or SFX provider. No subtitles:
> no subtitle cue was burned in, and no timed-text track is muxed. No screening or clearance
> was performed on this file or its sources; a licence record is not a clearance.

## Does the delivered file really carry that footage?

`frame-comparison.txt` — ffmpeg's `psnr` filter over the first 20 s, delivered vs the
**normalised timeline segment** that the encode stage produced from the stored object:

* average PSNR **29.23 dB** (y 27.49, u 46.95, v 48.10)
* **negative control**: the same measurement against a generated `testsrc2` pattern —
  average PSNR **10.63 dB**

**What this establishes:** the delivered picture is the clip's picture, not a pattern's,
and not a blank or colour frame — 18.6 dB of separation between "the footage" and
"a different picture" is not something a coincidence produces.

**What it does NOT establish:** it is not a per-frame identity. The 29.23 dB is what a
20-second stock clip looks like after being decoded, letterboxed to 1080p, re-encoded to
an intermediate at CRF 18, then encoded again at the preset's 8 Mbps — two lossy
generations. Nor does it compare against the *raw provider bytes*: the comparison target
is the normalised segment, whose own provenance is the stage record (materialised from the
object key above, digest checked against the asset row before it was normalised). A
pixel-identical comparison against the raw CDN file was not run.

## Regeneration

```bash
# 1. store the clip's bytes (needs the fixture account's session cookie)
curl -s -b cookies.txt -X POST http://127.0.0.1:3100/api/media/ingest \
  -H 'content-type: application/json' -d '{"assetId":"<assetId>"}'
# 2. enqueue a REAL (non-synthetic) render at 1080p
curl -s -b cookies.txt -X POST http://127.0.0.1:3100/api/studio/render \
  -H 'content-type: application/json' -d '{"action":"enqueue","projectId":"<projectId>","presetId":"youtube-1080p"}'
# 3. everything above, in order, from a clean project
bun scripts/fixtures/p8rf-real-footage-render.ts
# 4. the measurements
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_type,codec_name,profile,level,width,height,pix_fmt,avg_frame_rate,sample_rate,channels -of default=nw=1 delivered.mp4
ffmpeg -hide_banner -nostats -i delivered.mp4 -t 20 -i timeline-segment-as-encoded.mp4 \
  -lavfi "[0:v]scale=1920:1080,format=yuv420p[a];[1:v]scale=1920:1080,format=yuv420p[b];[a][b]psnr" -f null -
```

## Files

| file | bytes | sha256 |
|---|---|---|
| delivered.mp4 | 20114274 | `4f5f5c611c146d3733ec64658c0b8fbef8dd1dc48da0477dbb7bffdddd068829` |
| timeline-segment-as-encoded.mp4 | 24898404 | `592af593413113653808f884b11e4f3df81b249125ba820b556ca4de967a359c` |
| run.log | 1792 | `5185341c02ca313af5874a1ebf01375c4d88a0f32c1e11dd42a2485e74ec1615` |
| run.json | 83096 | `4be1498968c97bfe36013245774703490834d41bdc30a98c5f823605d0f15df1` |
| stage-rows-and-artefacts.txt | 1805 | `99bbcaa3e869ad171c1df0cf416d3e3336f8100286057b8235f93ddb8579f4cc` |
| ffprobe-delivered.json | 5410 | `5aa57dd6147819d45b293e14d2b321bbfdcfcefb86f69d14cb966adc784aff5b` |
| ffprobe-timeline-segment.json | 4621 | `948c1a1e4fd66daf906e2e2f016637e4e258e2b8e077a5d9b91309ddb4dac495` |
| frame-comparison.txt | 640 | `30f4053415b8ce824c260dd92572df664941a96ac542c1f70dd43e2fd9053ec7` |
| delivered-summary.txt | 1339 | `893d9de4aa5f9be641a2c1a39b13a6fa8617bbdb2e34a39ab5f63f0fa6a23d65` |

The two .mp4 files (delivered.mp4, 20,114,274 B and timeline-segment-as-encoded.mp4, 24,898,404 B) are NOT committed: they live at /home/team/shared/evidence/phase8_real_footage_render/ and their digests are in the table above.
