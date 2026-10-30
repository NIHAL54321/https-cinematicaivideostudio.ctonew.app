/**
 * THE BILLING / USAGE VIEW (Phase 8, block 5).
 *
 * Every figure below is a field of `BillingOverview`, which `loadBillingOverview()`
 * computed on this request from rows in the database. The component types no
 * number of its own — a guard test scans this file for a digit inside a JSX text
 * node and fails the build if one appears.
 *
 * The plans section renders `plans.emptyReason` when there is no plan, which is
 * the case today. An empty grid would read as "we have plans, they are just not
 * loading"; a reason reads as what it is.
 */
import { Badge, Card, PageHeader } from "@/components/ui";
import type { BillingOverview } from "@/lib/usage/overview";

const OUTCOME_TONE: Record<string, "neutral" | "ok" | "danger" | "accent"> = {
  SUCCEEDED: "ok",
  FAILED: "danger",
  BLOCKED: "accent",
  STOPPED: "accent",
  NOT_APPLICABLE: "neutral",
};

function Stat({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <Card className="glass-hover p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink break-words">{value}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint break-words">{note}</p>
    </Card>
  );
}

export function BillingOverviewView({ overview }: { overview: BillingOverview }) {
  const { usage, ledger, plans } = overview;
  const balanceText = ledger.summary.known ? String(ledger.summary.balance) : "not reported";
  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-5">
      <PageHeader
        title="Usage &amp; credits"
        description="What this account has actually used, what its credit ledger says, and what can be bought. Every figure is computed on this request from rows in this database: usage rows written by the code paths that did the work, and ledger rows summed into a balance. Nothing on this page is stored as a total and nothing is cached."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          label="Metered actions"
          value={usage.total}
          note={`${usage.synthetic} of them are declared synthetic encoder proofs, not a project's render`}
        />
        <Stat
          label="Ledger rows"
          value={ledger.total}
          note={`${ledger.summary.grants} grant(s), ${ledger.summary.spends} spend(s), ${ledger.summary.adjustments} adjustment(s)`}
        />
        <Stat label="Credit balance" value={balanceText} note="Summed from the ledger rows below. No balance is stored anywhere." />
      </div>

      <Card className="p-5">
        <h2 className="font-display text-base font-semibold tracking-tight text-ink">What this account has used</h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-dim">
          Each row below was written by the code that did the work — the render service when it created a job, the
          render runner when a stage ran or an encoder probe answered, the AI orchestrator when it attempted a
          provider call. {usage.coverage}.
        </p>
        {usage.empty ? (
          <p className="mt-4 rounded-xl border border-dashed border-line-soft p-3 text-[12px] leading-relaxed text-ink-dim">
            {usage.empty}
          </p>
        ) : (
          <>
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {usage.byKind.map((line) => (
                <li key={line.kind} className="rounded-xl border border-line-soft bg-panel-2/40 p-3">
                  <p className="text-[13px] font-semibold text-ink break-words">{line.label}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-dim break-words">
                    {line.rows} row(s) · {line.quantity} unit(s) · {line.synthetic} synthetic
                  </p>
                </li>
              ))}
            </ul>
            <ul className="mt-4 space-y-2">
              {usage.recent.map((row, index) => (
                <li key={`${row.occurredAt}-${index}`} className="rounded-xl border border-line-soft bg-panel-2/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{row.label}</span>
                    <Badge tone={OUTCOME_TONE[row.outcome] ?? "neutral"}>{row.outcome}</Badge>
                    {row.synthetic ? <Badge tone="accent">synthetic</Badge> : null}
                    <span className="text-[11px] text-ink-faint">{row.occurredAt}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-dim break-words">
                    {row.quantity} {row.unit} · recorded by {row.source}
                    {row.stageId ? ` · stage ${row.stageId}` : ""}
                    {row.renderJobId ? ` · job ${row.renderJobId}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-base font-semibold tracking-tight text-ink">What the ledger says</h2>
        <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-dim">{ledger.summary.sentence}</p>
        <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-ink-faint">{ledger.coverage}</p>
        {ledger.empty ? (
          <p className="mt-4 rounded-xl border border-dashed border-line-soft p-3 text-[12px] leading-relaxed text-ink-dim">
            {ledger.empty}
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {ledger.entries.map((entry, index) => (
              <li key={`${entry.occurredAt}-${index}`} className="rounded-xl border border-line-soft bg-panel-2/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={entry.kind === "SPEND" ? "danger" : entry.kind === "GRANT" ? "ok" : "accent"}>
                    {entry.kind}
                  </Badge>
                  <span className="font-display text-[15px] font-semibold text-ink">
                    {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                  </span>
                  <span className="text-[11px] text-ink-faint">{entry.occurredAt}</span>
                  {entry.causedBySynthetic ? <Badge tone="accent">synthetic cause</Badge> : null}
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-dim break-words">{entry.reason}</p>
                <p className="mt-1 text-[11px] text-ink-faint break-words">
                  {entry.usageEventId ? `caused by usage event ${entry.usageEventId}` : "no usage event — this row carries its own reason"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-base font-semibold tracking-tight text-ink">Plans</h2>
        {plans.plans.length === 0 ? (
          <>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-ink-dim">
              No plan can be purchased on this deployment. This is derived on this request, not written by hand:
            </p>
            <p className="mt-2 max-w-3xl rounded-xl border border-dashed border-line-soft p-3 text-[12px] leading-relaxed text-ink-dim break-words">
              {plans.emptyReason}
            </p>
            <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-ink-faint break-words">
              Where an owner-approved price would be entered: {plans.seam}. Nothing has been entered there, and this
              build does not invent a price, a plan name or a figure for what a plan would include.
            </p>
          </>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {plans.plans.map((plan) => (
              <li key={plan.id} className="rounded-xl border border-line-soft bg-panel-2/40 p-4">
                <p className="font-display text-[15px] font-semibold text-ink break-words">{plan.label}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-dim break-words">{plan.includes}</p>
                <p className="mt-2 text-[11px] text-ink-faint break-words">
                  {plan.priceMinorUnits} {plan.currency} minor units · approved by {plan.approvedBy} on {plan.approvedAt}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint break-words">
                  {plans.purchasePossible
                    ? "A payment provider and a payment path are both configured, so this plan could be bought."
                    : "This plan cannot be bought yet: a payment provider and a payment path are both required, and the probes above say which is missing."}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-base font-semibold tracking-tight text-ink">What this page will not say</h2>
        <ul className="mt-3 space-y-2">
          {overview.statements.map((statement, index) => (
            <li key={index} className="text-[12px] leading-relaxed text-ink-faint break-words">
              {statement}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-ink-faint break-words">
          Read at {overview.generatedAt} for {overview.account.email}.
        </p>
      </Card>
    </div>
  );
}
