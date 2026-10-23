# P7-7a fixture world

The machine has been replaced **five times**. Each replacement emptied the database and cost a
session rebuilding the proof target by hand. This directory is that rebuild, written down.

```
scripts/fixtures/p7a-world.sh              # create the world (and optionally capture the package)
scripts/fixtures/p7a-world.sql             # the rows it creates, all upserts on fixed ids
scripts/fixtures/p7a-world-teardown.sql    # removes exactly those rows
scripts/fixtures/p7a-package-readout.mjs   # turns a captured package into the compact read-out
docs/evidence/p7a-world-2026-10-23/        # a capture taken from the live server on 2026-10-23
```

## Rebuild it

```bash
cd /home/team/app
bash scripts/fixtures/p7a-world.sh --capture      # world + package capture + read-out
bash scripts/fixtures/p7a-world.sh                # world only
bash scripts/fixtures/p7a-world.sh --teardown     # remove exactly what it created
```

The script checks the database and `/api/health` first, creates the account through the app's
own `/api/auth/signup` route, applies the SQL, reads the project back through a real session,
and (with `--capture`) builds the publishing package through `POST /api/studio/publishing`.

**No app code is involved and none is changed.** If the account already exists but its password
has drifted, the script resets the hash with the app's own scheme (`scrypt:<salt-hex>:<key-hex>`,
64-byte key — the format `src/lib/auth.ts` writes) and signs in again.

## The world

| what | id | why the proof needs it |
|---|---|---|
| proof account | `p7a-fixture@cavs.test` / `p7a-fixture-password-2026` | sign in; created by the sign-up route |
| project | **`p7a_fix_project`** — "The tide gauge at Ardnish (P7-7a FIXTURE project)" | the proof target; title and description are its own stored text |
| script | `p7a_fix_script` (title + logline) | title/description derivation |
| chapters | `p7a_fix_ch1..3` | chapter timings |
| scenes | `p7a_fix_sc1..9`, durations summing to **600 s** = the project's own `targetDurationSeconds` | chapter coverage + scene narration |
| asset, **no licence row** | `p7a_fix_asset_no_licence` — its name carries `©` | `R-SCR-COPY-RIGHTS` with an exact span, and `R-SCR-LICENCE-GAP` |
| stock asset | `p7a_fix_asset_stock` + `StockAsset p7a_fix_stock` + `LicensingMetadata p7a_fix_lic_stock` | a real origin row (`stock_asset` / `pexels`) and an attribution the description does not contain → `R-SCR-ATTRIBUTION-MISSING` |
| subtitle track | `p7a_fix_asset_subtitles` / `p7a_fix_subtitles` | 3 cues; cue 1 ends 4.000 s while cue 2 starts 3.000 s, so `subtitle_overlap` genuinely **fails** |

Every row is labelled a fixture **in its own data**: the project title says `P7-7a FIXTURE`, each
asset name says `P7-7a FIXTURE`, and each asset's `metadata.fixture` is `true` with a note saying
what it is and what it is not.

**One subtitle track, not two.** `quality.ts` reads `source.subtitleTracks[0]` — the project's
first track by id. A second, clean track would be silently unread while the read-out looked as if
both had been examined, so the deliberate overlap lives in the only track there is.

## What it does not do

- It writes no `Thumbnail` row, calls no provider, and produces no video file.
- It does not touch any project, user or row it did not create. The teardown deletes by fixed id,
  and deletes the fixture account only if that account owns no other project.
- It is idempotent: fixed ids and upserts throughout. Re-running leaves the same rows (and appends
  a new package version, because the package store is append-only by design).

## The capture in `docs/evidence/p7a-world-2026-10-23/`

Taken from the served build `7p96uAMy8P2JZafy9h0-p` (== `.next/BUILD_ID` on disk) on 2026-10-23.

| file | what it is |
|---|---|
| `package_capture.json` | the full `POST /api/studio/publishing` response (1.4 MB), format `cavs.publishing-package/v6` |
| `package_readout.json` | the same facts reduced to what the proof quotes |
| `package_readout.txt` | the read-out as printed |
| `world_build.txt` | `p7a-world.sh --capture` from an empty database, `RC=0` |
| `world_teardown.txt` | `p7a-world.sh --teardown`, before/after counts, `RC=0` |

Key read-outs (all read out of the package's own JSON):

- `format` = `cavs.publishing-package/v6`, `block` = `P7-1..P7-8`, project `p7a_fix_project`.
- 3 screening flags:
  - `R-SCR-COPY-RIGHTS` · row `asset p7a_fix_asset_no_licence` · field `name` · **span 21–22** · matched `"©"`
  - `R-SCR-LICENCE-GAP` · row `asset p7a_fix_asset_no_licence` · field `licensing`
  - `R-SCR-ATTRIBUTION-MISSING` · row `licensing p7a_fix_lic_stock` · field `attribution`
- **7 of 7** screening areas carry "not screened — no capability".
- Licences: 3 assets, 2 with a licence row, **1 `unknown_unverified`** whose reason is
  "Asset row p7a_fix_asset_no_licence has no LicensingMetadata row, so its licence is unknown and
  unverified."; the stock asset reads `verified_row`, `ROYALTY_FREE`, origin `stock_asset` / `pexels`.
- Quality: 17 checks — **5 pass, 1 fail, 11 not measured**; score **83** over the 6 measured checks
  (36 of the 100 declared weight), `30 ÷ 36 × 100`, with the failing check named
  (`subtitle_overlap`, 1 overlapping pair).

## Standing facts this does not change

No successful provider response has ever been seen; no video file exists; `ffprobe`/`ffmpeg` are
not installed; unkeyed, every provider value stays gated and names its env var. Nothing here is
evidence that generation, export or publishing works.
