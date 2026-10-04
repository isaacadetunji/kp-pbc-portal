import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  timeout: "You were signed out after a period of inactivity.",
  inactive: "Your account has been deactivated. Contact the firm if you think this is a mistake.",
  link: "That sign-in link is invalid or has expired. Request a new one below.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  return (
    <AuthShell title="Sign in" subtitle="Use the email address your invitation was sent to.">
      <LoginForm next={next && next.startsWith("/") && !next.startsWith("//") ? next : "/"} notice={reason ? REASONS[reason] : undefined} />
    </AuthShell>
  );
}
