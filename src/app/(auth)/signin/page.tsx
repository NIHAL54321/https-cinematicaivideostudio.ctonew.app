import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { ownerAutoLoginGate, safeOwnerNextPath } from "@/lib/owner-session/gate";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The sign-in page — and, on a deployment whose only user is the owner, a
 * doorway that is already open.
 *
 * The flag is read HERE, per request, in the Node runtime (`force-dynamic`
 * guarantees that: a statically prerendered page would freeze whatever the
 * environment said at build time, which is exactly the accident this must not
 * allow). When CAVS_OWNER_EMAIL names an account, the page hands the request to
 * `/api/auth/owner-session`, which mints the session and redirects onward. When
 * it does not, this page is byte-for-byte what it was: the same form, the same
 * POST to /api/auth/signin, the same anonymous API being 401.
 */
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const gate = ownerAutoLoginGate();
  if (gate.enabled) {
    const { next } = await searchParams;
    redirect(`/api/auth/owner-session?next=${encodeURIComponent(safeOwnerNextPath(next ?? null))}`);
  }
  return <AuthLayout mode="signin" />;
}
