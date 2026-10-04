import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSession } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage() {
  const { profile } = await getSession();
  if (!profile) redirect("/login?reason=link");
  return (
    <AuthShell title={`Welcome${profile.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}`} subtitle="Choose a password for your account. You can also sign in with an emailed link at any time.">
      <SetPasswordForm home={profile.app_role === "client" ? "/portal" : "/dashboard"} />
    </AuthShell>
  );
}
