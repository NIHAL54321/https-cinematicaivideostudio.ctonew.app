# BLOCK M1 — the music library: provider layer, licence gate, routes, Music tab

Branch `phase8/music-library`, branched from `master` 3191cdd. **Merged to `master` as `dd46efd`**;
served build `0C7BFMvJHEAXhCLXyDf28` on port 3100, which is the build every capture below was read from.

## What is in here

- `panel-live.txt` — 786 B, SHA-256 `dc564f47787f8c2a1e6027005ff2ac18cc78ebf256d595147c6db77974e36038`.
  Text read out of the SERVED BUILD's Music tab (`data-testid` nodes) on 2026-11-17, for the
  owner's own project `cmwfum4uh0006ffuutb528ciw`: the "no music is in any delivered file yet"
  line, the three provider slots with their env var names (Audius configured, Epidemic Sound and
  Unminus not configured), and the empty selection.
- `music-steps-live.txt` — 7234 B, SHA-256
  `e09e1de554570b28424db68d2bd7a77c3ffd26fce453dad197ec6e8208f9d9a5`.
  The five steps this pack previously said were missing, captured in the browser against the same
  served build on 2026-11-17: the search counts line, genre narrowing, a preview whose
  `audio.currentTime` advances, a refused selection and a permitted one. The panel's own innerText
  verbatim, decoded from the browser's JSON return — nothing paraphrased.
- `drive.sh` — 6159 B, SHA-256 `fee446b8702dd1a14e87e39b144acbb9d80aba44f62d01b69821431788ac597e`.
  The browser driver that produces steps 1–3 and the first pass at 4–5.
- `drive2.sh` — 3507 B, SHA-256 `ba2d7b0300503d1e9e11deeade8b8dcec8e3827d0e82c4237cb501cf1849186c`.
  The clean refusal sequence: clear the selection, refuse a preview-only track from an EMPTY
  selection, then select the permitted one — so the refusal is the only thing that could have
  written and did not.

## What was proved, and where the proof lives

| Claim | How it is proved |
| --- | --- |
| The Music tab exists in the served build and renders the panel | `panel-live.txt`, read from the live DOM after the build below |
| A live search answers with the server's own counts line | `music-steps-live.txt` step 1: **20 tracks · 0 export-allowed · 20 preview-only** for `cinematic`, 20 rows rendered, 20 PREVIEW ONLY badges, 0 export-allowed |
| The genre filter narrows to a value the catalogue returned, and changes the decision | step 2: the select's options are the 12 values the catalogue returned; `Soundtrack` gives **20 tracks · 2 export-allowed · 18 preview-only**, query line verbatim. The row count stays 20 (a full page either way) — what narrowed is the decision, and the pack says so |
| A preview really plays, with `audio.currentTime` advancing | step 3: `/api/studio/music/preview/audius/ZOR97`, `paused:false`, `readyState:4`, `currentTime` 2.641151 → 6.646286 over ~4 s, duration 56.223792 |
| A refused selection quotes the server's reason and writes NOTHING | step 4, from an EMPTY selection (`drive2.sh`): clear → "Selection cleared — 1 stored row deleted.", then **"Not selected — all rights reserved — no sync or commercial use granted"**, selection still "No track selected for this project." |
| A permitted selection stores exactly 1 MUSIC row | step 5: "Cinematic Animation" / ONE ABE · @iamoneabe, EXPORT ALLOWED · uploader-claimed · attribution required, licence CC BY-SA, and the panel's own "**1 stored MUSIC row for this project**" |
| Audius reads answer with no credential; search/genre/mood filter server-side | probed live 2026-11-17: `genre=Electronic` → 5/5 Electronic; `mood=Peaceful` → 5/5 Peaceful; `stream` → 302 → 307 → 206 `audio/mpeg` with Range |
| The licence table refuses most of the catalogue | `src/lib/music/__tests__/licence.test.ts` — every branch, against the exact strings Audius sends ("All rights reserved", "Attribution CC BY", "Attribution-NonCommercial-ShareAlike CC BY-NC-SA", …) |
| A refusal writes ZERO rows | `src/lib/music/__tests__/service.test.ts` — memory `MusicStore`: writes 0, selection null, no defaults merged, 422 with the verdict's own reason |
| A foreign project id is a 404, not a 403-with-detail | same file: `Project not found.`, provider never called, no writes |
| Route validation (empty `q` → 400, `limit` > 50 → 400) and route auth | `src/lib/music/__tests__/query.test.ts` |
| Provider mapping against a recorded fixture | `src/lib/music/__tests__/providers.test.ts` + `__tests__/fixtures/audius-search.json` |
| No component references a provider env name | `providers.test.ts` source sweep over `src/components` |

Full suite at this commit: **1859 pass, 0 fail, 129 files**; `npx tsc --noEmit` clean.

## What was NOT captured (stated, not blurred)

The five browser steps the spec asks for are now captured in `music-steps-live.txt` — the counts
line, genre narrowing, a preview whose `currentTime` advances, a refusal and a permitted
selection. What remains **not** proved, and is not claimed here:

- **No music is in any delivered file.** It is not: mixing is a later block, and the panel's own
  `music-no-mix` line says so on every render.
- The badge is this product's licence decision on the licence the uploader stated. It is **not**
  a clearance, and it is **not** licence verification beyond Audius' own upload metadata.
- The genre narrowing changes the decision, not the number of rows: the provider returned a full
  page of 20 for `Soundtrack` too.
- The refusal capture in step 4 comes from a cleared selection, so "wrote nothing" is shown by the
  panel staying empty. It is the panel's own count that reads "1 stored MUSIC row" in step 5; no
  direct SQL read of the `Asset` table is in this pack.

## Regeneration commands

```
cd /home/team/app
kill $(pgrep -f "next start -p 3100") 2>/dev/null            # the build must not run beside the server
NODE_OPTIONS=--max-old-space-size=1536 bun run build         # 4 GB machine; heap capped
. /etc/profile.d/cto-env-vars.sh && setsid nohup bunx next start -p 3100 > /tmp/cavs-server.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/api/health   # 200
CAVS_TEST_MODE=1 bun test src/lib/music                     # 81 pass
CAVS_TEST_MODE=1 bun test                                   # 1859 pass

# the browser captures (owner auto sign-in is ON on this machine, so the page opens signed in)
setsid nohup bash evidence/phase8_music_library/drive.sh  > /tmp/ml-drive.log  2>&1 &   # steps 1-5
setsid nohup bash evidence/phase8_music_library/drive2.sh > /tmp/ml2-drive.log 2>&1 &   # clean refusal
# outputs land in /tmp/ml and /tmp/ml2 as one JSON file per action; /tmp is wiped on rebuild,
# which is why music-steps-live.txt carries the decoded text and the driver scripts are committed
```
