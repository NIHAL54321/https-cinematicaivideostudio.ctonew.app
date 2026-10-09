import { CreditCard, Plug2, UserRound } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { allCapabilityStatus } from "@/lib/ai";

export const metadata = { title: "Settings" };

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default async function SettingsPage() {
  const session = await requireUser();
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId } }),
    prisma.subscription.findUnique({ where: { userId: session.userId } }),
  ]);
  const capabilities = allCapabilityStatus();
  const connectedCount = capabilities.filter((c) => c.status === "connected").length;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Account, plan and provider connections — all values below are read live from your account."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* (a) Profile & account */}
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <UserRound size={16} strokeWidth={1.75} className="text-accent/80" />
            <h2 className="font-display text-base font-semibold text-ink">Profile &amp; account</h2>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Name</dt>
              <dd className="text-ink">{user?.name ?? "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Email</dt>
              <dd className="break-all text-ink">{user?.email ?? "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Member since</dt>
              <dd className="text-ink">{fmtDate(user?.createdAt)}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-faint">
            This panel reads your account. Profile editing and password changes are not available in this
            build — nothing here can change your name, your email or your password.
          </p>
        </Card>

        {/* (b) Plan & billing */}
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <CreditCard size={16} strokeWidth={1.75} className="text-accent/80" />
            <h2 className="font-display text-base font-semibold text-ink">Plan &amp; billing</h2>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{subscription?.plan ?? "FREE"}</Badge>
            <Badge tone={subscription?.status === "ACTIVE" ? "ok" : "neutral"}>
              {subscription?.status ?? "ACTIVE"}
            </Badge>
            {subscription?.provider ? (
              <Badge tone="neutral">via {subscription.provider}</Badge>
            ) : null}
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Current period</dt>
              <dd className="text-ink-dim">
                {subscription?.currentPeriodStart || subscription?.currentPeriodEnd
                  ? `${fmtDate(subscription?.currentPeriodStart)} → ${fmtDate(subscription?.currentPeriodEnd)}`
                  : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-faint">
            Billing is not connected to a payment provider. This build cannot take a payment or charge a card,
            and your plan reads FREE because nothing has been billed.
          </p>
        </Card>
      </div>

      {/* (c) Provider connections */}
      <Card className="mt-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Plug2 size={16} strokeWidth={1.75} className="text-accent/80" />
          <h2 className="font-display text-base font-semibold text-ink">Provider connections</h2>
          <Badge tone={connectedCount > 0 ? "ok" : "neutral"}>
            {connectedCount} of {capabilities.length} connected
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
          Live capability status from the AI orchestrator. Provider keys live only in server-side environment
          variables — they are never stored in the database or shown in the browser.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="bg-panel-2 text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                <th className="px-4 py-3 font-semibold">Capability</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Required env vars</th>
              </tr>
            </thead>
            <tbody>
              {capabilities.map((c) => (
                <tr key={c.capability} className="border-t border-line text-ink-dim">
                  <td className="px-4 py-3 text-ink">{c.label}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge tone={c.status === "connected" ? "ok" : "neutral"}>
                      {c.status === "connected" ? "Connected" : "Not Connected"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {c.requiredEnv.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {c.requiredEnv.map((name) => (
                          <code
                            key={name}
                            className="rounded-md border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-dim"
                          >
                            {name}
                          </code>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
