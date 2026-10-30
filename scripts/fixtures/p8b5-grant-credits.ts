/**
 * Phase 8 block 5 — put REAL ledger rows behind a real account, through the
 * product's own ledger functions (`postGrant` / `postSpend` in
 * src/lib/usage/ledger.ts). Nothing here is typed into the database by hand.
 *
 * WHAT THIS IS NOT: a price, a plan, a product, a payment or a sale. The rate
 * below is FIXTURE-DECLARED — the same way the 1440p specification in block 2b
 * was fixture-declared — and every reason string it writes says so in the row
 * itself, so a reader of the ledger can see what the row is without reading this
 * file. No customer exists, no money moved, and the balance it produces is a
 * number of credits in a database, not a currency.
 *
 * Usage:  bun scripts/fixtures/p8b5-grant-credits.ts [email] [grant] [perStageRun]
 */
import { prisma } from "@/lib/db";
import { LedgerError, postGrant, postSpend, summariseLedger } from "@/lib/usage/ledger";
import { prismaLedgerStore } from "@/lib/usage/store";

const email = process.argv[2] ?? "p7a-fixture@cavs.test";
const grantCredits = Number(process.argv[3] ?? 100);
const perStageRun = Number(process.argv[4] ?? 1);

const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
if (!user) throw new Error(`no account ${email} — run scripts/fixtures/p7a-world.sh first`);

// The job is the one the METERED rows point at — read from the usage table, not
// guessed from the render-job table: a job enqueued before metering existed has
// no usage rows, and spending against it would be spending against nothing.
const newestMetered = await prisma.usageEvent.findFirst({
  where: { kind: "RENDER_STAGE_RUN", userId: user.id },
  // eslint-disable-next-line no-restricted-syntax -- explicit, see below
  orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  select: { renderJobId: true },
});
let owner = user;
if (!newestMetered) {
  // The account the pipeline METERED, read from the usage row itself: the
  // encode fixture signs in as the account it finds, and a script must not
  // assume which one that was.
  const anyMetered = await prisma.usageEvent.findFirst({
    where: { kind: "RENDER_STAGE_RUN" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    select: { renderJobId: true, userId: true },
  });
  if (anyMetered) {
    const ownerRow = await prisma.user.findUnique({ where: { id: anyMetered.userId }, select: { id: true, email: true } });
    if (ownerRow) owner = ownerRow;
  }
}
const jobId = process.argv[5] ?? newestMetered?.renderJobId ?? (await prisma.usageEvent.findFirst({
  where: { kind: "RENDER_STAGE_RUN", userId: owner.id },
  orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  select: { renderJobId: true },
}))?.renderJobId;
if (!jobId) throw new Error(`no metered stage run for ${email} — run scripts/fixtures/p8b2b-synthetic-encode.ts first`);
const job = await prisma.renderJob.findUnique({
  where: { id: jobId },
  select: { id: true, projectId: true, syntheticProof: true, requestedAt: true },
});
if (!job) throw new Error(`render job ${jobId} does not exist`);

const events = await prisma.usageEvent.findMany({
  where: { userId: owner.id, renderJobId: job.id, kind: "RENDER_STAGE_RUN" },
  orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  select: { id: true, stageId: true, outcome: true, synthetic: true, occurredAt: true },
});

console.log("=== WHAT THIS SCRIPT IS DOING ===");
console.log(`account            : ${owner.email} (${owner.id})`);
console.log(`render job         : ${job.id} (syntheticProof=${job.syntheticProof})`);
console.log(`stage-run usage    : ${events.length} row(s) metered by the pipeline's own store`);
console.log(`grant              : ${grantCredits} credits, reason recorded on the row`);
console.log(`fixture rate       : ${perStageRun} credit(s) per stage run — DECLARED BY THIS FIXTURE, not a price`);
console.log("");

const grant = await postGrant(prismaLedgerStore, {
  userId: owner.id,
  credits: grantCredits,
  reason:
    `development grant of ${grantCredits} credits by scripts/fixtures/p8b5-grant-credits.ts. No payment was taken, ` +
    "no plan was purchased, no invoice exists and no customer was charged: this row exists so the ledger has a " +
    "positive balance to spend against in the block-5 proof.",
});
console.log(`GRANT  ${grant.entry.id}  ${grant.entry.amount}  balance ${grant.balanceBefore} -> ${grant.balanceAfter}`);

for (const event of events) {
  const spend = await postSpend(prismaLedgerStore, {
    userId: owner.id,
    credits: perStageRun,
    usageEventId: event.id,
    reason:
      `FIXTURE-DECLARED RATE, NOT A PRICE: ${perStageRun} credit(s) for the ${event.stageId} stage run recorded as ` +
      `usage event ${event.id} (outcome ${event.outcome}). This rate was declared by ` +
      "scripts/fixtures/p8b5-grant-credits.ts to exercise the ledger's spend path; no product, plan or customer " +
      "exists and nothing was charged to anyone.",
  });
  console.log(`SPEND  ${spend.entry.id}  ${spend.entry.amount}  cause ${event.id} (${event.stageId})  balance ${spend.balanceBefore} -> ${spend.balanceAfter}`);
}

/* ---- the two invariants, exercised against the REAL store ---- */
console.log("\n=== INVARIANT CONTROLS (each of these MUST fail) ===");
const entries = await prismaLedgerStore.readEntries(owner.id);
const balance = summariseLedger(entries).balance;

try {
  await postSpend(prismaLedgerStore, {
    userId: owner.id,
    credits: balance + 1,
    reason: "negative control: a spend larger than the balance",
    usageEventId: events[0]?.id ?? "none",
  });
  console.log("NEGATIVE CONTROL 1 FAILED — an overdraft was accepted (this must never happen)");
} catch (err) {
  console.log(`negative control 1 (spend ${balance + 1} of a ${balance} balance) refused: ${(err as LedgerError).code} — ${(err as Error).message}`);
}
try {
  await postSpend(prismaLedgerStore, {
    userId: owner.id,
    credits: 1,
    reason: "negative control: a spend with no cause",
  } as never);
  console.log("NEGATIVE CONTROL 2 FAILED — a spend with no cause was accepted (this must never happen)");
} catch (err) {
  console.log(`negative control 2 (spend with no usage event) refused: ${(err as LedgerError).code} — ${(err as Error).message}`);
}

const after = summariseLedger(await prismaLedgerStore.readEntries(owner.id));
console.log("\n=== LEDGER AFTER THIS RUN ===");
console.log(after.sentence);
console.log(`rows=${after.rows} grants=${after.grants} spends=${after.spends} adjustments=${after.adjustments} balance=${after.balance}`);
await prisma.$disconnect();
