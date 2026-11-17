# BLOCK M1 — the music library: provider layer, licence gate, routes, Music tab

Branch `phase8/music-library`, branched from `master` 3191cdd. Not merged.

## What is in here

- `panel-live.txt` — 786 B, SHA-256 `dc564f47787f8c2a1e6027005ff2ac18cc78ebf256d595147c6db77974e36038`.
  Text read out of the SERVED BUILD's Music tab (`data-testid` nodes) on 2026-11-17, for the
  owner's own project `cmwfum4uh0006ffuutb528ciw`: the "no music is in any delivered file yet"
  line, the three provider slots with their env var names (Audius configured, Epidemic Sound and
  Unminus not configured), and the empty selection.

## What was proved, and where the proof lives

| Claim | How it is proved |
| --- | --- |
| The Music tab exists in the served build and renders the panel | `panel-live.txt`, read from the live DOM after the build below |
| Audius reads answer with no credential; search/genre/mood filter server-side | probed live 2026-11-17: `genre=Electronic` → 5/5 Electronic; `mood=Peaceful` → 5/5 Peaceful; `stream` → 302 → 307 → 206 `audio/mpeg` with Range |
| The licence table refuses most of the catalogue | `src/lib/music/__tests__/licence.test.ts` — every branch, against the exact strings Audius sends ("All rights reserved", "Attribution CC BY", "Attribution-NonCommercial-ShareAlike CC BY-NC-SA", …) |
| A refusal writes ZERO rows | `src/lib/music/__tests__/service.test.ts` — memory `MusicStore`: writes 0, selection null, no defaults merged, 422 with the verdict's own reason |
| A foreign project id is a 404, not a 403-with-detail | same file: `Project not found.`, provider never called, no writes |
| Route validation (empty `q` → 400, `limit` > 50 → 400) and route auth | `src/lib/music/__tests__/query.test.ts` |
| Provider mapping against a recorded fixture | `src/lib/music/__tests__/providers.test.ts` + `__tests__/fixtures/audius-search.json` |
| No component references a provider env name | `providers.test.ts` source sweep over `src/components` |

Full suite at this commit: **1859 pass, 0 fail, 129 files**; `npx tsc --noEmit` clean.

## What was NOT captured (stated, not blurred)

The browser capture in `panel-live.txt` covers the tab, the provider slots and the empty
selection. The remaining browser steps the spec asks for — a live search's counts line and
badges, a genre filter narrowing the list, `audio.currentTime` advancing during a preview, and a
permitted plus a refused selection with their verbatim panel text — were **not** captured before
this session's budget ran out. The behaviour behind them is covered by the unit tests above and
by the live provider probes, but that is not the same as a browser capture, and this pack does
not claim it is.

## Regeneration commands

```
cd /home/team/app
kill $(pgrep -f "next start -p 3100") 2>/dev/null            # the build must not run beside the server
NODE_OPTIONS=--max-old-space-size=1536 bun run build         # 4 GB machine; heap capped
. /etc/profile.d/cto-env-vars.sh && setsid nohup bunx next start -p 3100 > /tmp/cavs-server.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/api/health   # 200
CAVS_TEST_MODE=1 bun test src/lib/music                     # 81 pass
CAVS_TEST_MODE=1 bun test                                   # 1859 pass
```
