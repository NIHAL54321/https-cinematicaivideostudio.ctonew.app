import { NextResponse } from "next/server";
import { getSession, publicUser } from "@/lib/auth";

export const runtime = "nodejs";

/** Returns the current user (or null) — used by client components. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null });
  return NextResponse.json({ user: publicUser(session.user) });
}
