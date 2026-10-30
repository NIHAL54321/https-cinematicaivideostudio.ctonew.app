/**
 * grant-admin.ts — grant (or revoke) the operator role for ONE account.
 * (Phase 8, block 4.)
 *
 * The role lives in a column (`User.role`, default `USER`) and is set HERE, by
 * an explicit act with the address typed on the command line. No application
 * code contains an operator's email address, so "who can see /admin" is a fact
 * about this deployment's data, not about its source.
 *
 *     bun scripts/fixtures/grant-admin.ts <email>
 *     bun scripts/fixtures/grant-admin.ts <email> --revoke
 *
 * It prints what the row said before and after, so the change is visible rather
 * than assumed, and it exits non-zero when the address is not an account — a
 * grant that silently did nothing would be the worst outcome.
 */
import { prisma } from "@/lib/db";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim();
const revoke = args.includes("--revoke");

if (!email) {
  console.error("usage: bun scripts/fixtures/grant-admin.ts <email> [--revoke]");
  process.exit(2);
}

const before = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true } });
if (!before) {
  console.error(`no account with email ${email} — nothing was changed`);
  process.exit(1);
}

const after = await prisma.user.update({
  where: { id: before.id },
  data: { role: revoke ? "USER" : "ADMIN" },
  select: { id: true, email: true, role: true },
});

console.log(`account   : ${after.email} (${after.id})`);
console.log(`role before: ${before.role}`);
console.log(`role after : ${after.role}`);
console.log(
  revoke
    ? "the operator surface now answers this account with 404, on the next request"
    : "the operator surface now answers this account, on the next request",
);
await prisma.$disconnect();
