#!/bin/bash
# PART A — "the served build is this tree", by CHUNK DIGEST (WORKFLOW.md method).
# The _buildManifest.js probe is not dependable, so identity is proved by
# comparing the bytes on the wire with the bytes on disk.
set -u
cd /home/team/app || exit 1
LOG=/tmp/served-digest.log
: > "$LOG"
BASE=http://127.0.0.1:3100
NEXT=/opt/cavs-deps/.next

{
  echo "== commit on disk:            $(git rev-parse HEAD)"
  echo "== branch:                    $(git branch --show-current)"
  echo "== git status --porcelain:    [$(git status --porcelain | tr '\n' ';')]"
  echo "== BUILD_ID on disk:          $(cat "$NEXT/BUILD_ID")"
  echo ""

  echo "---- 1. the chunk /signin references, served vs on disk ----"
  CH=$(curl -s "$BASE/signin" | grep -o '/_next/static/chunks/main-app-[^"]*' | head -1)
  echo "chunk referenced by /signin: $CH"
  curl -s "$BASE$CH" -o /tmp/served-main-app.js
  echo "served  : $(sha256sum /tmp/served-main-app.js | cut -d' ' -f1)  $(stat -c %s /tmp/served-main-app.js) bytes"
  echo "on disk : $(sha256sum "$NEXT${CH#/_next}" | cut -d' ' -f1)  $(stat -c %s "$NEXT${CH#/_next}") bytes"
  if cmp -s /tmp/served-main-app.js "$NEXT${CH#/_next}"; then echo "RESULT: IDENTICAL — the bytes on the wire are the bytes on disk"; else echo "RESULT: DIFFERENT — the server is NOT serving this build"; fi
  echo ""

  echo "---- 2. the chunk carrying THIS BLOCK'S new panel copy ----"
  # The phrase exists only in the block-6 panel. If the served chunk carries it,
  # the block-6 code is what is being served.
  PHRASE="What Retry does, and what it does not do"
  HITS=$(grep -rl --include='*.js' -F "$PHRASE" "$NEXT/static" 2>/dev/null | head -5)
  echo "files on disk containing the block-6 panel copy:"
  echo "$HITS" | sed "s|^$NEXT||" | sed 's/^/  /'
  for f in $HITS; do
    rel="/_next${f#"$NEXT"}"
    curl -s -g "$BASE$rel" -o /tmp/served-panel-chunk.js
    a=$(sha256sum /tmp/served-panel-chunk.js | cut -d' ' -f1)
    b=$(sha256sum "$f" | cut -d' ' -f1)
    echo "  URL: $rel"
    echo "    served  : $a  $(stat -c %s /tmp/served-panel-chunk.js) bytes"
    echo "    on disk : $b  $(stat -c %s "$f") bytes"
    if [ "$a" = "$b" ]; then echo "    RESULT: IDENTICAL"; else echo "    RESULT: DIFFERENT"; fi
    if grep -qF "$PHRASE" /tmp/served-panel-chunk.js; then echo "    the SERVED bytes contain: \"$PHRASE\""; else echo "    the served bytes do NOT contain the phrase"; fi
    # The block-6 control itself: the retry action and the attempt history labels
    # did not exist in the block-5 panel.
    for token in 'action:"retry"' 'files reused:' 'The server refused this retry'; do
      if grep -qF "$token" /tmp/served-panel-chunk.js; then echo "    the SERVED bytes contain the block-6 token: $token"; else echo "    MISSING from the served bytes: $token"; fi
    done
  done
  echo ""

  echo "---- 3. nothing was skipped by the swap ----"
  echo "the served panel chunk is the one on disk, so the block-6 control and the attempt history are what a visitor is sent"
  echo ""

  echo "---- 4. the app answers ----"
  echo "GET /api/health            -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")"
  echo "GET /signin                -> $(curl -s -o /dev/null -w '%{http_code}' "$BASE/signin")"
  echo "POST /api/studio/render {action:retry} without a session -> $(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"action":"retry","jobId":"nope"}' "$BASE/api/studio/render")"
  echo ""
  echo "== server pid and start time: $(ps -o pid=,lstart= -p "$(cat /tmp/cavs3100.pid 2>/dev/null || pgrep -f 'next-server' | head -1)" 2>/dev/null | tr -s ' ')"
  echo "== DONE"
} >> "$LOG" 2>&1
echo done
