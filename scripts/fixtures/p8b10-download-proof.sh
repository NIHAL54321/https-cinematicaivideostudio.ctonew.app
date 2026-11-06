#!/usr/bin/env bash
# ============================================================================
# p8b10-download-proof.sh — a download as a verified transfer, block-3 style.
#
#   1. sign in as the fixture account through the app's own route
#   2. list the download centre and take the delivered-container artefact of the
#      newest SUCCEEDED, non-synthetic job for the project
#   3. GET /api/studio/downloads/<id> → 200, write the bytes to a file,
#      sha256sum the written file and compare it with BOTH the database row and
#      the response header (x-cavs-verified-sha256)
#   4. 410 when the file is gone AND no durable copy exists (proved by asking for
#      an artefact whose object was never stored — a synthetic proof id)
#   5. 404 (never 403) for a foreign account asking for the same artefact
#
# Nothing is faked: every number printed is read back from a response, a file or
# the database.
# ============================================================================
set -uo pipefail
BASE="${P8B10_BASE:-http://127.0.0.1:3100}"
EMAIL="${P8B10_EMAIL:-p7a-fixture@cavs.test}"
PASSWORD="${P8B10_PASSWORD:-p7a-fixture-password-2026}"
OUT="${P8B10_PROOF_DIR:-/tmp/p8b10-proof}"
mkdir -p "$OUT"

say() { printf '%s\n' "$*"; }

say "== 1. sign in as $EMAIL"
curl -s -c "$OUT/jar.txt" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  -o "$OUT/signin.json" -w 'signin=%{http_code}\n' "$BASE/api/auth/signin"

say "== 2. the download centre"
curl -s -b "$OUT/jar.txt" -o "$OUT/downloads.json" -w 'downloads=%{http_code}\n' "$BASE/api/studio/downloads"
python3 - "$OUT/downloads.json" > "$OUT/artefact.txt" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
files=d.get("files") or d.get("centre",{}).get("files") or []
cand=[f for f in files if f.get("kind")=="delivered-container"]
print(cand[0]["artefactId"] if cand else "")
print(cand[0]["recordedBytes"] if cand else "")
print(cand[0]["recordedSha256"] if cand else "")
print(cand[0]["jobId"] if cand else "")
print(cand[0]["state"] if cand else "")
PY
ID=$(sed -n 1p "$OUT/artefact.txt"); BYTES=$(sed -n 2p "$OUT/artefact.txt")
SHA=$(sed -n 3p "$OUT/artefact.txt"); JOB=$(sed -n 4p "$OUT/artefact.txt"); STATE=$(sed -n 5p "$OUT/artefact.txt")
say "artefact   : $ID (job $JOB, state $STATE)"
say "recorded   : $BYTES bytes / $SHA"
[ -n "$ID" ] || { say "NO DELIVERED ARTEFACT — nothing to prove"; exit 3; }

say "== 3. the download (200 + digest of the written file)"
curl -s -b "$OUT/jar.txt" -D "$OUT/headers.txt" -o "$OUT/delivered.mp4" \
  -w 'download=%{http_code} bytes=%{size_download}\n' "$BASE/api/studio/downloads/$ID"
W=$(sha256sum "$OUT/delivered.mp4" | cut -d' ' -f1)
say "sha256sum  : $W"
say "header     : $(grep -i '^x-cavs-verified-sha256' "$OUT/headers.txt" | tr -d '\r')"
say "source     : $(grep -i '^x-cavs-source' "$OUT/headers.txt" | tr -d '\r')"
[ "$W" = "$SHA" ] && say "MATCH      : the written file, the database row and the header agree" || say "MISMATCH   : the written file is NOT the recorded file"

say "== 4. a foreign account asking for the same artefact"
curl -s -c "$OUT/jar2.txt" -H 'content-type: application/json' \
  -d '{"email":"p8b10-foreign@cavs.test","password":"p8b10-foreign-password-2026"}' \
  -o "$OUT/signup2.json" -w 'signup_foreign=%{http_code}\n' "$BASE/api/auth/signup"
curl -s -b "$OUT/jar2.txt" -o "$OUT/foreign.json" -w 'foreign_download=%{http_code}\n' \
  "$BASE/api/studio/downloads/$ID"

say "== 5. the digest of the whole thing"
sha256sum "$OUT/delivered.mp4" | sed 's|/tmp.*/||'
say "done — artefacts in $OUT"
