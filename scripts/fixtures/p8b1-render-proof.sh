#!/bin/bash
# ============================================================================
# p8b1-render-proof.sh — Phase 8 block 1: run a REAL render on the SERVED build
# and capture the evidence.
#
# What it does, in order, against http://localhost:3100 (never :3000):
#   1. health + the BUILD_ID the server actually serves (read from the sign-in
#      HTML, the same way scripts/restart-3100.sh reads it)
#   2. signs in as the P7-7a fixture account (created by its own script)
#   3. enqueues a render for the FIXTURE project through the app's own route,
#      labelled fixture in its own data
#   4. polls the job until it reaches a terminal state and keeps every read-out
#   5. dumps the stage rows and the artefact count from psql (a COUNT, not a claim)
#   6. probes TENANT ISOLATION: a second account asks for the same job id and
#      must get 404 — never 403
#   7. prints the progress arithmetic the server derived, so it can be checked
#      by hand
#
# It writes nothing except /tmp cookie jars, the job rows in the database, and
# the capture files in $OUT. Teardown of the job rows: see the README
# (scripts/fixtures/p8b1-render-teardown.sql).
#
# Usage:  bash scripts/fixtures/p8b1-render-proof.sh
# ============================================================================
set -uo pipefail

BASE="${BASE:-http://localhost:3100}"
OUT="${OUT:-/home/team/shared/evidence/phase8_block1_render_pipeline}"
PGURL="${PGURL:-postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio}"
PROJECT="${PROJECT:-p7a_fix_project}"
EMAIL="p7a-fixture@cavs.test"
PASSWORD="p7a-fixture-password-2026"
INTRUDER_EMAIL="p8b1-intruder@cavs.test"
INTRUDER_PASSWORD="p8b1-intruder-password-2026"
FIX_JAR=/tmp/p8b1_fix.cookies
INT_JAR=/tmp/p8b1_intruder.cookies

mkdir -p "$OUT"
rm -f "$FIX_JAR" "$INT_JAR"

say() { printf '\n=== %s\n' "$*"; }
psql_q() { psql "$PGURL" -tA -c "$1"; }

say "1. health and the served build"
curl -s -m 10 "$BASE/api/health" > "$OUT/00_health.json"
cat "$OUT/00_health.json"; echo
SIGNIN_HTML=$(curl -s -m 10 "$BASE/signin")
# Phase 8 block 2b: the id travels ESCAPED inside the RSC flight payload
# (\"b\":\"<id>\"), so unescape before matching. The old unescaped grep always came
# back empty and the "match" line below was meaningless.
SERVED_BUILD_ID=$(printf '%s' "$SIGNIN_HTML" | sed 's/\\"/"/g' | grep -o '"b":"[^"]*"' | head -1 | cut -d'"' -f4)
DISK_BUILD_ID=$(tr -d '[:space:]' < /opt/cavs-deps/.next/BUILD_ID)
{
  echo "BUILD_ID on disk   : $DISK_BUILD_ID"
  echo "BUILD_ID served    : $SERVED_BUILD_ID"
  echo "match              : $([ "$SERVED_BUILD_ID" = "$DISK_BUILD_ID" ] && echo YES || echo NO)"
  echo "asset path status  : $(curl -s -o /dev/null -w '%{http_code}' "$BASE/_next/static/$DISK_BUILD_ID/_buildManifest.js")"
} | tee "$OUT/07_served_build.txt"

say "2. sign in as the fixture account"
curl -s -c "$FIX_JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/signin" \
  | tee "$OUT/01_signin.json"; echo

say "3. enqueue a render (FIXTURE project, labelled fixture in its own row)"
ENQ=$(curl -s -b "$FIX_JAR" -H 'content-type: application/json' \
  -d "{\"action\":\"enqueue\",\"projectId\":\"$PROJECT\",\"presetId\":\"youtube-2160p\",\"fixture\":true}" \
  "$BASE/api/studio/render")
echo "$ENQ" | tee "$OUT/02_enqueue.json"
JOB=$(echo "$ENQ" | jq -r '.jobId // empty')
if [ -z "$JOB" ]; then echo "NO JOB ID — stopping"; exit 1; fi
echo "job id: $JOB"

say "4. watch it run in the background (polling the served API)"
for i in $(seq 1 40); do
  curl -s -b "$FIX_JAR" "$BASE/api/studio/render?jobId=$JOB" > /tmp/p8b1_read.json
  ST=$(jq -r '.job.status' /tmp/p8b1_read.json)
  PC=$(jq -r '.job.progress.percent' /tmp/p8b1_read.json)
  ROWS=$(jq -r '.job.stages | map(select(.reached)) | length' /tmp/p8b1_read.json)
  printf 'poll %02d: status=%s percent=%s stage-rows=%s\n' "$i" "$ST" "$PC" "$ROWS"
  case "$ST" in blocked|failed|stopped|succeeded) break ;; esac
  sleep 1
done
cp /tmp/p8b1_read.json "$OUT/03_job_readout.json"

say "5. the read-out, as the server derived it"
jq '{status:.job.status, statusBasis:.job.statusBasis,
     progress:{percent:.job.progress.percent, earnedWeight:.job.progress.earnedWeight,
               totalWeight:.job.progress.totalWeight, arithmetic:.job.progress.arithmetic},
     artefacts:{count:.job.artefacts.count, rows:.job.artefacts.rows},
     stages:[.job.stages[] | {id,sequence,title,weight,reached,state,missingInput,artefactCount}],
     notReached:.job.notReached,
     job:.job.job}' "$OUT/03_job_readout.json" > "$OUT/04_derived_readout.json"
cat "$OUT/04_derived_readout.json"

say "6. the stage rows in psql"
{
  echo "--- RenderJob (note: there is no status column; status is derived)"
  psql "$PGURL" -c "SELECT id, \"projectId\", \"presetId\", fixture, \"pipelineVersion\", \"requestedAt\", \"startedAt\", \"finishedAt\", \"stopRequestedAt\", \"stopReason\" FROM \"RenderJob\" WHERE id = '$JOB';"
  echo "--- RenderStageRun (one row per stage the pipeline REACHED)"
  psql "$PGURL" -c "SELECT \"sequence\", \"stageId\", state, \"artefactCount\", \"missingInput\", \"blockedReason\", \"errorMessage\", \"startedAt\", \"finishedAt\" FROM \"RenderStageRun\" WHERE \"jobId\" = '$JOB' ORDER BY \"sequence\";"
  echo "--- RenderArtefact (a COUNT, not a claim)"
  psql "$PGURL" -c "SELECT count(*) AS artefacts FROM \"RenderArtefact\" WHERE \"jobId\" = '$JOB';"
} | tee "$OUT/05_psql_rows.txt"

ARTEFACT_COUNT=$(psql_q "SELECT count(*) FROM \"RenderArtefact\" WHERE \"jobId\" = '$JOB';")
STAGE_ROW_COUNT=$(psql_q "SELECT count(*) FROM \"RenderStageRun\" WHERE \"jobId\" = '$JOB';")
DECLARED=$(psql_q "SELECT count(*) FROM \"RenderJob\" WHERE id = '$JOB';")
{
  echo "declared stages in the pipeline : 7"
  echo "stage rows written              : $STAGE_ROW_COUNT"
  echo "stages with NO row (not reached) : $((7 - STAGE_ROW_COUNT))"
  echo "artefact rows                   : $ARTEFACT_COUNT"
  echo "job rows                        : $DECLARED"
} | tee "$OUT/06_artefact_count.txt"

say "7. progress arithmetic, checked by hand"
jq -r '.progress.arithmetic' "$OUT/03_job_readout.json" | tee "$OUT/09_progress_arithmetic.txt"
jq -r '"earned=" + (.progress.earnedWeight|tostring) + " total=" + (.progress.totalWeight|tostring) + " floor(earned/total*100)=" + (((.progress.earnedWeight / .progress.totalWeight) * 100)|floor|tostring) + " reported=" + (.progress.percent|tostring)' "$OUT/03_job_readout.json" | tee -a "$OUT/09_progress_arithmetic.txt"

say "8. tenant isolation: another account asks for the same job id"
curl -s -c "$INT_JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$INTRUDER_EMAIL\",\"password\":\"$INTRUDER_PASSWORD\"}" "$BASE/api/auth/signup" > /tmp/p8b1_signup.json
if ! jq -e '.user.email' /tmp/p8b1_signup.json > /dev/null 2>&1; then
  curl -s -c "$INT_JAR" -H 'content-type: application/json' \
    -d "{\"email\":\"$INTRUDER_EMAIL\",\"password\":\"$INTRUDER_PASSWORD\"}" "$BASE/api/auth/signin" > /tmp/p8b1_signin2.json
fi
{
  echo "--- the foreign account's own session:"
  curl -s -b "$INT_JAR" "$BASE/api/auth/session" | head -c 300; echo
  echo "--- GET the fixture account's job with the foreign cookie:"
  curl -s -b "$INT_JAR" -o /tmp/p8b1_foreign.json -w 'HTTP %{http_code}\n' "$BASE/api/studio/render?jobId=$JOB"
  cat /tmp/p8b1_foreign.json; echo
  echo "--- POST action=read with the foreign cookie:"
  curl -s -b "$INT_JAR" -o /tmp/p8b1_foreign2.json -w 'HTTP %{http_code}\n' -H 'content-type: application/json' \
    -d "{\"action\":\"read\",\"jobId\":\"$JOB\"}" "$BASE/api/studio/render"
  cat /tmp/p8b1_foreign2.json; echo
  echo "--- POST action=stop with the foreign cookie (must also be 404, and must not stop it):"
  curl -s -b "$INT_JAR" -o /tmp/p8b1_foreign3.json -w 'HTTP %{http_code}\n' -H 'content-type: application/json' \
    -d "{\"action\":\"stop\",\"jobId\":\"$JOB\",\"reason\":\"intruder\"}" "$BASE/api/studio/render"
  cat /tmp/p8b1_foreign3.json; echo
  echo "--- a project that is not theirs: enqueue must be 404 too"
  curl -s -b "$INT_JAR" -o /tmp/p8b1_foreign4.json -w 'HTTP %{http_code}\n' -H 'content-type: application/json' \
    -d "{\"action\":\"enqueue\",\"projectId\":\"$PROJECT\"}" "$BASE/api/studio/render"
  cat /tmp/p8b1_foreign4.json; echo
  echo "--- the owner's own read still works after those attempts:"
  curl -s -b "$FIX_JAR" "$BASE/api/studio/render?jobId=$JOB" | jq -c '{status:.job.status, stopReason:.job.job.stopReason}'
} | tee "$OUT/08_tenant_isolation.txt"

say "DONE — job $JOB; artefacts $ARTEFACT_COUNT; capture in $OUT"
