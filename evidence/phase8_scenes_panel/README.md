# Phase 8 — the Scenes panel: sourcing and editing a video by clicking

Branch `phase8/scenes-panel`, from `master` = `fb19a5b`. Code commit `6a44813`.
Browser proof and this README: lead run on the served build `DWrptO4WSWGizLZkQfFTN`.

## What this replaces
The Scenes tab used to render *"Scenes — no panel on this tab in this build."* It was the reason a
video could only be produced by calling the app's API. It is now the first surface in the product
where a video's scenes are listed, edited and sourced by clicking.

## What the panel does
1. **Lists** every scene in order with its title, narration, duration, visual prompt, and a
   `SOURCED` / `UNSOURCED` badge, plus a header summary — *"0 of 6 scenes sourced · 6 UNSOURCED"*.
2. **Edits inline** — title, narration, duration and **visual prompt** — through
   `PATCH /api/projects/:id/scenes/:sceneId`. That route gained `visualPrompt` (validated, capped at
   4 000 characters) in `6a44813`; without it the search would have had nothing to build on.
3. **Sources a clip by clicking** — the search box is pre-filled from the scene's own visual prompt,
   *Search stock video* asks the scene route, candidates come back from the provider, clicking one
   runs `POST /api/media/select` then `POST /api/media/ingest`, and the scene then shows its
   **Attached clip** with provider, external id, author and the licence exactly as stored.
4. **States the consequence**: *"1 of 6 scenes have a sourced clip, 5 do not. An unsourced scene
   blocks the render: the encode stage refuses to encode a project while any scene carries no …"*
5. Labels every clip **"Keyword-found stock — not an illustration of this scene"** and invents no
   match score. A provider refusal is shown in the provider's own words, never as "no results".

## What was driven in the browser, and read back
| Step | Evidence | Result |
|---|---|---|
| Panel, nothing sourced | `01_panel_unsourced.png` | "0 of 6 scenes sourced", 6 UNSOURCED |
| Search from the scene's prompt | `02_search_results.png` | real Pixabay candidates (203987, 203986, 183107, 174086, …) |
| Click a candidate → select → ingest | `03_clip_attached.png` | header flips to **1 of 6 scenes sourced · 5 UNSOURCED** |
| Attached clip block | `03_clip_attached.png` | *Pixabay video 203987 · Provider: pixabay · id 203987 · Author: olenchic via Pixabay · Licence on record: ROYALTY_FREE from Pixabay · Bytes in object storage (3,327,836 B)* |
| Edit narration + visual prompt, save | `04_edited_scene.png` | both fields hold the new text |
| Reload the project and re-read | `05_after_reload.png` | both edits survive the reload |
| API read-back | `readback.txt` | `Hook` narration and prompt are the edited strings; `asset=pixabay/203987 'olenchic via Pixabay' ROYALTY_FREE 3327836B stored=True`; the other five scenes remain `asset=none` |

The project used is `cmwfum4uh0006ffuutb528ciw` ("The future of artificial intelligence"), created
through `/api/studio/magic-create` after this machine's database was rebuilt — the earlier demo
project did not survive the reset.

## Gates
- `tsc --noEmit` clean (engineer run on `6a44813`).
- `bun test` — see `tests.txt` in this folder for the full-suite result of the lead run.
- `bun run build` with the server stopped; served build `DWrptO4WSWGizLZkQfFTN`, health 200.
- New unit tests in `6a44813`: scene PATCH `visualPrompt` handling and the panel's pure view logic.

## What this does NOT claim
- The panel makes scenes real; it does not make the whole product drivable. **Voice & Audio,
  Subtitles, Thumbnail and Export are still stubs**, so rendering a video from the UI is the next block.
- The clips remain keyword-matched stock. The label says so on every scene, and a sourced scene is
  not a claim that the clip illustrates it.
- This was proved on one project with one attached clip. Multi-clip replacement per scene, reordering
  and bulk actions are not part of this block.

## Regenerate
```bash
cd /home/team/app
bash scripts/restart-3100.sh          # in a shell that has the saved secrets
# then, with the project id above:
#   open /projects/<id> → Scenes tab → Source a clip → Search stock video → click a candidate
#   edit narration and visual prompt → Save this scene → reload → read the values back
```
