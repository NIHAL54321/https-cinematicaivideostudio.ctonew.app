#!/bin/bash
# Part A evidence: each guard, driven against a DELIBERATELY BROKEN source tree.
# Each break is applied, the guard test is run (it must fail), the file is
# restored, and the tree is checked clean at the end.
set -u
cd /home/team/app || exit 1
LOG=/tmp/guard-controls.log
: > "$LOG"
echo "commit under test: $(git rev-parse HEAD)" >> "$LOG"
echo "tree at start: $(git status --porcelain | wc -l) modified path(s)" >> "$LOG"

backup() { cp "$1" "/tmp/guard-bk-$(basename "$1")"; }
restore() { cp "/tmp/guard-bk-$(basename "$1")" "$1"; }

run_guard() { # $1 = label, $2 = test file
  echo "" >> "$LOG"
  echo "########## $1 ##########" >> "$LOG"
  CAVS_TEST_MODE=1 timeout 180 bun test "$2" >> "$LOG" 2>&1
  echo "rc=$?" >> "$LOG"
  grep -E "^\(fail\)" "$LOG" | tail -3 >> "$LOG"
}

########## GUARD 1 — resume point forced to the first declared stage ##########
backup src/lib/render/recovery.ts
python3 - <<'PY'
p = "src/lib/render/recovery.ts"
s = open(p).read()
old = '      startStageId = stage.id;\n      stoppedAt = `"${stage.id}" is ${latest.state}'
new = '      startStageId = stages[0].id;\n      stoppedAt = `"${stage.id}" is ${latest.state}'
assert old in s, "break 1: anchor not found"
open(p, "w").write(s.replace(old, new, 1))
print("BREAK 1 APPLIED: a failed stage now resumes at the FIRST declared stage")
PY
run_guard "GUARD 1 with a resume point computed as an earlier stage (recovery.ts broken)" src/lib/render/__tests__/retry-resume.test.ts
restore src/lib/render/recovery.ts

########## GUARD 2 — a recycled pid accepted as the owner ##########
backup src/lib/render/attempt.ts
python3 - <<'PY'
p = "src/lib/render/attempt.ts"
s = open(p).read()
old = 'if (owner.procStart !== null && start !== owner.procStart) {'
new = 'if (false && owner.procStart !== null && start !== owner.procStart) {'
assert old in s, "break 2: anchor not found"
open(p, "w").write(s.replace(old, new, 1))
print("BREAK 2 APPLIED: the pid alone is now accepted as the owner (start time ignored)")
PY
run_guard "GUARD 2 with a recycled pid reading as alive (attempt.ts broken)" src/lib/render/__tests__/interrupted-liveness.test.ts
restore src/lib/render/attempt.ts

########## GUARD 3 — the store stops refusing writes to a closed attempt ##########
backup src/lib/render/__tests__/memory-store.ts
python3 - <<'PY'
p = "src/lib/render/__tests__/memory-store.ts"
s = open(p).read()
old = '    if (attempt.state !== "RUNNING") {'
new = '    if (false && attempt.state !== "RUNNING") {'
assert old in s, "break 3: anchor not found"
open(p, "w").write(s.replace(old, new, 1))
print("BREAK 3 APPLIED: the store now silently accepts a write to a CLOSED attempt")
PY
run_guard "GUARD 3 with the refusal removed (memory-store.ts broken)" src/lib/render/__tests__/retry-immutable.test.ts
restore src/lib/render/__tests__/memory-store.ts

########## GUARD 4 — a promise added to the panel copy ##########
backup src/components/render/render-pipeline-panel.tsx
python3 - <<'PY'
p = "src/components/render/render-pipeline-panel.tsx"
s = open(p).read()
old = "Seven stages from a finished project to a delivered master."
new = "Your render is resumable. Seven stages from a finished project to a delivered master."
assert old in s, "break 4: anchor not found"
open(p, "w").write(s.replace(old, new, 1))
print("BREAK 4 APPLIED: the panel now claims a render is resumable")
PY
run_guard "GUARD 4 with a promise in the panel copy (render-pipeline-panel.tsx broken)" src/lib/render/__tests__/panel-copy.test.ts
restore src/components/render/render-pipeline-panel.tsx

########## back to green ##########
echo "" >> "$LOG"
echo "########## ALL BREAKS REVERTED — the four guards on the restored tree ##########" >> "$LOG"
CAVS_TEST_MODE=1 timeout 180 bun test src/lib/render/__tests__/retry-resume.test.ts src/lib/render/__tests__/interrupted-liveness.test.ts src/lib/render/__tests__/retry-immutable.test.ts src/lib/render/__tests__/panel-copy.test.ts >> "$LOG" 2>&1
echo "rc=$?" >> "$LOG"
echo "" >> "$LOG"
echo "tree at end: $(git status --porcelain | wc -l) modified path(s)" >> "$LOG"
git status --porcelain >> "$LOG"
echo "DONE"
