# Phase 8 — the Export panel, proved in a browser on the served build

Date: 2026-11-15. Served build: `master` = `b2004e1`, running on `http://localhost:3100`
(`bunx next start -p 3100`). Nothing was rebuilt for this pack; every capture below is
the running server's own output.

Project: `cmwfum4uh0006ffuutb528ciw` — *The future of artificial intelligence*, 6 scenes.
Signed-in account: `demo@cavs.test` (`cmwfulf410000ffuukjmyen7f`), the project's owner —
the browser profile already held a real session for it, so no sign-in step was needed.

How each capture was taken: the workspace page `/projects/cmwfum4uh0006ffuutb528ciw`
was opened, the **Export** tab clicked, and the panel read back with `agent-browser eval`
over its own `data-testid` attributes. The JSON files are that read-back verbatim
(`JSON.stringify` of the strings the DOM holds, so what is quoted is the rendered text).

## 1. Readiness and the preset picker (`01-readiness-and-preset.png`, `dom-01-delivered-job.json`)

- badge **CAN QUEUE**; sentence: *"All 6 scenes have a sourced clip. That is a sourcing
  fact and nothing more: each clip is keyword-found stock, not an illustration of its scene."*
- preset picker holds 7 options (4K, 4K HDR10, 1080p, Shorts, Reels, 1:1, 4:5);
  **YouTube 1080p (FHD SDR)** is selected, with its declared facts printed beside it:
  `1920×1080 · H.264/AVC High L4.0 · yuv420p · 30 fps · mp4 · audio AAC-LC 384 kbps
  48000 Hz · spec export-spec-matrix/1`.
- the Render button was enabled at this moment (`renderDisabled: false`).

## 2. The already-delivered job `cmwg3bam20001ffeo88k3mw2q` (`02-…`, `03-…`, `download-cmwg3bam-sha256.txt`)

- status **SUCCEEDED**, `attempt 1 · succeeded`, elapsed `3m 32s` from the job row,
  progress `100% = (10 + 15 + 10 + 10 + 35 + 15 + 5) / 100`.
- **seven stage rows, all SUCCEEDED** — resolve-inputs, assemble-timeline, audio-mix-plan,
  subtitle-plan, encode-master (3m 16s), container-mux (15.6s), checksum-artefact (0.3s).
- Delivery badge `CHECKSUM-ARTEFACT SUCCEEDED`; the delivered container is **PRESENT**:
  **118,049,344 B**, SHA-256 `067c392415e18ac130b374885c96fc26dbe0cdb8924d96f40b9328f73b2a623e`,
  durable key `cinema-studio/renders/cmwfulf410000ffuukjmyen7f/cmwg3bam20001ffeo88k3mw2q/delivered-container-067c392415e18ac1.mp4`.
  The same panel states the encoded master is **GONE** and offers no link for it.
- **Download clicked in the panel** (`agent-browser download '[data-testid="export-download-delivered-container"]'`),
  the written file hashed on this machine:

```
067c392415e18ac130b374885c96fc26dbe0cdb8924d96f40b9328f73b2a623e  downloads/delivered-cmwg3bam20001ffeo88k3mw2q.mp4
118049344 bytes
```

  Both the byte count and the digest **match the recorded row and the panel's own text**.

## 3. A fresh render, stopped, and the retry (`04-…` → `07-…`)

- **Render pressed** in the panel at 17:29:30Z: job **`cmwi40c45001dffv2fm6lyglc`** created,
  `attempt 1 · running`.
- **Stage rows advanced while the server answered**: at 14 s the panel read `RUNNING`,
  `45% = (10 + 15 + 10 + 10) / 100` with stages 1–4 SUCCEEDED and *Encode master* RUNNING;
  at 2m 03s the same job read `RUNNING`, elapsed `2m 03s`, *Encode master* `RUNNING 2m 3s`.
  Three `/api/health` probes taken during the encode (`health-during-render.txt`):

```
17:29:44 200 0.059249s
17:29:46 200 0.015681s
17:29:48 200 0.017937s
```

- **Stop pressed** at 17:31:46Z. The honest state, read from the panel and the rows
  (`06-stopped.png`, `dom-02-stopped.json`, `db-attempts-and-stop-reason.txt`): stages 1–5
  SUCCEEDED, stage 6 **STOPPED** with the stored reason *"stopped before this stage ran:
  stopped from the Export tab"*; stage 7 has no row and the panel says *not reached*.
  Delivery reads `CHECKSUM-ARTEFACT: NOT REACHED` and no file is offered.
- **Retry pressed** at 17:33:08Z. **It did not reach delivery, and that is a defect, not a
  capture failure.** `RenderAttempt` shows attempt 1 STOPPED and attempt 2 STOPPED, and the
  job's `stopReason` is still *"stopped from the Export tab"*: the retry creates a new
  attempt that starts at container-mux, and the runner re-reads the job's
  `stopRequestedAt`, which nothing clears, so the new attempt stops immediately with the
  same sentence. The panel (`07-retry-restopped.png`, `dom-03-after-retry.json`) shows
  `attempt 2 · stopped` and still no delivery. **So "retry through to delivery and download
  that file too" is not proved — it is blocked by this defect.** A retry from a *stopped*
  job needs the stop flag cleared (or the retry endpoint should refuse with a sentence)
  before this half of the block can be closed. Nothing was edited in the database to get
  past it.

## 4. Retry after a stop, through to delivery and a second download (2026-11-15, `p8-retry-*.png`)

Section 3 recorded the defect: a retry on a **stopped** job re-stopped instantly because nothing
cleared the job's `stopRequestedAt`. The fix (`88f122c`, `retryRenderJob` → `clearStopForRetry`)
was built and served as BUILD_ID `5OcgaM77Ry47Kq1SblDlr`, and the same panel was driven again —
`master` = `88f122c`, no rebuild for this capture.

- **Retry pressed in the Export tab** at 17:41:35Z on job `cmwi40c45001dffv2fm6lyglc`
  (`p8-retry-00-before.png`: `STOPPED`, `attempt 2 · stopped`, delivery `CHECKSUM-ARTEFACT: NOT REACHED`).
- **The stop was lifted, read from the rows**: `stopRequestedAt = null`, `stopReason = null`,
  `attempt 3` **RUNNING** at `container-mux` (attempts 1 and 2 stayed `STOPPED` with their rows).
- **The panel does not poll a retried attempt by itself.** Between t1 and t3 (17:42:00 → 17:42:16)
  it still read `STOPPED` / `attempt 3 · queued`; pressing **Re-read** returned the finished state.
  That is a UI finding, recorded below — not a claim that the retry failed.
- **After Re-read** (`p8-retry-02-delivered.png`): `SUCCEEDED`, `attempt 3 · succeeded`,
  progress `100% = (10 + 15 + 10 + 10 + 35 + 15 + 5) / 100`, delivery
  `CHECKSUM-ARTEFACT SUCCEEDED`; delivered container **PRESENT**, **118,043,723 B**,
  SHA-256 `4c1dfe765ee0f600b4f71ff7b377ef401c7fb0dbba98d231e1526d009f26a491`,
  durable key `cinema-studio/renders/cmwfulf410000ffuukjmyen7f/cmwi40c45001dffv2fm6lyglc/delivered-container-4c1dfe765ee0f600.mp4`,
  copies `local-and-durable`. The encoded master reads **GONE** with no link offered.
- **Download clicked in the panel** (its own link `/api/studio/downloads/cmwi4gdyd001fffqt0d0oesx4`),
  hashed on this machine:

```
4c1dfe765ee0f600b4f71ff7b377ef401c7fb0dbba98d231e1526d009f26a491  downloads/delivered-cmwi40c45001dffv2fm6lyglc.mp4
118043723 bytes · ffprobe: h264 1920x1080 30/1 + aac, duration 120.033333 s, 7,867,396 b/s
```

  Byte count and digest **match the panel's own text and the `delivered-container` artefact row**.

### Two findings recorded here, not fixed in this pack

1. **A wrong path in a user-facing sentence.** The "encoded master GONE" paragraph still reads
   *"Render output lives in /tmp/cavs-render-output, which a machine reset wipes"*, but this
   deployment renders to `/home/team/render-out` (`RENDER_OUTPUT_DIR` is set). The string is
   hardcoded at `src/lib/downloads/centre.ts:394`; it should name the directory the deployment
   actually uses. Recorded, and fixed in the follow-up block — the statement was wrong, not the data.
2. **The panel does not poll while a retried attempt is queued.** `Re-read` is required to see the
   retry's progress. Nothing shown was false (it kept showing the last state it had read), but a
   surface that says `STOPPED` while an attempt is `RUNNING` in the rows is a defect of freshness.

## Files, byte sizes and SHA-256

| bytes | SHA-256 | file |
|---|---|---|
| 173035 | b815d762e48e98934a39158a88afad0890027077715245f5194c9c93482c8195 | 01-readiness-and-preset.png |
| 105089 | 9a5fd2bccdcb25524d190af6f3113cfc73386128158a6a5b78573009f4aab502 | 02-delivered-job-stages.png |
| 94544 | 7cdf58a5408e79826fbb74a757cdfe433c56a4e9ace81d720cefc9cd6035d7b3 | 03-stages-to-delivery.png |
| 109129 | 764627846e42263ddea89dea4f4299f2203ea370d01cc71c798ed4c2deef84ed | 04-render-running.png |
| 108972 | e0523acf9486215d1305f42b0eb69d3c20bebb78d0fa232ab43824a72663fd04 | 05-render-advanced.png |
| 106049 | e1882442f0fc6137526bfca7579cf20bc2a7f89231617e8a083cced888e573c6 | 06-stopped.png |
| 105928 | a26ba7fef8a8c5e1472f831d7219e4774e368dfea0a944b00c012fc695dbed12 | 07-retry-restopped.png |
| 6792 | 434b3599f65cf4a281825d72de6fd9e9fc4555270ebe027604fc603105f48b45 | dom-01-delivered-job.json |
| 4415 | 9aa5621d4c9024ceb69583d0778231b879e0e98b06128005d5b81e01d39aa259 | dom-02-stopped.json |
| 4413 | 4ccbe1aa45e617f5c2ef3060e79f6081ec2bb347c74cb67ee8eff859370d18ea | dom-03-after-retry.json |
| 69 | 3511ed8e898b7c8f6185cfa7935cd4950ae6cbc5e969e48287c56ac80aed4c13 | health-during-render.txt |
| 320 | 1372780b9dc427a04957f9b1937c3bfd59c20e6badcf92bc389105ecaae7a74e | db-attempts-and-stop-reason.txt |
| 271 | — | download-cmwg3bam-sha256.txt (the `sha256sum`/`stat` output above) |
| 118049344 | 067c392415e18ac130b374885c96fc26dbe0cdb8924d96f40b9328f73b2a623e | downloads/delivered-cmwg3bam20001ffeo88k3mw2q.mp4 |
| 168648 | f96fbcd2328a9a7dc7899ef369c9a10231b744e31481abf0b6fd0edeb3fd166f | p8-retry-00-before.png |
| 128766 | d8ee149fdd0e841ea9527ccb61d113a691b4c4ae2cefc5283a1ecf2207d08bab | p8-retry-01-after.png |
| 128965 | 474a5771500338aab8232a0fd0e221b765c4c5ad2a76da8c52253bf6042965d1 | p8-retry-02-delivered.png |
| 116 | 5eb38bcf6cf2be10b35124e3f7380c40fdd9e4c3835abb9edb76fab61b3f2422 | download-cmwi40c-retry-sha256.txt |
| 118043723 | 4c1dfe765ee0f600b4f71ff7b377ef401c7fb0dbba98d231e1526d009f26a491 | downloads/delivered-cmwi40c45001dffv2fm6lyglc.mp4 |

The downloaded file is kept in this pack because `/home` is the only durable place here;
it is a byte-for-byte copy of the recorded delivery and can be re-fetched with the command
below at any time.

## Regeneration

```bash
# served build must already be up on :3100 (do not rebuild while it serves)
curl -s http://localhost:3100/api/health

# the panel itself, in a browser holding the owner's session
agent-browser open http://localhost:3100/projects/cmwfum4uh0006ffuutb528ciw --session cavs
agent-browser click 'button:has-text("Export")' --session cavs        # the Export tab
agent-browser screenshot evidence/phase8_export_panel/01-readiness-and-preset.png --session cavs

# the delivered job's download, re-measured on this machine
agent-browser download '[data-testid="export-download-delivered-container"]' \
  evidence/phase8_export_panel/downloads/delivered-cmwg3bam20001ffeo88k3mw2q.mp4 --session cavs
sha256sum evidence/phase8_export_panel/downloads/delivered-cmwg3bam20001ffeo88k3mw2q.mp4
stat -c %s evidence/phase8_export_panel/downloads/delivered-cmwg3bam20001ffeo88k3mw2q.mp4

# the rows behind every sentence in the panel
psql "postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio" -A -F'|' -c \
 "select s.sequence, s.\"stageId\", s.state, coalesce(s.\"blockedReason\",'') from \"RenderStageRun\" s where s.\"jobId\"='cmwi40c45001dffv2fm6lyglc' order by s.sequence;"

# render output pruning: only dirs with no RenderJob row are removed (none existed here)
for d in /home/team/render-out/*/; do id=$(basename "$d"); \
  psql "postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio" -tAc \
  "select count(*) from \"RenderJob\" where id='$id'" | grep -q '^0$' && rm -rf "$d"; done
```

Pruning: `/home/team/render-out` held exactly three job directories
(`cmwg31bo10017ffmygs6bu7x9`, `cmwg3bam20001ffeo88k3mw2q`, `cmwi40c45001dffv2fm6lyglc`) and
each has a `RenderJob` row, so **nothing was deleted**.
