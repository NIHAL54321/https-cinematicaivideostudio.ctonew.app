# Phase 8 — the three surfaces that lied, and the sentences that replaced them

Branch `phase8/truthful-surfaces`, from `master` = `ba6b2f1`.
Commit `16d92a0` (code + before-state) and the commit carrying this README (after-state).

**The rule this block holds:** a surface must never deny work the database holds, and must never
claim work it cannot show. Where something genuinely is missing, name exactly what is missing.
**No row, seed or fixture was changed to make a screen look right.**

---

## 1. Dashboard — "RENDERS 0" on an account with a delivered render job

**Before** (`before/01_dashboard_before.png`, `before/dashboard_dom.json`): `RENDERS 0 —
Rendering jobs created`.

**Root cause, measured:** `src/app/(app)/dashboard/page.tsx` counted
`prisma.renderingJob.count({ where: { userId } })` — the **legacy export-queue table**, which holds
0 rows database-wide. The render pipeline writes **`RenderJob`**, which held 3 rows, including the
demo account's delivered job `cmw9go52e00ekffw62310ysd0`. The Export Center read the right table and
said 1; the Dashboard read the wrong one and said 0. Two surfaces, one database, two answers.

**Now:** `src/lib/render/surface-counts.ts` — `readRenderCounts()` reads `RenderJob`
(`syntheticProof: false`), `ExportJob` and the legacy `RenderingJob` as **three separate numbers**,
and the pure `rendersStat()` composes the card. Both the Dashboard and the Export Center use it, so
they cannot drift apart again. The hint names the table: *"1 RenderJob row in the render pipeline —
the table the Export Center reads."* Legacy rows are named separately and never merged into the
render count. The Export Center's empty state now requires all three counts to be zero — it used to
deny a delivered render outright.

**After** (`after/dashboard.png`): **RENDERS 1**, with the table named.

## 2. Media Library — "Stock Provider Not Connected" while stock search worked

**Before** (`before/02_media_before.png`, `before/media_dom.json`): the banner directly above six
real Pixabay video tiles.

**Root cause, measured:** the banner fired `GET /api/media?q=…` **with no `mediaType`**, so the route
answered for *images* — `not_connected`, chips `PEXELS_API_KEY` / `UNSPLASH_ACCESS_KEY`. Pixabay is a
**video-only** adapter, so the one provider that was configured could never answer that call. The
same server answered `GET /api/media?q=tide gauge&mediaType=video` with `200 status:"ok"` and real
candidates.

**Now:** `stockProviderAvailability()` in `src/lib/media/providers/index.ts` uses the *same*
`isConfigured()` predicate `searchAllStockProviders()` uses; `GET /api/media/status` reports that
availability **plus a live probe search**, so the banner states what was *observed*, not what was
assumed. `src/lib/media/provider-banner.ts` renders the sentence.

**After** (`after/media-library.png`): *"Stock providers connected: Pixabay (video). A live video
search just now returned 3 candidates (answered by pixabay). Not connected: Pexels
(PEXELS_API_KEY), Unsplash (UNSPLASH_ACCESS_KEY)."* With no key at all it still reads "Stock Provider
Not Connected." and lists all three env names; a configured-but-silent provider gets its own sentence
carrying the provider's own message.

## 3. Storyboard — "No structure plan yet" on a project with six scenes

**Before** (`before/03_storyboard_before.png`, `before/storyboard_dom.json`): the message rendered
under a header reading *"3 chapters · 6 scenes"*.

**Root cause, measured:** `/api/projects/[id]/storyboard` returned `ok({ tree })` while the tab
parsed the response body **as** the tree, so `tree.script` was always `undefined` and the empty state
fired. The data was never missing: 1 Script, 3 Chapters, 6 Scenes, 12 versions.

**Now:** the route returns the tree unwrapped like its sibling `/script`, and `readScriptTreeBody()`
accepts either shape. New pure `src/lib/studio/storyboard-view.ts` (`storyboardView`) is used by
**both** the Storyboard and Script tabs: scenes are shown with their shot plan, and each empty state
names exactly what is missing (Script row / Chapter rows / Scene rows). Where narration is absent it
says *"The script step is blocked: no provider for script_generation is configured on this server"* —
**only when `/api/ai/status` says so**, otherwise "has not been run". Scene rows carry their
`SceneAsset` rows, so each shot shows the asset it is actually sourced from, labelled
keyword-found and not a commissioned illustration, or says none is attached.

**After** (`after/storyboard.png`): `TIMELINE / CHRONOLOGICAL · 3 CHAPTERS · 6 SCENES · Total 2m vs
target 2m · 100% of target`, chapter "Hook → Context · 2 scenes · 40s", scene 1 "A model writes a
paragraph", narration "78 characters · user-written", visual description, clip plan, and
`SOURCED ASSET (SCENEASSET)` naming *Pixabay video 43559 — keyboard, laptop, computer…*

---

## Gates

| Gate | Result |
|---|---|
| `tsc --noEmit` | clean |
| `bun test` | **1735 pass / 0 fail / 116 files** (was 1710/113 — 25 new tests, none deleted or weakened) |
| `bun run build` (server stopped) | success; BUILD_ID `d7QexfcAhDyxXheQunwG0` |
| `scripts/restart-3100.sh` | every assertion PASS; `:3000` untouched; provider env names `[PIXABAY_API_KEY]` present in the new process |
| served-build identity | `after/served-identity.txt` — `main-app-4b240cd1ab7e1e9a.js` sha256 `3df96f4d…0cd7f3` **equal on disk and on the wire**; bogus chunk 404; health 200 |

## Regeneration

```bash
cd /home/team/app
bun run build                     # the resident server MUST be stopped first (it OOMs)
bash scripts/restart-3100.sh      # sources nothing itself: run it in a shell that has the secrets
bash scripts/evidence/after-surfaces.sh   # curl-free: browser capture of the three surfaces
sha256sum -c evidence/phase8_truthful_surfaces/SHA256SUMS
```

## What this block does NOT claim

- It does not make the app drivable end to end: **Storyboard and Script are now truthful and usable;
  Scenes, Voice & Audio, Subtitles, Thumbnail and Export are still stubs**, and that is the next block.
- The clips remain keyword-matched stock. Showing a scene's sourced asset is not a claim that the
  clip illustrates the scene — the label says so.
- Passing our own tests is not a claim the app is secure, and nothing here was audited externally.
