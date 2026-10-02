import type { Metadata } from "next";
import { AuthLayout } from "@/components/auth-layout";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return <AuthLayout mode="signup" />;
}
