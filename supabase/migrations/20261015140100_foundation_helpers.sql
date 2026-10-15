-- Phase 1: helper functions used by RLS policies and RPCs, plus audit logging.
--
-- All helpers are security definer so they can read staff and devices without
-- tripping RLS on those tables. They are owned by postgres, which bypasses RLS,
-- so policies that call them never recurse.

-- ---------------------------------------------------------------------------
-- Who is calling?
-- ---------------------------------------------------------------------------

-- The active staff row linked to the signed-in user, if any. Internal only:
-- it includes pin_hash, so the API can't call it.
create function public.current_staff()
returns public.staff
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.staff s
  where s.auth_user_id = auth.uid()
    and s.is_active
  limit 1;
$$;

-- The active device row linked to the signed-in user, if any.
create function public.current_device()
returns public.devices
language sql
stable
security definer
set search_path = ''
as $$
  select d.*
  from public.devices d
  where d.auth_user_id = auth.uid()
    and d.is_active
  limit 1;
$$;

create function public.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (public.current_staff()).id;
$$;

create function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select (public.current_staff()).role;
$$;

create function public.current_device_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select (public.current_device()).id;
$$;

-- Branch of the signed-in staff member or device. Null for admins without a
-- home branch.
create function public.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.current_staff()).branch_id, (public.current_device()).branch_id);
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.current_staff()).role = 'admin', false);
$$;

create function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.current_staff()).role = 'manager', false);
$$;

create function public.is_device()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_device_id() is not null;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

-- True if the staff member is active and their role has the permission.
-- Admins always have every permission (their row is locked on).
create function public.staff_has_permission(p_staff_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff s
    where s.id = p_staff_id
      and s.is_active
      and (
        s.role = 'admin'
        or exists (
          select 1
          from public.role_permissions rp
          where rp.role = s.role
            and rp.permission = p_permission
        )
      )
  );
$$;

-- Permission check for the signed-in staff member.
create function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.staff_has_permission(public.current_staff_id(), p_permission);
$$;

-- Admins reach every branch. Managers and devices reach only their own.
-- Cashiers sign in with a PIN on a device, never with their own login, so a
-- cashier-linked login reaches nothing.
create function public.can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      p_branch_id is not null
      and p_branch_id = public.current_branch_id()
      and (public.is_manager() or public.is_device())
    );
$$;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- Writes one audit_log row. Every RPC that changes something sensitive calls
-- this. Actor, branch and device default to the signed-in caller. Internal
-- only: the API can't call it, so nobody can forge audit entries.
create function public.write_audit(
  p_action text,
  p_entity text,
  p_entity_id text,
  p_before jsonb default null,
  p_after jsonb default null,
  p_reason text default null,
  p_branch_id uuid default null,
  p_approver_staff_id uuid default null,
  p_actor_staff_id uuid default null,
  p_device_id uuid default null,
  p_is_offline boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.audit_log (
    branch_id, actor_staff_id, approver_staff_id, device_id,
    action, entity, entity_id, before, after, reason, is_offline
  )
  values (
    coalesce(p_branch_id, public.current_branch_id()),
    coalesce(p_actor_staff_id, public.current_staff_id()),
    p_approver_staff_id,
    coalesce(p_device_id, public.current_device_id()),
    p_action, p_entity, p_entity_id, p_before, p_after, p_reason,
    coalesce(p_is_offline, false)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Trigger for back-office tables: logs every insert, update and delete with
-- before/after values. Secrets and noisy columns are left out, and updates
-- that only touch those columns aren't logged.
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ignored constant text[] := array['pin_hash', 'has_pin', 'updated_at', 'last_seen_at'];
  v_before jsonb;
  v_after jsonb;
  v_row jsonb;
  v_branch_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_before := to_jsonb(old) - v_ignored;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_after := to_jsonb(new) - v_ignored;
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  v_row := coalesce(v_after, v_before);
  v_branch_id := case
    when tg_table_name = 'branches' then (v_row ->> 'id')::uuid
    else (v_row ->> 'branch_id')::uuid
  end;

  perform public.write_audit(
    p_action => tg_table_name || '.' || lower(tg_op),
    p_entity => tg_table_name,
    -- role_permissions has a composite key, e.g. "cashier:order.create".
    p_entity_id => coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'role', v_row ->> 'permission')),
    p_before => v_before,
    p_after => v_after,
    p_branch_id => v_branch_id
  );

  return null;
end;
$$;

create trigger branches_audit
  after insert or update or delete on public.branches
  for each row execute function public.audit_row_change();

create trigger staff_audit
  after insert or update or delete on public.staff
  for each row execute function public.audit_row_change();

create trigger devices_audit
  after insert or update or delete on public.devices
  for each row execute function public.audit_row_change();

create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.audit_row_change();

create trigger role_permissions_audit
  after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row_change();
