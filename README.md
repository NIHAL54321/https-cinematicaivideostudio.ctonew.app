# Cinematic AI Video Studio — Phase 1 Foundation

A premium SaaS that turns one idea into a complete, cinematic, faceless YouTube
video. **Phase 1** delivers the foundation: Next.js + TypeScript app, dark
cinematic dashboard shell, authentication, and the full data model — no AI is
faked, everything AI-shaped shows a clear **"Provider Not Connected"** state.

> Golden rule: **never fake AI functionality.** Anything requiring an AI
> provider renders "Provider Not Connected" until real APIs are wired in later
> phases. Provider keys live only in server-side env vars.

## Stack

- **App:** Next.js 15 (App Router) + React 19 + TypeScript (strict)
- **Styling:** Tailwind CSS v4 (CSS-first theme tokens) + fontsource variable fonts
- **Database:** PostgreSQL 16 + Prisma 6 (`prisma/schema.prisma`)
- **Queues:** Redis 7 + BullMQ (`src/lib/queue.ts`)
- **Storage:** MinIO / S3-compatible via `minio` client (`src/lib/storage.ts`)
- **Auth:** email + password (scrypt hashing), DB-backed httpOnly sessions
- **Rate limiting:** Redis-backed with in-memory fallback (`src/lib/rate-limit.ts`)

## Directory layout

```
prisma/schema.prisma        # full Phase 1 data model (20 models + enums)
prisma/migrations/          # applied migrations
src/app/                    # App Router: pages + API routes
src/app/(app)/              # protected route group (dashboard shell + sidebar)
src/app/(auth)/             # signin / signup
src/app/api/                # /api/auth/*, /api/health
src/components/             # shell, sidebar, AI-tool page, empty states, ui primitives
src/lib/                    # env, db, auth, rate-limit, storage, queue, constants
src/middleware.ts           # cookie-presence gate (real check is in (app)/layout)
src/workers/ai-worker.ts    # BullMQ worker skeleton (Phase 3 hook)
scripts/infra-start.sh      # start Postgres/Redis/MinIO natively
docker-compose.yml          # same infra for Docker-capable machines
```

## 1. Start local infrastructure

Two equivalent options:

**A) Docker (recommended on machines with Docker):**

```bash
docker compose up -d
docker compose exec postgres psql -U cinema -d postgres -c "CREATE DATABASE cinema_studio OWNER cinema;" 2>/dev/null || true
```

**B) Native (used on this sandbox — Docker cannot run here):**

```bash
bun run infra:start        # starts PostgreSQL 16, Redis 7, MinIO; creates role+db
```

Services:
| Service  | Port | Notes |
|----------|------|-------|
| PostgreSQL 16 | 5432 | db `cinema_studio`, user `cinema` / `cinema_dev_password` |
| Redis 7 | 6379 | rate limits + BullMQ |
| MinIO | 9000 (API), 9001 (console) | user `minioadmin` / `minioadmin`; bucket auto-created on first use |

## 2. Configure environment

```bash
cp .env.example .env
# edit values if your services differ; AUTH_SECRET must be a random 32-byte value:
#   openssl rand -base64 32
```

`.env.example` documents every variable, including the (empty, server-side)
AI provider keys that Phase 3+ will use.

## 3. Install, migrate, run

```bash
bun install                 # or: npm install
bunx prisma generate
bunx prisma migrate dev     # applies prisma/migrations to cinema_studio

bun run dev                 # dev server on http://localhost:3000
# or production:
bun run build && bun run start
```

> **Memory-light note:** on this sandbox `/home` is only 300 MB, so
> `node_modules` and `.next` live on the roomier root filesystem via a symlink
> (`node_modules -> /opt/cavs-deps/node_modules`). On a normal machine you can
> delete that symlink and let `bun install` create a real directory.

## What works in Phase 1

- **Auth:** sign up / sign in / sign out, scrypt-hashed passwords, httpOnly
  session cookies (only SHA-256 token hashes stored), protected routes, all
  queries scoped to the signed-in user (tenant isolation), rate-limited auth
  API routes (Redis-backed with in-memory fallback).
- **Dashboard shell:** dark cinematic design system, full 15-item sidebar
  (Dashboard, Create Video, My Projects, AI Script Writer, AI Video Generator,
  Image Generator, Thumbnail Generator, Voice Studio, Music Studio, Shorts
  Maker, SEO Studio, Brand Kit, Media Library, Export Center, Settings).
- **Dashboard:** empty-state stat cards with **real** numbers from the DB.
- **AI Studio pages:** every one renders "Provider Not Connected" with the env
  vars it will need. Nothing is simulated.
- **Data model:** User, Session, Project, ProjectSettings, Script, Chapter,
  Scene, Asset (typed by `kind` with per-kind 1:1 extensions: StockAsset,
  GeneratedImage, GeneratedVideo, Voiceover, Music, SoundEffect, Subtitle,
  Thumbnail), SceneAsset (role join), LicensingMetadata, AIGeneration,
  RenderingJob, ExportJob, BrandKit, Subscription, Usage, ProviderLog,
  ProjectVersion. Aspect ratios are first-class enums (16:9, 9:16, 1:1, 4:3,
  21:9, 4:5) — add a ratio by adding one enum value + one entry in
  `src/lib/constants.ts`. Projects/Assets support soft delete (`deletedAt`).
  Indexes on every FK for thousands-of-scenes queries without N+1.
- **Foundations:** S3 storage module (presigned URLs, user-scoped keys),
  BullMQ queues (`ai` / `render` / `exports`) + worker skeleton, `/api/health`
  endpoint reporting real service status.

## Health check

```bash
curl http://localhost:3000/api/health
# → { ok: true, db: "ok", redis: "ok", storage: "configured", ... }
```

## Production notes

- Set `COOKIE_SECURE=true` behind HTTPS and a real `AUTH_SECRET`.
- `prisma migrate deploy` applies migrations without a dev server.
- Never import `src/lib/env.ts` or any `process.env.API_KEY` from client code.
