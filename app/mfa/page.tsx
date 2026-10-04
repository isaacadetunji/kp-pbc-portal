import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/auth";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ enroll?: string }> }) {
  const { profile } = await getSession();
  if (!profile) redirect("/login");
  const { enroll } = await searchParams;
  return (
    <AuthShell
      title="Two-step verification"
      subtitle={enroll ? "Your firm requires an authenticator app for your account. Set it up to continue." : "Enter the 6-digit code from your authenticator app."}
    >
      <MfaForm mode={enroll ? "enroll" : "challenge"} home={profile.app_role === "client" ? "/portal" : "/dashboard"} />
    </AuthShell>
  );
}
