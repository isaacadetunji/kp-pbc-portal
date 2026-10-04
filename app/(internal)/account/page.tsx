import type { Metadata } from "next";
import { AccountSettings } from "@/components/account-settings";
import { PageHeader } from "@/components/page-header";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage() {
  const { profile } = await requireStaff();
  return (
    <div className="space-y-6">
      <PageHeader title="My account" />
      <AccountSettings profile={profile} />
    </div>
  );
}
