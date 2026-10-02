"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { Brand, SidebarNav } from "@/components/sidebar";
import { navItemForPath } from "@/lib/constants";
import { cn } from "@/lib/cn";

export function AppShell({
  user,
  children,
}: {
  user: { name: string | null; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const current = navItemForPath(pathname);
  const displayName = user.name || user.email.split("@")[0];

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      router.push("/signin");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line-soft bg-abyss/80 backdrop-blur-xl lg:flex">
        <div className="px-4 pt-5 pb-2">
          <Brand />
        </div>
        <SidebarNav pathname={pathname} />
        <div className="border-t border-line-soft p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel-3 text-xs font-semibold text-accent uppercase">
              {displayName.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{displayName}</p>
              <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
            </div>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              title="Sign out"
              className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-panel-2 hover:text-danger cursor-pointer"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-line-soft bg-abyss">
            <div className="flex items-center justify-between px-4 pt-5 pb-2">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-ink-dim hover:bg-panel-2 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <SidebarNav pathname={pathname} />
          </aside>
        </div>
      ) : null}

      {/* Main column */}
      <div className="lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line-soft bg-void/80 px-4 backdrop-blur-xl lg:px-8">
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-dim hover:bg-panel-2 lg:hidden cursor-pointer"
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-faint">Studio</span>
            {current ? (
              <>
                <span className="text-ink-faint">/</span>
                <span className={cn("font-medium", current.href === pathname ? "text-accent" : "text-ink")}>
                  {current.label}
                </span>
              </>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/create-video"
              className="hidden rounded-xl bg-accent px-4 py-2 text-[13px] font-semibold text-[#171208] transition-colors hover:bg-accent-strong sm:inline-flex"
            >
              New video
            </Link>
          </div>
        </header>

        <main className="px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
