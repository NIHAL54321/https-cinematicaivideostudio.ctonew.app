#!/bin/bash
# ============================================================================
# p8b6-lib.sh — shared helpers for the Phase 8 block 6 INDUCED-FAILURE proofs.
#
# Sourced, never executed. Everything here reads the same database and the same
# served app the product uses; nothing writes a row of its own except through
# the app's own API, so every row in the transcript was written by the code
# under test.
#
#   BASE  the app on :3100 (the product). :3000 is the platform's own site and is
#         never touched by these scripts.
#   DB    the database the app is configured against.
#   CJ    the cookie jar for the fixture account (p7a-fixture@cavs.test).
# ============================================================================

BASE=${BASE:-http://localhost:3100}
DB=${DB:-postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio}
CJ=${CJ:-/tmp/p8b6-cookies.txt}

say() { echo; echo "##### $* #####"; }

# scalar query, unaligned — for tests and loops
q() { psql "$DB" -X -q -A -F'|' -t -c "$1"; }
# aligned query — for the transcript a reader has to be able to read
pq() { psql "$DB" -X -q -c "$1"; }

signin() {
  local code
  code=$(curl -s -c "$CJ" -b "$CJ" -H 'content-type: application/json' \
    -d '{"email":"p7a-fixture@cavs.test","password":"p7a-fixture-password-2026"}' \
    -o /dev/null -w '%{http_code}' "$BASE/api/auth/signin")
  echo "signin as p7a-fixture@cavs.test -> HTTP $code"
}

# POST to the render route; $1 = JSON body, $2 = file to write the body to.
render_post() {
  curl -s -b "$CJ" -H 'content-type: application/json' -d "$1" -o "$2" \
    -w 'HTTP %{http_code}\n' "$BASE/api/studio/render"
}

# GET the read-out and UNWRAP the route's envelope ONCE: the route answers
# `{job: <RenderReadout>}`, and <RenderReadout> is the object with `status`,
# `stages`, `attempts`, `retry`, `latestAttempt` and its own nested `job` row.
# Everything downstream reads the RenderReadout itself, so a filter written as
# `.stages[]` means the read-out's stages, and `.job.stopReason` means the row's.
jobread() { curl -s -b "$CJ" "$BASE/api/studio/render?jobId=$1" | jq -c '.job'; }

# --- the read-backs the evidence quotes -------------------------------------

stage_rows() {
  pq "select a.\"attemptNumber\" as att, s.sequence as seq, s.\"stageId\", s.state::text as state,
        to_char(s.\"startedAt\" at time zone 'UTC','HH24:MI:SS.MS') as started_utc,
        to_char(s.\"finishedAt\" at time zone 'UTC','HH24:MI:SS.MS') as finished_utc,
        s.\"artefactCount\" as art,
        coalesce(s.\"errorMessage\", s.\"blockedReason\",'') as error_or_reason
      from \"RenderStageRun\" s join \"RenderAttempt\" a on a.id = s.\"attemptId\"
      where s.\"jobId\" = '$1'
      order by a.\"attemptNumber\", s.sequence;"
}

attempt_rows() {
  pq "select a.\"attemptNumber\" as att, a.state::text as state, a.\"startStageId\", a.\"continuedFromId\",
        a.\"ownerPid\", a.\"ownerProcStart\", a.\"heartbeatCount\" as hb,
        to_char(a.\"startedAt\" at time zone 'UTC','HH24:MI:SS.MS') as started_utc,
        to_char(a.\"heartbeatAt\" at time zone 'UTC','HH24:MI:SS.MS') as hb_utc,
        to_char(a.\"finishedAt\" at time zone 'UTC','HH24:MI:SS.MS') as finished_utc,
        coalesce(a.\"endedReason\",'') as ended
      from \"RenderAttempt\" a where a.\"jobId\" = '$1' order by a.\"attemptNumber\";"
}

artefact_rows() {
  pq "select a.\"attemptNumber\" as att, r.\"stageId\", r.kind, r.bytes,
        left(r.sha256, 16) as sha256_head, r.path
      from \"RenderArtefact\" r
      join \"RenderStageRun\" s on s.id = r.\"stageRunId\"
      join \"RenderAttempt\" a on a.id = s.\"attemptId\"
      where r.\"jobId\" = '$1'
      order by a.\"attemptNumber\", r.\"stageId\";"
}

# side-by-side of attempt 1 and attempt 2 — the table the block asks for
attempt_compare() {
  pq "with a1 as (
        select s.\"stageId\", s.sequence, s.state::text as st, s.\"artefactCount\" as art
        from \"RenderStageRun\" s join \"RenderAttempt\" a on a.id = s.\"attemptId\"
        where s.\"jobId\" = '$1' and a.\"attemptNumber\" = 1),
      a2 as (
        select s.\"stageId\", s.sequence, s.state::text as st, s.\"artefactCount\" as art
        from \"RenderStageRun\" s join \"RenderAttempt\" a on a.id = s.\"attemptId\"
        where s.\"jobId\" = '$1' and a.\"attemptNumber\" = 2)
      select coalesce(a1.sequence, a2.sequence) as seq,
             coalesce(a1.\"stageId\", a2.\"stageId\") as stage,
             coalesce(a1.st, '— no row —') as attempt_1,
             coalesce(a2.st, '— no row —') as attempt_2,
             coalesce(a1.art::text, '—') as art1,
             coalesce(a2.art::text, '—') as art_2
      from a1 full outer join a2 on a1.\"stageId\" = a2.\"stageId\"
      order by 1;"
}

db_counts() {
  q "select 'jobs='||(select count(*) from \"RenderJob\")
       ||' attempts='||(select count(*) from \"RenderAttempt\")
       ||' stageruns='||(select count(*) from \"RenderStageRun\")
       ||' artefacts='||(select count(*) from \"RenderArtefact\");"
}

# chk "<what>" "<actual>" "<expected>" — prints PASS/FAIL, returns 1 on FAIL
chk() {
  if [ "$2" = "$3" ]; then
    echo "[PASS] $1 — $2"
    return 0
  fi
  echo "[FAIL] $1 — expected [$3], got [$2]"
  return 1
}

FAILS=0
chkf() { chk "$@" || FAILS=$((FAILS + 1)); }
summary() {
  echo
  if [ "$FAILS" = "0" ]; then echo "RESULT: OK — every assertion in this proof held"; else echo "RESULT: $FAILS ASSERTION(S) FAILED"; fi
  exit $(( FAILS == 0 ? 0 : 1 ))
}

# wait until a stage row for $2 in job $1 reaches state $3 (any attempt), or
# until it becomes terminal-other-than-$3 (returns what it saw).
wait_stage() {
  local job=$1 stage=$2 want=$3 tries=${4:-1200} i st
  for i in $(seq 1 "$tries"); do
    st=$(q "select state::text from \"RenderStageRun\" where \"jobId\"='$job' and \"stageId\"='$stage' order by \"startedAt\" desc limit 1")
    [ "$st" = "$want" ] && { echo "observed $stage=$want after $i polls"; return 0; }
    sleep 0.1
  done
  echo "TIMEOUT waiting for $stage=$want (last state: ${st:-none})"
  return 1
}

# wait until the derived job status leaves running/queued
wait_terminal() {
  local job=$1 tries=${2:-900} i st
  for i in $(seq 1 "$tries"); do
    st=$(jobread "$job" | jq -r '.status // "?"')
    case "$st" in failed|succeeded|stopped|blocked|interrupted) echo "derived status -> $st"; return 0;; esac
    sleep 0.2
  done
  echo "TIMEOUT waiting for a terminal status (last: ${st:-?})"
  return 1
}
