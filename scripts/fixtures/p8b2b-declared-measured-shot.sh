#!/bin/bash
# ============================================================================
# p8b2b-declared-measured-shot.sh — the 1440 screenshot of the declared-vs-
# measured block, off the SERVED build, with its hash printed BEFORE the image
# is opened.
#
# Two capture lessons are baked in, both learned the hard way:
#
#   1. `agent-browser screenshot "<selector>"` — an ELEMENT-CLIPPED capture —
#      returns a blank rectangle on the Export Center (733 bytes, uniform dark,
#      the same SHA-256 on every run) while the element is provably painted in
#      the DOM. So this script captures the VIEWPORT and crops the block out of
#      it with ffmpeg, using the block's own getBoundingClientRect().
#   2. A screenshot taken after a scroll may show the page header instead of the
#      block, so the block is scrolled into view and its rect is printed before
#      the shot; the crop uses that same rect.
#
# Usage: bash scripts/fixtures/p8b2b-declared-measured-shot.sh
#   BASE=http://127.0.0.1:3100 OUT=/tmp/p8b2b_shot bash …
# ============================================================================
set -uo pipefail
BASE="${BASE:-http://127.0.0.1:3100}"
OUT="${OUT:-/tmp/p8b2b_shot}"
SHOT="$OUT/declared_measured_1440.png"
mkdir -p "$OUT"
AB="agent-browser"

$AB set viewport 1440 900
$AB cookies clear >/dev/null 2>&1
$AB open "$BASE/signin"
$AB fill "#email" "p7a-fixture@cavs.test"
$AB fill "#password" "p7a-fixture-password-2026"
$AB click "button[type=submit]"
sleep 3
$AB open "$BASE/export-center?masterPreset=youtube-2160p"
sleep 3

cat > "$OUT/probe.js" <<'JS'
(() => {
  const dec = document.querySelector('[data-fact="declared"]');
  if (!dec) return JSON.stringify({ found: false });
  const box = dec.parentElement;
  const mea = box.querySelector('[data-fact="measured"]');
  const div = box.querySelector('[data-fact="divergence"]');
  const rb = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
  window.scrollTo(0, Math.max(0, Math.round(box.getBoundingClientRect().top + window.scrollY) - 120));
  const b = rb(box);
  const crosses = (x, y) => x && y && !(x.bottom <= y.top || y.bottom <= x.top);
  return JSON.stringify({
    block: b, insideViewport: b.top >= 0 && b.bottom <= window.innerHeight,
    overlap: { declared_measured: crosses(rb(dec), rb(mea)), measured_divergence: crosses(rb(mea), rb(div)) },
    clipped: { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth },
    viewport: { innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
    labels: Array.from(box.querySelectorAll('[data-fact]')).map(e => e.getAttribute('data-fact')),
    texts: { declared: dec.innerText, measured: mea ? mea.innerText : null, divergence: div ? div.innerText : null },
  });
})()
JS
RECT=$($AB eval "$(cat "$OUT/probe.js")" | tr -d '\n' | sed 's/^"//; s/"$//; s/\\"/"/g' )
echo "$RECT" > "$OUT/block_rect_and_text.json"
echo "--- block geometry / overlap / labels:"; echo "$RECT"

$AB screenshot "$OUT/viewport_1440.png"
echo "--- viewport capture:"; sha256sum "$OUT/viewport_1440.png"; ls -l "$OUT/viewport_1440.png"

read -r X Y W H < <(node -e '
const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const b=j.block; process.stdout.write([b.left,b.top,b.w,b.h].join(" "));' "$OUT/block_rect_and_text.json")
ffmpeg -y -loglevel error -i "$OUT/viewport_1440.png" -vf "crop=$W:$H:$X:$Y" -frames:v 1 "$SHOT"
echo "--- the block cropped from that capture:"; sha256sum "$SHOT"; ls -l "$SHOT"
echo "DONE — open $SHOT and $OUT/viewport_1440.png"
