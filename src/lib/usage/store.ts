/**
 * THE PRISMA SIDE OF METERING (Phase 8, block 5).
 *
 * `ledger.ts` holds the invariants and knows nothing about Prisma; this file is
 * the adapter, and it is the ONLY place in the app that creates a row in
 * `CreditLedgerEntry` or `UsageEvent`. A guard test counts the `create` calls
 * and fails the build if a second one appears anywhere else.
 *
 * Two things worth reading before changing this file:
 *
 * 1. `runExclusive` is not decoration. A spend reads the ledger and then
 *    appends; without a lock, two spends at the same moment both see the same
 *    balance and both succeed, and the balance goes negative through a race that
 *    no single request could have caused. `pg_advisory_xact_lock` on the account
 *    id serialises them inside one transaction, and the transaction client is
 *    the one passed to the callback, so the read and the write are on the same
 *    connection and the same lock.
 *
 * 2. There is no update and no delete here, and there could not be: the
 *    database refuses both with a trigger (`cavs_refuse_mutation`).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { LedgerEntryInput, LedgerEntryRecord, UsageEventInput, UsageEventRecord } from "./types";
import type { LedgerScope, LedgerStore } from "./ledger";

type EntryRow = {
  id: string;
  userId: string;
  kind: string;
  amount: number;
  reason: string;
  usageEventId: string | null;
  occurredAt: Date;
};

function toEntry(row: EntryRow): LedgerEntryRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as LedgerEntryRecord["kind"],
    amount: row.amount,
    reason: row.reason,
    usageEventId: row.usageEventId,
    occurredAt: row.occurredAt,
  };
}

type EventRow = {
  id: string;
  userId: string;
  projectId: string | null;
  renderJobId: string | null;
  stageId: string | null;
  kind: string;
  quantity: number;
  unit: string;
  outcome: string;
  synthetic: boolean;
  source: string;
  detail: Prisma.JsonValue | null;
  occurredAt: Date;
};

function toEvent(row: EventRow): UsageEventRecord {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    renderJobId: row.renderJobId,
    stageId: row.stageId,
    kind: row.kind as UsageEventRecord["kind"],
    quantity: row.quantity,
    unit: row.unit,
    outcome: row.outcome as UsageEventRecord["outcome"],
    synthetic: row.synthetic,
    source: row.source,
    detail: (row.detail ?? null) as Record<string, unknown> | null,
    occurredAt: row.occurredAt,
  };
}

const ENTRY_SELECT = {
  id: true,
  userId: true,
  kind: true,
  amount: true,
  reason: true,
  usageEventId: true,
  occurredAt: true,
} as const;

const EVENT_SELECT = {
  id: true,
  userId: true,
  projectId: true,
  renderJobId: true,
  stageId: true,
  kind: true,
  quantity: true,
  unit: true,
  outcome: true,
  synthetic: true,
  source: true,
  detail: true,
  occurredAt: true,
} as const;

/** The ledger operations bound to one client (the transaction client inside a lock). */
function scopeOver(client: Prisma.TransactionClient | typeof prisma): LedgerScope {
  return {
    async readEntries(userId: string) {
      const rows = await client.creditLedgerEntry.findMany({
        where: { userId },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: ENTRY_SELECT,
      });
      return rows.map(toEntry);
    },
    async appendEntry(input: LedgerEntryInput) {
      const row = await client.creditLedgerEntry.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          amount: input.amount,
          reason: input.reason,
          usageEventId: input.usageEventId ?? null,
          occurredAt: input.occurredAt ?? new Date(),
        },
        select: ENTRY_SELECT,
      });
      return toEntry(row);
    },
  };
}

export const prismaLedgerStore: LedgerStore = {
  ...scopeOver(prisma),
  async runExclusive<T>(userId: string, fn: (scope: LedgerScope) => Promise<T>): Promise<T> {
    return prisma.$transaction(
      async (tx) => {
        // One lock per account, held for the transaction: a second spend on the
        // same account waits here instead of reading a stale balance.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
        return fn(scopeOver(tx));
      },
      { timeout: 15_000, maxWait: 10_000 },
    );
  },
  async usageEventBelongsTo(userId: string, usageEventId: string) {
    const found = await prisma.usageEvent.findFirst({
      where: { id: usageEventId, userId },
      select: { id: true },
    });
    return Boolean(found);
  },
};

/* ------------------------------------------------------------------ */
/* Usage events                                                        */
/* ------------------------------------------------------------------ */

export interface UsageStore {
  appendUsageEvent(input: UsageEventInput): Promise<UsageEventRecord>;
  readUsageEvents(userId: string, take?: number): Promise<UsageEventRecord[]>;
}

export const prismaUsageStore: UsageStore = {
  async appendUsageEvent(input: UsageEventInput) {
    const row = await prisma.usageEvent.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        renderJobId: input.renderJobId ?? null,
        stageId: input.stageId ?? null,
        kind: input.kind,
        quantity: input.quantity,
        unit: input.unit,
        outcome: input.outcome ?? "NOT_APPLICABLE",
        synthetic: input.synthetic,
        source: input.source,
        detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        occurredAt: input.occurredAt ?? new Date(),
      },
      select: EVENT_SELECT,
    });
    return toEvent(row);
  },
  async readUsageEvents(userId: string, take = 50) {
    const rows = await prisma.usageEvent.findMany({
      where: { userId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take,
      select: EVENT_SELECT,
    });
    return rows.map(toEvent);
  },
};

/**
 * How many usage rows this account has, counted in the database rather than
 * from the page of rows that was read — so a capped list is never mistaken for
 * the whole account's usage.
 */
export async function countUsageEvents(userId: string): Promise<number> {
  return prisma.usageEvent.count({ where: { userId } });
}

/** How many ledger rows this account has (same reason as above). */
export async function countLedgerEntries(userId: string): Promise<number> {
  return prisma.creditLedgerEntry.count({ where: { userId } });
}
