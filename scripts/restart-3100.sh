#!/bin/bash
# ============================================================================
# restart-3100.sh — replace the product app on :3100, and FAIL LOUDLY.
#
# WHY THIS SCRIPT LOOKS LIKE THIS
# The earlier version was four lines of `pkill -f "next-server";
# pkill -f "next start"; sleep 2; start` plus a health check that only ever
# printed the code. With no verification of anything, it could leave the OLD
# server holding :3100 — on one occasion a process still carrying a provider
# key in its environment — while starting a SECOND server that could not bind
# the port. `/api/health` then answered 200 *from the old process* and the
# operator believed the swap had happened. The same class of trap hid a
# committed fix once already: a change can be built and tested while the
# running app still serves the old build.
#
# So every claim this script makes is now a HARD CHECK. Each one prints
# [PASS] or [FAIL], a [FAIL] increments the failure count, and the script
# exits non-zero if anything failed. The assertions are:
#   1. the old server is really gone (pid not alive, and :3100 not answering)
#   2. SIGTERM was enough, or which escalation to SIGKILL was needed, is printed
#   3. the new server pid differs from the old one
#   4. the new process started AFTER the build's mtime
#      (/opt/cavs-deps/.next/BUILD_ID) — "served build is the build on disk"
#   5. the BUILD_ID the server serves matches the one on disk
#   6. the provider env var NAMES in the new process are exactly the ones this
#      launcher's environment (plus .env) set — NAMES ONLY, never a value
#   7. GET /api/health answers 200
#
# :3000 MUST NEVER BE TOUCHED.
# :3000 is the platform's own site dev server (`bun run dev` / `vite dev` in
# /home/team/shared/site). It is not ours: the owner watches it from their
# dashboard, and killing it takes the team's public site down. This script
# therefore never kills by a broad pattern — it finds the :3000 server BY PORT
# and refuses to signal any pid that owns that listening socket (or any of its
# ancestors), skips any candidate whose working directory is inside the site
# repo, and asserts the :3000 server is answering before AND after the restart.
# The product app lives on :3100 only.
#
# Usage (a key passes through the process environment only — never to disk):
#   bash scripts/restart-3100.sh
#   REPLICATE_API_TOKEN=... bash scripts/restart-3100.sh
#
# No dependencies beyond coreutils/bash: `ss` is absent on this machine and
# lsof does not show the app's IPv6 listener, so port→pid is read from /proc.
# ============================================================================
set -uo pipefail

APP=/home/team/app
PORT=3100
SITE_PORT=3000
SITE_DIR=/home/team/shared/site
BUILD_ID_FILE=/opt/cavs-deps/.next/BUILD_ID
SERVER_LOG=/tmp/cavs3100.log
RUN_LOG=${RESTART_LOG:-/tmp/restart-3100.log}
TERM_WAIT=10        # seconds to give SIGTERM before escalating
KILL_WAIT=5         # seconds to give SIGKILL
PORT_WAIT=8         # seconds to wait for :3100 to stop answering
HEALTH_WAIT=60      # seconds to wait for /api/health 200 (timeout = failure)

# The provider env var NAMES declared by src/lib/ai/providers/env-keys.ts
# (PROVIDER_ENV_KEYS). Names only — this script never reads or prints a value.
PROVIDER_ENV_NAMES="OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_AI_API_KEY GOOGLE_API_KEY REPLICATE_API_TOKEN RUNWAY_API_KEY ELEVENLABS_API_KEY STABILITY_API_KEY AZURE_SPEECH_KEY AZURE_SPEECH_REGION PEXELS_API_KEY UNSPLASH_ACCESS_KEY"

FAILURES=0
: > "$RUN_LOG" 2>/dev/null || true
ts() { date '+%H:%M:%S'; }
say() { echo "[$(ts)] $*" | tee -a "$RUN_LOG"; }
pass() { echo "[$(ts)] [PASS] $*" | tee -a "$RUN_LOG"; }
fail() { echo "[$(ts)] [FAIL] $*" | tee -a "$RUN_LOG"; FAILURES=$((FAILURES + 1)); }

# ---------------------------------------------------------------------------
# Port -> pid, read from /proc (no ss/lsof dependency).
# ---------------------------------------------------------------------------
pids_of_inode() {
  local inode="$1" p fd target
  for p in /proc/[0-9]*; do
    [ -d "$p/fd" ] || continue
    for fd in "$p"/fd/*; do
      target=$(readlink "$fd" 2>/dev/null) || continue
      case "$target" in
        "socket:[$inode]") echo "${p#/proc/}"; break 2 ;;
      esac
    done
  done
}
# Every pid holding a LISTENING socket on $1 (IPv4 or IPv6), one per line.
pid_on_port() {
  local port="$1" hex line laddr st inode
  hex=$(printf '%04X' "$port")
  for t in /proc/net/tcp /proc/net/tcp6; do
    [ -r "$t" ] || continue
    while read -r line; do
      set -- $line
      laddr="$2"; st="$4"; inode="${10}"
      case "$laddr" in
        *":$hex") [ "$st" = "0A" ] && pids_of_inode "$inode" ;;
      esac
    done < "$t"
  done
}
# Ancestors of $1, up to pid 1 (guards the site dev server's `bun run dev` parent).
ancestors_of() {
  local pid="$1" ppid n=0
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null && [ "$n" -lt 20 ]; do
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -n "$ppid" ] || break
    [ "$ppid" -gt 1 ] 2>/dev/null || break
    echo "$ppid"
    pid="$ppid"
    n=$((n + 1))
  done
}
in_list() { # in_list <needle> <space-separated haystack>
  local needle="$1" hay=" $2 "
  case "$hay" in *" $needle "*) return 0 ;; esac
  return 1
}

# ---------------------------------------------------------------------------
# THE SERVED BUILD_ID, read out of the page the server actually returns.
#
# WHY THIS IS A FUNCTION WITH A SELF-TEST (Phase 8 block 2b)
# The first version of this check grepped the UNESCAPED pattern `"b":"<id>"`.
# Next server-streams its bootstrap config as an RSC payload, so every quote in
# it arrives ESCAPED — the id travels as  \"b\":\"<id>\"  — and that pattern never
# matched. The extractor therefore always returned empty, and the fallback below
# then "found" the on-disk id somewhere in the page and set PASS. The check could
# not fail, which made it worthless as the team's proof that served == built.
#
# Two changes:
#   * unescape the payload BEFORE matching, so the real escaped form is read;
#   * the fallback no longer invents a PASS out of a loose substring. It requires
#     the expected id to appear as a QUOTED token, and it prints that it is the
#     weaker signal.
# `--selftest-buildid` drives this exact code against synthetic HTML — including
# negative controls that must report NOT-OK — so the check is tested, not assumed.
# ---------------------------------------------------------------------------
unescape_rsc() { printf '%s' "$1" | sed 's/\\"/"/g'; }

extract_served_build_id() { # extract_served_build_id <html> -> the id, or empty
  unescape_rsc "$1" | grep -o '"b":"[^"]*"' | head -1 | cut -d'"' -f4
}

# 0 when the page's build id is the expected one, 1 otherwise. Sets SERVED_ID_SOURCE.
SERVED_ID_SOURCE=""
served_build_matches() { # served_build_matches <html> <expected_id>
  local html="$1" expected="$2" served
  SERVED_ID_SOURCE='extracted from the "b":"…" field of the served HTML'
  served=$(extract_served_build_id "$html")
  if [ -z "$served" ]; then
    SERVED_ID_SOURCE="FALLBACK — the served HTML carries the expected id as a quoted token; weaker than extracting it, but not assumed"
    case "$(unescape_rsc "$html")" in
      *"\"$expected\""*) served="$expected" ;;
    esac
  fi
  [ -n "$expected" ] && [ "$served" = "$expected" ]
}

# ---------------------------------------------------------------------------
# --selftest-buildid: prove the extractor works AND can fail. Touches nothing —
# no process is signalled, no port is read, no file is written.
# ---------------------------------------------------------------------------
selftest_buildid() {
  local failures=0 got want desc html exp
  st() { # st <want: PASS|FAIL> <expected id> <html> <description>
    want="$1"; exp="$2"; html="$3"; desc="$4"
    if served_build_matches "$html" "$exp"; then got=PASS; else got=FAIL; fi
    if [ "$got" = "$want" ]; then
      echo "[PASS] selftest-buildid: $desc — reported $got as wanted"
    else
      echo "[FAIL] selftest-buildid: $desc — reported $got, wanted $want"
      failures=$((failures + 1))
    fi
  }
  # The real shape: the id travels ESCAPED inside the RSC payload.
  st PASS '4cZ0ez0BPKUnqe4EE4oM-' \
    '<script>self.__next_f.push([1,"{\"b\":\"4cZ0ez0BPKUnqe4EE4oM-\",\"p\":\"\"}"])</script>' \
    'the escaped \"b\":\"…\" form the server really streams extracts the id'
  # NEGATIVE CONTROL 1: a real id served, a different id expected.
  st FAIL 'BUILDZZZ' \
    '<script>self.__next_f.push([1,"\"b\":\"BUILDAAA\""])</script>' \
    'NEGATIVE CONTROL — served BUILDAAA against expected BUILDZZZ does not match'
  # NEGATIVE CONTROL 2: a prefix must not match by substring (the fallback's old hole).
  st FAIL 'BUILDAA' \
    '<script>self.__next_f.push([1,"\"b\":\"BUILDAAA\""])</script>' \
    'NEGATIVE CONTROL — expected BUILDAA against served BUILDAAA does not match'
  # NEGATIVE CONTROL 3: nothing extractable, and the id appears nowhere.
  st FAIL 'BUILDAAA' \
    '<html><body>no build information in this page</body></html>' \
    'NEGATIVE CONTROL — a page carrying no id does not match'
  # The fallback, exercised on its own: no "b":"…" field, but the id is a quoted token.
  st PASS 'BUILDAAA' \
    '<script id="__NEXT_DATA__" type="application/json">{"buildId":"BUILDAAA","page":"/signin"}</script>' \
    'the quoted-token fallback still reads a page with no b field'
  # ...and a bare, unquoted mention must NOT reach the fallback (the hole this closed).
  st FAIL 'BUILDAAA' \
    '<script src="/_next/static/BUILDAAA/_buildManifest.js"></script>' \
    'NEGATIVE CONTROL — an unquoted path mention alone does not satisfy the fallback'
  echo "RESULT: $([ "$failures" -eq 0 ] && echo 'SELFTEST OK (6/6)' || echo "SELFTEST NOT OK ($failures failed)")"
  return "$([ "$failures" -eq 0 ] && echo 0 || echo 1)"
}

case "${1:-}" in
  --selftest-buildid) selftest_buildid; exit $? ;;
esac

say "=== restart-3100.sh start (port :$PORT; :$SITE_PORT is the platform's site dev server and must not be touched) ==="

# ---------------------------------------------------------------------------
# 0. Preconditions: the repo, the build, and the site dev server we must not kill.
# ---------------------------------------------------------------------------
[ -f "$BUILD_ID_FILE" ] || { fail "no build on disk ($BUILD_ID_FILE missing)"; echo "RESULT: ABORTED"; exit 1; }
DISK_BUILD_ID=$(cat "$BUILD_ID_FILE" 2>/dev/null | tr -d '[:space:]')
BUILD_MTIME=$(stat -c %Y "$BUILD_ID_FILE" 2>/dev/null || echo 0)
command -v bunx >/dev/null 2>&1 || { fail "bunx not on PATH — cannot start the app"; echo "RESULT: ABORTED"; exit 1; }

SITE_PIDS=$(pid_on_port "$SITE_PORT" | sort -u | tr '\n' ' ')
SITE_PIDS=$(echo $SITE_PIDS)
PROTECTED="$SITE_PIDS"
for p in $SITE_PIDS; do PROTECTED="$PROTECTED $(ancestors_of "$p" | tr '\n' ' ')"; done
PROTECTED=$(echo $PROTECTED | tr ' ' '\n' | sort -u | tr '\n' ' ')
SITE_CODE_BEFORE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$SITE_PORT/" 2>/dev/null)
say "site dev server on :$SITE_PORT — pids [$SITE_PIDS], protected set [$PROTECTED], HTTP $SITE_CODE_BEFORE (not touched by this script)"
if [ "$SITE_CODE_BEFORE" = "200" ]; then
  pass "the platform's site dev server on :$SITE_PORT is answering before the restart"
else
  fail "the platform's site dev server on :$SITE_PORT did not answer before the restart (HTTP ${SITE_CODE_BEFORE:-none})"
fi

# ---------------------------------------------------------------------------
# 1. The old server: collect it BY PORT and by its own command line, never by a
#    pattern that could match the site dev server.
# ---------------------------------------------------------------------------
OLD_PORT_PIDS=$(pid_on_port "$PORT" | sort -u | tr '\n' ' ')
OLD_PORT_PIDS=$(echo $OLD_PORT_PIDS)
OLD_CMD_PIDS=$(
  {
    pgrep -f "next start -p $PORT" 2>/dev/null
    pgrep -f "next-server" 2>/dev/null
  } | sort -u | grep -v -x "$$" | grep -v -x "$PPID" | tr '\n' ' '
)
OLD_CMD_PIDS=$(echo $OLD_CMD_PIDS)
OLD_PIDS=$(echo "$OLD_PORT_PIDS $OLD_CMD_PIDS" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ')
OLD_PIDS=$(echo $OLD_PIDS)
OLD_SERVER_PID=$(echo $OLD_PORT_PIDS | awk '{print $1}')
[ -n "$OLD_SERVER_PID" ] || OLD_SERVER_PID=$(echo $OLD_CMD_PIDS | awk '{print $1}')
say "old process set: by port [$OLD_PORT_PIDS] · by command line [$OLD_CMD_PIDS] · combined [$OLD_PIDS]"

# Refuse to signal anything that owns :3000 or lives in the site repo.
KILLABLE=""
for p in $OLD_PIDS; do
  if in_list "$p" "$PROTECTED"; then
    say "SKIPPED pid $p — it owns/ancestors the :$SITE_PORT site dev server and is never signalled by this script"
    continue
  fi
  cwd=$(readlink "/proc/$p/cwd" 2>/dev/null || echo "")
  case "$cwd" in
    "$SITE_DIR"*) say "SKIPPED pid $p — its working directory is the site repo ($cwd)"; continue ;;
  esac
  cmd=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
  case "$cmd" in
    *vite*|*"bun run dev"*|*esbuild*) say "SKIPPED pid $p — looks like the site dev server ($cmd)"; continue ;;
  esac
  KILLABLE="$KILLABLE $p"
done
KILLABLE=$(echo $KILLABLE)
say "will signal [${KILLABLE:-none}] with SIGTERM first"

# ---------------------------------------------------------------------------
# 2. Terminate, confirm gone, escalate to SIGKILL only if needed.
# ---------------------------------------------------------------------------
ESCAPATION="none"
if [ -n "$KILLABLE" ]; then
  for p in $KILLABLE; do kill -TERM "$p" 2>/dev/null; done
  waited=0
  while [ "$waited" -lt "$TERM_WAIT" ]; do
    alive=""
    for p in $KILLABLE; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
    [ -z "$(echo $alive)" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  alive=""
  for p in $KILLABLE; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
  alive=$(echo $alive)
  if [ -z "$alive" ]; then
    ESCAPATION="SIGTERM"
    pass "old process stopped by SIGTERM after ${waited}s [$KILLABLE]"
  else
    say "still alive after SIGTERM + ${TERM_WAIT}s: [$alive] — escalating to SIGKILL"
    for p in $alive; do kill -KILL "$p" 2>/dev/null; done
    waited2=0
    while [ "$waited2" -lt "$KILL_WAIT" ]; do
      still=""
      for p in $alive; do kill -0 "$p" 2>/dev/null && still="$still $p"; done
      [ -z "$(echo $still)" ] && break
      sleep 1
      waited2=$((waited2 + 1))
    done
    still=""
    for p in $alive; do kill -0 "$p" 2>/dev/null && still="$still $p"; done
    still=$(echo $still)
    if [ -z "$still" ]; then
      ESCAPATION="SIGKILL"
      pass "old process stopped by SIGKILL after SIGTERM failed (SIGTERM + ${TERM_WAIT}s, then SIGKILL + ${waited2}s) [$alive]"
    else
      ESCAPATION="SIGKILL-FAILED"
      fail "old process survived SIGKILL: [$still] — refusing to start a second server on :$PORT"
    fi
  fi
else
  say "no old server found to stop (nothing on :$PORT, no matching command line)"
fi
say "termination path used: $ESCAPATION"

# Every old pid must be gone, whoever signalled it.
survivors=""
for p in $OLD_PIDS; do kill -0 "$p" 2>/dev/null && survivors="$survivors $p"; done
survivors=$(echo $survivors)
if [ -z "$survivors" ]; then
  pass "all old pids are gone (pids [$OLD_PIDS] no longer alive)"
else
  fail "old pids still alive: [$survivors]"
fi

# The port must have stopped answering, too.
code=""
for _ in $(seq 1 "$PORT_WAIT"); do
  code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" 2>/dev/null)
  [ "$code" != "200" ] && break
  sleep 1
done
if [ "$code" = "200" ]; then
  fail ":$PORT is STILL answering /api/health 200 after the old process was stopped — something else holds the port"
else
  pass ":$PORT stopped answering (last code ${code:-000} = refused/absent)"
fi

if [ "$ESCAPATION" = "SIGKILL-FAILED" ]; then
  say "RESULT: ABORTED — a second server will not be started onto a port an old one still holds"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Start, and wait for health with a bounded retry (a timeout is a failure).
# ---------------------------------------------------------------------------
cd "$APP" || { fail "cannot cd $APP"; exit 1; }
say "starting: setsid nohup bunx next start -p $PORT > $SERVER_LOG 2>&1 &"
setsid nohup bunx next start -p "$PORT" > "$SERVER_LOG" 2>&1 &
LAUNCHER_PID=$!
say "launcher pid $LAUNCHER_PID"

code=""
waited=0
while [ "$waited" -lt "$HEALTH_WAIT" ]; do
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 1
  waited=$((waited + 1))
done
if [ "$code" = "200" ]; then
  pass "/api/health answered 200 after ${waited}s (bounded wait ${HEALTH_WAIT}s)"
else
  fail "/api/health did not answer 200 within ${HEALTH_WAIT}s (last code ${code:-none}) — treat as failure; tail $SERVER_LOG"
fi

# ---------------------------------------------------------------------------
# 4. Identify the new server and check the pid really changed.
# ---------------------------------------------------------------------------
NEW_PORT_PIDS=$(pid_on_port "$PORT" | sort -u | tr '\n' ' ')
NEW_PORT_PIDS=$(echo $NEW_PORT_PIDS)
NEW_CMD_PIDS=$(pgrep -f "next-server" 2>/dev/null | sort -u | tr '\n' ' ')
NEW_CMD_PIDS=$(echo $NEW_CMD_PIDS)
NEW_PIDS=$(echo "$NEW_PORT_PIDS $NEW_CMD_PIDS" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ')
NEW_PIDS=$(echo $NEW_PIDS)
NEW_PID=$(echo $NEW_PORT_PIDS | awk '{print $1}')
[ -n "$NEW_PID" ] || NEW_PID=$(echo $NEW_CMD_PIDS | awk '{print $1}')
say "new process set: by port [$NEW_PORT_PIDS] · by command line [$NEW_CMD_PIDS] · launcher $LAUNCHER_PID"

if [ -z "$NEW_PID" ]; then
  fail "could not identify the new server pid"
else
  pass "new server pid $NEW_PID (launcher $LAUNCHER_PID)"
fi
if [ -z "$OLD_SERVER_PID" ]; then
  pass "pid changed — no old server pid existed to compare against (old was absent)"
elif [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$OLD_SERVER_PID" ]; then
  pass "new server pid $NEW_PID differs from old server pid $OLD_SERVER_PID"
else
  fail "new server pid ($NEW_PID) equals the old server pid ($OLD_SERVER_PID) — the old process was NOT replaced"
fi
reused=""
for p in $NEW_PIDS; do in_list "$p" "$OLD_PIDS" && reused="$reused $p"; done
reused=$(echo $reused)
if [ -z "$reused" ]; then
  pass "no pid from the old process set [$OLD_PIDS] appears in the new set [$NEW_PIDS]"
else
  fail "pids reused from the old process: [$reused]"
fi

# ---------------------------------------------------------------------------
# 5. The process must have started after the build's mtime.
# ---------------------------------------------------------------------------
if [ -n "$NEW_PID" ]; then
  LSTART=$(ps -o lstart= -p "$NEW_PID" 2>/dev/null | sed 's/^ *//')
  START_EPOCH=$(date -d "$LSTART" +%s 2>/dev/null || echo 0)
  if [ "$START_EPOCH" -gt "$BUILD_MTIME" ]; then
    pass "process start ($LSTART = $START_EPOCH) is AFTER the build's mtime ($(date -d "@$BUILD_MTIME" '+%Y-%m-%d %H:%M:%S') = $BUILD_MTIME)"
  else
    fail "process start ($LSTART = $START_EPOCH) is NOT after the build's mtime ($BUILD_MTIME) — this server may be serving an older build"
  fi
else
  fail "no new pid — cannot check the start time against the build's mtime"
fi

# ---------------------------------------------------------------------------
# 6. The BUILD_ID the server serves must be the one on disk.
# ---------------------------------------------------------------------------
SIGNIN_HTML=$(curl -s -m 10 "http://127.0.0.1:$PORT/signin" 2>/dev/null)
SERVED_BUILD_ID=$(extract_served_build_id "$SIGNIN_HTML")
if served_build_matches "$SIGNIN_HTML" "$DISK_BUILD_ID"; then SERVED_MATCH=yes; else SERVED_MATCH=no; fi
say "served BUILD_ID [$SERVED_BUILD_ID] · BUILD_ID on disk [$DISK_BUILD_ID] · how the served id was read: $SERVED_ID_SOURCE"
if [ "$SERVED_MATCH" = "yes" ]; then
  pass "the server serves the BUILD_ID on disk ($DISK_BUILD_ID) — $SERVED_ID_SOURCE"
else
  fail "served BUILD_ID (${SERVED_BUILD_ID:-none}) does not match the BUILD_ID on disk ($DISK_BUILD_ID) — the running app is not the built app (read via: $SERVED_ID_SOURCE)"
  if [ -z "$SERVED_BUILD_ID" ]; then
    say "note: nothing was extracted from /signin; run 'bash scripts/restart-3100.sh --selftest-buildid' to prove the extractor itself works"
  fi
fi
MANIFEST_CODE=$(curl -s -m 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/_next/static/$DISK_BUILD_ID/_buildManifest.js" 2>/dev/null)
if [ "$MANIFEST_CODE" = "200" ]; then
  pass "the served build's own asset path responds (/_next/static/$DISK_BUILD_ID/_buildManifest.js -> 200; an unknown id returns 404 here)"
else
  fail "/_next/static/$DISK_BUILD_ID/_buildManifest.js answered $MANIFEST_CODE, not 200"
fi

# ---------------------------------------------------------------------------
# 7. Provider env var NAMES in the new process — names only, never values.
#    Expected = the names set in this launcher's own environment plus those in
#    the app's .env (a .env provider key would reach the server too). A key that
#    belongs to an OLD process must not appear here.
# ---------------------------------------------------------------------------
ENV_FILE_NAMES=""
if [ -f "$APP/.env" ]; then
  ENV_FILE_NAMES=$(grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$APP/.env" 2>/dev/null | tr -d '=' | tr '\n' ' ')
fi
EXPECTED_NAMES=""
for n in $PROVIDER_ENV_NAMES; do
  if [ -n "${!n:-}" ] || in_list "$n" "$ENV_FILE_NAMES"; then EXPECTED_NAMES="$EXPECTED_NAMES $n"; fi
done
EXPECTED_NAMES=$(echo $EXPECTED_NAMES)
ACTUAL_NAMES=""
if [ -n "$NEW_PID" ] && [ -r "/proc/$NEW_PID/environ" ]; then
  PROC_NAMES=$(tr '\0' '\n' < "/proc/$NEW_PID/environ" 2>/dev/null | cut -d= -f1)
  for n in $PROVIDER_ENV_NAMES; do
    printf '%s\n' "$PROC_NAMES" | grep -qx "$n" && ACTUAL_NAMES="$ACTUAL_NAMES $n"
  done
fi
ACTUAL_NAMES=$(echo $ACTUAL_NAMES)
COUNT_EXPECTED=$(echo $EXPECTED_NAMES | wc -w)
COUNT_ACTUAL=$(echo $ACTUAL_NAMES | wc -w)
say "provider env var NAMES (no values, ever): expected in the new process [$EXPECTED_NAMES] ($COUNT_EXPECTED) · present in pid $NEW_PID [$ACTUAL_NAMES] ($COUNT_ACTUAL)"
if [ "$COUNT_EXPECTED" -eq "$COUNT_ACTUAL" ] && [ "$(echo "$EXPECTED_NAMES" | tr ' ' '\n' | sort | tr -d ' ' | tr '\n' ' ')" = "$(echo "$ACTUAL_NAMES" | tr ' ' '\n' | sort | tr -d ' ' | tr '\n' ' ')" ]; then
  pass "the new process carries exactly the expected provider env var NAMES ($COUNT_ACTUAL${ACTUAL_NAMES:+: $ACTUAL_NAMES}) — a name set in the environment of an OLD process would show up here as a difference"
else
  fail "provider env var NAMES differ from what this launcher set (expected $COUNT_EXPECTED [$EXPECTED_NAMES], got $COUNT_ACTUAL [$ACTUAL_NAMES]) — a leaked or missing key"
fi

# ---------------------------------------------------------------------------
# 8. The last word: /api/health must be 200 (re-read, after all of the above).
# ---------------------------------------------------------------------------
FINAL_CODE=$(curl -s -m 8 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" 2>/dev/null)
if [ "$FINAL_CODE" = "200" ]; then
  pass "GET http://127.0.0.1:$PORT/api/health -> 200"
else
  fail "GET http://127.0.0.1:$PORT/api/health -> ${FINAL_CODE:-none}"
fi

# ---------------------------------------------------------------------------
# 9. The site dev server on :3000 must be untouched and still answering.
# ---------------------------------------------------------------------------
SITE_PIDS_AFTER=$(pid_on_port "$SITE_PORT" | sort -u | tr '\n' ' ')
SITE_PIDS_AFTER=$(echo $SITE_PIDS_AFTER)
SITE_CODE_AFTER=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$SITE_PORT/" 2>/dev/null)
if [ "$SITE_CODE_AFTER" = "200" ] && [ "$SITE_PIDS_AFTER" = "$SITE_PIDS" ]; then
  pass "the platform's site dev server on :$SITE_PORT is untouched (same pids [$SITE_PIDS_AFTER], HTTP 200)"
else
  fail "the platform's site dev server on :$SITE_PORT changed or stopped (pids before [$SITE_PIDS] after [$SITE_PIDS_AFTER], HTTP ${SITE_CODE_AFTER:-none})"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
say "summary — old pids [$OLD_PIDS] -> new pids [$NEW_PIDS] · termination $ESCAPATION · served BUILD_ID ${SERVED_BUILD_ID:-none} · provider env names ($COUNT_ACTUAL) · :$SITE_PORT untouched"
if [ "$FAILURES" -gt 0 ]; then
  say "RESULT: FAILED — $FAILURES assertion(s) failed. The server on :$PORT is NOT verified."
  exit 1
fi
say "RESULT: OK — the server on :$PORT was replaced and every assertion above passed."
exit 0
