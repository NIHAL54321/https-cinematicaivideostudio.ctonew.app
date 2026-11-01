#!/bin/bash
# ============================================================================
# p8b6-failure2-failed-retry.sh — INDUCED FAILURE 2: a REAL failed stage, then
# a retry that resumes.
#
# THE TRICK, AND WHY IT IS DETERMINISTIC
#   `container-mux` runs `ffmpeg -c copy … <stageDir>/synthetic-encoder-proof-delivered.mp4`.
#   If a DIRECTORY already exists at exactly that path, ffmpeg cannot write its
#   output and fails with the operating system's own error (EISDIR, "Is a
#   directory") — AFTER `encode-master` has succeeded and recorded its
#   `master-video` artefact. That gives a real FAILED stage at a known place,
#   with a real master file on disk for the retry to reuse.
#
# WHAT IT PROVES
#   - the pipeline records FAILED at container-mux with the encoder's own stderr;
#   - the API's retry creates ATTEMPT 2 that starts at container-mux;
#   - the five stages attempt 1 already honoured get NO new row in attempt 2, and
#     `encode-master` still has exactly ONE row across both attempts;
#   - the master file is re-measured and REUSED, digest unchanged before/after;
#   - the run completes with the delivered container present and its digest
#     recorded in the database, the sidecar and the artefact row.
#
#   bash scripts/fixtures/p8b6-failure2-failed-retry.sh
# ============================================================================
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/p8b6-lib.sh"
OUT=${OUT:-/tmp/p8b6/f2}
mkdir -p "$OUT"
echo "== p8b6 failure 2 — a real FAILED stage, then a retry that resumes =="
echo "when: $(date -u '+%Y-%m-%dT%H:%M:%SZ')  db: $DB  base: $BASE"
echo "output dir: $OUT"

say "0. state before anything"
signin
echo "render tables before: $(db_counts)"

say "1. enqueue a synthetic encoder proof — youtube-1080p, 5 s (declared synthetic source)"
render_post '{"action":"synthetic-proof","presetId":"youtube-1080p","durationSeconds":5}' "$OUT/enqueue.json" | tee "$OUT/enqueue.http"
JOB=$(jq -r '.jobId // empty' "$OUT/enqueue.json")
if [ -z "$JOB" ]; then echo "no jobId — enqueue refused:"; cat "$OUT/enqueue.json"; exit 1; fi
echo "jobId=$JOB"; echo "$JOB" > "$OUT/jobid.txt"
DELIVERED="/tmp/cavs-render-output/synthetic-encoder-proof/$JOB/container-mux/synthetic-encoder-proof-delivered.mp4"
echo "the path container-mux will write: $DELIVERED"
echo "$DELIVERED" > "$OUT/delivered-path.txt"

say "2. wait until encode-master is RUNNING, then plant a DIRECTORY at the delivered path"
wait_stage "$JOB" encode-master RUNNING 1800 || { echo "could not catch encode-master RUNNING"; exit 1; }
mkdir -p "$(dirname "$DELIVERED")"
mkdir "$DELIVERED"
echo "planted (this is a directory, not a file):"
ls -ld "$DELIVERED" | tee "$OUT/planted-directory.txt"
stat -c 'type=%F mode=%A inode=%i' "$DELIVERED" | tee -a "$OUT/planted-directory.txt"

say "3. wait for the run to end — a FAILED stage is expected"
wait_terminal "$JOB" 900
jobread "$JOB" > "$OUT/job-after-attempt1.json"
jq -r '{status, statusBasis}' "$OUT/job-after-attempt1.json"

say "4a. psql — attempt 1's stage rows (BEFORE the retry)"
stage_rows "$JOB" | tee "$OUT/psql-attempt1-stage-rows.txt"

say "4b. the encoder's own stderr, as the pipeline recorded it (errorMessage, verbatim)"
jq -r '.stages[] | select(.id=="container-mux") | .errorMessage' "$OUT/job-after-attempt1.json" | tee "$OUT/container-mux-stderr-verbatim.txt"

say "4c. the same failure, reproduced by hand with the identical ffmpeg argv (full stderr)"
MASTER_ART=$(q "select path from \"RenderArtefact\" where \"jobId\"='$JOB' and kind='master-video' limit 1")
echo "master artefact on disk: $MASTER_ART"
if [ -n "$MASTER_ART" ]; then
  ffmpeg -y -hide_banner -i "$MASTER_ART" -c copy -movflags +faststart "$DELIVERED" \
    > "$OUT/ffmpeg-handrun.stdout.txt" 2> "$OUT/ffmpeg-handrun.stderr.txt"
  echo "hand-run ffmpeg exit=$?"
  echo "-- stderr, verbatim --"
  cat "$OUT/ffmpeg-handrun.stderr.txt" | tail -n 6 | tee "$OUT/ffmpeg-handrun-stderr-tail.txt"
fi

say "4d. the master file BEFORE the retry — measured on disk"
if [ -n "$MASTER_ART" ]; then
  sha256sum "$MASTER_ART" | tee "$OUT/master-before-retry.txt"
  stat -c 'bytes=%s' "$MASTER_ART" | tee -a "$OUT/master-before-retry.txt"
fi
artefact_rows "$JOB" | tee "$OUT/psql-attempt1-artefacts.txt"

say "4e. the derived status is FAILED, and it names the stage"
chkf "derived status after attempt 1" "$(jq -r '.job.status // .status' "$OUT/job-after-attempt1.json")" "failed"
chkf "container-mux reads FAILED" "$(jq -r '.stages[] | select(.id=="container-mux") | .state' "$OUT/job-after-attempt1.json")" "FAILED"
chkf "the five stages before it SUCCEEDED" \
  "$(jq -r '[.stages[] | select(.sequence < 6) | .state] | unique | join(",")' "$OUT/job-after-attempt1.json")" "SUCCEEDED"
chkf "checksum-artefact was never reached" \
  "$(jq -r '.notReached | join(",")' "$OUT/job-after-attempt1.json")" "checksum-artefact"
chkf "retry is offered" "$(jq -r '.retry.available' "$OUT/job-after-attempt1.json")" "true"
echo "retry.firstUnsuccessfulStageId: $(jq -r '.retry.firstUnsuccessfulStageId' "$OUT/job-after-attempt1.json")"

say "5. remove the planted directory and retry THROUGH THE API"
rm -rf "$DELIVERED"
echo "removed; path exists now? $([ -e "$DELIVERED" ] && echo yes || echo no)"
render_post "{\"action\":\"retry\",\"jobId\":\"$JOB\"}" "$OUT/retry-response.json" | tee "$OUT/retry.http"
jq '{queued, jobId, attemptId, attemptNumber, startStageId, continuedFromId, basis, honoured, reused}' "$OUT/retry-response.json" | tee "$OUT/retry-summary.json"

say "6. wait for attempt 2 to finish"
wait_terminal "$JOB" 1200
jobread "$JOB" > "$OUT/job-after-attempt2.json"
jq -r '{status, statusBasis, attempts: [.attempts[] | {attemptNumber, recordedState, state, startStageId, lastStageId, heartbeatCount, endedReason, reusedArtefacts}]}' "$OUT/job-after-attempt2.json"

say "7a. psql — attempt 1 vs attempt 2, side by side"
attempt_compare "$JOB" | tee "$OUT/attempt1-vs-attempt2.txt"

say "7b. psql — attempt 2's stage rows only"
pq "select a.\"attemptNumber\" as att, s.sequence as seq, s.\"stageId\", s.state::text as state,
      to_char(s.\"startedAt\" at time zone 'UTC','HH24:MI:SS.MS') as started_utc,
      to_char(s.\"finishedAt\" at time zone 'UTC','HH24:MI:SS.MS') as finished_utc, s.\"artefactCount\" as art
    from \"RenderStageRun\" s join \"RenderAttempt\" a on a.id=s.\"attemptId\"
    where s.\"jobId\"='$JOB' and a.\"attemptNumber\"=2 order by s.sequence;" | tee "$OUT/psql-attempt2-stage-rows.txt"

say "7c. the rows attempt 2 wrote — one per stage it actually ran"
pq "select a.\"attemptNumber\" as att, count(*) as rows
    from \"RenderStageRun\" s join \"RenderAttempt\" a on a.id=s.\"attemptId\"
    where s.\"jobId\"='$JOB' group by 1 order by 1;" | tee "$OUT/psql-row-count-by-attempt.txt"
pq "select count(*) as encode_master_rows_across_both_attempts
    from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.\"stageId\"='encode-master';" | tee "$OUT/psql-encode-master-row-count.txt"

say "7d. the master file AFTER the retry — re-measured on disk, and the digest the retry re-measured"
if [ -n "$MASTER_ART" ]; then
  sha256sum "$MASTER_ART" | tee "$OUT/master-after-retry.txt"
  stat -c 'bytes=%s' "$MASTER_ART" | tee -a "$OUT/master-after-retry.txt"
fi
jq -r '.reused[] | "reused kind=\(.kind) stage=\(.stageId) from attempt \(.fromAttemptNumber)\n  recorded  sha256=\(.sha256)\n  measured  sha256=\(.measuredSha256)  bytes=\(.measuredBytes)\n  path=\(.path)"' "$OUT/retry-response.json" | tee "$OUT/reused-verbatim.txt"

say "7e. the delivered container, its recorded digest and its sidecar"
artefact_rows "$JOB" | tee "$OUT/psql-attempt2-artefacts.txt"
DELIVERED_ART=$(q "select path from \"RenderArtefact\" where \"jobId\"='$JOB' and kind='delivered-container' limit 1")
echo "delivered-container row path: $DELIVERED_ART"
if [ -n "$DELIVERED_ART" ]; then
  sha256sum "$DELIVERED_ART" | tee "$OUT/delivered-on-disk.txt"
  stat -c 'bytes=%s' "$DELIVERED_ART" | tee -a "$OUT/delivered-on-disk.txt"
  echo "-- the sidecar checksum-artefact wrote --"; cat "${DELIVERED_ART}.sha256" | tee "$OUT/delivered-sidecar.txt"
fi

say "8. assertions"
BEFORE=$(awk '{print $1}' "$OUT/master-before-retry.txt" 2>/dev/null | head -1)
AFTER=$(awk '{print $1}' "$OUT/master-after-retry.txt" 2>/dev/null | head -1)
MEASURED=$(jq -r '.reused[0].measuredSha256 // empty' "$OUT/retry-response.json")
RECORDED=$(jq -r '.reused[0].sha256 // empty' "$OUT/retry-response.json")
chkf "attempt 2 was created and is attempt number" "$(jq -r '.attemptNumber' "$OUT/retry-response.json")" "2"
chkf "attempt 2 starts at container-mux" "$(jq -r '.startStageId' "$OUT/retry-response.json")" "container-mux"
chkf "attempt 2 ran exactly 2 stages" "$(q "select count(*) from \"RenderStageRun\" s join \"RenderAttempt\" a on a.id=s.\"attemptId\" where s.\"jobId\"='$JOB' and a.\"attemptNumber\"=2")" "2"
chkf "encode-master has exactly ONE row across both attempts" \
  "$(q "select count(*) from \"RenderStageRun\" s where s.\"jobId\"='$JOB' and s.\"stageId\"='encode-master'")" "1"
chkf "the five honoured stages wrote no row in attempt 2" \
  "$(q "select count(*) from \"RenderStageRun\" s join \"RenderAttempt\" a on a.id=s.\"attemptId\" where s.\"jobId\"='$JOB' and a.\"attemptNumber\"=2 and s.\"stageId\" in ('resolve-inputs','assemble-timeline','audio-mix-plan','subtitle-plan','encode-master')")" "0"
chkf "the master's digest is unchanged before vs after the retry" "$BEFORE" "$AFTER"
chkf "the retry's re-measured digest equals the digest recorded on the artefact" "$MEASURED" "$RECORDED"
chkf "the job's derived status after attempt 2" "$(jq -r '.job.status // .status' "$OUT/job-after-attempt2.json")" "succeeded"
chkf "attempt 1 is still recorded FAILED and was not rewritten" \
  "$(jq -r '.attempts[] | select(.attemptNumber==1) | .recordedState' "$OUT/job-after-attempt2.json")" "FAILED"
chkf "attempt 2 is recorded SUCCEEDED" \
  "$(jq -r '.attempts[] | select(.attemptNumber==2) | .recordedState' "$OUT/job-after-attempt2.json")" "SUCCEEDED"
chkf "the delivered container is recorded with a digest" \
  "$(q "select count(*) from \"RenderArtefact\" where \"jobId\"='$JOB' and kind='delivered-container' and length(sha256)=64")" "1"
echo "render tables after: $(db_counts)"
summary
