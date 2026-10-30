/**
 * WHO MAY SEE THE OPERATOR SURFACE (Phase 8, block 4).
 *
 * The role is a column (`User.role`, default `USER`), never an email address in
 * code: a hard-coded address would make "who is an operator" a fact about the
 * source rather than about the deployment, and would be wrong the moment the
 * account changed. The grant is a script (`scripts/fixtures/grant-admin.ts`).
 *
 * THE TWO REFUSALS ARE DIFFERENT ON PURPOSE:
 *
 *   - anonymous → 401. The caller is not signed in; telling them that is not a
 *     disclosure, because every page behind the app shell says the same thing.
 *   - signed in, ordinary account → 404, NEVER 403. A 403 would confirm that an
 *     operator surface exists at this address and that the caller is merely
 *     outside it. A 404 says only what a stranger may know: nothing here for you.
 *     The API returns exactly the same shape for a missing id and for a
 *     non-admin caller, and the page renders the app's own 404.
 *
 * The role is read from the database on every request (one indexed lookup by
 * primary key), so revoking it takes effect on the next request rather than on
 * the next deploy.
 */
import { notFound, redirect } from "next/navigation";
import { ApiError, requireApiUser } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** The only role that may read the operator surface. */
export const ADMIN_ROLE = "ADMIN" as const;

/** True when this account's role column says ADMIN. Read per request. */
export async function isAdminUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === ADMIN_ROLE;
}

/**
 * API guard: 401 when anonymous, 404 when signed in without the role.
 * Returns the operator's user id, which the loader then re-reads for its email.
 */
export async function requireAdminApiUser(): Promise<string> {
  const userId = await requireApiUser();
  if (!(await isAdminUser(userId))) {
    throw new ApiError(404, "Not found.", "not_found");
  }
  return userId;
}

/**
 * Page guard: the app shell already redirects an anonymous visitor to /signin,
 * so this only has to decide the ordinary-account case — and it renders the
 * app's own 404 rather than a "forbidden" page, for the reason above.
 */
export async function requireAdminPage() {
  const session = await getSession();
  if (!session) redirect("/signin");
  if (session.user.role !== ADMIN_ROLE) notFound();
  return session;
}
