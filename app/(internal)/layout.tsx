import { AppSidebar, MobileNav, type NavAccess } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { StageLabelsProvider } from "@/components/stage-labels";
import { UserMenu } from "@/components/user-menu";
import { getPermissions, getStageLabels, requireStaff } from "@/lib/auth";
import { APP_ROLE } from "@/lib/constants";
import { getBrand } from "@/lib/settings";

export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireStaff();
  const [brand, perms, labels] = await Promise.all([getBrand(), getPermissions(), getStageLabels()]);
  // Admin areas are shown by permission (Settings > Access); pages guard themselves too.
  const access: NavAccess = {
    users: perms.manage_users,
    clients: perms.manage_clients,
    checklist: perms.manage_checklist,
    settings: perms.isSuperAdmin,
  };
  return (
    <StageLabelsProvider labels={labels}>
      <div className="flex min-h-dvh">
        <AppSidebar access={access} firm={brand.firm_name} portal={brand.portal_name} logoUrl={brand.logo_url} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur sm:px-6">
            <MobileNav access={access} firm={brand.firm_name} portal={brand.portal_name} logoUrl={brand.logo_url} />
            <div className="flex-1" />
            <NotificationBell userId={profile.id} />
            <UserMenu name={profile.full_name} email={profile.email} role={APP_ROLE[profile.app_role]} />
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </StageLabelsProvider>
  );
}
