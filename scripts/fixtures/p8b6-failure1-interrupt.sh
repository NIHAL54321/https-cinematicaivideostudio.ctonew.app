#!/bin/bash
# ============================================================================
# p8b6-failure1-interrupt.sh — INDUCED FAILURE 1: the process dies mid-encode.
#
# WHAT IT DOES, IN ORDER (each step prints what it observed):
#   0. signs in as the fixture account and records the render-table counts;
#   1. enqueues a SYNTHETIC ENCODER PROOF at youtube-1080p / 12 s — a declared
#      generated test source, NOT a project's video;
#   2. polls psql until `encode-master` has a RUNNING row;
#   3. records, before the kill: the stage rows, the attempt row (with the owner
#      identity it recorded), the server's whole process group and the ffmpeg
#      child;
#   4. `kill -9 -- -PGID` so the ffmpeg child dies with the server — the same
#      signal an OOM kill or a machine reset produces, with no chance for the
#      app to write an outcome;
#   5. proves the pid and the ffmpeg child are gone, and reads the rows back
#      UNCHANGED — no terminal write ever happened;
#   6. restarts the app with scripts/restart-3100.sh;
#   7. reads the job back through the API and prints the DERIVED state, then
#      asserts it is `interrupted`, names `encode-master`, and never says
#      running or succeeded.
#
# SAFETY: it refuses to signal a process group that looks like the platform's
# :3000 site dev server, and it never signals by pattern — only the pgid of the
# next-server process that owns the product app.
#
#   bash scripts/fixtures/p8b6-failure1-interrupt.sh
# ============================================================================
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/p8b6-lib.sh"
APP=$(cd "$HERE/../.." && pwd)
OUT=${OUT:-/tmp/p8b6/f1}
mkdir -p "$OUT"
echo "== p8b6 failure 1 — the process dies mid-encode =="
echo "when: $(date -u '+%Y-%m-%dT%H:%M:%SZ')  app: $APP  db: $DB  base: $BASE"
echo "output dir: $OUT"

say "0. state before anything"
signin
echo "render tables before: $(db_counts)"

say "1. enqueue a synthetic encoder proof — youtube-1080p, 12 s (declared synthetic source)"
render_post '{"action":"synthetic-proof","presetId":"youtube-1080p","durationSeconds":12}' "$OUT/enqueue.json" | tee "$OUT/enqueue.http"
jq -c '{jobId, projectId, syntheticProof, source: {widthPx: .source.widthPx, heightPx: .source.heightPx, durationSeconds: .source.durationSeconds}}' "$OUT/enqueue.json"
JOB=$(jq -r '.jobId // empty' "$OUT/enqueue.json")
if [ -z "$JOB" ]; then echo "no jobId — the enqueue was refused; transcript ends here"; cat "$OUT/enqueue.json"; exit 1; fi
echo "jobId=$JOB"
echo "$JOB" > "$OUT/jobid.txt"

say "2. wait until encode-master has a RUNNING row (psql, polled every 100 ms)"
wait_stage "$JOB" encode-master RUNNING 1800 || { echo "could not catch encode-master RUNNING — nothing was killed"; exit 1; }

say "3a. psql BEFORE the kill — stage rows"
stage_rows "$JOB" | tee "$OUT/psql-before-kill-stage-rows.txt"

say "3b. psql BEFORE the kill — attempt row (the owner identity it recorded)"
attempt_rows "$JOB" | tee "$OUT/psql-before-kill-attempts.txt"

say "3c. the server's process group and its ffmpeg child, BEFORE the kill"
SPID=$(ps -eo pid=,cmd= | awk '$2=="next-server"{print $1; exit}')
PGID=$(ps -o pgid= -p "${SPID:-0}" 2>/dev/null | tr -d ' ')
echo "next-server pid=$SPID  process group=$PGID"
ps -o pid=,ppid=,pgid=,stat=,cmd= -g "${PGID:-0}" | tee "$OUT/process-group-before-kill.txt"
echo "-- ffmpeg children --"
pgrep -a ffmpeg | tee "$OUT/ffmpeg-before-kill.txt" || echo "  (none found by pgrep)"

# --- safety: never signal the platform's site dev server --------------------
if [ -z "${PGID:-}" ] || [ -z "${SPID:-}" ]; then echo "REFUSING: could not identify the product app's process group"; exit 1; fi
if grep -qiE 'vite|cto\.site|bun run dev|shared/site' "$OUT/process-group-before-kill.txt"; then
  echo "REFUSING: that process group looks like the :3000 site dev server"; exit 1
fi
grep -q 'next-server' "$OUT/process-group-before-kill.txt" || { echo "REFUSING: no next-server in that group"; exit 1; }

say "4. kill the whole process group: kill -9 -- -$PGID"
kill -9 -- "-$PGID"
echo "kill rc=$? (0 = the signal was delivered to the group)"
sleep 1

say "5a. the process and its ffmpeg child after the kill"
if ps -p "$SPID" -o pid=,stat=,cmd= 2>/dev/null; then echo "STILL ALIVE: $SPID"; else echo "pid $SPID: no such process"; fi
if pgrep -a ffmpeg; then echo "an ffmpeg survived the group kill"; else echo "ffmpeg: none running (the child died with its group)"; fi
if pgrep -a -f 'next-server' >/dev/null; then echo "next-server still running"; else echo "next-server: none running"; fi

say "5b. psql AFTER the kill, BEFORE the restart — the rows, read back unchanged"
stage_rows "$JOB" | tee "$OUT/psql-after-kill-stage-rows.txt"
attempt_rows "$JOB" | tee "$OUT/psql-after-kill-attempts.txt"

say "5c. the absence-of-outcome facts, as data (this is what justifies the verdict later)"
pq "select s.\"stageId\", s.state::text as state,
      (s.\"finishedAt\" is null) as finished_at_is_null,
      (s.\"errorMessage\" is null) as error_message_is_null,
      (s.\"blockedReason\" is null) as blocked_reason_is_null,
      s.\"artefactCount\",
      (s.output is null) as output_is_null
    from \"RenderStageRun\" s where s.\"jobId\"='$JOB' order by s.sequence;" | tee "$OUT/psql-absence-of-outcome.txt"
pq "select a.\"attemptNumber\", a.state::text as state, (a.\"finishedAt\" is null) as finished_at_is_null,
      (a.\"endedReason\" is null) as ended_reason_is_null, a.\"ownerPid\", a.\"ownerProcStart\", a.\"heartbeatCount\"
    from \"RenderAttempt\" a where a.\"jobId\"='$JOB' order by a.\"attemptNumber\";" | tee "$OUT/psql-attempt-absence-of-outcome.txt"

say "5d. the server's own log — it ends where the signal landed (no terminal write)"
tail -n 12 /tmp/cavs3100.log | tee "$OUT/server-log-tail-before-restart.txt"

say "6. restart the app: bash scripts/restart-3100.sh"
cd "$APP" || exit 1
bash scripts/restart-3100.sh > "$OUT/restart-3100.log" 2>&1
RC=$?
echo "restart rc=$RC"
grep -E '\[PASS\]|\[FAIL\]|RESULT:|^summary' "$OUT/restart-3100.log" | tee "$OUT/restart-assertions.txt"

say "7. read the job back through the API — the DERIVED state after the restart"
signin
jobread "$JOB" > "$OUT/job-after-restart.json"
echo "job read: $(wc -c < "$OUT/job-after-restart.json") bytes of JSON"
jq '{status, statusBasis, progress, jobFlags: {syntheticProof: .job.syntheticProof, presetId: .job.presetId},
     attempts: [.attempts[] | {attemptNumber, recordedState, state, liveness, heartbeatCount, lastStageId, endedReason}],
     stages: [.stages[] | {stageId: .id, reached, state, recordedState, stateBasis, finishedAt, errorMessage}],
     notReached}' "$OUT/job-after-restart.json" | tee "$OUT/derived-state.json"

say "8. assertions — the verdict must be an interruption, never running or succeeded"
ST=$(jq -r '.job.status // .status' "$OUT/job-after-restart.json")
chkf "the derived job status is 'interrupted'" "$ST" "interrupted"
chkf "the derived job status is not 'running'" "$(echo "$ST" | grep -cx running || true)" "0"
chkf "the derived job status is not 'succeeded'" "$(echo "$ST" | grep -cx succeeded || true)" "0"
EM=$(jq -r '.stages[] | select(.id=="encode-master") | (.state // "null")' "$OUT/job-after-restart.json")
chkf "encode-master reads INTERRUPTED (not RUNNING, not SUCCEEDED)" "$EM" "INTERRUPTED"
chkf "encode-master's RECORDED state is still RUNNING — the row was never rewritten" \
  "$(jq -r '.stages[] | select(.id=="encode-master") | .recordedState' "$OUT/job-after-restart.json")" "RUNNING"
VERDICT=$(jq -r '.latestAttempt.liveness.verdict' "$OUT/job-after-restart.json")
chkf "the attempt's liveness verdict names the kind" "$VERDICT" "interrupted"
BASIS=$(jq -r '.latestAttempt.liveness.basis' "$OUT/job-after-restart.json")
echo "liveness.basis (verbatim): $BASIS"
echo "statusBasis (verbatim): $(jq -r .statusBasis "$OUT/job-after-restart.json")"
echo "stage stateBasis (verbatim): $(jq -r '.stages[] | select(.id=="encode-master") | .stateBasis' "$OUT/job-after-restart.json")"
echo "render tables after: $(db_counts)"
summary
