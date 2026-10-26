#!/bin/bash
# ============================================================================
# p8b2b-serve-proof.sh — Phase 8 block 2b, the SERVED-BUILD proof.
#
# Everything goes through the app's own HTTP surface on :3100, against whatever
# build the server is actually serving. It captures, in order:
#   1. the served BUILD_ID beside the one on disk.
#   2. what the Export Center PRINTS for the 2160p preset: the DECLARED level
#      sentence, the MEASURED level sentence and the divergence sentence — each
#      read out of the served HTML by its data-fact label, so no value can be
#      mistaken for the other.
#   3. every project <select> on that page, and the project titles psql holds.
#   4. the Projects page: no synthetic title, the account's own project only.
#   5. a render for the FIXTURE project: it reaches encode-master and stops
#      there, naming the missing source media, with zero artefacts.
#
# Read-only apart from step 5, which enqueues one real render job — one
# RenderJob row, stage rows, and no artefact rows, which is the point.
#
# Usage: bash scripts/fixtures/p8b2b-serve-proof.sh
#   BASE=http://127.0.0.1:3100 OUT=/tmp/p8b2b OUT_PSQL=... bash …
# ============================================================================
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3100}"
OUT="${OUT:-/tmp/p8b2b_serve_proof}"
PGURL="${PGURL:-postgresql://cinema:cinema_dev_password@localhost:5432/cinema_studio}"
PROJECT="${PROJECT:-p7a_fix_project}"
EMAIL="p7a-fixture@cavs.test"
PASSWORD="p7a-fixture-password-2026"
JAR="$OUT/cookies.txt"
mkdir -p "$OUT"; rm -f "$JAR"
say() { printf '\n=== %s\n' "$*"; }
psql_q() { psql "$PGURL" -P pager=off -c "$1"; }
jqval() { node -e 'const v=process.argv[2].split(".").reduce((o,k)=>o==null?o:o[k],JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")));process.stdout.write(v==null?"":String(v))' "$1" "$2"; }

say "1. the served build"
DISK=$(tr -d '[:space:]' < /opt/cavs-deps/.next/BUILD_ID 2>/dev/null || echo "(no build on disk)")
SIGNIN_HTML=$(curl -s -m 10 "$BASE/signin")
SERVED=$(printf '%s' "$SIGNIN_HTML" | grep -o '"b":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$SERVED" ]; then
  # Next's RSC payload escapes the quotes: \"b\":\"<id>\"
  SERVED=$(printf '%s' "$SIGNIN_HTML" | grep -o '\\"b\\":\\"[^\\]*' | head -1 | sed 's/.*\\"//')
fi
echo "BUILD_ID on disk : ${DISK:-none}"
echo "BUILD_ID served  : ${SERVED:-none (not found in /signin)}"
echo "match            : $([ -n "$SERVED" ] && [ "$SERVED" = "$DISK" ] && echo YES || echo "$([ -z "$SERVED" ] && echo UNKNOWN || echo NO)")"

say "2. sign in as the fixture account"
curl -s -c "$JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/signin" | head -c 240; echo

say "3. the Export Center, 2160p preset selected — declared vs measured as PRINTED"
curl -s -b "$JAR" -o "$OUT/export_center.html" -w 'HTTP %{http_code} · %{size_download} bytes\n' \
  "$BASE/export-center?masterPreset=youtube-2160p"

cat > "$OUT/extract_facts.js" <<'JS'
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
const dec = (s) => s.replace(/<!--[^]*?-->/g, "").replace(/<[^>]+>/g, "")
  .replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
for (const label of ["declared", "measured", "no-measurement", "divergence"]) {
  const re = new RegExp('<p[^>]*data-fact="' + label + '"[^>]*>([^]*?)</p>', "g");
  let m, n = 0;
  while ((m = re.exec(html))) { n++; console.log("[" + label + " #" + n + "] " + dec(m[1])); }
  if (!n) console.log("[" + label + "] (not present)");
}
JS
node "$OUT/extract_facts.js" "$OUT/export_center.html" | tee "$OUT/printed_declared_vs_measured.txt"

say "4. the project selectors on that page, and the projects psql holds"
cat > "$OUT/extract_selects.js" <<'JS'
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
let i = 0;
for (const m of html.matchAll(/<select[^>]*>([^]*?)<\/select>/g)) {
  i++;
  const id = (m[0].match(/id="([^"]+)"/) || [])[1] || "(no id)";
  const opts = [...m[1].matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((o) => o[1].trim());
  console.log("select #" + i + " id=" + id + " -> " + opts.length + " option(s): " + JSON.stringify(opts));
}
console.log("total selects: " + i);
JS
node "$OUT/extract_selects.js" "$OUT/export_center.html" | tee "$OUT/selectors.txt"
echo "--- project titles that exist for this account, from psql:"
psql "$PGURL" -tA -c "SELECT LEFT(title,52) FROM \"Project\" WHERE \"deletedAt\" IS NULL ORDER BY \"createdAt\";"

say "5. the Projects page"
curl -s -b "$JAR" -o "$OUT/projects.html" -w 'HTTP %{http_code} · %{size_download} bytes\n' "$BASE/projects"
echo "SYNTHETIC ENCODER PROOF occurrences in the page: $(grep -ci 'SYNTHETIC ENCODER PROOF' "$OUT/projects.html" || true)"
echo "project links in the page:"; grep -o 'href="/projects/[^"]*"' "$OUT/projects.html" | sort -u

say "6. a render for the FIXTURE project, through the served route"
curl -s -b "$JAR" -H 'content-type: application/json' \
  -d "{\"action\":\"enqueue\",\"projectId\":\"$PROJECT\",\"presetId\":\"youtube-1080p\",\"fixture\":true}" \
  "$BASE/api/studio/render" > "$OUT/enqueue.json"
JOB=$(jqval "$OUT/enqueue.json" jobId)
echo "job: ${JOB:-none}"
[ -n "$JOB" ] || { echo "no job id returned — cannot continue"; exit 1; }
for i in $(seq 1 90); do
  curl -s -b "$JAR" "$BASE/api/studio/render?jobId=$JOB" > "$OUT/jobread.json"
  ST=$(jqval "$OUT/jobread.json" job.status)
  case "$ST" in blocked|failed|stopped|succeeded) break ;; esac
  sleep 1
done
cat > "$OUT/report_job.js" <<'JS'
const j = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8")).job;
console.log("status        :", j.status);
console.log("statusBasis   :", j.statusBasis);
console.log("progress      :", j.progress.percent + "% — " + j.progress.arithmetic);
console.log("artefacts     : count=" + j.artefacts.count + " rows=" + j.artefacts.rows.length);
console.log("notReached    :", JSON.stringify(j.notReached));
for (const s of j.stages) console.log("  " + s.id + " · " + s.state + " · reached=" + s.reached + " · artefacts=" + (s.artefactCount || 0));
for (const s of j.stages) if (s.state === "FAILED") console.log("FAILED " + s.id + ": " + s.errorMessage);
JS
node "$OUT/report_job.js" "$OUT/jobread.json" | tee "$OUT/fixture_failure.txt"
echo "artefact rows in psql for $JOB: $(psql "$PGURL" -tA -c "SELECT count(*) FROM \"RenderArtefact\" WHERE \"jobId\"='$JOB';")"
psql_q "SELECT \"sequence\",\"stageId\",state,\"artefactCount\",\"errorMessage\" FROM \"RenderStageRun\" WHERE \"jobId\"='$JOB' ORDER BY \"sequence\";"
psql_q "SELECT id,\"presetId\",fixture,\"syntheticProof\",\"projectId\" FROM \"RenderJob\" WHERE id='$JOB';"
echo
echo "DONE — capture in $OUT"
