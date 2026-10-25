// Role permissions (shared contract with migration 0007, has_app_permission()).
// Client-safe: no server imports. The database is the security boundary; these
// mirror it so the UI can hide what a user cannot do.
import type { AppRole } from "./types";

export type AppPermission =
  | "manage_users"
  | "manage_clients"
  | "manage_checklist"
  | "view_all_engagements"
  | "create_engagements";

export const APP_PERMISSIONS: { key: AppPermission; label: string; description: string }[] = [
  {
    key: "manage_users",
    label: "Users & access",
    description: "Invite, deactivate and edit firm users and client users (including bulk upload).",
  },
  {
    key: "manage_clients",
    label: "Clients",
    description: "Sync and add clients, group related entities and manage client contacts.",
  },
  {
    key: "manage_checklist",
    label: "Master checklist",
    description: "Edit the standard request library, its categories and default folders.",
  },
  {
    key: "view_all_engagements",
    label: "See every engagement",
    description: "Open any engagement in the firm (read-only unless on its team). Without it: engagements they are on or created.",
  },
  {
    key: "create_engagements",
    label: "Create engagements",
    description: "Start the new-engagement wizard and choose the engagement team.",
  },
];

export type RolePermissions = Record<"admin" | "staff", Record<AppPermission, boolean>>;

/** Same as public.default_role_permissions() */
export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  admin: { manage_users: false, manage_clients: false, manage_checklist: true, view_all_engagements: true, create_engagements: true },
  staff: { manage_users: false, manage_clients: false, manage_checklist: false, view_all_engagements: false, create_engagements: true },
};

/** Merge a stored app_settings('role_permissions') value over the defaults. */
export function normaliseRolePermissions(value: unknown): RolePermissions {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, Record<string, unknown> | undefined>;
  const out = { admin: { ...DEFAULT_ROLE_PERMISSIONS.admin }, staff: { ...DEFAULT_ROLE_PERMISSIONS.staff } };
  for (const role of ["admin", "staff"] as const) {
    for (const p of APP_PERMISSIONS) {
      const x = v[role]?.[p.key];
      if (typeof x === "boolean") out[role][p.key] = x;
    }
  }
  return out;
}

export interface Permissions extends Record<AppPermission, boolean> {
  isSuperAdmin: boolean;
}

export function permissionsFor(role: AppRole | null | undefined, matrix: RolePermissions): Permissions {
  const none = { manage_users: false, manage_clients: false, manage_checklist: false, view_all_engagements: false, create_engagements: false };
  if (role === "super_admin") {
    return { manage_users: true, manage_clients: true, manage_checklist: true, view_all_engagements: true, create_engagements: true, isSuperAdmin: true };
  }
  if (role === "admin" || role === "staff") return { ...matrix[role], isSuperAdmin: false };
  return { ...none, isSuperAdmin: false };
}
