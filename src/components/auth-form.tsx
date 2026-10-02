"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2, Lock, Mail, User as UserIcon } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";

type Mode = "signin" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const form = new FormData(e.currentTarget);
    const payload: Record<string, string> = {
      email: String(form.get("email") ?? "").trim(),
      password: String(form.get("password") ?? ""),
    };
    if (isSignup) payload.name = String(form.get("name") ?? "").trim();

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error ?? "Something went wrong. Please try again.");
        return;
      }

      const next = searchParams.get("next");
      router.push(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isSignup ? (
        <div>
          <Label htmlFor="name">Name (optional)</Label>
          <div className="relative">
            <UserIcon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <Input id="name" name="name" autoComplete="name" placeholder="Jane Director" className="pl-9" />
          </div>
        </div>
      ) : null}

      <div>
        <Label htmlFor="email">Email</Label>
        <div className="relative">
          <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@studio.com"
            className="pl-9"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={isSignup ? 8 : 1}
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder={isSignup ? "At least 8 characters" : "Your password"}
            className="pl-9"
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : null}
        {isSignup ? "Create account" : "Sign in"}
        {!busy ? <ArrowRight size={16} /> : null}
      </Button>

      <p className="text-center text-sm text-ink-dim">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/signin" className="font-medium text-accent hover:text-accent-strong">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to the studio?{" "}
            <Link href="/signup" className="font-medium text-accent hover:text-accent-strong">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
