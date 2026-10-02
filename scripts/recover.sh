#!/usr/bin/env bash
# ============================================================================
# CAVS environment recovery — idempotent, reset-proof.
# Lives in /home/team/app/scripts/recover.sh (source survives resets).
# Logs to /home/team/app/recovery.log (also survives resets).
# Re-run whenever the machine resets: it picks up where it left off.
# ============================================================================
set -uo pipefail
LOG=/home/team/app/recovery.log
APP=/home/team/app
log() { echo "[$(date +%H:%M:%S)] $*" >> "$LOG"; }

mkdir -p /opt/cavs-deps/node_modules /opt/cavs-deps/.next /opt/bun-cache /opt/minio
log "=== recovery pass start ==="

# 1. Postgres + Redis binaries (apt)
if [ ! -x /usr/lib/postgresql/16/bin/psql ]; then
  log "apt: installing postgresql redis-server"
  apt-get update >> "$LOG" 2>&1
  apt-get install -y postgresql redis-server >> "$LOG" 2>&1
  log "apt: done rc=$?"
else
  log "apt: pg bin present"
fi

# 2. MinIO binary — validate it, because a truncated/error-page download is
# still chmod +x-able and used to be mistaken for a working binary. NOTE:
# dl.min.io now answers 410 Gone for every path (the OSS server was archived),
# so the binary comes from the pinned GitHub release asset instead.
MINIO_URL="https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z"
if [ ! -x /opt/minio/minio ] || ! /opt/minio/minio --version >/dev/null 2>&1; then
  log "minio: downloading"
  rm -f /tmp/minio-bin
  curl -fsSL "$MINIO_URL" -o /tmp/minio-bin
  chmod +x /tmp/minio-bin
  if /tmp/minio-bin --version >/dev/null 2>&1; then
    mv /tmp/minio-bin /opt/minio/minio
    log "minio: installed ($(/opt/minio/minio --version 2>&1 | head -1))"
  else
    log "minio: DOWNLOAD INVALID — binary NOT installed"
  fi
else
  log "minio: present"
fi

# 3. node_modules
if [ ! -d /opt/cavs-deps/node_modules/next ]; then
  log "bun install (cache /opt/bun-cache)"
  cd "$APP" || exit 1
  bun install --cache-dir /opt/bun-cache >> "$LOG" 2>&1
  log "bun install rc=$? node_modules=$(du -sh /opt/cavs-deps/node_modules 2>/dev/null | cut -f1)"
else
  log "deps: present"
fi

# 4. Infra start
log "infra-start"
cd "$APP" || exit 1
bash scripts/infra-start.sh >> "$LOG" 2>&1
log "infra-start rc=$?"

# 5. Migrate
log "migrate deploy"
NODE_OPTIONS=--max-old-space-size=2048 bunx prisma migrate deploy >> "$LOG" 2>&1
log "migrate rc=$?"

# 6. Build
if [ ! -f /opt/cavs-deps/.next/BUILD_ID ]; then
  log "build"
  NODE_OPTIONS=--max-old-space-size=2048 bun run build >> "$LOG" 2>&1
  log "build rc=$?"
else
  log "build: present (BUILD_ID exists)"
fi

# 7. Start the app server. :3000 belongs to the platform's site dev server
# (/home/team/shared/site) — never bind it and never kill that process. The
# product app lives on :3100. package.json hard-codes `-p 3000`, so the port is
# passed to `next start` directly instead of relying on $PORT.
APP_PORT=3100
pkill -f "next start" 2>/dev/null
sleep 2
log "starting next-server on PORT=$APP_PORT"
cd "$APP" || exit 1
setsid nohup bunx next start -p "$APP_PORT" > /tmp/cavs.log 2>&1 &
code=""
# Health-check the APP's own endpoint (the site dev server answers / on :3000,
# which is how a dead app once got logged as "server: UP").
for _ in $(seq 1 20); do
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
if [ "$code" = "200" ]; then
  log "server: UP on :$APP_PORT (app /api/health 200)"
else
  log "server: NOT UP on :$APP_PORT (last /api/health code=${code:-none}; tail /tmp/cavs.log)"
fi

log "=== recovery pass end ==="