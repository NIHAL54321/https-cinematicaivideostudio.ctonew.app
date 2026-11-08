# Phase 8 security block — evidence

Branch phase8/security, from master dd41eec. Files: probe.log (the real run of scripts/security/probe.ts against the live server BEFORE the fixes — every PASS/FAIL line), FINDINGS.md (finding, how proved, severity, fixed or OPEN), SHA256SUMS.

Regenerate: bash scripts/restart-3100.sh && bun scripts/security/probe.ts > evidence/phase8_security/probe.log 2>&1; npx tsc --noEmit; CAVS_TEST_MODE=1 bun test; bun run build (server stopped); bash scripts/restart-3100.sh.

THREAT MODEL: one machine, one Next process on http://127.0.0.1:3100, no WAF, no external TLS terminator, callers are anonymous or one of two signed-in fixture accounts.

THE POST-FIX RE-RUN DID NOT COMPLETE. The run in probe.log is the pre-fix run (killed during the rate-limit wait when that section was reordered). After the fixes: tsc rc=0, suite 1674 pass / 0 fail / 111 files, one build+restart cycle rc=0 serving BUILD_ID i7Y-deSq_kvQfsqBaKoB5; a later restart served BUILD_ID mQ9QE1wk5TGLlAYoZr1mO (the pre-fix build), so the re-run measured the old code, and the rebuild was still running when the block ended. The next session must build, restart, confirm the served BUILD_ID changed and x-frame-options appears on /signin, then run the probe and replace probe.log.

WHAT IS NOT COVERED: no WAF, no TLS terminator, no proxy; rate limiting is in-process and does not survive a restart or scale past one instance; DNS rebinding is not closed; X-Forwarded-For is trusted for the per-IP bucket (OPEN, needs the deployment proxy fact); no external audit; no load/DoS testing; no dependency/CVE scanning; no CSRF test beyond SameSite=Lax plus JSON handlers; no browser CSP-violation probe; no full render with a hostile title (injection proved statically plus stored-as-data). Passing this probe is not a claim that the app is secure or hardened.
