#!/usr/bin/env bash
# ============================================================================
# Cinematic AI Video Studio — start local infrastructure natively.
#
# Starts PostgreSQL 16, Redis 7, and MinIO (S3-compatible) directly on the
# host. Idempotent: safe to run repeatedly. Use this on machines where Docker
# is unavailable; otherwise `docker compose up -d` is the equivalent.
#
# Usage:  bash scripts/infra-start.sh   (or: bun run infra:start)
# ============================================================================
set -euo pipefail

DB_USER="${DB_USER:-cinema}"
DB_PASS="${DB_PASS:-cinema_dev_password}"
DB_NAME="${DB_NAME:-cinema_studio}"

echo "== PostgreSQL 16 =="
if pg_lsclusters 2>/dev/null | grep -q "16 .* online"; then
  echo "  already running"
else
  sudo pg_ctlcluster 16 main start
  echo "  started"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}' CREATEDB;"
  echo "  role '${DB_USER}' created"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
  echo "  database '${DB_NAME}' created"
fi

echo "== Redis 7 =="
if redis-cli ping >/dev/null 2>&1; then
  echo "  already running"
else
  redis-server --daemonize yes --port 6379 --save '' --appendonly no
  echo "  started on :6379"
fi

echo "== MinIO =="
MINIO_BIN="$(command -v minio 2>/dev/null || echo /opt/minio/minio)"
if [ -x "$MINIO_BIN" ]; then
  if lsof -t -iTCP:9000 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  already running on :9000"
  else
    nohup "$MINIO_BIN" server /opt/minio/data --address ":9000" --console-address ":9001" \
      > /tmp/minio.log 2>&1 &
    sleep 2
    echo "  started (API :9000, console :9001, log /tmp/minio.log)"
  fi
else
  echo "  MinIO binary not found (looked at '${MINIO_BIN}'). Skipping — storage stays 'Not Configured'."
  echo "  Install: curl -fsSL https://github.com/minio/minio/releases/download/RELEASE.2025-09-07T16-13-09Z/minio.linux-amd64.RELEASE.2025-09-07T16-13-09Z -o /opt/minio/minio && chmod +x /opt/minio/minio"
  echo "  (dl.min.io returns 410 Gone now — use the pinned GitHub release asset, and validate --version before installing.)"
fi

echo
echo "== Summary =="
echo "  Postgres: postgresql://${DB_USER}:***@localhost:5432/${DB_NAME}"
echo "  Redis:    redis://localhost:6379"
echo "  MinIO:    http://localhost:9000 (console: http://localhost:9001)"
