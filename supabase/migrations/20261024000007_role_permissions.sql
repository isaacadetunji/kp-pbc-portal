-- =============================================================================
-- Role permissions (shared contract for later migrations)
-- Super admin always has every permission. Admin and Staff permissions are a
-- matrix stored in app_settings('role_permissions') and edited by a Super admin
-- in Settings > Access. Missing keys fall back to the defaults below.
--
-- Permissions:
--   manage_users          Users & access (invite/deactivate firm users, bulk upload)
--   manage_clients        Clients & groups, client users
--   manage_checklist      Master checklist, categories, default folders
--   view_all_engagements  See every engagement (otherwise: assigned or created only)
--   create_engagements    Start the new-engagement wizard
-- Settings itself is Super admin only and is not part of the matrix.
-- =============================================================================

create or replace function public.default_role_permissions()
returns jsonb language sql immutable as $$
  select '{
    "admin": {"manage_users": false, "manage_clients": false, "manage_checklist": true,
              "view_all_engagements": true, "create_engagements": true},
    "staff": {"manage_users": false, "manage_clients": false, "manage_checklist": false,
              "view_all_engagements": false, "create_engagements": true}
  }'::jsonb
$$;

insert into public.app_settings (key, value)
values ('role_permissions', public.default_role_permissions())
on conflict (key) do nothing;

create or replace function public.has_app_permission(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_app_role()
    when 'super_admin' then true
    when 'admin' then coalesce(
      ((select value from public.app_settings where key = 'role_permissions') -> 'admin' ->> p_perm)::boolean,
      (public.default_role_permissions() -> 'admin' ->> p_perm)::boolean,
      false)
    when 'staff' then coalesce(
      ((select value from public.app_settings where key = 'role_permissions') -> 'staff' ->> p_perm)::boolean,
      (public.default_role_permissions() -> 'staff' ->> p_perm)::boolean,
      false)
    else false
  end
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_app_role() = 'super_admin', false)
$$;

revoke all on function public.has_app_permission(text), public.is_super_admin(), public.default_role_permissions() from public;
grant execute on function public.has_app_permission(text), public.is_super_admin(), public.default_role_permissions() to authenticated, service_role;
