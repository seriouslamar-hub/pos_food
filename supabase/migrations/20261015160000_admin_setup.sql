-- Phase 3: admin back office.
-- Taxes, payment methods, default settings, the branding storage bucket,
-- device setup codes, staff login linking, device heartbeats and guards on
-- staff changes.

-- ---------------------------------------------------------------------------
-- Audit: record PIN removal (has_pin) now that a PIN can be cleared by the
-- staff guard below. The hash itself is still never logged.
-- ---------------------------------------------------------------------------

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ignored constant text[] := array['pin_hash', 'updated_at', 'last_seen_at'];
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

-- ---------------------------------------------------------------------------
-- Staff guards
-- ---------------------------------------------------------------------------

create function public.staff_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.staff := public.current_staff();
begin
  -- A PIN is only unique among active staff in one branch. When someone is
  -- reactivated or moves branch, their old PIN may clash with a colleague's,
  -- and bcrypt hashes can't be compared with each other, so they need a new
  -- PIN. (set_staff_pin changes only pin_hash, so it never trips this.)
  if tg_op = 'UPDATE'
    and new.pin_hash is not null
    and new.pin_hash is not distinct from old.pin_hash
    and ((new.is_active and not old.is_active) or new.branch_id is distinct from old.branch_id) then
    new.pin_hash := null;
  end if;

  -- Staff other than admins can't hand out more discount than they have.
  if v_actor.id is not null
    and v_actor.role <> 'admin'
    and new.discount_limit_bps > v_actor.discount_limit_bps
    and (tg_op = 'INSERT' or new.discount_limit_bps <> old.discount_limit_bps) then
    raise exception 'Discount limit can''t be higher than your own (%)',
      rtrim(to_char(v_actor.discount_limit_bps / 100.0, 'FM9990.99'), '.') || '%'
      using errcode = '42501';
  end if;

  -- Never leave the system without an active admin.
  if tg_op = 'UPDATE'
    and old.role = 'admin'
    and old.is_active
    and (new.role <> 'admin' or not new.is_active)
    and not exists (
      select 1 from public.staff s
      where s.id <> old.id and s.role = 'admin' and s.is_active
    ) then
    raise exception 'This is the last active admin. Make someone else an admin first.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger staff_guard
  before insert or update on public.staff
  for each row execute function public.staff_guard();

-- Links (or, with null, unlinks) a Supabase Auth login to a staff member.
-- The server creates the login with the service role, then calls this as the
-- signed-in admin, so the audit log records who did it.
create function public.set_staff_login(p_staff_id uuid, p_auth_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_staff public.staff;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can manage staff logins'
      using errcode = '42501';
  end if;

  select * into v_staff from public.staff where id = p_staff_id for update;
  if not found then
    raise exception 'Staff member not found'
      using errcode = 'P0002';
  end if;

  if p_auth_user_id is not null then
    if v_staff.role = 'cashier' then
      raise exception 'Cashiers sign in with a PIN and don''t have a login'
        using errcode = '22023';
    end if;
    if not exists (select 1 from auth.users u where u.id = p_auth_user_id) then
      raise exception 'Login not found'
        using errcode = 'P0002';
    end if;
    if exists (select 1 from public.devices d where d.auth_user_id = p_auth_user_id)
      or exists (
        select 1 from public.staff s
        where s.auth_user_id = p_auth_user_id and s.id <> p_staff_id
      ) then
      raise exception 'That login already belongs to someone else'
        using errcode = '23505';
    end if;
  end if;

  update public.staff set auth_user_id = p_auth_user_id where id = p_staff_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Devices: heartbeat and one-time setup codes
-- ---------------------------------------------------------------------------

-- Called by tills and screens every minute so admins can see what's online.
create function public.device_heartbeat()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.devices
  set last_seen_at = now()
  where id = public.current_device_id();
$$;

-- A one-time code that signs a browser in as a device without anyone signing
-- in on it. Only the server (service role) reads or writes these: there are no
-- policies, and the code itself is stored as a SHA-256 hash.
create table public.device_setup_codes (
  device_id uuid primary key references public.devices (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  created_by_staff_id uuid references public.staff (id),
  created_at timestamptz not null default now()
);

alter table public.device_setup_codes enable row level security;
revoke all on public.device_setup_codes from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Taxes
-- ---------------------------------------------------------------------------

create table public.taxes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  -- Basis points: 1500 = 15%.
  rate_bps integer not null check (rate_bps between 0 and 10000),
  -- Inclusive taxes are already in the menu price; exclusive ones are added on top.
  is_inclusive boolean not null default false,
  -- Menu items have a tax category; every active tax in that category applies,
  -- so one item can carry several taxes.
  tax_category text not null default 'standard' check (tax_category ~ '^[a-z0-9_]+$'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger taxes_set_updated_at
  before update on public.taxes
  for each row execute function public.set_updated_at();

create trigger taxes_audit
  after insert or update or delete on public.taxes
  for each row execute function public.audit_row_change();

-- ---------------------------------------------------------------------------
-- Payment methods
-- ---------------------------------------------------------------------------

create type public.payment_method_type as enum ('cash', 'card', 'mobile_money', 'other');

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  type public.payment_method_type not null,
  name text not null check (length(btrim(name)) > 0),
  is_enabled boolean not null default true,
  requires_reference boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_methods_cash_has_no_reference check (type <> 'cash' or not requires_reference)
);

-- One cash method (the drawer), and no two methods with the same name.
create unique index payment_methods_one_cash on public.payment_methods (type) where type = 'cash';
create unique index payment_methods_name_unique on public.payment_methods (lower(name));

create trigger payment_methods_set_updated_at
  before update on public.payment_methods
  for each row execute function public.set_updated_at();

create trigger payment_methods_audit
  after insert or update or delete on public.payment_methods
  for each row execute function public.audit_row_change();

insert into public.payment_methods (type, name, is_enabled, requires_reference, sort_order) values
  ('cash', 'Cash', true, false, 10),
  ('card', 'Card', true, true, 20),
  ('mobile_money', 'Mobile money', true, true, 30),
  ('other', 'Other', false, false, 40);

-- ---------------------------------------------------------------------------
-- Default settings (branches can override each one)
-- ---------------------------------------------------------------------------

insert into public.settings (branch_id, key, value) values
  (null, 'staff.default_cashier_discount_bps', '0'),
  (null, 'orders.number_reset_daily', 'true'),
  (null, 'receipt.paper_width_mm', '80'),
  (null, 'kds.ticket_warn_minutes', '3'),
  (null, 'kds.ticket_late_minutes', '5')
on conflict on constraint settings_branch_key_unique do nothing;

-- ---------------------------------------------------------------------------
-- Branding bucket: public logos for receipts and screens; only admins upload.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy branding_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and (select public.is_admin()));

create policy branding_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'branding' and (select public.is_admin()))
  with check (bucket_id = 'branding' and (select public.is_admin()));

create policy branding_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding' and (select public.is_admin()));

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------

alter table public.taxes enable row level security;
alter table public.payment_methods enable row level security;

grant select, insert, update on public.taxes to authenticated;
grant select, insert, update on public.payment_methods to authenticated;

-- Tills need taxes and payment methods to price orders and take payments.
create policy taxes_select on public.taxes
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager()) or (select public.is_device()));

create policy taxes_insert on public.taxes
  for insert to authenticated
  with check ((select public.is_admin()));

create policy taxes_update on public.taxes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy payment_methods_select on public.payment_methods
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager()) or (select public.is_device()));

create policy payment_methods_insert on public.payment_methods
  for insert to authenticated
  with check ((select public.is_admin()));

create policy payment_methods_update on public.payment_methods
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke execute on function
  public.staff_guard(),
  public.set_staff_login(uuid, uuid),
  public.device_heartbeat()
from public, anon, authenticated;

grant execute on function
  public.set_staff_login(uuid, uuid),
  public.device_heartbeat()
to authenticated;
