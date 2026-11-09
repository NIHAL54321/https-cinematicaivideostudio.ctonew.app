#!/usr/bin/env bash
# ============================================================================
# after-surfaces.sh — re-capture the three fixed surfaces from the SERVED app.
#
# Writes evidence/phase8_truthful_surfaces/after/{dashboard,media-library,storyboard}.png
# and served-identity.txt, then prints the sentence each surface actually renders.
#
# Requires: the app serving on :3100, the `agent-browser` CLI, and the demo
# project below to exist. Nothing is fabricated: every line printed is read
# back from the rendered DOM or from a response.
# ============================================================================
set -uo pipefail
BASE="${CAVS_BASE:-http://127.0.0.1:3100}"
PROJECT="${CAVS_PROJECT:-cmw9gm8tm00bbffw6pj1up5fa}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
D="$ROOT/evidence/phase8_truthful_surfaces/after"
mkdir -p "$D"
S="agent-browser --session after-surfaces"

echo "== served-build identity =="
BID=$(cat /opt/cavs-deps/.next/BUILD_ID)
CH=$(ls /opt/cavs-deps/.next/static/chunks/main-app-*.js | head -1)
NAME=$(basename "$CH")
TMP=$(mktemp)
CODE=$(curl -s -o "$TMP" -w '%{http_code}' "$BASE/_next/static/chunks/$NAME")
{
  echo "# served-build identity — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "BUILD_ID (disk): $BID"
  echo "chunk: $NAME"
  echo "disk  sha256: $(sha256sum "$CH" | cut -d' ' -f1)"
  echo "served status: $CODE  bytes: $(stat -c %s "$TMP")"
  echo "wire  sha256: $(sha256sum "$TMP" | cut -d' ' -f1)"
  echo "equal: $([ "$(sha256sum "$CH" | cut -d' ' -f1)" = "$(sha256sum "$TMP" | cut -d' ' -f1)" ] && echo YES || echo NO)"
  echo "bogus chunk status: $(curl -s -o /dev/null -w '%{http_code}' "$BASE/_next/static/chunks/does-not-exist-abc123.js")"
  echo "health: $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")"
} | tee "$D/served-identity.txt"
rm -f "$TMP"

echo "== 1. dashboard =="
$S open "$BASE/dashboard" >/dev/null 2>&1; sleep 4
$S screenshot "$D/dashboard.png" >/dev/null 2>&1
$S eval 'const t=document.body.innerText; const i=t.indexOf("RENDERS"); t.slice(Math.max(0,i-40), i+220).replace(/\n+/g," | ")' 2>&1 | tail -1

echo "== 2. media library =="
$S open "$BASE/media-library" >/dev/null 2>&1; sleep 4
$S screenshot "$D/media-library.png" >/dev/null 2>&1
$S eval 'const t=document.body.innerText; const i=t.indexOf("Stock providers"); const j=i<0?t.indexOf("Stock Provider"):i; t.slice(Math.max(0,j-20), j+420).replace(/\n+/g," | ")' 2>&1 | tail -1

echo "== 3. storyboard =="
$S open "$BASE/projects/$PROJECT" >/dev/null 2>&1; sleep 4
$S eval "Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()==='Storyboard').click(); 'clicked'" >/dev/null 2>&1
sleep 4
$S screenshot "$D/storyboard.png" >/dev/null 2>&1
$S eval 'const t=document.body.innerText; const i=t.indexOf("TIMELINE"); t.slice(i, i+420).replace(/\n+/g," | ")' 2>&1 | tail -1

echo "== written =="
ls -l "$D" | awk '{print $5, $9}'
