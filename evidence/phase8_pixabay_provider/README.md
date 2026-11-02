# Phase 8 block 7a — the keyed Pixabay stock-video leg, proved end to end

Branch `phase8/pixabay-media-provider`. Supersedes the earlier README in this directory
(the adapter-only pack); this one carries the two code fixes and the live, keyed proof.

## What is proved here

A real `PIXABAY_API_KEY` (saved on this machine in `/etc/profile.d/cto-env-vars.sh`; its **value is
never printed, logged or committed** anywhere in this pack) let the served build on `:3100`:

1. **search** stock video through the app's own route, with the provider named in the answer;
2. **select** one hit, writing `Asset` + `StockAsset` + `LicensingMetadata` + `SceneAsset` rows;
3. have the chosen CDN file **downloaded and measured** with `ffprobe`.

This is the first real stock footage this business has ever held — and "held" is precise: the
database row is a **reference** (URL + provider id + licence), not a copy. The bytes were fetched by
hand for measurement; nothing on this machine stored them.

## The two code bugs fixed (they were the blocker)

- `src/lib/media/semantic.ts` — `resolveMediaType()` could never return `"video"` for an explicit
  request: everything except `AI_VIDEO` fell through to `return "image"`, so `?mediaType=video` was
  ignored and the video-only Pixabay adapter was skipped on every route-built request. Now an
  explicit `"VIDEO"`/`"video"`/`"AI_VIDEO"` resolves to `video`; `STOCK`/`AI_IMAGE`/`ANIMATION`/`IMAGE`
  stay `image`; missing/unknown keeps the documented default (`image`). Nothing is guessed from text.
  The resolution is also stated in the query's own `rationale.mediaType`.
- `src/lib/media/providers/pexels.ts` — the guard read `if (!this.isConfigured)` (a function
  reference, always truthy), so a keyless Pexels search went to the network instead of reporting
  `not_connected`. Now `if (!this.isConfigured())`, with a test asserting **zero** `fetch` calls.
- `src/app/api/media/route.ts` — the standalone `?q=` form dropped `mediaType` entirely; it now
  forwards `mediaType` and `aspectRatio` like the scene form does.

Tests added (no existing test edited, skipped or weakened): `src/lib/media/__tests__/semantic-media-type.test.ts`
(22 assertions incl. unknown/undefined/typo), `src/lib/media/providers/__tests__/pexels.test.ts`
(no-key ⇒ `not_connected` + 0 fetch calls, plus a negative control where a key **is** present and the
request does leave), `src/lib/admin/__tests__/stock-media-derivation.test.ts`.

## The live proof (verbatim, redacted)

Served build identity: `BUILD_ID a6aoBm9jVhA9n_eT8xzmq`, proved by chunk digest and by the
restart script's own assertions — `restart.log`, every line `[PASS]`, `RESULT: OK`.

Served process carries the key **by name only**:

```
provider env var NAMES (no values, ever): expected in the new process [PIXABAY_API_KEY] (1)
  · present in pid 27829 [PIXABAY_API_KEY] (1)
```

1. `GET /api/media?sceneId=p7a_fix_sc1&mediaType=video&count=5` (session cookie for
   `p7a-fixture@cavs.test`) → **HTTP 200**, 12 123 bytes (`media-search.json`):
   `status: "ok"`, `source: "stock-provider"`, `query.mediaType: "video"`,
   `rationale.mediaType: "the caller asked for \"video\" → searching video"`,
   `candidates: 5`, one provider response, `status: ok`, 5 results.
   First hit — **provider `pixabay`**, `externalId 3713`, 1920×1080, 20 s, author `bellergy`,
   `pageUrl https://pixabay.com/videos/id-3713/`,
   `url https://cdn.pixabay.com/video/2016/07/05/3713-173505175_large.mp4`,
   licence `ROYALTY_FREE` / `Pixabay` / `bellergy via Pixabay` / `https://pixabay.com/service/terms/`,
   `metadata.pixabay.rendition: "large"`, `fileSizeBytes: 11749650`.

2. `POST /api/media/select` with that asset → **HTTP 201** (`select-resp.json`). Rows, read back with
   psql (`rows.txt`):

   ```
   ASSET|cmvzdydxd0003ffh1ov7nibfp|VIDEO|video/mp4|1920|1080|20|<cdn url>|p7a_fix_project|cmvv8g5ow0000ffphqnyrfyf9
   STOCK|cmvzdydxd0003ffh1ov7nibfp|pixabay|3713|video|https://pixabay.com/videos/id-3713/
   LIC|cmvzdydxd0003ffh1ov7nibfp|ROYALTY_FREE|Pixabay|bellergy via Pixabay|https://pixabay.com/service/terms/|NULL|NULL
   SCENEASSET|p7a_fix_sc1|VISUAL
   ```

   Populated: `Asset` kind/mimeType/width/height/durationSeconds/url/projectId/userId and
   `metadata.stock` (provider, externalId, previewUrl, thumbUrl, pageUrl, authorUrl); `StockAsset`
   provider/externalId/stockType/pageUrl; `LicensingMetadata` licenseType/source/attribution/
   licenseUrl. **Null, and left null on purpose: `purchasedAt`, `expiresAt`** — Pixabay states
   neither for a Content License, and a fabricated purchase date or "never expires" would be a lie.
   `Asset.status` is `READY`; no byte size, no codec, no checksum is stored on the row.

3. The CDN file downloaded by hand and measured (`probe.json`):

   | property | measured |
   |---|---|
   | HTTP | 200 |
   | bytes | **11 749 650** (identical to Pixabay's stated `size`) |
   | SHA-256 | `0eb61602761518281073ac95031d33fadec5bc9fe0181b457c18b840614e4fd7` |
   | duration | 20.073333 s |
   | frame | **1920 × 1080** |
   | video codec | h264, 29.97 fps, 4 425 893 b/s |
   | audio codec | aac, 255 999 b/s |
   | container | mov/mp4 |

## Work item 3 — the capability line is derived, and stays true

`probe-capability-derivation.ts` rebuilds the operator matrix twice in one process, with and without
`PIXABAY_API_KEY` (`capderiv.json`). Both states read **"3 of 21 capabilities have a provider adapter
on this build, and 0 of them can be used right now"** — the sentence is derived
(`buildCapabilityMatrix` counts rows built from `capabilityStatus()`, which reads env lazily), and it
is **still true**: Pixabay is not an AI-orchestrator adapter, so it cannot make one of the 21 AI
capabilities usable. No surface became false, and no number was hand-edited.

`slots.ts` was **not** given a pixabay `stock_media_search` slot. It would not have changed the
3-of-21 count (adapters are counted per row, and a plain slot is unwired), but it *would* have flipped
that row's `keysPresent` to `true` and told the AI router that a provider can answer an AI task it has
no `call()` for. The media routes use a different interface (`StockProvider.search`), so the honest
place for Pixabay is the stock registry — which the operator surface now also reports.

**What changed instead:** `buildStockMediaSection()` in `src/lib/admin/sections.ts`, fed live from
`STOCK_PROVIDERS` in `src/lib/admin/overview.ts`, adds a derived stock-media line and table to the
capabilities section (headline, per-provider "key present", env var names). Its test hands the builder
different states and requires the sentence to follow — a hand-typed figure cannot pass.

## Open items, named not buried

1. **`createStockAsset` drops the adapter's rendition metadata.** The chosen `metadata.pixabay` block
   (`rendition: "large"`, `fileSizeBytes`, `fileType`, `tags`, `views`, `downloads`, `likes`,
   `licenceName`, `licenceSummaryUrl`, `orientationFilterApplied`) is not persisted — only the six
   `metadata.stock` fields survive. Which rendition was imported is therefore unrecoverable from the
   database. Not changed here: widening persistence is its own decision.
2. **Nothing was written to object storage.** The asset row points at Pixabay's CDN; if Pixabay removes
   the file the row is a dead reference. No byte size or digest is stored on the row.
3. **The operator surface still has no per-asset view** of what was imported; the new stock section
   reports provider availability, not inventory.
4. **This is not a project video.** No scene has been encoded from this footage — wiring footage into
   scenes and rendering is the next delegation, and the pipeline still stops at the encode stage.

## Regeneration commands

```bash
# 1. fixes + tests
cd /home/team/app && npx tsc --noEmit && CAVS_TEST_MODE=1 bun test    # 1560 pass / 0 fail / 103 files
# 2. build and serve WITH the key (value never written to disk)
bun run build
. /etc/profile.d/cto-env-vars.sh && bash scripts/restart-3100.sh       # all [PASS]
# 3. a session cookie: sign in at http://127.0.0.1:3100/signin as p7a-fixture@cavs.test
agent-browser cookies get | grep -o 'cavs_session=[^;" ]*' > /tmp/cookie.txt
# 4. search, select, read back, measure
curl -s -b "$(cat /tmp/cookie.txt)" "http://127.0.0.1:3100/api/media?sceneId=p7a_fix_sc1&mediaType=video&count=5" -o media-search.json
jq '{sceneId:"p7a_fix_sc1", asset: .candidates[0], role:"VISUAL"}' media-search.json > body.json
curl -s -b "$(cat /tmp/cookie.txt)" -H 'content-type: application/json' -d @body.json http://127.0.0.1:3100/api/media/select -o select-resp.json
curl -sL -o pixabay-3713.mp4 https://cdn.pixabay.com/video/2016/07/05/3713-173505175_large.mp4
sha256sum pixabay-3713.mp4
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate,bit_rate -of json pixabay-3713.mp4
# 5. derivation probe
cd /home/team/app && . /etc/profile.d/cto-env-vars.sh && bun scripts/evidence/probe-capability-derivation.ts
```

## Artefacts (byte size, SHA-256)

| file | bytes | SHA-256 |
|---|---|---|
| capderiv.json | 3009 | a9bf66a6ac77aae4026c04388b40a8c3e3416eaee167407c1b0927e52512b3a8 |
| media-search.json | 12123 | 7d499379410984e6647f95132b3e3a66c14394f50f585827aa46339efb19fe47 |
| probe.json | 594 | f8790da45df39775c5470412f761270a2986513bc4160dd084a0b601504483b3 |
| restart.log | 2638 | b79c05d169b807eacba1eafed80c4e8d16a1eaf6343858b621f76009289a525c |
| rows.txt | 403 | 91dfb2d970082f8b2d6a7d7347ee49e802d13f579ab7fb5e5824c85a7e4db296 |
| select-resp.json | 1482 | cc1fac2531ef3bbd799f588c1c0d47b2806a5d02305bea1baf191e1182071677 |

The downloaded video is **not** in this pack (11.7 MB, `/tmp` is wiped on reset); its size and digest
above, with the URL and the two commands, regenerate and verify it. No file in this pack contains the
API key or the session cookie.
