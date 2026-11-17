# The 40-line production checklist — answered, item by item

2026-11-17. `master` = `f0409b7`, served build `lBV12IFkQWrFfsb1IsulE`.
Project used throughout: `cmwfum4uh0006ffuutb528ciw` (*The future of artificial intelligence*),
delivered jobs `cmwg3bam20001ffeo88k3mw2q` and `cmwi40c45001dffv2fm6lyglc`.

**This checklist did not exist before this document.** The business plan referred to "the 40-line
production checklist" as if it were an existing artefact; no such file existed in the repository, the
shared folder, or the team's history. It is written here as the forty questions a faceless-video
product must answer before anyone pays for it, and each is answered from what can be shown.

Legend: **YES** = proved with a file, a row or a browser capture · **PARTLY** = true with a stated
limit · **NO** = does not exist and is said so.

## A. Does it make a video at all?

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Can a project hold chapters, scenes, narration and durations? | YES | 3 chapters, 6 scenes; Scenes panel edits persist across reload |
| 2 | Does every scene have a source clip? | YES | 6 of 6 sourced (Pixabay 203987, 203986, 183107, 174086, 200609, 183108) |
| 3 | Does a render run all seven stages end to end? | YES | job `cmwg3bam…`: resolve-inputs → checksum-artefact all SUCCEEDED |
| 4 | Is the output a valid 1080p H.264 + AAC mp4? | YES | ffprobe: h264 1920×1080 30/1 + aac 48 kHz stereo, 120.033 s |
| 5 | Can the finished file be downloaded and its digest verified? | YES | 118,049,344 B `067c3924…`; 118,043,723 B `4c1dfe76…`, both re-hashed on the written file |

## B. Is the picture true to the script?

| # | Question | Answer | Evidence |
|---|---|---|---|
| 6 | Does each clip illustrate its scene? | **NO** | contact sheet: keyboard, hands, lens, tablet, skyline — none matches its scene; the container's own metadata says so |
| 7 | Is each clip's provenance recorded per scene? | YES | `SceneAsset` rows: provider, author, external id, licence, bytes |
| 8 | Is the licence verified beyond the provider's summary? | PARTLY | Pixabay's own ROYALTY_FREE summary only; nothing checked independently |
| 9 | Has any footage been rights-screened or cleared? | **NO** | `screenedOrCleared: false` in the container-mux row |
| 10 | Are the encoded picture parameters measured, not declared? | YES | 7,867,396 b/s, H.264 High L4.0, yuv420p, faststart, 3,601 frames |

## C. Is there any sound?

| # | Question | Answer | Evidence |
|---|---|---|---|
| 11 | Is there narration? | **NO** | 20 of 20 voice personas have `providerVoiceId: null`; no TTS provider wired; no `Voiceover` row |
| 12 | Is there music? | **NO** | `musicProduced: false`; music select/duck are plans only |
| 13 | Are there sound effects? | **NO** | the sfx plan is a plan; no audio file behind it |
| 14 | Is the audio track itself valid? | YES | aac 2 ch 48 kHz beside h264 in both delivered files — but it carries none of 11–13 |
| 15 | Is loudness measured against the −14 LUFS target? | **NO** | the preset declares −14 LUFS; the mux row records `loudness.tool: null` — never measured |

## D. Text and captions

| # | Question | Answer | Evidence |
|---|---|---|---|
| 16 | Can captions be produced from the project's own rows? | YES | `.srt` 152 B `8ff479d6…`, `.vtt` 156 B `8a1118d3…`, computed server-side |
| 17 | Are captions burned into the delivered video? | **NO** | `subtitlesBurnedIn: false`; the panel says so and quotes the file |
| 18 | Is caption timing derived from real scene durations? | YES | every cue sits inside its Scene row's own `durationSeconds` |
| 19 | Do the captions cover the whole video? | **NO** | 1 of 6 scenes carries narration → 2 cues for a 120 s video; the panel counts the 5 empty scenes |

## E. Thumbnail, title and SEO

| # | Question | Answer | Evidence |
|---|---|---|---|
| 20 | Does a thumbnail image exist? | **NO** | 0 `Thumbnail` rows, 0 `THUMBNAIL` assets; `thumbnail_generation` has no provider |
| 21 | Is there a title and description? | YES | project title; description states team-written script, keyword-matched clips, no narration/music/subtitles |
| 22 | Is there any SEO data (keywords, volume, difficulty)? | **NO** | no data source exists; no number may be invented |
| 23 | Are there chapters/timestamps? | PARTLY | 3 chapters exist in the project; no YouTube-style timestamp list has been produced |

## F. Formats and presets

| # | Question | Answer | Evidence |
|---|---|---|---|
| 24 | Is 1080p SDR deliverable? | YES | two delivered files, measured |
| 25 | Is 4K deliverable on this machine? | **NO** | at the shipped preset's default settings the encoder was killed (exit 137); HEVC measured at level 5.0 vs declared 5.1 |
| 26 | Is 1440p deliverable? | **NO** | produced no file |
| 27 | Is vertical (9:16) deliverable? | **NO** | preset exists with declared facts; no file has been produced from it |

## G. Delivery and durability

| # | Question | Answer | Evidence |
|---|---|---|---|
| 28 | Is there a durable copy beyond the working disk? | YES | object storage key `renders/…/delivered-container-<sha>.mp4`, read back and hashed equal |
| 29 | Would the file survive this machine being rebuilt? | **NO** | object storage is local to this machine; a reset wipes both copies |
| 30 | Does the download route re-measure before serving? | YES | size and SHA-256 re-checked; 410 `file_gone` for a freed master; 404 (never 403) for a foreign account |

## H. Reliability under the operator's hand

| # | Question | Answer | Evidence |
|---|---|---|---|
| 31 | Can a render be stopped, with its reason recorded? | YES | stage STOPPED with "stopped from the Export tab"; delivery reads NOT REACHED |
| 32 | Does a retry after a stop reach delivery? | YES | attempt 3 ran past the stop and delivered; the stop flag is cleared on retry |
| 33 | Can one attempt execute twice? | **NO** | refused by `AttemptAlreadyRunError`; `createStageRun` is P2002-tolerant |
| 34 | Does the server stay responsive during an encode? | YES | `/api/health` 200 in 12–38 ms while 1080p x264 ran |

## I. Security, tenancy and audit

| # | Question | Answer | Evidence |
|---|---|---|---|
| 35 | Can one account reach another's project or file? | **NO** | foreign-account download → 404; tenancy enforced on every query |
| 36 | Is the app hardened against the attacks we probed? | PARTLY | SSRF, headers, timing oracle, content types fixed; **4 findings remain open** (XFF trust, DNS rebinding, in-process rate limit, shared object-store key) |
| 37 | Has an external party audited the security? | **NO** | only our own probe; passing it is not a claim the app is secure |

## J. Money, operations and the honesty of the whole thing

| # | Question | Answer | Evidence |
|---|---|---|---|
| 38 | Can the business take a payment today? | **NO** | Stripe Connect onboarding incomplete; no transactions, no revenue, no balance |
| 39 | Is there an approved price? | **NO** | the billing surface shows an empty plan catalogue with its reason |
| 40 | Can the machine be rebuilt and the app recovered? | PARTLY | `scripts/recover.sh` is scripted and has run seven times; **produced videos do not survive it** |

## Score

- **YES: 17** · **PARTLY: 4** · **NO: 19**. (Counted from the forty rows below, not from memory: the first version of this line said 16 / 5 and was wrong by one.)
- The product can produce a real, downloadable 1080p file from a script **and it says out loud, on
  every surface, that the file has no voice, no music, no subtitles burned in, and that its clips
  were found by keyword rather than matched to the scene.**
- The three things that stand between this and something a customer would pay for: **a provider that
  makes voice and music real (11–13, and the precondition for 19)**, **a visual step that matches picture to script (6)**,
  and **a payment path (38–39)**.
