#!/usr/bin/env bash
# ===========================================================================
# p7a-world.sh — rebuild the P7-7a proof world on an empty database.
# ===========================================================================
#
# The machine has been replaced five times; each replacement emptied the
# database and cost a session rebuilding the proof target by hand. This script
# is that rebuild, written down. On a freshly recovered machine:
#
#     bash scripts/fixtures/p7a-world.sh
#
# leaves a signable-in proof account and one fixture project that the Creator
# Studio and the publishing package can be proved against. It creates the
# account through the app's OWN /api/auth/signup route (no app code changes, no
# invented hash scheme), then applies p7a-world.sql, then checks the world and
# prints what it found.
#
#     bash scripts/fixtures/p7a-world.sh --capture [outfile]
#         build the publishing package for the fixture project and save the
#         JSON to outfile (default /tmp/p7a_package_<projectId>.json)
#
#     bash scripts/fixtures/p7a-world.sh --teardown
#         delete exactly the rows this script created (see the teardown SQL)
#
# SAFE TO RUN TWICE: the account step treats "already exists" as success, and
# every row is an upsert on a fixed id. It touches nothing it did not create.
#
# WHAT IT DOES NOT DO: it does not take screenshots, does not touch any other
# project, and does not pretend anything was generated. Every row it writes is
# labelled a fixture in its own data.
#
# ENV OVERRIDES: BASE_URL (default http://127.0.0.1:3100), DATABASE_URL,
#   P7A_EMAIL, P7A_PASSWORD, COOKIE_JAR.
# ===========================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3100}"
DATABASE_URL="${DATABASE_URL:-postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio}"
P7A_EMAIL="${P7A_EMAIL:-p7a-fixture@cavs.test}"
P7A_PASSWORD="${P7A_PASSWORD:-p7a-fixture-password-2026}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/p7a_world_cookies.txt}"
PROJECT_ID="p7a_fix_project"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_APPLY="$ROOT/scripts/fixtures/p7a-world.sql"
SQL_TEARDOWN="$ROOT/scripts/fixtures/p7a-world-teardown.sql"

MODE="apply"
CAPTURE_OUT=""
for arg in "$@"; do
  case "$arg" in
    --teardown) MODE="teardown" ;;
    --capture)  MODE="capture" ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      if [ "$MODE" = "capture" ]; then CAPTURE_OUT="$arg"; else
        echo "unknown argument: $arg" >&2; exit 2
      fi ;;
  esac
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die()  { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }

psql_c() { PGPASSWORD="" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "$1"; }

# ---------------------------------------------------------------------------
# 0) Is anything there at all?
# ---------------------------------------------------------------------------
say "0/5  checking the database and the served app"
command -v psql >/dev/null || die "psql is not installed"
psql_c 'select 1' >/dev/null || die "cannot reach the database at $DATABASE_URL"
note "database reachable"

if [ "$MODE" = "teardown" ]; then
  say "teardown — removing exactly the rows p7a-world.sql created"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_TEARDOWN"
  rm -f "$COOKIE_JAR" /tmp/p7a_world.json
  say "teardown done"
  exit 0
fi

health_ok=0
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/health" || true)"
  if [ "$code" = "200" ]; then health_ok=1; break; fi
  sleep 1
done
[ "$health_ok" = "1" ] || die "the app on $BASE_URL/api/health did not answer 200 — start it first (bash scripts/recover.sh)"
note "app answers 200 on $BASE_URL/api/health"

# ---------------------------------------------------------------------------
# 1) The proof account — through the app's own sign-up route.
# ---------------------------------------------------------------------------
say "1/5  proof account $P7A_EMAIL"

signup_code="$(curl -s -o /tmp/p7a_signup_body.json -w '%{http_code}' \
  -X POST "$BASE_URL/api/auth/signup" \
  -H 'content-type: application/json' \
  -d "$(printf '{"email":"%s","password":"%s","name":"P7-7a fixture account"}' "$P7A_EMAIL" "$P7A_PASSWORD")" || true)"

case "$signup_code" in
  200|201) note "account created by POST /api/auth/signup (http $signup_code)" ;;
  409|429) note "account already exists / sign-up rate-limited (http $signup_code) — continuing to sign-in" ;;
  *)       die "sign-up answered http $signup_code: $(cat /tmp/p7a_signup_body.json)" ;;
esac

signin() {
  curl -s -o /tmp/p7a_signin_body.json -w '%{http_code}' \
    -c "$COOKIE_JAR" \
    -X POST "$BASE_URL/api/auth/signin" \
    -H 'content-type: application/json' \
    -d "$(printf '{"email":"%s","password":"%s"}' "$P7A_EMAIL" "$P7A_PASSWORD")" || true
}

signin_code="$(signin)"
if [ "$signin_code" != "200" ]; then
  # The account exists but this script's password does not open it (a previous
  # session may have changed it). Reset the hash using the app's OWN scheme —
  # scrypt:<salt-hex>:<derived-key-hex>, 64-byte key, exactly as src/lib/auth.ts
  # writes it. No app code is changed and no other column is touched.
  note "sign-in answered http $signin_code — resetting the fixture account's hash with the app's own scrypt scheme"
  new_hash="$(P7A_PASSWORD="$P7A_PASSWORD" node -e '
    const { randomBytes, scrypt } = require("node:crypto");
    const salt = randomBytes(16).toString("hex");
    scrypt(process.env.P7A_PASSWORD, salt, 64, (err, dk) => {
      if (err) { console.error(err); process.exit(1); }
      process.stdout.write("scrypt:" + salt + ":" + dk.toString("hex"));
    });
  ')"
  case "$new_hash" in
    scrypt:*) ;;
    *) die "could not compute a scrypt hash" ;;
  esac
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "UPDATE \"User\" SET \"passwordHash\" = '$new_hash', \"updatedAt\" = now() WHERE email = '$P7A_EMAIL'" >/dev/null
  signin_code="$(signin)"
  [ "$signin_code" = "200" ] || die "sign-in still answers http $signin_code after the hash reset: $(cat /tmp/p7a_signin_body.json)"
  note "hash reset and sign-in now answers 200"
fi
note "signed in; session cookie in $COOKIE_JAR"

# ---------------------------------------------------------------------------
# 2) The fixture rows.
# ---------------------------------------------------------------------------
say "2/5  applying $SQL_APPLY"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SQL_APPLY" \
  | grep -v '^$' | sed 's/^/   /'

# ---------------------------------------------------------------------------
# 3) Prove the world is the world the proof needs — through the app's own API,
#    not just by reading the database.
# ---------------------------------------------------------------------------
say "3/5  reading the project back through the app's own session"
project_json="$(curl -s -b "$COOKIE_JAR" "$BASE_URL/api/projects/$PROJECT_ID" || true)"
case "$project_json" in
  *"$PROJECT_ID"*) note "GET /api/projects/$PROJECT_ID returned the fixture project" ;;
  *) die "the app did not return the fixture project: $(printf '%s' "$project_json" | head -c 400)" ;;
esac

owner_email="$(psql_c "SELECT u.email FROM \"Project\" p JOIN \"User\" u ON u.id = p.\"userId\" WHERE p.id = '$PROJECT_ID'")"
[ "$owner_email" = "$P7A_EMAIL" ] || die "the fixture project is owned by '$owner_email', not '$P7A_EMAIL'"
note "owner: $owner_email"

counts="$(psql_c "SELECT (SELECT count(*) FROM \"Chapter\" WHERE \"projectId\"='$PROJECT_ID') || ' chapters, ' || (SELECT count(*) FROM \"Scene\" WHERE \"projectId\"='$PROJECT_ID') || ' scenes, ' || (SELECT coalesce(sum(\"durationSeconds\"),0) FROM \"Scene\" WHERE \"projectId\"='$PROJECT_ID') || ' s of scene duration, ' || (SELECT count(*) FROM \"Asset\" WHERE \"projectId\"='$PROJECT_ID' AND \"deletedAt\" IS NULL) || ' assets'")"
note "$counts"

# ---------------------------------------------------------------------------
# 4) Capture (optional) — build the publishing package through the app's route.
# ---------------------------------------------------------------------------
if [ "$MODE" = "capture" ]; then
  [ -n "$CAPTURE_OUT" ] || CAPTURE_OUT="/tmp/p7a_package_${PROJECT_ID}.json"
  say "4/5  building the publishing package via POST /api/studio/publishing"
  code="$(curl -s -o "$CAPTURE_OUT" -w '%{http_code}' \
    -b "$COOKIE_JAR" \
    -X POST "$BASE_URL/api/studio/publishing" \
    -H 'content-type: application/json' \
    -d "{\"action\":\"build\",\"projectId\":\"$PROJECT_ID\"}" || true)"
  note "http $code -> $CAPTURE_OUT ($(wc -c <"$CAPTURE_OUT" | tr -d ' ') bytes)"
  if [ "$code" != "200" ]; then
    head -c 600 "$CAPTURE_OUT" >&2
    die "the package build did not answer 200"
  fi
  node "$ROOT/scripts/fixtures/p7a-package-readout.mjs" "$CAPTURE_OUT" \
    || note "could not summarise the capture (its shape differs) — read the file"
else
  say "4/5  capture skipped (run with --capture to build the package now)"
fi

# ---------------------------------------------------------------------------
# 5) What to do next.
# ---------------------------------------------------------------------------
say "5/5  the world is ready"
note "project id     : $PROJECT_ID"
note "account        : $P7A_EMAIL"
note "password       : $P7A_PASSWORD"
note "cookie jar     : $COOKIE_JAR"
note ""
note "build the package by hand:"
note "  curl -s -b $COOKIE_JAR -X POST $BASE_URL/api/studio/publishing \\"
note "    -H 'content-type: application/json' \\"
note "    -d '{\"action\":\"build\",\"projectId\":\"$PROJECT_ID\"}' -o /tmp/p7a_package.json"
note "open the workspace:"
note "  $BASE_URL/projects/$PROJECT_ID/creator-studio"
note "remove the world again:"
note "  bash scripts/fixtures/p7a-world.sh --teardown"

cat >/tmp/p7a_world.json <<JSON
{
  "projectId": "$PROJECT_ID",
  "email": "$P7A_EMAIL",
  "password": "$P7A_PASSWORD",
  "baseUrl": "$BASE_URL",
  "cookieJar": "$COOKIE_JAR",
  "builtBy": "scripts/fixtures/p7a-world.sh",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
note "wrote /tmp/p7a_world.json (project id, account, cookie jar)"
