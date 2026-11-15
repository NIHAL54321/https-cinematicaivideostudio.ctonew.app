# Phase 8 — the three remaining tabs: Subtitles, Voice & Audio, Thumbnail

Served build: `master` = `fcc958f`, `bunx next start -p 3100`, BUILD_ID `ZZb5WAS8DAvA_6V_lQ1YF`
(served id read from the page's own `"b":"…"` field, equal to `.next/BUILD_ID` on disk).
Project: `cmwfum4uh0006ffuutb528ciw` — *The future of artificial intelligence*, 3 chapters, 6 scenes.
Signed-in account: `demo@cavs.test`, the project's owner (owner auto sign-in on this machine).

This pack has two sections. **A (Subtitles) is proved here.** B (Voice & Audio, Thumbnail) is
recorded in `README-b.md` when it lands.

## Why these tabs were a defect before this block

`src/components/projects/workspace.tsx` gave each of the three tabs a blurb naming a page that
**does not exist** — `/voice-studio`, `/music-studio`, `/sound-effects`, `/subtitle-studio`,
`/thumbnail-generator` — each of which answers **404** on the served build (checked 2026-11-15,
`curl -o /dev/null -w '%{http_code}'`). A surface that sends the reader to a missing page is a false
statement about the product. Those blurbs are gone in `fcc958f`.

## A. The Subtitles tab — real cues, real files, and what is *not* true

`01-subtitles-panel.png`, `dom-01-subtitles.json` (the panel's own strings, read from its
`data-testid` nodes with `JSON.stringify` of the rendered text).

**What the panel shows, in its own words:**

- *"No subtitle track is burned into any delivered file. The render pipeline's subtitle-plan stage
  plans and records cues; no burn-in has been produced or proved, and no delivered file carries a
  caption stream — the file's own recorded provenance says: “No subtitles: no subtitle cue was
  burned in, and no timed-text track is muxed.” The .srt and .vtt below are the captions
  themselves, as files you can take away."*
- *"Every cue below is derived on the server from this project's own Scene rows — the narration text
  and the duration recorded on each row — in scene order."*
- Counters, read from the panel: **CUES 2 · SCENES WITH CUES 1 / 6 · SCENES WITHOUT NARRATION 5 ·
  TIMING Explicit**.
- *"Provider Not Connected: set one of OPENAI_API_KEY, ANTHROPIC_API_KEY server-side to enable
  subtitle_generation. The cues above are NOT provider output: they are computed locally by the
  deterministic subtitle engine from the project's own narration and recorded durations…"*

**The 5 scenes with no cues are a fact about the project, not a panel failure.** Read from the
`Scene` rows: only scene 1 (*Hook*, 17 s) carries narration — the text typed during the Scenes-panel
proof (86 characters). The other five rows have `narration = ''`. A scene with no narration
produces no cue, and the panel says so by counting them.

**The files, downloaded by clicking the panel's own links:**

```
.srt  GET /api/projects/<id>/subtitles/export?style=minimal&format=srt   152 bytes
.vtt  GET /api/projects/<id>/subtitles/export?style=minimal&format=vtt   156 bytes
```

`downloads/captions.srt` (verbatim):

```
1
00:00:00,000 --> 00:00:15,276
Typed in the Scenes panel: a machine that
finishes a sentence still has to be

2
00:00:15,276 --> 00:00:17,000
checked.
```

`downloads/captions.vtt` (verbatim) is the same two cues under a `WEBVTT` header with `.` in the
timestamps. Both cues sit inside the Scene row's own recorded `durationSeconds` (17 s), which is
what "Timing is EXPLICIT" means — no timing was invented.

| bytes | SHA-256 | file |
|---|---|---|
| 197872 | see SHA256SUMS | 01-subtitles-panel.png |
| 852 | see SHA256SUMS | dom-01-subtitles.json |
| 152 | `8ff479d62b72cbf60e17776ceebc4de93777cf960f74976555ff6851681c4ca1` | downloads/captions.srt |
| 156 | `8a1118d3d3d062ef6a5a8c2ce98e3ca12431bd2f8e9c980f1c20d0b50512cb45` | downloads/captions.vtt |

## Regeneration

```bash
# served build up on :3100 (never build while it serves)
curl -s http://localhost:3100/api/health

agent-browser open http://127.0.0.1:3100/projects/cmwfum4uh0006ffuutb528ciw --session cavs
# click the "Subtitles" tab, then read the panel:
agent-browser eval "document.querySelector('[data-testid=\"no-burn-in\"]').innerText" --session cavs
agent-browser screenshot evidence/phase8_audio_subtitle_thumbnail/01-subtitles-panel.png --session cavs

# the files themselves, from the panel's own links
agent-browser download '[data-testid="download-srt"]' captions.srt --session cavs
agent-browser download '[data-testid="download-vtt"]' captions.vtt --session cavs
sha256sum captions.srt captions.vtt

# or straight from the route, with the owner's session cookie
curl -s -b cookies.txt -o captions.srt \
  "http://127.0.0.1:3100/api/projects/cmwfum4uh0006ffuutb528ciw/subtitles/export?style=minimal&format=srt"
```

## The honesty traps held in this section

- The cues are **not** provider output, and the panel says so in the provider's own terms.
- The captions are **not** in the delivered video, and the panel quotes the container's own
  provenance saying so.
- **5 of 6 scenes produce no cue** because those rows carry no narration; the panel counts them
  rather than implying the file covers the whole video.
- No search-volume, quality or "AI-generated" claim appears anywhere on this tab.
