#!/bin/bash
# ============================================================================
# p8b2b-served-proof.sh — Phase 8 block 2b: prove the SERVED build carries the
# encoder, and that its gates are the ones it says they are.
#
# Everything here goes through the app's own HTTP surface on :3100 — no
# in-process calls, no direct library calls. In order:
#   1. health + the BUILD_ID the server actually serves (vs the one on disk)
#   2. sign in as the p7a fixture account
#   3. run a SYNTHETIC ENCODER PROOF through the served route: the declared
#      test source is generated and the seven-stage pipeline runs on it
#   4. enqueue a render for the FIXTURE project — it reaches the encode stage
#      and stops there, naming the missing input (there is no source media)
#   5. the probe both ways: with ffmpeg/ffprobe on PATH, then hidden by a
#      temporary rename, then restored — no code change between the three
#   6. the synthetic job's EXCLUSION: absent from the job list endpoint and from
#      the export centre page's own HTML, present in psql
#
# Usage: bash scripts/fixtures/p8b2b-served-proof.sh
# ============================================================================
set -uo pipefail
BASE="${BASE:-http://localhost:3100}"
OUT="${OUT:-/home/team/shared/evidence/phase8_block2b_encoder}"
PGURL="${PGURL:-postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio}"
PROJECT="${PROJECT:-p7a_fix_project}"
EMAIL="p7a-fixture@cavs.test"
PASSWORD="p7a-fixture-password-2026"
JAR=/tmp/p8b2b_fix.cookies
TMP=/tmp/p8b2b_served
mkdir -p "$OUT" "$TMP"
rm -f "$JAR"
say() { printf '\n=== %s\n' "$*"; }
psql_q() { psql "$PGURL" -tA -c "$1"; }

say "1. health and the served build"
curl -s -m 10 "$BASE/api/health" > "$OUT/00_health.json"; cat "$OUT/00_health.json"; echo
SIGNIN_HTML=$(curl -s -m 10 "$BASE/signin")
SERVED_BUILD_ID=$(printf '%s' "$SIGNIN_HTML" | grep -o '"b":"[^"]*"' | head -1 | cut -d'"' -f4)
DISK_BUILD_ID=$(tr -d '[:space:]' < /opt/cavs-deps/.next/BUILD_ID)
{
  echo "BUILD_ID on disk   : $DISK_BUILD_ID"
  echo "BUILD_ID served    : $SERVED_BUILD_ID"
  echo "match              : $([ "$SERVED_BUILD_ID" = "$DISK_BUILD_ID" ] && echo YES || echo NO)"
} | tee "$OUT/01_served_build.txt"

say "2. sign in as the fixture account"
curl -s -c "$JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/signin" > "$TMP/signin.json"
jq -c '{signedIn:(.user.email // null), error:(.error // null)}' "$TMP/signin.json" | tee "$OUT/02_signin.json"

say "3. a SYNTHETIC ENCODER PROOF through the served route (youtube-1080p)"
curl -s -b "$JAR" -H 'content-type: application/json' \
  -d '{"action":"synthetic-proof","presetId":"youtube-1080p","durationSeconds":2}' \
  "$BASE/api/studio/render" > "$TMP/syn.json"
SYNJOB=$(jq -r '.jobId // empty' "$TMP/syn.json")
SYNPROJ=$(jq -r '.projectId // empty' "$TMP/syn.json")
jq -c '{queued,jobId,projectId,syntheticProof,note,source:{format:.source.format,durationSeconds:.source.durationSeconds,widthPx:.source.widthPx,heightPx:.source.heightPx}}' "$TMP/syn.json" | tee "$OUT/03_synthetic_enqueue.json"
for i in $(seq 1 60); do
  curl -s -b "$JAR" "$BASE/api/studio/render?jobId=$SYNJOB" > "$TMP/synread.json"
  ST=$(jq -r '.job.status' "$TMP/synread.json")
  case "$ST" in blocked|failed|stopped|succeeded) break ;; esac
  sleep 1
done
jq '{status:.job.status, progress:.job.progress.percent, arithmetic:.job.progress.arithmetic,
     artefacts:{count:.job.artefacts.count, rows:.job.artefacts.rows},
     stages:[.job.stages[]|{id,state,reached,missingInput,artefactCount,wall:(.output.wallClockMs // null)}]}' \
  "$TMP/synread.json" > "$OUT/04_synthetic_readout.json"
cat "$OUT/04_synthetic_readout.json"
psql "$PGURL" -c "SELECT \"sequence\",\"stageId\",state,\"artefactCount\",\"syntheticProof\" FROM \"RenderStageRun\" WHERE \"jobId\"='$SYNJOB' ORDER BY \"sequence\";" > "$OUT/05_synthetic_psql_stages.txt" 2>&1
psql "$PGURL" -c "SELECT kind, bytes, sha256, \"syntheticProof\" FROM \"RenderArtefact\" WHERE \"jobId\"='$SYNJOB' ORDER BY \"createdAt\";" >> "$OUT/05_synthetic_psql_stages.txt" 2>&1
cat "$OUT/05_synthetic_psql_stages.txt"

say "4. a render for the FIXTURE project: it reaches the encode stage and stops there"
curl -s -b "$JAR" -H 'content-type: application/json' \
  -d "{\"action\":\"enqueue\",\"projectId\":\"$PROJECT\",\"presetId\":\"youtube-1080p\",\"fixture\":true}" \
  "$BASE/api/studio/render" > "$TMP/enq.json"
FIXJOB=$(jq -r '.jobId // empty' "$TMP/enq.json")
echo "fixture-project job: $FIXJOB"
for i in $(seq 1 60); do
  curl -s -b "$JAR" "$BASE/api/studio/render?jobId=$FIXJOB" > "$TMP/fixread.json"
  ST=$(jq -r '.job.status' "$TMP/fixread.json")
  case "$ST" in blocked|failed|stopped|succeeded) break ;; esac
  sleep 1
done
jq '{status:.job.status, progress:.job.progress.percent, arithmetic:.job.progress.arithmetic,
     artefacts:{count:.job.artefacts.count},
     stages:[.job.stages[]|{id,state,reached,missingInput,artefactCount}],
     notReached:.job.notReached, halted:.job.halted}' "$TMP/fixread.json" > "$OUT/06_fixture_project_readout.json"
cat "$OUT/06_fixture_project_readout.json"
psql "$PGURL" -c "SELECT \"stageId\",state,\"artefactCount\",\"missingInput\",\"errorMessage\" FROM \"RenderStageRun\" WHERE \"jobId\"='$FIXJOB' ORDER BY \"sequence\";" > "$OUT/07_fixture_psql_stages.txt" 2>&1
psql "$PGURL" -tA -c "SELECT count(*) FROM \"RenderArtefact\" WHERE \"jobId\"='$FIXJOB';" > "$OUT/08_fixture_artefact_count.txt" 2>&1
cat "$OUT/07_fixture_psql_stages.txt"; echo "artefact rows for the fixture job: $(cat "$OUT/08_fixture_artefact_count.txt")"

say "5. the probe both ways — no code change, only the binaries' presence"
{
  echo "--- 5a. binaries present: $(command -v ffmpeg) / $(command -v ffprobe)"
  curl -s -b "$JAR" -H 'content-type: application/json' -d "{\"action\":\"enqueue\",\"projectId\":\"$PROJECT\",\"presetId\":\"youtube-1080p\",\"fixture\":true}" "$BASE/api/studio/render" > "$TMP/probe_a.json"
  JA=$(jq -r '.jobId' "$TMP/probe_a.json")
  for i in $(seq 1 40); do
    curl -s -b "$JAR" "$BASE/api/studio/render?jobId=$JA" > "$TMP/probe_a_read.json"
    ST=$(jq -r '.job.status' "$TMP/probe_a_read.json")
    case "$ST" in blocked|failed|stopped|succeeded) break ;; esac
    sleep 1
  done
  echo "job $JA status=$(jq -r '.job.status' "$TMP/probe_a_read.json")"
  jq -c '.job.stages[]|{id,state,missingInput}' "$TMP/probe_a_read.json"
} | tee "$OUT/09_probe_binaries_present.txt"

{
  echo "--- 5b. ffmpeg and ffprobe HIDDEN by a temporary rename (no code change)"
  mv /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg.hidden-p8b2b
  mv /usr/local/bin/ffprobe /usr/local/bin/ffprobe.hidden-p8b2b
  echo "command -v ffmpeg -> $(command -v ffmpeg || echo '(not found)')"
  curl -s -b "$JAR" -H 'content-type: application/json' -d "{\"action\":\"enqueue\",\"projectId\":\"$PROJECT\",\"presetId\":\"youtube-1080p\",\"fixture\":true}" "$BASE/api/studio/render" > "$TMP/probe_b.json"
  JB=$(jq -r '.jobId' "$TMP/probe_b.json")
  for i in $(seq 1 40); do
    curl -s -b "$JAR" "$BASE/api/studio/render?jobId=$JB" > "$TMP/probe_b_read.json"
    ST=$(jq -r '.job.status' "$TMP/probe_b_read.json")
    case "$ST" in blocked|failed|stopped|succeeded) break ;; esac
    sleep 1
  done
  echo "job $JB status=$(jq -r '.job.status' "$TMP/probe_b_read.json") — $(jq -r '.job.statusBasis' "$TMP/probe_b_read.json")"
  jq -c '.job.stages[]|{id,state,missingInput}' "$TMP/probe_b_read.json"
  mv /usr/local/bin/ffmpeg.hidden-p8b2b /usr/local/bin/ffmpeg
  mv /usr/local/bin/ffprobe.hidden-p8b2b /usr/local/bin/ffprobe
  echo "restored: $(command -v ffmpeg) / $(command -v ffprobe)"
} | tee "$OUT/10_probe_binaries_hidden.txt"

{
  echo "--- 5c. restored: the same probe on the same build, no code change"
  curl -s -b "$JAR" -H 'content-type: application/json' -d "{\"action\":\"enqueue\",\"projectId\":\"$PROJECT\",\"presetId\":\"youtube-1080p\",\"fixture\":true}" "$BASE/api/studio/render" > "$TMP/probe_c.json"
  JC=$(jq -r '.jobId' "$TMP/probe_c.json")
  for i in $(seq 1 40); do
    curl -s -b "$JAR" "$BASE/api/studio/render?jobId=$JC" > "$TMP/probe_c_read.json"
    ST=$(jq -r '.job.status' "$TMP/probe_c_read.json")
    case "$ST" in blocked|failed|stopped|succeeded) break ;; esac
    sleep 1
  done
  echo "job $JC status=$(jq -r '.job.status' "$TMP/probe_c_read.json")"
  jq -c '.job.stages[]|{id,state,missingInput}' "$TMP/probe_c_read.json"
} | tee "$OUT/11_probe_restored.txt"

say "6. the synthetic job is excluded from every user-facing list, and present in psql"
curl -s -b "$JAR" -H 'content-type: application/json' -d '{"action":"list"}' "$BASE/api/studio/render" > "$TMP/list.json"
{
  echo "--- job list endpoint: $(jq -r '.jobs | length' "$TMP/list.json") job(s) returned"
  echo "the synthetic job id appears in the list?  $(grep -c "$SYNJOB" "$TMP/list.json" || true) time(s)"
  echo "the synthetic project id appears?          $(grep -c "$SYNPROJ" "$TMP/list.json" || true) time(s)"
  echo "every returned job's fixture/synthetic flags:"
  jq -c '.jobs[]|{id,projectId,fixture}' "$TMP/list.json" 2>/dev/null | head -20
} | tee "$OUT/12_exclusion_job_list.txt"

curl -s -b "$JAR" "$BASE/export-center" > "$TMP/export_center.html"
{
  echo "--- export centre page: HTTP $(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/export-center"), $(wc -c < "$TMP/export_center.html") bytes of HTML"
  echo "the synthetic job id appears in the page?     $(grep -c "$SYNJOB" "$TMP/export_center.html" || true) time(s)"
  echo "the synthetic project id appears in the page? $(grep -c "$SYNPROJ" "$TMP/export_center.html" || true) time(s)"
  echo "--- and the same job id in psql:"
  psql "$PGURL" -tA -c "SELECT id || ' syntheticProof=' || \"syntheticProof\" || ' preset=' || \"presetId\" || ' project=' || \"projectId\" FROM \"RenderJob\" WHERE id='$SYNJOB';"
} | tee "$OUT/13_exclusion_export_center.txt"

{
  echo "SYNTHETIC_JOB=$SYNJOB"
  echo "SYNTHETIC_PROJECT=$SYNPROJ"
  echo "FIXTURE_JOB=$FIXJOB"
  echo "PROBE_PRESENT_JOB=$JA"
  echo "PROBE_HIDDEN_JOB=$JB"
  echo "PROBE_RESTORED_JOB=$JC"
} > "$OUT/14_job_ids.txt"
echo
echo "DONE — capture in $OUT"
