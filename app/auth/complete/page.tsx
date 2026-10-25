import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { CompleteSignIn } from "./complete-sign-in";

export const metadata: Metadata = { title: "Signing you in" };

export default async function CompletePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <AuthShell title="Signing you in" subtitle="One moment while we confirm your link.">
      <CompleteSignIn next={safeNext} />
    </AuthShell>
  );
}
