# Phase 8 security block — evidence

Branch `phase8/security`, from `master` = `dd41eec`. **This file describes the run that exists in
`probe.log`.** Where a claim is not backed by that log or by a command named here, it says so.

## What was tested, in plain words

**Who can reach this app.** One machine, one Node/Next process on `http://127.0.0.1:3100`, behind no
WAF and no external TLS terminator. Everything the probe did, it did over plain HTTP from the same
machine. Two kinds of caller exist: anonymous, and a signed-in account (sessions are opaque tokens in
an httpOnly cookie, hashed in the database).

**What a caller could try, and what the probe asked.** Whether an anonymous caller can read anything
(every route, one request each); whether account B can read or change account A's project, version,
render job, artefact, asset or download (25 requests with A's real ids); whether the sign-in limit
really fires, really resets, and reveals whether an account exists; whether a forged or replayed
cookie is honoured; whether a path or an id can escape the directory or the tenant it belongs to;
whether the server can be made to fetch addresses on this machine or the private network (SSRF);
whether a hostile title or filename can reach a shell; whether a secret value appears in anything the
server sends; whether an oversized or wrong-typed download is refused before it is buffered; and
which security headers the server sends.

**What this block did.** It wrote the probe (`scripts/security/probe.ts`), ran it, and fixed what it
proved: SSRF on the media ingest path, the missing response headers, the sign-in timing oracle, the
missing content-type refusal and the missing fetch deadline. It also found and fixed **four defects
in the probe itself** — recorded in `FINDINGS.md`, because a probe that reports a false pass is worse
than no probe.

## Artefacts

| File | What it is |
|------|------------|
| `probe.log` | **The post-fix run against the served build**: 187 checks · **185 PASS · 2 FAIL · 0 SKIP**, `probe_rc=1`, BUILD_ID `HaJ3HYlDo1amWbZhq-wd3`. Both failures are explained in `FINDINGS.md` rows #10 and #11 — one is a 120-character title cap the probe asserted wrongly, the other is this deployment using the same string for its object-store access key and secret. |
| `probe_prefix_baseline.log` | The **pre-fix** run from `6be0cc4`. Kept for comparison only: its FAIL lines for SSRF, headers, content type and the timing oracle are what the fixes were written against. **It is not evidence of the shipped state.** |
| `FINDINGS.md` | Finding · how it was proved · severity · fixed, open or not-a-defect; the probe defects; the checks that passed. |
| `README.md` | This file. |

Sizes and digests: `SHA256SUMS` in this directory, verified with `sha256sum -c SHA256SUMS`.

## Gates on this branch (`phase8/security`, HEAD `6be0cc4` + the evidence commit)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | **rc=0** (measured by the lead on this branch) |
| `CAVS_TEST_MODE=1 bun test` | **1674 pass / 0 fail / 111 files**, rc=0 |
| `bun run build` (server stopped, browser daemon closed) | **rc=0**, BUILD_ID `HaJ3HYlDo1amWbZhq-wd3` |
| `scripts/restart-3100.sh` | **rc=0**; served `BUILD_ID` == disk `BUILD_ID`; `_buildManifest.js` for that id → **200**, a bogus id → **404** |
| Served == disk chunk | `/opt/cavs-deps/.next/static/chunks/main-app-4b240cd1ab7e1e9a.js` sha256 `3df96f4ddbb01b20624ec4b7ee8b665837d55c540cdc76cb9723f2e5920cd7f3` on disk **and** fetched from `/_next/static/chunks/` (re-verified by the lead with `curl | sha256sum`) |
| Headers on the wire | CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` present on `/signin` **and** `/api/auth/session` (re-verified by the lead with `curl -sI`) |

## Two checks the lead ran independently of the probe

Both were needed to say what the two FAIL lines actually mean:

1. **Title truncation (#10).** Sent a 133-character hostile title to `POST /api/projects` and read the
   row back: stored **120** characters, **prefix identical for all 120**, `first_diff None`, and the
   canary file it names does not exist. The string is stored as inert data and cut to the documented
   cap; it is never executed. The probe's assertion (byte equality with the 133-character original)
   is what failed, not the product.
2. **The storage credential (#11).** `S3_ACCESS_KEY` and `S3_SECRET_KEY` in `.env` are the **same
   10-character value**. `POST /api/media/upload` returns a presigned URL (`X-Amz-Credential`
   present, host `localhost:9000`) and the access-key id necessarily appears in it — SigV4 requires
   it. So the probe's two "secret hits" are the access-key id inside a URL meant to be handed to a
   client, and the real issue is that this deployment signs with the same string it publishes as the
   key id. **Deployment credential weakness, not a code defect; recorded OPEN.**

## Regenerating everything

```bash
cd /home/team/app
bash scripts/restart-3100.sh                          # the server must be up on :3100 first
bun scripts/security/probe.ts > evidence/phase8_security/probe.log 2>&1   # ~3 min, exit 0 = all passed
npx tsc --noEmit                                      # rc 0
CAVS_TEST_MODE=1 bun test                             # suite
# bun run build must run with the :3100 server STOPPED — it OOMs alongside the resident server
bun run build && bash scripts/restart-3100.sh         # then prove served BUILD_ID == disk BUILD_ID
sha256sum evidence/phase8_security/* > evidence/phase8_security/SHA256SUMS
sha256sum -c evidence/phase8_security/SHA256SUMS
```

The probe needs the two fixture accounts (`scripts/fixtures/p7a-world.sh`) and the delivered artefact
rows already in the database. It creates its own rows (victim project, version, assets, and two
throwaway accounts for the rate-limit scenarios) and deletes them at the end — the run in `probe.log`
ends with `cleanup: removed 2 probe account(s), 13 probe asset row(s) and 2 probe project(s)`.

## What is not covered

- **One machine, no WAF, no external TLS terminator.** The app is reached over plain HTTP on the
  loopback interface. Nothing here says how it behaves behind a real proxy, CDN or TLS terminator —
  including whether `X-Forwarded-For` (which the rate limiter trusts, finding #5) would then be
  believable.
- **Rate limiting is in-process** unless Redis answers, and this deployment runs one process. It does
  not survive a restart and does not scale past one instance.
- **DNS rebinding is not closed** (finding #6). The guard resolves, checks, then `fetch` resolves
  again.
- **No external audit.** Nobody outside this team has looked at this code. Passing this probe is not
  a claim that the app is "secure" or "hardened"; it is a claim that the listed checks behaved as
  stated on this build, on this machine, at this time.
- **No load, DoS or resource-exhaustion testing.** The oversize refusal is proved; a flood of
  well-formed requests is not.
- **No dependency or vulnerability scanning** (`bun audit`, CVE databases) was run.
- **No CSRF probe beyond the cookie policy.** `SameSite=Lax` plus JSON-only handlers is the argument,
  not a demonstrated test.
- **No browser-level check of the CSP** (whether a real browser reports zero violations on the
  editor) completed in this block. The policy is known to need `'unsafe-inline'` for Next's bootstrap.
- **No hostile-title render was executed end to end.** Command injection is proved statically (no
  `shell: true`, no `exec`/`execSync`, six `spawnSync` sites taking argv arrays) and by showing the
  hostile string is stored as inert data whose canary never appears — not by encoding a project whose
  title carries shell metacharacters.
- **The object store's own credentials are weak on this deployment** (finding #11): same value for
  key id and secret. That is a configuration matter for whoever runs this for real.
