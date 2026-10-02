import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth-layout";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return <AuthLayout mode="signin" />;
}
