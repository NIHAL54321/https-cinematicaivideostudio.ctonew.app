# Phase 8 Scenes panel — browser evidence

Branch phase8/scenes-panel @ 6a44813. Served build DWrptO4WSWGizLZkQfFTN.

## Proved in the browser (served build on :3100)
- The Scenes tab renders the panel: summary sentence, per-scene cards, sourced/unsourced badges. See scenes_tab.png + panel_state_1_dom.json (project cmwfum4uh0006ffuutb528ciw, created through the app's own /api/studio/magic-create because the demo project named in the brief does not exist in this machine's database after the rebuild).
- Summary text observed verbatim: "0 of 6 scenes have a sourced clip, 6 do not. An unsourced scene blocks the render: ..."

## NOT proved
- Clicking a search result to select+ingest a clip, and the inline edit round-trip, were not captured: the session budget ran out mid-drive (search_results_dom.json / attach_after_dom.json record whatever that run reached).

## Regenerate
bash evidence/phase8_scenes_panel/drive1.sh  # panel state + screenshot
bash evidence/phase8_scenes_panel/drive3.sh  # search + click-to-attach
