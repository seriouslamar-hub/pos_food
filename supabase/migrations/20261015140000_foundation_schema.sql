-- Phase 1: foundation tables.
-- Branches, staff, roles and permissions, devices, till sessions, PIN attempts,
-- manager overrides, settings and the audit log. RLS policies and grants are in
-- 20261015140200_foundation_rls.sql.

create extension if not exists pgcrypto with schema extensions;

-- Default deny for the anon role: tables, sequences and functions created in
-- public from now on are not granted to anon. Anything public-facing (Phase 15)
-- must be granted explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.staff_role as enum ('admin', 'manager', 'cashier');
create type public.device_type as enum ('till', 'kds', 'pickup', 'kiosk');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  address text,
  phone text,
  timezone text not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  receipt_header text,
  receipt_footer text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.branches.timezone is 'IANA timezone name, e.g. Europe/London. Business days use this timezone.';
comment on column public.branches.currency_code is 'ISO 4217 code. Money columns store integer minor units of this currency.';

create function public.branches_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.currency_code := upper(new.currency_code);
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown timezone "%". Use an IANA name such as Europe/London.', new.timezone
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger branches_validate
  before insert or update of timezone, currency_code on public.branches
  for each row execute function public.branches_validate();

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- staff
-- ---------------------------------------------------------------------------

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  branch_id uuid references public.branches (id),
  full_name text not null check (length(btrim(full_name)) > 0),
  phone text,
  email text,
  role public.staff_role not null,
  -- bcrypt hash of the 4-6 digit till PIN. Only set_staff_pin() writes it, and
  -- the API can't read it (see column grants in the RLS migration).
  pin_hash text,
  has_pin boolean generated always as (pin_hash is not null) stored,
  -- Basis points: 1000 = 10%.
  discount_limit_bps integer not null default 0
    check (discount_limit_bps between 0 and 10000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_branch_required check (role = 'admin' or branch_id is not null)
);

comment on column public.staff.branch_id is 'Null only for admins, who work across all branches.';

create index staff_branch_id_idx on public.staff (branch_id);

create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- role_permissions
-- ---------------------------------------------------------------------------

create table public.role_permissions (
  role public.staff_role not null,
  permission text not null,
  primary key (role, permission),
  constraint role_permissions_known_permission check (permission in (
    'order.create', 'order.void_unsent', 'order.void_sent',
    'order.refund', 'discount.apply', 'discount.override',
    'price.override', 'drawer.no_sale', 'menu.edit',
    'menu.availability', 'staff.manage_cashiers', 'staff.manage_all',
    'shift.open', 'shift.close_own', 'shift.reconcile',
    'day.open_close', 'inventory.manage', 'promo.manage',
    'reports.own_shift', 'reports.branch', 'reports.all',
    'audit.view_branch', 'audit.view_all', 'settings.manage',
    'devices.manage'
  ))
);

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (length(btrim(name)) > 0),
  type public.device_type not null,
  -- Short code such as T1, used as the prefix of offline order numbers (T1-042).
  code text not null check (code ~ '^[A-Z0-9]{1,6}$'),
  station text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_code_unique_per_branch unique (branch_id, code)
);

create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- pos_sessions: a staff member signed in on a till with their PIN
-- ---------------------------------------------------------------------------

create table public.pos_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  device_id uuid not null references public.devices (id),
  staff_id uuid not null references public.staff (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint pos_sessions_end_after_start check (ended_at is null or ended_at >= started_at)
);

-- At most one open session per device.
create unique index pos_sessions_one_open_per_device
  on public.pos_sessions (device_id) where ended_at is null;
create index pos_sessions_branch_started_idx on public.pos_sessions (branch_id, started_at desc);
create index pos_sessions_staff_id_idx on public.pos_sessions (staff_id);

-- ---------------------------------------------------------------------------
-- pin_attempts: used for till PIN lockout
-- ---------------------------------------------------------------------------

create table public.pin_attempts (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.devices (id),
  attempted_at timestamptz not null default now(),
  success boolean not null
);

create index pin_attempts_device_time_idx on public.pin_attempts (device_id, attempted_at desc);

-- ---------------------------------------------------------------------------
-- override_approvals: a manager PIN approving one protected action
-- ---------------------------------------------------------------------------

create table public.override_approvals (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  device_id uuid references public.devices (id),
  requested_by_staff_id uuid references public.staff (id),
  approved_by_staff_id uuid not null references public.staff (id),
  permission text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint override_approvals_expiry check (expires_at > created_at)
);

create index override_approvals_branch_created_idx on public.override_approvals (branch_id, created_at desc);

-- ---------------------------------------------------------------------------
-- settings: global defaults (branch_id null) with per-branch overrides
-- ---------------------------------------------------------------------------

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid references public.branches (id),
  key text not null check (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One global default per key, and one override per branch per key.
  constraint settings_branch_key_unique unique nulls not distinct (branch_id, key)
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_log: insert-only record of every sensitive action
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  branch_id uuid references public.branches (id),
  actor_staff_id uuid references public.staff (id),
  approver_staff_id uuid references public.staff (id),
  device_id uuid references public.devices (id),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  is_offline boolean not null default false,
  created_at timestamptz not null default now()
);

create index audit_log_branch_created_idx on public.audit_log (branch_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);

-- Blocks updates, deletes and truncates for every role, including service_role
-- and postgres. Grants and RLS also deny them; this is the last line of defence.
create function public.audit_log_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is insert-only'
    using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_immutable();
