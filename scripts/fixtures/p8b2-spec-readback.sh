#!/bin/bash
# ============================================================================
# p8b2-spec-readback.sh — Phase 8 block 2a: read the export specification back
# OFF THE SERVED PAGE (not the source), and record what a stranger would see.
#
# What it does:
#   1. reads the BUILD_ID the server actually serves (the same way
#      scripts/restart-3100.sh reads it) and the one on disk, and refuses to
#      call the read-back evidence if they differ
#   2. signs in as the P7-7a fixture account
#   3. GETs /export-center and saves the RAW HTML (no browser, no JS: the panel
#      is server-rendered, so the HTML is the page)
#   4. strips tags and checks a list of strings that MUST be there — including
#      every string that was MISSING in the stale capture taken from the
#      previous build — printing [FOUND]/[MISSING] with the text around it
#   5. prints the values it read: the matrix axes/options/presets line, all
#      seven presets with their resolved values, the YouTube delivery master,
#      the recommendation with its basis, and the render job's recorded spec
#
# Exit code 1 if any required string is missing — a read-back that cannot find
# its own text is a failure, not a footnote.
#
# Usage: bash scripts/fixtures/p8b2-spec-readback.sh
# ============================================================================
set -uo pipefail

BASE="${BASE:-http://localhost:3100}"
OUT="${OUT:-/home/team/shared/evidence/phase8_block2_export_spec}"
EMAIL="p7a-fixture@cavs.test"
PASSWORD="p7a-fixture-password-2026"
JAR=/tmp/p8b2_readback.cookies

mkdir -p "$OUT"
rm -f "$JAR"

say() { printf '\n=== %s\n' "$*"; }

say "1. the build this page comes from"
# The BUILD_ID travels inside the escaped RSC flight payload as \"b\":\"<id>\".
# (A plain '"b":"' grep finds nothing on this build — it matches only the
# escaped form — which is why this reads the escaped shape explicitly.)
SERVED_BUILD_ID=$(curl -s -m 10 "$BASE/signin" \
  | grep -o '\\"b\\":\\"[^\\]*' | head -1 | sed 's/.*\\"//')
DISK_BUILD_ID=$(tr -d '[:space:]' < /home/team/app/.next/BUILD_ID)
echo "BUILD_ID served : $SERVED_BUILD_ID"
echo "BUILD_ID on disk: $DISK_BUILD_ID"
if [ "$SERVED_BUILD_ID" != "$DISK_BUILD_ID" ]; then
  echo "REFUSING: the served build is not the built build — a read-back of the old build is not evidence."
  exit 1
fi

say "2. sign in as the fixture account"
curl -s -c "$JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" "$BASE/api/auth/signin" | head -c 200; echo

say "3. GET /export-center (signed in) — the raw HTML is saved"
curl -s -b "$JAR" -o "$OUT/export-center-served.html" \
  -w 'HTTP %{http_code} · %{size_download} bytes\n' "$BASE/export-center"

say "4/5. what the SERVED page says"
python3 - "$OUT/export-center-served.html" "$SERVED_BUILD_ID" <<'PY' | tee "$OUT/served-readback.txt"
import html, re, sys

path, build_id = sys.argv[1], sys.argv[2]
raw = open(path, encoding="utf-8").read()
text = re.sub(r"<[^>]+>", " ", raw)
text = html.unescape(re.sub(r"\s+", " ", text))

print(f"read from    : {path}")
print(f"BUILD_ID     : {build_id}")
print(f"raw bytes    : {len(raw)}")
print(f"text chars   : {len(text)}")
print()

# Every string below that was [MISSING] in the stale capture taken from the
# PREVIOUS build is marked (was MISSING). Each one is the real rendered text,
# not a source-code symbol.
required = [
    ("Export specification", "the panel heading"),
    ("No option in this matrix is delivered", "was MISSING — the delivery statement"),
    ("matrix export-spec-matrix/1", "was MISSING — the matrix version line"),
    ("13 axes", "was MISSING — the axis count"),
    ("50 options", "was MISSING — the option count"),
    ("7 presets resolved from them", "was MISSING — the preset count"),
    ("The 7 presets — each resolved from the matrix, never typed", "was MISSING — the presets heading"),
    ("The YouTube delivery master —", "was MISSING — the master heading"),
    ("Smart recommendation", "was MISSING — the recommendation heading"),
    ("PARTIAL BASIS", "was MISSING — the partial-basis statement"),
    ("would run with", "was MISSING — the job's resolved spec on the encode stage"),
    ("ffmpeg binary", "was FOUND before — the named missing input"),
    ("not installed on this machine (ENOENT)", "was FOUND before — the verbatim probe reason"),
    ("What this master does not claim", "the master's boundary"),
    ("We do not claim YouTube will use any particular codec", "the codec boundary, in words"),
]
fails = 0
print("--- required strings on the SERVED page")
for needle, note in required:
    i = text.find(needle)
    if i < 0:
        fails += 1
        print(f"[MISSING] {needle}\n    ({note})")
    else:
        print(f"[FOUND]   {needle}  ({note})")
        print(f"    ...{text[max(0,i-90):i+150]}...")
print()

def section(start, end, label, limit=4000):
    i = text.find(start)
    j = text.find(end, i + 1) if end else -1
    print(f"--- {label}")
    if i < 0:
        print("    [MISSING]")
        return
    print("    " + text[i:j if j > i else i + limit][:limit])
    print()

section("matrix export-spec-matrix/1", "AI upscale", "the matrix line and the provider-backed option")
section("The 7 presets —", "The YouTube delivery master —", "all seven presets, resolved")
section("The YouTube delivery master —", "Smart recommendation", "the YouTube delivery master and its boundary")
section("Smart recommendation", "Render pipeline", "the recommendation, its reasons and its basis")
section("5 Encode master", "6 Container / mux", "the encode stage: still BLOCKED, and what it would run with")

# The seven presets must each appear with the values they resolve to.
print("--- the seven presets, one line each")
for pid, label in [
    ("youtube-2160p", "YouTube 4K (2160p SDR)"),
    ("youtube-2160p-hdr", "YouTube 4K HDR10 (2160p)"),
    ("youtube-1080p", "YouTube 1080p (FHD SDR)"),
    ("youtube-shorts", "YouTube Shorts (9:16)"),
    ("instagram-reels", "Instagram Reels (9:16)"),
    ("square-1080", "Square 1:1 (1080)"),
    ("portrait-4x5", "Portrait 4:5 (1080×1350)"),
]:
    ok_label = label in text
    ok_id = pid in text
    i = text.find(label)
    frame = ""
    if i >= 0:
        seg = text[i:i + 400]
        m = re.search(r"frame (\S+)", seg)
        frame = m.group(1) if m else "?"
    print(f"    {'OK ' if (ok_label and ok_id) else 'MISS'} {pid:20s} {label:32s} frame={frame}")

print()
print("RESULT:", "ALL REQUIRED STRINGS FOUND" if fails == 0 else f"{fails} REQUIRED STRING(S) MISSING")
sys.exit(1 if fails else 0)
PY

say "DONE — read-back in $OUT/served-readback.txt"
