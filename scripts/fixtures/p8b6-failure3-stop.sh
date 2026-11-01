#!/bin/bash
# ============================================================================
# p8b6-failure3-stop.sh — INDUCED FAILURE 3: a stop, through the API.
#
# WHAT IT DOES
#   1. enqueues a synthetic encoder proof (youtube-1080p, 8 s);
#   2. waits until `encode-master` is RUNNING;
#   3. POSTs {action:"stop", jobId, reason} to the app's own render route;
#   4. waits for the run to end and reads it back.
#
# WHAT IT MUST SHOW
#   - the stages that ran before the stop keep their outcome (SUCCEEDED);
#   - the stage the stop landed in reads STOPPED, with the reason the caller gave;
#   - the stages after it have NO ROW AT ALL — not a skipped row, not a null;
#   - the sentence the user is given, verbatim.
#
# HONEST LIMIT THIS PROOF SHOWS RATHER THAN HIDES: the stop is honoured at a
# STAGE BOUNDARY. A stop requested while `encode-master` is mid-encode does not
# abort that encoder; the stage finishes and the NEXT stage records the stop.
# The runner's own words for that row are "stopped before this stage ran".
#
#   bash scripts/fixtures/p8b6-failure3-stop.sh
# ============================================================================
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/p8b6-lib.sh"
OUT=${OUT:-/tmp/p8b6/f3}
mkdir -p "$OUT"
REASON="P8B6 induced stop: the owner stopped this render to prove the stop path records a STOPPED row and leaves the later stages with no row at all."
echo "== p8b6 failure 3 — a stop through the API =="
echo "when: $(date -u '+%Y-%m-%dT%H:%M:%SZ')  db: $DB  base: $BASE"
echo "output dir: $OUT"

say "0. state before anything"
signin
echo "render tables before: $(db_counts)"

say "1. enqueue a synthetic encoder proof — youtube-1080p, 8 s (declared synthetic source)"
render_post '{"action":"synthetic-proof","presetId":"youtube-1080p","durationSeconds":8}' "$OUT/enqueue.json" | tee "$OUT/enqueue.http"
JOB=$(jq -r '.jobId // empty' "$OUT/enqueue.json")
if [ -z "$JOB" ]; then echo "no jobId — enqueue refused:"; cat "$OUT/enqueue.json"; exit 1; fi
echo "jobId=$JOB"; echo "$JOB" > "$OUT/jobid.txt"

say "2. wait until encode-master is RUNNING"
wait_stage "$JOB" encode-master RUNNING 1800 || { echo "could not catch encode-master RUNNING"; exit 1; }
stage_rows "$JOB" | tee "$OUT/psql-at-stop-stage-rows.txt"

say "3. POST {action:'stop', jobId, reason} to the app's own route"
jq -n --arg job "$JOB" --arg reason "$REASON" '{action:"stop", jobId:$job, reason:$reason}' > "$OUT/stop-request.json"
render_post "$(cat "$OUT/stop-request.json")" "$OUT/stop-response.json" | tee "$OUT/stop.http"
jq '{job: {id: .job.job.id, status: .job.status, statusBasis: .job.statusBasis,
            stopRequestedAt: .job.job.stopRequestedAt, stopReason: .job.job.stopReason}}' "$OUT/stop-response.json" | tee "$OUT/stop-response-summary.json"

say "4. wait for the run to end"
wait_terminal "$JOB" 900
jobread "$JOB" > "$OUT/job-after-stop.json"

say "5a. psql — the stage rows after the stop"
stage_rows "$JOB" | tee "$OUT/psql-after-stop-stage-rows.txt"

say "5b. the derived state, verbatim"
jq '{status, statusBasis, progress, attempts: [.attempts[] | {attemptNumber, recordedState, state, lastStageId, endedReason}],
     stages: [.stages[] | {stageId: .id, sequence, reached, state, recordedState, stateBasis, blockedReason, finishedAt, artefactCount}],
     notReached}' "$OUT/job-after-stop.json" | tee "$OUT/derived-state.json"

say "5c. the sentence the user is given"
echo "-- statusBasis --";        jq -r '.statusBasis' "$OUT/job-after-stop.json"
echo "-- the stopped stage's own words (blockedReason) --"
jq -r '.stages[] | select(.state=="STOPPED") | "\(.id): \(.blockedReason)"' "$OUT/job-after-stop.json" | tee "$OUT/stopped-sentence.txt"
echo "-- the attempt's ending sentence --"
jq -r '.attempts[] | select(.state=="stopped") | .endedReason' "$OUT/job-after-stop.json" | tee -a "$OUT/stopped-sentence.txt"

say "6. assertions"
#
# WHERE THE STOP LANDS IS A RACE, AND THIS PROOF DOES NOT PRETEND OTHERWISE.
# The runner uses spawnSync for the encoder, so the server cannot answer ANY
# request while `encode-master` is inside ffmpeg: a stop POSTed during the
# encode is only served once the encode returns. The runner then re-reads the
# job before each stage, so the stop is applied at the NEXT stage boundary it
# observes. The claim that must hold wherever that boundary falls is therefore
# stated position-independently: everything before the STOPPED row SUCCEEDED,
# exactly one row is STOPPED, and NO row exists after it.
STOPPED_SEQ=$(q "select s.sequence from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.state::text='STOPPED'")
STOPPED_STAGE=$(q "select s.\"stageId\" from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.state::text='STOPPED'")
echo "the stop was honoured at the boundary before: $STOPPED_STAGE (sequence $STOPPED_SEQ)"
echo "$STOPPED_STAGE" > "$OUT/stopped-stage.txt"
chkf "derived status" "$(jq -r '.status' "$OUT/job-after-stop.json")" "stopped"
chkf "exactly one STOPPED row" \
  "$(q "select count(*) from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.state::text='STOPPED'")" "1"
chkf "every stage BEFORE it kept a SUCCEEDED outcome (no other state at all)" \
  "$(q "select count(*) from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.sequence < $STOPPED_SEQ and s.state::text <> 'SUCCEEDED'")" "0"
chkf "there is one row per earlier stage — none was skipped or rewritten" \
  "$(q "select count(*) from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.sequence < $STOPPED_SEQ")" "$((STOPPED_SEQ - 1))"
chkf "NO row exists for any stage AFTER it" \
  "$(q "select count(*) from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.sequence > $STOPPED_SEQ")" "0"
chkf "total stage rows written equals the stopped stage's own sequence" \
  "$(q "select count(*) from \"RenderStageRun\" s where s.\"jobId\"='$JOB'")" "$STOPPED_SEQ"
chkf "the reason the caller gave is the one recorded on the job" \
  "$(jq -r '.job.stopReason' "$OUT/job-after-stop.json")" "$REASON"
chkf "the stopped row's sentence carries that reason" \
  "$(jq -r '.stages[] | select(.state=="STOPPED") | .blockedReason' "$OUT/job-after-stop.json")" "stopped before this stage ran: $REASON"
chkf "the stopped row is the LAST row for this job (nothing after it, by sequence)" \
  "$(q "select max(s.sequence) from \"RenderStageRun\" s where s.\"jobId\"='$JOB'")" "$STOPPED_SEQ"
echo "render tables after: $(db_counts)"
summary
