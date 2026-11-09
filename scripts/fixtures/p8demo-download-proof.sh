#!/usr/bin/env bash
# ============================================================================
# p8demo-download-proof.sh — the DEMO project's delivered video, downloaded as a
# verified transfer, and downloaded AGAIN from object storage after the local
# copy is deleted.
#
#   1. sign in as the demo account through the app's own route
#   2. list the download centre and take the delivered-container artefact of the
#      demo project's newest SUCCEEDED, non-synthetic job
#   3. GET /api/studio/downloads/<id> → 200, write the bytes to a file,
#      sha256sum the written file and compare it with BOTH the database row and
#      the response header (x-cavs-verified-sha256)
#   4. 410 for the master-video artefact, whose file the mux stage freed
#   5. 404 (never 403) for a foreign account asking for the same artefact, after
#      proving that account's session is a real one
#   6. THE DURABLE RE-DOWNLOAD: the local delivered file is DELETED, the same
#      artefact is downloaded again, and the response must be a 200 served from
#      object storage (x-cavs-source: object-storage) with the identical digest
#   7. the digests of everything written
#
# Every number printed is read back from a response, a file or the database.
# Exit code 0 only when every check passed.
# ============================================================================
set -uo pipefail
BASE="${P8D_BASE:-http://127.0.0.1:3100}"
EMAIL="${P8D_EMAIL:-demo@cavs.test}"
PASSWORD="${P8D_PASSWORD:-demo-password-2026}"
OUT="${P8D_PROOF_DIR:-/tmp/p8demo-proof}"
mkdir -p "$OUT"

FAILED=0
say() { printf '%s\n' "$*"; }
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then say "PASS  $1: $2"; else say "FAIL  $1: got '$2', expected '$3'"; FAILED=$((FAILED + 1)); fi
}

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
def pick(kind):
    return next((f for f in files if f.get("kind")==kind), None)
for kind in ("delivered-container","master-video"):
    f=pick(kind)
    print(f["artefactId"] if f else "")
    print(f["recordedBytes"] if f else "")
    print(f["recordedSha256"] if f else "")
    print(f["jobId"] if f else "")
    print(f["state"] if f else "")
    print(f.get("filename","") if f else "")
PY
DID=$(sed -n 1p "$OUT/artefact.txt");  DB_=$(sed -n 2p "$OUT/artefact.txt")
DSHA=$(sed -n 3p "$OUT/artefact.txt"); DJOB=$(sed -n 4p "$OUT/artefact.txt")
DSTATE=$(sed -n 5p "$OUT/artefact.txt")
MID=$(sed -n 7p "$OUT/artefact.txt");  MB_=$(sed -n 8p "$OUT/artefact.txt")
MSHA=$(sed -n 9p "$OUT/artefact.txt"); MSTATE=$(sed -n 11p "$OUT/artefact.txt")
say "delivered  : $DID (job $DJOB, state $DSTATE, $DB_ bytes, $DSHA)"
say "master     : $MID (state $MSTATE, $MB_ bytes, $MSHA)"
[ -n "$DID" ] || { say "NO DELIVERED ARTEFACT — nothing to prove"; exit 3; }

say "== 3. the download (200 + digest of the written file)"
curl -s -b "$OUT/jar.txt" -D "$OUT/headers.txt" -o "$OUT/delivered.mp4" \
  -w 'download=%{http_code} bytes=%{size_download}\n' "$BASE/api/studio/downloads/$DID"
W=$(sha256sum "$OUT/delivered.mp4" | cut -d' ' -f1)
SZ=$(stat -c%s "$OUT/delivered.mp4")
H=$(grep -i '^x-cavs-verified-sha256' "$OUT/headers.txt" | tr -d '\r' | awk '{print $2}')
HS=$(grep -i '^x-cavs-source' "$OUT/headers.txt" | tr -d '\r' | awk '{print $2}')
CL=$(grep -i '^content-length' "$OUT/headers.txt" | tr -d '\r' | awk '{print $2}')
say "sha256sum  : $W"
say "db row     : $DSHA"
say "header     : $H"
say "source     : $HS"
say "bytes      : $SZ written, Content-Length $CL, row says $DB_"
check "written file == database row" "$W" "$DSHA"
check "written file == response header" "$W" "$H"
check "written bytes == database row bytes" "$SZ" "$DB_"
check "Content-Length == database row bytes" "$CL" "$DB_"
check "served from the render output dir" "$HS" "render-output"

say "== 4. 410 for the freed master"
curl -s -b "$OUT/jar.txt" -o "$OUT/gone.json" -w 'gone=%{http_code}\n' \
  "$BASE/api/studio/downloads/$MID"
GONE=$(python3 -c "import json;d=json.load(open('$OUT/gone.json'));print(d.get('code',''));print((d.get('durable') or {}).get('state',''))" 2>/dev/null)
check "status for the freed master" "$(head -1 <<<"$GONE")" "file_gone"
say "durable    : $(sed -n 2p <<<"$GONE")"
say "sentence   : $(python3 -c "import json;print(json.load(open('$OUT/gone.json')).get('error',''))" 2>/dev/null)"

say "== 5. a foreign account asking for the same artefact"
SU=$(curl -s -c "$OUT/jar2.txt" -H 'content-type: application/json' \
  -d '{"email":"p8demo-foreign@cavs.test","password":"p8demo-foreign-password-2026"}' \
  -o "$OUT/signup2.json" -w '%{http_code}' "$BASE/api/auth/signup")
say "signup_foreign=$SU"
if [ "$SU" != "201" ]; then
  curl -s -c "$OUT/jar2.txt" -H 'content-type: application/json' \
    -d '{"email":"p8demo-foreign@cavs.test","password":"p8demo-foreign-password-2026"}' \
    -o "$OUT/signin2.json" -w 'signin_foreign=%{http_code}\n' "$BASE/api/auth/signin"
fi
AUTHED=$(curl -s -b "$OUT/jar2.txt" -o "$OUT/foreign_centre.json" -w '%{http_code}' \
  "$BASE/api/studio/downloads")
say "foreign_own_downloads=$AUTHED (must be 200: the session is a real one)"
check "the foreign account is signed in" "$AUTHED" "200"
FOREIGN=$(curl -s -b "$OUT/jar2.txt" -o "$OUT/foreign.json" -w '%{http_code}' \
  "$BASE/api/studio/downloads/$DID")
say "foreign_download=$FOREIGN"
check "foreign account gets 404, never 403" "$FOREIGN" "404"

say "== 6. the durable re-download: the local file is DELETED, then downloaded again"
LOCAL=$(cd "$(dirname "$0")/../.." && python3 - "$DJOB" <<'PY'
import json,sys,subprocess
job=sys.argv[1]
db=subprocess.run(["bash","-lc","grep -E '^DATABASE_URL' .env | cut -d= -f2- | tr -d '\"'"],capture_output=True,text=True).stdout.strip()
out=subprocess.run(["psql",db,"-A","-t","-c",
  f"select path from \"RenderArtefact\" where \"jobId\"='{job}' and kind='delivered-container';"],
  capture_output=True,text=True).stdout.strip()
print(out)
PY
)
say "local path : $LOCAL"
if [ -f "$LOCAL" ]; then
  rm -f "$LOCAL"
  say "deleted    : $( [ -f "$LOCAL" ] && echo 'STILL PRESENT' || echo 'the local delivered file is gone from the path the row names' )"
else
  say "local path was already empty — the re-download is still the same test"
fi
curl -s -b "$OUT/jar.txt" -D "$OUT/headers2.txt" -o "$OUT/delivered_restored.mp4" \
  -w 'redownload=%{http_code} bytes=%{size_download}\n' "$BASE/api/studio/downloads/$DID"
W2=$(sha256sum "$OUT/delivered_restored.mp4" | cut -d' ' -f1)
SRC2=$(grep -i '^x-cavs-source' "$OUT/headers2.txt" | tr -d '\r' | awk '{print $2}')
KEY2=$(grep -i '^x-cavs-durable-key' "$OUT/headers2.txt" | tr -d '\r' | sed 's/^[^:]*: //')
BUC2=$(grep -i '^x-cavs-durable-bucket' "$OUT/headers2.txt" | tr -d '\r' | sed 's/^[^:]*: //')
say "sha256sum  : $W2"
say "source     : $SRC2"
say "durable key: $KEY2 (bucket $BUC2)"
check "re-downloaded bytes == recorded digest" "$W2" "$DSHA"
check "re-download served from object storage" "$SRC2" "object-storage"
if [ -f "$LOCAL" ]; then say "restored   : the file is back at $LOCAL ($(stat -c%s "$LOCAL") bytes)"; else say "NOT RESTORED: nothing at $LOCAL"; FAILED=$((FAILED+1)); fi

say "== 7. the digests of what was written"
sha256sum "$OUT/delivered.mp4" "$OUT/delivered_restored.mp4" | sed "s|$OUT/||"
say "done — artefacts in $OUT"
if [ "$FAILED" -ne 0 ]; then say "RESULT: $FAILED check(s) FAILED"; exit 1; fi
say "RESULT: every check passed"
