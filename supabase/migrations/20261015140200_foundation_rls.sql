-- Phase 1: Row Level Security and grants for the foundation tables.
--
-- Default deny: start with no privileges for anon or authenticated, then grant
-- only what each policy needs. anon gets nothing. Policies apply to
-- authenticated users only (back-office staff and device logins). Helper calls
-- are wrapped in (select ...) so Postgres evaluates them once per statement,
-- not once per row.

-- ---------------------------------------------------------------------------
-- Start from nothing
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter table public.branches enable row level security;
alter table public.staff enable row level security;
alter table public.role_permissions enable row level security;
alter table public.devices enable row level security;
alter table public.pos_sessions enable row level security;
alter table public.pin_attempts enable row level security;
alter table public.override_approvals enable row level security;
alter table public.settings enable row level security;
alter table public.audit_log enable row level security;

-- Helpers that policies call. Internal helpers (current_staff, current_device,
-- staff_has_permission, write_audit) stay private to definer functions.
grant execute on function
  public.current_staff_id(),
  public.current_staff_role(),
  public.current_device_id(),
  public.current_branch_id(),
  public.is_admin(),
  public.is_manager(),
  public.is_device(),
  public.has_permission(text),
  public.can_access_branch(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- branches: admins manage; managers and devices read their own branch
-- ---------------------------------------------------------------------------

grant select, insert, update on public.branches to authenticated;

create policy branches_select on public.branches
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      id = (select public.current_branch_id())
      and ((select public.is_manager()) or (select public.is_device()))
    )
  );

create policy branches_insert on public.branches
  for insert to authenticated
  with check ((select public.is_admin()));

create policy branches_update on public.branches
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- staff: admins manage everyone; managers read their branch and manage its
-- cashiers. pin_hash is never readable or writable through the API (only
-- set_staff_pin writes it), and auth_user_id is linked by a server-only route.
-- Clients must list columns explicitly: select=* fails because of pin_hash.
-- ---------------------------------------------------------------------------

grant select (
  id, auth_user_id, branch_id, full_name, phone, email, role, has_pin,
  discount_limit_bps, is_active, created_at, updated_at
) on public.staff to authenticated;
grant insert (
  id, branch_id, full_name, phone, email, role, discount_limit_bps, is_active
) on public.staff to authenticated;
grant update (
  branch_id, full_name, phone, email, role, discount_limit_bps, is_active
) on public.staff to authenticated;

create policy staff_select on public.staff
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_manager())
      and branch_id = (select public.current_branch_id())
    )
  );

create policy staff_insert on public.staff
  for insert to authenticated
  with check (
    (select public.is_admin())
    or (
      (select public.has_permission('staff.manage_cashiers'))
      and role = 'cashier'
      and branch_id = (select public.current_branch_id())
    )
  );

-- USING limits which rows can be changed; WITH CHECK stops a manager turning
-- a cashier into a manager or moving them to another branch.
create policy staff_update on public.staff
  for update to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.has_permission('staff.manage_cashiers'))
      and role = 'cashier'
      and branch_id = (select public.current_branch_id())
    )
  )
  with check (
    (select public.is_admin())
    or (
      (select public.has_permission('staff.manage_cashiers'))
      and role = 'cashier'
      and branch_id = (select public.current_branch_id())
    )
  );

-- ---------------------------------------------------------------------------
-- role_permissions: readable by staff logins and devices; admins edit, and the
-- admin role can't be edited (it always has every permission).
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.role_permissions to authenticated;

create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (
    (select public.is_admin())
    or (select public.is_manager())
    or (select public.is_device())
  );

create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check ((select public.is_admin()) and role <> 'admin');

create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using ((select public.is_admin()) and role <> 'admin');

-- ---------------------------------------------------------------------------
-- devices: admins manage; managers read their branch; a device reads itself
-- ---------------------------------------------------------------------------

grant select on public.devices to authenticated;
grant insert (id, branch_id, name, type, code, station, is_active) on public.devices to authenticated;
grant update (branch_id, name, type, code, station, is_active) on public.devices to authenticated;

create policy devices_select on public.devices
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_manager())
      and branch_id = (select public.current_branch_id())
    )
    or id = (select public.current_device_id())
  );

create policy devices_insert on public.devices
  for insert to authenticated
  with check ((select public.is_admin()));

create policy devices_update on public.devices
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- pos_sessions, pin_attempts, override_approvals: read-only; RPCs write them
-- ---------------------------------------------------------------------------

grant select on public.pos_sessions to authenticated;

create policy pos_sessions_select on public.pos_sessions
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_manager())
      and branch_id = (select public.current_branch_id())
    )
    or device_id = (select public.current_device_id())
  );

grant select on public.pin_attempts to authenticated;

create policy pin_attempts_select on public.pin_attempts
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_manager())
      and exists (
        select 1
        from public.devices d
        where d.id = pin_attempts.device_id
          and d.branch_id = (select public.current_branch_id())
      )
    )
  );

grant select on public.override_approvals to authenticated;

create policy override_approvals_select on public.override_approvals
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_manager())
      and branch_id = (select public.current_branch_id())
    )
  );

-- ---------------------------------------------------------------------------
-- settings: admins manage; managers and devices read global defaults and
-- their own branch's overrides
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.settings to authenticated;

create policy settings_select on public.settings
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      ((select public.is_manager()) or (select public.is_device()))
      and (branch_id is null or branch_id = (select public.current_branch_id()))
    )
  );

create policy settings_insert on public.settings
  for insert to authenticated
  with check ((select public.is_admin()));

create policy settings_update on public.settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy settings_delete on public.settings
  for delete to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- audit_log: read-only. Admins see everything; managers with
-- audit.view_branch see their branch. Rows are written only by write_audit().
-- ---------------------------------------------------------------------------

grant select on public.audit_log to authenticated;

create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_manager())
      and (select public.has_permission('audit.view_branch'))
      and branch_id = (select public.current_branch_id())
    )
  );
