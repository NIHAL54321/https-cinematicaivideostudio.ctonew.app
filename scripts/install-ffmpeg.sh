#!/bin/bash
# ============================================================================
# install-ffmpeg.sh — install the encoder this product's render pipeline needs,
# idempotently, and verify it.
#
# WHY THIS IS A SCRIPT AND NOT A COMMAND SOMEONE REMEMBERS
# Phase 8's render pipeline has three stages that must leave a FILE (encode,
# mux, checksum). They are probed at run time against the real binary, and the
# machine is subject to full resets that wipe everything outside /home — `/opt`
# and `/usr/local/bin` included. So "ffmpeg is installed" is not a fact about
# this machine, it is a PROVISIONING STEP that has to be repeatable by anyone who
# gets here after a reset. Before this script the install was a set of curl/tar
# commands typed into a terminal and recorded only in a chat log; that is not
# reproducible.
#
# WHAT IT DOES
#   1. VALIDATES FIRST. If `ffmpeg -version` and `ffprobe -version` already
#      answer with the expected version, it prints what it found and exits 0
#      without touching the network or the disk. Re-running this script is safe
#      and cheap, which is what "idempotent" has to mean in practice.
#   2. DOWNLOADS the exact tarball, to a `.part` file, and refuses to continue
#      unless its SHA-256 is the recorded one. A tarball already in the cache is
#      verified again rather than trusted because it exists.
#   3. EXTRACTS into /opt/ffmpeg-<version>. /opt is used because /home is the
#      small volume on this machine and a 162 MB extract there would crowd the
#      repository.
#   4. SYMLINKS /opt/ffmpeg -> the versioned directory, and
#      /usr/local/bin/{ffmpeg,ffprobe} -> /opt/ffmpeg/{ffmpeg,ffprobe}, so the
#      binary is on PATH for the server process and for `spawnSync("ffmpeg")`.
#   5. VALIDATES: prints both `-version` banners and exits non-zero if either
#      binary fails to run. A binary that exists but does not run is reported as
#      such — the pipeline's own probe makes the same distinction.
#
# PROVENANCE (recorded here so it does not live only in a terminal log)
#   URL      https://johnvansickle.com/ffmpeg/releases/ffmpeg-7.0.2-amd64-static.tar.xz
#   SIZE     41,888,096 bytes
#   SHA-256  abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67
#   BANNER   ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/ (GPLv3, static build)
#   LICENCE  GPLv3 — GPLv3.txt ships inside the tarball and is extracted alongside
# See /home/team/shared/evidence/phase8_block2b_encoder_attempt/ for the install's
# own measured record (disk and memory before and after).
#
# Usage:
#   bash scripts/install-ffmpeg.sh            # install, or validate and stop
#   bash scripts/install-ffmpeg.sh --check     # validate only; never downloads
#   FFMPEG_NO_NETWORK=1 bash scripts/install-ffmpeg.sh   # refuse network use
# ============================================================================
set -uo pipefail

FFMPEG_VERSION="${FFMPEG_VERSION:-7.0.2}"
URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz"
TARBALL="ffmpeg-${FFMPEG_VERSION}-amd64-static.tar.xz"
SHA256="abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67"
BYTES=41888096
DEST="${FFMPEG_DEST:-/opt/ffmpeg-${FFMPEG_VERSION}}"
LINK="${FFMPEG_LINK:-/opt/ffmpeg}"
BINDIR="${FFMPEG_BINDIR:-/usr/local/bin}"
CACHE="${FFMPEG_CACHE_DIR:-/opt/cavs-dl}"

MODE=install
case "${1:-}" in
  --check) MODE=check ;;
  "") ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

say() { printf '%s\n' "$*"; }
ok() { printf '  [OK]   %s\n' "$*"; }
bad() { printf '  [FAIL] %s\n' "$*"; }

# --- 1. validate first ------------------------------------------------------
# The version banner is the ONLY thing that proves a runnable encoder. A file
# that exists at the right path is not evidence: it can be a truncated download,
# a symlink into a directory a reset removed, or a binary built for another cpu.
banner() { # banner <command> -> the first line of -version, or empty
  "$1" -version 2>/dev/null | head -1
}

FF_BANNER=$(banner ffmpeg)
FP_BANNER=$(banner ffprobe)

say "=== install-ffmpeg.sh — ffmpeg ${FFMPEG_VERSION} (static, amd64) ==="
say "1. validate what is already here"
say "   ffmpeg  : ${FF_BANNER:-<not runnable>}"
say "   ffprobe : ${FP_BANNER:-<not runnable>}"

already_ok=0
case "$FF_BANNER" in
  *"version ${FFMPEG_VERSION}"*) already_ok=1 ;;
esac
if [ "$already_ok" = "1" ] && [ -z "$FP_BANNER" ]; then
  already_ok=0
fi

if [ "$already_ok" = "1" ]; then
  ok "ffmpeg ${FFMPEG_VERSION} already answers on PATH as $(command -v ffmpeg)"
  ok "ffprobe already answers on PATH as $(command -v ffprobe)"
  ok "nothing was downloaded, extracted or relinked — this run only validated"
  say "RESULT: ffmpeg ${FFMPEG_VERSION} present and runnable (no changes made)"
  exit 0
fi

if [ "$MODE" = "check" ]; then
  bad "ffmpeg ${FFMPEG_VERSION} is NOT runnable here"
  say "RESULT: MISSING — run without --check to install"
  exit 1
fi

# --- 2. get the tarball, and verify it -------------------------------------
say "2. the tarball"
say "   url      : $URL"
say "   sha256   : $SHA256"
say "   bytes    : $BYTES"
mkdir -p "$CACHE" || { bad "cannot create $CACHE"; exit 1; }
TAR_PATH="$CACHE/$TARBALL"

verify_tarball() { # verify_tarball <path>
  [ -f "$1" ] || return 1
  local got want_size
  got=$(sha256sum "$1" 2>/dev/null | cut -d' ' -f1)
  want_size=$(stat -c %s "$1" 2>/dev/null || echo 0)
  [ "$got" = "$SHA256" ] && [ "$want_size" = "$BYTES" ]
}

if verify_tarball "$TAR_PATH"; then
  ok "cached tarball re-verified against the recorded SHA-256 and size — not trusted merely because it exists"
else
  if [ -f "$TAR_PATH" ]; then
    bad "the cached tarball does not match the recorded digest or size — removing it rather than extracting it"
    rm -f "$TAR_PATH"
  fi
  if [ "${FFMPEG_NO_NETWORK:-0}" = "1" ]; then
    bad "FFMPEG_NO_NETWORK=1 and no verified tarball is cached — cannot install"
    say "RESULT: NEEDS NETWORK"
    exit 1
  fi
  say "   downloading…"
  if ! curl -fsS -m 600 -o "$TAR_PATH.part" "$URL"; then
    bad "download failed: $URL"
    rm -f "$TAR_PATH.part"
    say "RESULT: DOWNLOAD FAILED"
    exit 1
  fi
  if ! verify_tarball "$TAR_PATH.part"; then
    bad "the download does not match the recorded SHA-256 or size — refusing to extract it"
    say "   got  : $(sha256sum "$TAR_PATH.part" 2>/dev/null | cut -d' ' -f1) / $(stat -c %s "$TAR_PATH.part" 2>/dev/null || echo 0) bytes"
    say "   want : $SHA256 / $BYTES bytes"
    rm -f "$TAR_PATH.part"
    say "RESULT: TARBALL MISMATCH (nothing installed)"
    exit 1
  fi
  mv "$TAR_PATH.part" "$TAR_PATH"
  ok "downloaded and verified: $(sha256sum "$TAR_PATH" | cut -d' ' -f1)"
fi

# --- 3. extract ------------------------------------------------------------
say "3. extract into $DEST"
if [ -x "$DEST/ffmpeg" ] && [ -x "$DEST/ffprobe" ]; then
  ok "$DEST already holds both binaries — extraction skipped"
else
  mkdir -p "$DEST" || { bad "cannot create $DEST"; exit 1; }
  if ! tar -xJf "$TAR_PATH" -C "$DEST" --strip-components=1; then
    bad "tar failed on $TAR_PATH"
    say "RESULT: EXTRACT FAILED"
    exit 1
  fi
  ok "extracted $(du -sh "$DEST" | cut -f1) into $DEST"
fi
[ -f "$DEST/GPLv3.txt" ] && ok "GPLv3.txt is present alongside the binaries (the static build is GPLv3)"

# --- 4. symlink ------------------------------------------------------------
say "4. link onto PATH"
ln -sfn "$DEST" "$LINK" && ok "$LINK -> $DEST"
ln -sfn "$LINK/ffmpeg" "$BINDIR/ffmpeg" && ok "$BINDIR/ffmpeg -> $LINK/ffmpeg"
ln -sfn "$LINK/ffprobe" "$BINDIR/ffprobe" && ok "$BINDIR/ffprobe -> $LINK/ffprobe"

# --- 5. validate -----------------------------------------------------------
# The binaries are validated BY ABSOLUTE PATH — the thing this script just wrote
# — not by whatever `ffmpeg` happens to resolve to first on PATH. A run that
# extracted correctly but validated some other binary would prove nothing. PATH
# resolution is then checked separately, because the server spawns the bare name
# `ffmpeg` and a PATH miss is exactly the failure that leaves the encode stage
# BLOCKED with the binary sitting right there on disk.
say "5. validate"
FF_CHECK=$(banner "$BINDIR/ffmpeg")
FP_CHECK=$(banner "$BINDIR/ffprobe")
say "   $BINDIR/ffmpeg  : ${FF_CHECK:-<did not run>}"
say "   $BINDIR/ffprobe : ${FP_CHECK:-<did not run>}"
rc=0
case "$FF_CHECK" in
  *"version ${FFMPEG_VERSION}"*) ok "the installed ffmpeg runs and reports version ${FFMPEG_VERSION}" ;;
  *) bad "the installed ffmpeg did not run, or is not version ${FFMPEG_VERSION}"; rc=1 ;;
esac
case "$FP_CHECK" in
  *"version ${FFMPEG_VERSION}"*) ok "the installed ffprobe runs and reports version ${FFMPEG_VERSION}" ;;
  *) bad "the installed ffprobe did not run, or is not version ${FFMPEG_VERSION}"; rc=1 ;;
esac
ONPATH_F=$(command -v ffmpeg 2>/dev/null || true)
ONPATH_P=$(command -v ffprobe 2>/dev/null || true)
if [ -n "$ONPATH_F" ] && [ -n "$ONPATH_P" ]; then
  ok "PATH resolves them as $ONPATH_F and $ONPATH_P (this is what spawnSync(\"ffmpeg\") needs)"
else
  bad "PATH does not resolve ffmpeg/ffprobe — the server spawns them by bare name, so add $BINDIR to PATH"
  rc=1
fi

if [ "$rc" -eq 0 ]; then
  say "RESULT: ffmpeg ${FFMPEG_VERSION} INSTALLED AND RUNNABLE"
else
  say "RESULT: INSTALL DID NOT VALIDATE"
fi
exit "$rc"
