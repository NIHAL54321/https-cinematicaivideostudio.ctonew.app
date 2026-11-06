# What the timeline actually did — the nine segments, read from the stage records

Job `cmw5amjtb0003ffpncsz0xz7a`. Source: the `RenderStageRun` rows for `encode-master`
(`source.clips[]`, one entry per scene) and `assemble-timeline` (`clips[]`, the planned offsets) —
**not** from the encoder argv. The argv records what ffmpeg was told; these fields record what the
pipeline decided per scene and why.

```bash
DB=$(grep -E '^DATABASE_URL' /home/team/app/.env | cut -d= -f2- | tr -d '"')
psql "$DB" -A -t -c "select output::text from \"RenderStageRun\" \
  where \"jobId\"='cmw5amjtb0003ffpncsz0xz7a' and \"stageId\"='encode-master';"   > /tmp/encmaster.json
psql "$DB" -A -t -c "select output::text from \"RenderStageRun\" \
  where \"jobId\"='cmw5amjtb0003ffpncsz0xz7a' and \"stageId\"='assemble-timeline';" > /tmp/assemble.json
# the table below is printed by the extractor in section 5 of this file
```

## The nine segments

| # | scene | policy | trimmed s | held s | scene s | clip measured s | segment target s | clip audio | audio plan |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `p7a_fix_sc1` | `last-frame-held-to-scene-duration` | 0 | 9.292 | 20 | 10.708333 | 20 | False | `silent-track-added` |
| 2 | `p7a_fix_sc2` | `last-frame-held-to-scene-duration` | 0 | 5.367 | 20 | 14.633333 | 20 | True | `clip-audio-kept` |
| 3 | `p7a_fix_sc3` | `last-frame-held-to-scene-duration` | 0 | 4.96 | 20 | 15.04 | 20 | False | `silent-track-added` |
| 4 | `p7a_fix_sc4` | `trimmed-to-scene-duration` | 20.067 | 0 | 20 | 40.066667 | 20 | False | `silent-track-added` |
| 5 | `p7a_fix_sc5` | `trimmed-to-scene-duration` | 19.957 | 0 | 20 | 39.956667 | 20 | True | `clip-audio-kept` |
| 6 | `p7a_fix_sc6` | `trimmed-to-scene-duration` | 10.4 | 0 | 20 | 30.4 | 20 | True | `clip-audio-kept` |
| 7 | `p7a_fix_sc7` | `last-frame-held-to-scene-duration` | 0 | 5.28 | 20 | 14.72 | 20 | False | `silent-track-added` |
| 8 | `p7a_fix_sc8` | `last-frame-held-to-scene-duration` | 0 | 10 | 20 | 10 | 20 | False | `silent-track-added` |
| 9 | `p7a_fix_sc9` | `last-frame-held-to-scene-duration` | 0 | 7.696 | 20 | 12.303958 | 20 | False | `silent-track-added` |

- **Six scenes were held, three were cut.** A clip shorter than its 20 s scene has its **last frame
  held** (`tpad stop_mode=clone`) for exactly the shortfall — 42.595 s of held time in total; a clip
  longer than its scene is **cut at the scene's duration** (`-t`) — 50.424 s removed in total.
  The basis string the stage records for scene 1 is representative:

  > "the clip is 10.708 s and the scene declares 20 s, so the clip's LAST FRAME is held for 9.292 s
  > (tpad stop_mode=clone) to reach 20 s — the picture does not move and nothing is filled with
  > black; the held time is stated rather than hidden"

- **Six of the nine clips carried no audio stream**, so a silent AAC 48 kHz stereo track was
  generated per segment (`anullsrc`) and cut to the picture; three clips kept their own audio. That
  is the whole of the sound in this file: no narration, no music, no sound effect.
- `clip measured s` is the **normalised** clip's own measured duration (the fit-not-crop
  normalisation output), recorded by the stage per scene. It is the only per-scene measured number.

## The nine targets were 20 s each, and the sum is 180 s

| quantity | value | where it comes from |
|---|---|---|
| per-scene segment target | **20 s × 9** (`segmentDurationSeconds`) | `encode-master.source.clips[].trim`, all nine |
| planned timeline | `clipCount 9`, `totalDurationMs 180000`, `lastEndMs 180000` | `assemble-timeline` output |
| sum of the nine declared targets | **180.000 s** | 9 × 20 |
| measured master duration | **180.033333 s** | `encode-master.measured.durationSeconds` |
| measured delivered duration | **180.033333 s** | `container-mux.ffprobeReadBack.durationSeconds` |
| difference | **+0.033333 s** | = exactly **one frame at 30 fps** (1/30 = 0.0333333) |

`ffprobe` counted **5401 frames** at `avg_frame_rate=30/1`, not 5400 — so the file really is one
frame longer than the nine targets sum to, and the report is not rounding it away.

**Which segment carries that extra frame is not proved by anything on this machine.** The stage
records a per-scene *target*, not a per-scene *measured* duration, and the nine segment files were
removed when the encode finished (only `encode-master/timeline.ffconcat`, listing the nine
normalised inputs, remains). Frame-boundary rounding in the concat demuxer is a plausible cause;
it is a hypothesis, and this pack does not assert it as the explanation.

## The extractor that printed the table

```python
import json
em = json.load(open('/tmp/encmaster.json'))
at = json.load(open('/tmp/assemble.json'))
for c in sorted(em['source']['clips'], key=lambda x: x['order']):
    t = c['trim']
    print(c['order'], c['sceneId'], t['policy'], t['trimmedSeconds'], t['heldSeconds'],
          t['sceneDurationSeconds'], t['sourceDurationSeconds'], t['segmentDurationSeconds'],
          c['audio']['sourceHasAudio'], c['audio']['plan'])
print('sum targets:', sum(c['trim']['segmentDurationSeconds'] for c in em['source']['clips']))
print('assemble totalDurationMs:', at['totalDurationMs'], 'lastEndMs:', at['lastEndMs'])
print('encode-master measured:', em['measured']['durationSeconds'])
print('delivered measured:', json.load(open('/tmp/mux.json'))['ffprobeReadBack']['durationSeconds'])
```
