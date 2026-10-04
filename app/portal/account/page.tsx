import type { Metadata } from "next";
import { AccountSettings } from "@/components/account-settings";
import { requireClient } from "@/lib/auth";

export const metadata: Metadata = { title: "My account" };

export default async function PortalAccountPage() {
  const { profile } = await requireClient();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My account</h1>
      <AccountSettings profile={profile} />
    </div>
  );
}
