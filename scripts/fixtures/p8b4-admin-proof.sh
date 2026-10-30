#!/usr/bin/env bash
# ===========================================================================
# p8b4-admin-proof.sh — the block 4 proof, run against the SERVED build.
# ===========================================================================
# Proves, in one run, that the operator surface:
#   - is reachable for an account whose role column says ADMIN;
#   - answers 404 (never 403, never a partial object) for a second, ordinary,
#     signed-in account;
#   - answers 401 for an anonymous caller;
#   - and that every number it reports equals the number PostgreSQL reports in
#     the same run (scripts/fixtures/p8b4-crosscheck.py, printed side by side).
#
#   bash scripts/fixtures/p8b4-admin-proof.sh [logfile]
#
# The role is granted by the SCRIPT (grant-admin.ts), never by an email in code.
# ===========================================================================
set -uo pipefail
LOG="${1:-/tmp/b4_admin_proof.log}"
: > "$LOG"
exec >>"$LOG" 2>&1
BASE="${BASE_URL:-http://127.0.0.1:3100}"
ADMIN_EMAIL="${ADMIN_EMAIL:-p7a-fixture@cavs.test}"
ADMIN_PASS="${ADMIN_PASS:-p7a-fixture-password-2026}"
ORD_EMAIL="${ORD_EMAIL:-p8b4-ordinary@cavs.test}"
ORD_PASS="${ORD_PASS:-p8b4-ordinary-password-2026}"
APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$APP"

say() { echo; echo "=== $* ==="; }
echo "proof start $(date -u)"
echo "base url: $BASE"
echo "BUILD_ID on disk: $(cat .next/BUILD_ID 2>/dev/null)"

say "0. the operator role is granted by a script, not by an email in code"
bun scripts/fixtures/grant-admin.ts "$ADMIN_EMAIL"
echo "[grant rc=$?]"

say "1. sign in as the operator account"
curl -s -c /tmp/b4_admin.jar -o /tmp/b4_signin_admin.json \
  -w "signin_http=%{http_code}\n" -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" "$BASE/api/auth/signin"
cat /tmp/b4_signin_admin.json; echo

say "2. GET /api/studio/admin/overview as the operator — the full object"
curl -s -b /tmp/b4_admin.jar -o /tmp/b4_overview.json \
  -w "overview_http=%{http_code} bytes=%{size_download}\n" "$BASE/api/studio/admin/overview"
echo "--- first 900 bytes of the body, verbatim ---"
head -c 900 /tmp/b4_overview.json; echo

say "3. a SECOND account: sign up an ordinary one, with its own session"
curl -s -c /tmp/b4_ord.jar -o /tmp/b4_signup_ord.json \
  -w "signup_http=%{http_code}\n" -H 'content-type: application/json' \
  -d "{\"email\":\"$ORD_EMAIL\",\"password\":\"$ORD_PASS\",\"name\":\"Block 4 ordinary account\"}" \
  "$BASE/api/auth/signup"
cat /tmp/b4_signup_ord.json; echo

say "4. that ordinary account asks for the overview: 404, never 403"
curl -s -b /tmp/b4_ord.jar -o /tmp/b4_overview_ord.json \
  -w "ordinary_http=%{http_code} bytes=%{size_download}\n" "$BASE/api/studio/admin/overview"
cat /tmp/b4_overview_ord.json; echo

say "5. nobody signed in asks for the overview: 401"
curl -s -o /tmp/b4_overview_anon.json -w "anon_http=%{http_code} bytes=%{size_download}\n" \
  "$BASE/api/studio/admin/overview"
cat /tmp/b4_overview_anon.json; echo

say "6. the page: 200 for the operator, 404 for the ordinary account, redirect when anonymous"
curl -s -b /tmp/b4_admin.jar -o /tmp/b4_admin_page.html \
  -w "admin_page_http=%{http_code} bytes=%{size_download}\n" "$BASE/admin"
curl -s -b /tmp/b4_ord.jar -o /tmp/b4_ord_page.html \
  -w "ordinary_page_http=%{http_code} bytes=%{size_download}\n" "$BASE/admin"
curl -s -o /dev/null -w "anon_page_http=%{http_code} redirect=%{redirect_url}\n" "$BASE/admin"
echo "--- does the operator's page carry the heading the component renders? ---"
grep -c "Operator overview" /tmp/b4_admin_page.html
echo "--- does the ordinary account's page carry it? (0 expected) ---"
grep -c "Operator overview" /tmp/b4_ord_page.html

say "7. the same numbers, from the API and from psql, in the same run"
python3 scripts/fixtures/p8b4-crosscheck.py /tmp/b4_overview.json
echo "[crosscheck rc=$?]"

say "8. the encoder line really was probed on this request (from the JSON)"
python3 - <<'PY'
import json
o = json.load(open("/tmp/b4_overview.json"))
e = o["encoder"]
print("encoder.checkedAt      :", e["checkedAt"])
print("binariesAnswered       :", e["binariesAnswered"])
print("ffmpeg probe detail    :", next(p["detail"] for p in e["probes"] if p["probeId"] == "ffmpeg-binary"))
print("ffprobe probe detail   :", next(p["detail"] for p in e["probes"] if p["probeId"] == "ffprobe-binary"))
print("memory available kB    :", e["memoryAvailableKb"])
for f in e["presetFit"]:
    print(f"preset {f['presetId']:16} -> {f['verdict']}")
print()
c = o["capabilities"]
print("capabilities total     :", c["total"])
print("adapters built         :", c["adaptersBuilt"])
print("usable right now       :", c["wired"])
for r in c["rows"]:
    if r["state"] != "unbuilt":
        print(f"  {r['capability']:24} {r['provider'] or '-':18} {r['state']}")
print()
m = o["money"]
print("money.headline         :", m["headline"])
print("money.figures          :", m["figures"])
print("money.checkedAt        :", m["checkedAt"])
print()
print("failures listed        :", len(o["failures"]["rows"]))
for r in o["failures"]["rows"]:
    print("  ", r["jobId"], r["status"], "|", r["sentence"][:160])
PY

say "9. no source file is newer than the BUILD_ID the server is serving"
NEWEST_SRC=$(find src -type f -newer .next/BUILD_ID 2>/dev/null | head -5)
if [ -z "$NEWEST_SRC" ]; then
  echo "no file under src/ is newer than .next/BUILD_ID — the served build is this tree"
else
  echo "FILES NEWER THAN BUILD_ID (the served build is NOT this tree):"
  echo "$NEWEST_SRC"
fi

echo
echo "proof end $(date -u)"
