-- Phase 7: business days, shifts and cash control.
--
-- A branch trades inside an open business day. Each cashier opens a shift on
-- their till with a counted float; every order and payment belongs to the
-- shift that took it. Shifts end with a blind count: the cashier counts the
-- drawer without seeing what it should hold, and a manager reviews the
-- variance. Closing the day needs every shift closed and stores the Z report.

create type public.business_day_status as enum ('open', 'closed');
create type public.shift_status as enum ('open', 'pending_review', 'approved', 'flagged');
create type public.cash_movement_type as enum ('drop', 'paid_in', 'paid_out', 'no_sale');

create table public.business_days (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  status public.business_day_status not null default 'open',
  opened_by uuid references public.staff (id),
  opened_at timestamptz not null default now(),
  closed_by uuid references public.staff (id),
  closed_at timestamptz,
  z_report jsonb,
  constraint business_days_one_per_date unique (branch_id, business_date),
  constraint business_days_closed_has_time check ((status = 'closed') = (closed_at is not null))
);

-- At most one open day per branch.
create unique index business_days_one_open on public.business_days (branch_id) where status = 'open';

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  business_day_id uuid not null references public.business_days (id),
  staff_id uuid not null references public.staff (id),
  device_id uuid not null references public.devices (id),
  pos_session_id uuid references public.pos_sessions (id),
  opening_float integer not null check (opening_float >= 0),
  opening_denominations jsonb,
  expected_cash integer,
  counted_cash integer check (counted_cash >= 0),
  counted_denominations jsonb,
  variance integer,
  status public.shift_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.staff (id),
  reviewed_by uuid references public.staff (id),
  reviewed_at timestamptz,
  review_note text,
  constraint shifts_closed_has_time check ((status = 'open') = (closed_at is null)),
  constraint shifts_closed_has_count check (
    status = 'open'
    or (expected_cash is not null and counted_cash is not null and variance = counted_cash - expected_cash)
  )
);

-- One open shift per cashier per till.
create unique index shifts_one_open_per_cashier_device on public.shifts (staff_id, device_id) where status = 'open';
create index shifts_business_day_idx on public.shifts (business_day_id);
create index shifts_branch_opened_idx on public.shifts (branch_id, opened_at desc);

create table public.cash_movements (
  -- Made on the device, so a resend never records the movement twice.
  id uuid primary key,
  shift_id uuid not null references public.shifts (id),
  branch_id uuid not null references public.branches (id),
  type public.cash_movement_type not null,
  amount integer not null check (amount >= 0),
  reason text,
  staff_id uuid not null references public.staff (id),
  approved_by uuid references public.staff (id),
  device_id uuid references public.devices (id),
  pos_session_id uuid references public.pos_sessions (id),
  created_at timestamptz not null default now(),
  client_created_at timestamptz,
  constraint cash_movements_no_sale_amount check ((type = 'no_sale') = (amount = 0)),
  constraint cash_movements_reason check (type = 'drop' or reason is not null)
);
create index cash_movements_shift_idx on public.cash_movements (shift_id);

-- Orders and payments belong to the shift that took them. Required for new
-- rows only (NOT VALID): rows from before shifts existed keep a null shift.
alter table public.orders
  add constraint orders_shift_id_fkey foreign key (shift_id) references public.shifts (id),
  add constraint orders_shift_required check (shift_id is not null or channel <> 'counter') not valid;
alter table public.payments
  add constraint payments_shift_id_fkey foreign key (shift_id) references public.shifts (id),
  add constraint payments_shift_required check (shift_id is not null) not valid;
create index orders_shift_idx on public.orders (shift_id);
create index payments_shift_idx on public.payments (shift_id);

-- ---------------------------------------------------------------------------
-- RLS. Business days are visible to the branch (tills need to know whether
-- the day is open). Shifts and cash movements are for managers only: a till
-- reads its own shift through RPCs, which never return expected cash.
-- All writes go through the RPCs below.
-- ---------------------------------------------------------------------------

alter table public.business_days enable row level security;
alter table public.shifts enable row level security;
alter table public.cash_movements enable row level security;

grant select on public.business_days, public.shifts, public.cash_movements to authenticated;

create policy business_days_select on public.business_days
  for select to authenticated
  using (public.can_access_branch(branch_id));

create policy shifts_select on public.shifts
  for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));

-- ---------------------------------------------------------------------------
-- New settings
-- ---------------------------------------------------------------------------

insert into public.settings (branch_id, key, value) values
  (null, 'cash.variance_alert', '500');

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------

-- The open shift of a cashier on a till. Selling needs one.
create function public.require_open_shift(p_staff_id uuid, p_device_id uuid)
returns public.shifts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
begin
  select * into v_shift
  from public.shifts
  where staff_id = p_staff_id and device_id = p_device_id and status = 'open';
  if v_shift.id is null then
    raise exception 'Open your shift before taking orders or cash' using errcode = 'PS410';
  end if;
  return v_shift;
end;
$$;

-- Notes and coins counted, as {"<value in minor units>": count}. Returns the total.
create function public.count_denominations(p_counts jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_value jsonb;
  v_total bigint := 0;
begin
  if p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'The cash count wasn''t sent correctly' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_counts)
  loop
    if v_key !~ '^[1-9][0-9]{0,9}$'
      or jsonb_typeof(v_value) <> 'number'
      or (v_value #>> '{}') !~ '^[0-9]{1,6}$' then
      raise exception 'The cash count wasn''t sent correctly' using errcode = '22023';
    end if;
    v_total := v_total + v_key::bigint * (v_value #>> '{}')::bigint;
  end loop;
  if v_total > 2000000000 then
    raise exception 'That cash count is too large' using errcode = '22023';
  end if;
  return v_total;
end;
$$;

-- Who is opening or closing the day: a till session (the signed-in staff
-- member, or a manager's approval) or a back-office manager or admin.
create function public.day_control_actor(p_branch_id uuid, p_session_id uuid, p_override_id uuid)
returns table (branch_id uuid, staff_id uuid, device_id uuid, approver_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions;
begin
  if p_session_id is not null then
    v_session := public.require_pos_session(p_session_id);
    branch_id := v_session.branch_id;
    staff_id := v_session.staff_id;
    device_id := v_session.device_id;
    approver_id := null;
    if not public.staff_has_permission(v_session.staff_id, 'day.open_close') then
      if p_override_id is null then
        raise exception 'Only a manager can open or close the business day' using errcode = '42501';
      end if;
      approver_id := public.consume_override(p_override_id, v_session.branch_id, 'day.open_close');
    end if;
  else
    if public.is_device()
      or not public.has_permission('day.open_close')
      or not public.can_access_branch(p_branch_id) then
      raise exception 'Only a manager can open or close the business day' using errcode = '42501';
    end if;
    branch_id := p_branch_id;
    staff_id := public.current_staff_id();
    device_id := null;
    approver_id := null;
  end if;
  return next;
end;
$$;

create function public.business_day_summary(p_day_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id,
    'branch_id', d.branch_id,
    'business_date', d.business_date,
    'status', d.status,
    'opened_at', d.opened_at,
    'opened_by_name', o.full_name,
    'closed_at', d.closed_at,
    'closed_by_name', c.full_name,
    'open_shifts', (select count(*) from public.shifts s where s.business_day_id = d.id and s.status = 'open')
  )
  from public.business_days d
  left join public.staff o on o.id = d.opened_by
  left join public.staff c on c.id = d.closed_by
  where d.id = p_day_id;
$$;

-- A shift as its cashier may see it: never the expected cash or variance.
create function public.shift_summary(p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id,
    'business_day_id', s.business_day_id,
    'business_date', d.business_date,
    'staff_id', s.staff_id,
    'staff_name', st.full_name,
    'device_code', dv.code,
    'status', s.status,
    'opened_at', s.opened_at,
    'closed_at', s.closed_at,
    'opening_float', s.opening_float,
    'counted_cash', s.counted_cash
  )
  from public.shifts s
  join public.business_days d on d.id = s.business_day_id
  join public.staff st on st.id = s.staff_id
  join public.devices dv on dv.id = s.device_id
  where s.id = p_shift_id;
$$;

-- Expected cash in a shift's drawer: float + cash sales (already net of the
-- change given) + paid in − paid out − drops. Phase 8 subtracts cash refunds.
create function public.shift_expected_cash(p_shift_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.opening_float
    + coalesce((select sum(p.amount) from public.payments p where p.shift_id = s.id and p.method = 'cash'), 0)
    + coalesce((
        select sum(case m.type when 'paid_in' then m.amount when 'paid_out' then -m.amount when 'drop' then -m.amount else 0 end)
        from public.cash_movements m
        where m.shift_id = s.id
      ), 0)
  from public.shifts s
  where s.id = p_shift_id;
$$;

-- Cash in and out of a shift's drawer, with expected, counted and variance
-- (for managers and reports).
create function public.shift_cash(p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'opening_float', s.opening_float,
    'cash_sales', coalesce((select sum(p.amount) from public.payments p where p.shift_id = s.id and p.method = 'cash'), 0),
    'paid_in', coalesce(sum(m.amount) filter (where m.type = 'paid_in'), 0),
    'paid_out', coalesce(sum(m.amount) filter (where m.type = 'paid_out'), 0),
    'drops', coalesce(sum(m.amount) filter (where m.type = 'drop'), 0),
    'no_sales', count(m.id) filter (where m.type = 'no_sale'),
    'expected', coalesce(s.expected_cash, public.shift_expected_cash(s.id)),
    'counted', s.counted_cash,
    'variance', s.variance
  )
  from public.shifts s
  left join public.cash_movements m on m.shift_id = s.id
  where s.id = p_shift_id
  group by s.id;
$$;

-- A shift as a manager sees it.
create function public.shift_manager_view(p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.shift_summary(s.id) || jsonb_build_object(
    'cash', public.shift_cash(s.id),
    'counted_denominations', s.counted_denominations,
    'closed_by_name', cb.full_name,
    'reviewed_by_name', rb.full_name,
    'reviewed_at', s.reviewed_at,
    'review_note', s.review_note
  )
  from public.shifts s
  left join public.staff cb on cb.id = s.closed_by
  left join public.staff rb on rb.id = s.reviewed_by
  where s.id = p_shift_id;
$$;

-- Sales figures for a business day, or one shift of it. Orders count where
-- they were taken; payments count in the shift that took them.
create function public.sales_summary(p_day_id uuid, p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with day as (
    select * from public.business_days where id = p_day_id
  ),
  scope_orders as (
    select o.*
    from public.orders o
    join day d on o.branch_id = d.branch_id and o.business_date = d.business_date
    where p_shift_id is null or o.shift_id = p_shift_id
  ),
  sold as (
    select * from scope_orders where paid_at is not null and status <> 'voided'
  ),
  scope_payments as (
    select p.*
    from public.payments p
    join public.shifts s on s.id = p.shift_id
    where s.business_day_id = p_day_id and (p_shift_id is null or p.shift_id = p_shift_id)
  ),
  lines as (
    select i.*
    from public.order_items i
    join sold o on o.id = i.order_id
    where i.parent_item_id is null and i.status <> 'voided'
  )
  select jsonb_build_object(
    'orders', (select count(*) from sold),
    'gross_sales', (select coalesce(sum(subtotal), 0) from sold),
    'discounts', (select coalesce(sum(discount_total), 0) from sold),
    'tax', (select coalesce(sum(tax_total), 0) from sold),
    'net_sales', (select coalesce(sum(total), 0) from sold),
    'average_order', (
      select case when count(*) = 0 then 0 else public.round_div(sum(total)::bigint, count(*)) end from sold
    ),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'name', method_name, 'count', n, 'amount', amount)
        order by amount desc, method_name)
      from (
        select method, method_name, count(*) as n, sum(amount) as amount
        from scope_payments
        group by method, method_name
      ) by_method
    ), '[]'::jsonb),
    'items_sold', (select coalesce(sum(quantity), 0) from lines),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'amount', amount)
        order by quantity desc, name)
      from (
        select name_snapshot as name, sum(quantity) as quantity, sum(line_subtotal) as amount
        from lines
        group by name_snapshot
      ) by_item
    ), '[]'::jsonb),
    'voids', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(i.line_subtotal), 0))
      from public.order_items i
      join scope_orders o on o.id = i.order_id
      where i.parent_item_id is null and i.status = 'voided'
    ),
    'refunds', jsonb_build_object('count', 0, 'amount', 0),
    'unpaid_orders', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total), 0))
      from scope_orders
      where paid_at is null and status <> 'voided'
    )
  );
$$;

-- X report: one shift so far. The cashier's copy leaves out expected cash,
-- counted cash and variance (blind count).
create function public.shift_report(p_shift_id uuid, p_for_manager boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sales_summary(s.business_day_id, s.id) || jsonb_build_object(
    'kind', 'x',
    'generated_at', now(),
    'branch', jsonb_build_object('name', b.name, 'currency_code', b.currency_code, 'timezone', b.timezone),
    'shift', public.shift_summary(s.id),
    'cash', case
      when p_for_manager then public.shift_cash(s.id)
      else public.shift_cash(s.id) - 'expected' - 'counted' - 'variance'
    end
  )
  from public.shifts s
  join public.branches b on b.id = s.branch_id
  where s.id = p_shift_id;
$$;

-- Z report: the whole business day, with every shift's cash.
create function public.day_report(p_day_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.sales_summary(d.id, null) || jsonb_build_object(
    'kind', 'z',
    'generated_at', now(),
    'branch', jsonb_build_object('name', b.name, 'currency_code', b.currency_code, 'timezone', b.timezone),
    'day', public.business_day_summary(d.id),
    'shifts', coalesce((
      select jsonb_agg(public.shift_manager_view(s.id) order by s.opened_at)
      from public.shifts s
      where s.business_day_id = d.id
    ), '[]'::jsonb),
    'cash', (
      select jsonb_build_object(
        'opening_float', coalesce(sum(s.opening_float), 0),
        'expected', coalesce(sum(s.expected_cash), 0),
        'counted', coalesce(sum(s.counted_cash), 0),
        'variance', coalesce(sum(s.variance), 0)
      )
      from public.shifts s
      where s.business_day_id = d.id and s.status <> 'open'
    )
  )
  from public.business_days d
  join public.branches b on b.id = d.branch_id
  where d.id = p_day_id;
$$;

-- ---------------------------------------------------------------------------
-- Business days
-- ---------------------------------------------------------------------------

-- Opens today's business day for a branch: from the back office
-- (p_branch_id) or from a till (p_session_id, with a manager's approval if
-- the signed-in staff member can't). Safe to repeat.
create function public.open_business_day(
  p_branch_id uuid default null,
  p_session_id uuid default null,
  p_override_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_branch public.branches;
  v_today date;
  v_day public.business_days;
  v_action text := 'day.open';
begin
  select * into v_actor from public.day_control_actor(p_branch_id, p_session_id, p_override_id);
  perform pg_advisory_xact_lock(hashtextextended('business_day:' || v_actor.branch_id::text, 0));

  select * into v_branch from public.branches where id = v_actor.branch_id;
  if v_branch.id is null or not v_branch.is_active then
    raise exception 'This branch isn''t trading' using errcode = '22023';
  end if;
  v_today := (now() at time zone v_branch.timezone)::date;

  select * into v_day from public.business_days where branch_id = v_branch.id and status = 'open';
  if v_day.id is not null then
    if v_day.business_date < v_today then
      raise exception 'The business day of % is still open. Close it before opening a new day.',
        to_char(v_day.business_date, 'FMDD Mon YYYY')
        using errcode = '22023';
    end if;
    return public.business_day_summary(v_day.id);
  end if;

  select * into v_day from public.business_days where branch_id = v_branch.id and business_date = v_today;
  if v_day.id is not null then
    -- Today was closed too early: reopen it. Its Z report is made again on close.
    update public.business_days
    set status = 'open', closed_at = null, closed_by = null, z_report = null
    where id = v_day.id;
    v_action := 'day.reopen';
  else
    insert into public.business_days (branch_id, business_date, opened_by)
    values (v_branch.id, v_today, v_actor.staff_id)
    returning * into v_day;
  end if;

  perform public.write_audit(
    p_action => v_action,
    p_entity => 'business_days',
    p_entity_id => v_day.id::text,
    p_after => jsonb_build_object('business_date', v_today),
    p_branch_id => v_branch.id,
    p_actor_staff_id => v_actor.staff_id,
    p_approver_staff_id => v_actor.approver_id,
    p_device_id => v_actor.device_id
  );
  return public.business_day_summary(v_day.id);
end;
$$;

-- Closes the branch's open day once every shift is closed, and stores the
-- Z report. Returns the day with its Z report.
create function public.close_business_day(
  p_branch_id uuid default null,
  p_session_id uuid default null,
  p_override_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_day public.business_days;
  v_open_shifts integer;
  v_report jsonb;
begin
  select * into v_actor from public.day_control_actor(p_branch_id, p_session_id, p_override_id);
  perform pg_advisory_xact_lock(hashtextextended('business_day:' || v_actor.branch_id::text, 0));

  select * into v_day from public.business_days
  where branch_id = v_actor.branch_id and status = 'open'
  for update;
  if v_day.id is null then
    raise exception 'The business day isn''t open' using errcode = '22023';
  end if;

  select count(*) into v_open_shifts from public.shifts where business_day_id = v_day.id and status = 'open';
  if v_open_shifts > 0 then
    raise exception '% still open. Close every shift before closing the day.',
      case when v_open_shifts = 1 then '1 shift is' else v_open_shifts || ' shifts are' end
      using errcode = '22023';
  end if;

  update public.business_days
  set status = 'closed', closed_at = now(), closed_by = v_actor.staff_id
  where id = v_day.id;
  v_report := public.day_report(v_day.id);
  update public.business_days set z_report = v_report where id = v_day.id;

  perform public.write_audit(
    p_action => 'day.close',
    p_entity => 'business_days',
    p_entity_id => v_day.id::text,
    p_after => jsonb_build_object(
      'business_date', v_day.business_date,
      'net_sales', v_report -> 'net_sales',
      'orders', v_report -> 'orders',
      'variance', v_report #> '{cash,variance}'
    ),
    p_branch_id => v_day.branch_id,
    p_actor_staff_id => v_actor.staff_id,
    p_approver_staff_id => v_actor.approver_id,
    p_device_id => v_actor.device_id
  );
  return public.business_day_summary(v_day.id) || jsonb_build_object('z_report', v_report);
end;
$$;

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------

-- What the till needs after a PIN sign-in: is the day open, and does this
-- cashier have an open shift here?
create function public.till_state(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_day_id uuid;
  v_shift_id uuid;
begin
  select id into v_day_id from public.business_days where branch_id = v_session.branch_id and status = 'open';
  select id into v_shift_id from public.shifts
  where staff_id = v_session.staff_id and device_id = v_session.device_id and status = 'open';
  return jsonb_build_object(
    'day', case when v_day_id is null then null else public.business_day_summary(v_day_id) end,
    'shift', case when v_shift_id is null then null else public.shift_summary(v_shift_id) end
  );
end;
$$;

-- Opens the cashier's shift on this till with a counted float. Safe to repeat.
create function public.open_shift(
  p_session_id uuid,
  p_opening_float integer,
  p_denominations jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_day public.business_days;
  v_shift public.shifts;
begin
  if not public.staff_has_permission(v_session.staff_id, 'shift.open') then
    raise exception 'You are not allowed to open a shift' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('shift:' || v_session.staff_id::text || ':' || v_session.device_id::text, 0)
  );

  select * into v_shift from public.shifts
  where staff_id = v_session.staff_id and device_id = v_session.device_id and status = 'open';
  if v_shift.id is not null then
    return public.shift_summary(v_shift.id);
  end if;

  select * into v_day from public.business_days where branch_id = v_session.branch_id and status = 'open';
  if v_day.id is null then
    raise exception 'The business day isn''t open yet. A manager needs to open it first.' using errcode = 'PS411';
  end if;

  if p_opening_float is null or p_opening_float < 0 then
    raise exception 'Count the float in the drawer' using errcode = '22023';
  end if;
  if p_denominations is not null and public.count_denominations(p_denominations) <> p_opening_float then
    raise exception 'The float doesn''t match the notes and coins counted' using errcode = '22023';
  end if;

  insert into public.shifts (
    branch_id, business_day_id, staff_id, device_id, pos_session_id, opening_float, opening_denominations
  )
  values (
    v_session.branch_id, v_day.id, v_session.staff_id, v_session.device_id, v_session.id,
    p_opening_float, p_denominations
  )
  returning * into v_shift;

  perform public.write_audit(
    p_action => 'shift.open',
    p_entity => 'shifts',
    p_entity_id => v_shift.id::text,
    p_after => jsonb_build_object('opening_float', p_opening_float),
    p_branch_id => v_session.branch_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return public.shift_summary(v_shift.id);
end;
$$;

-- Drops, paid in, paid out and no-sales on the cashier's open shift.
-- p_movement: {id, type, amount, reason, override_id, client_created_at}.
-- Paid in/out need shift.reconcile and a no-sale needs drawer.no_sale, from
-- the cashier or a manager's approval. Safe to repeat (same id).
create function public.record_cash_movement(p_session_id uuid, p_movement jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_shift public.shifts;
  v_id uuid;
  v_type public.cash_movement_type;
  v_amount integer;
  v_reason text := nullif(btrim(p_movement ->> 'reason'), '');
  v_override_id uuid;
  v_permission text;
  v_approver_id uuid;
  v_existing public.cash_movements;
  v_labels constant jsonb := '{"drop": "Cash drop", "paid_in": "Paid in", "paid_out": "Paid out", "no_sale": "No sale"}';
begin
  if p_movement is null or jsonb_typeof(p_movement) <> 'object' then
    raise exception 'The cash movement wasn''t sent correctly' using errcode = '22023';
  end if;
  begin
    v_id := (p_movement ->> 'id')::uuid;
    v_type := (p_movement ->> 'type')::public.cash_movement_type;
    v_amount := coalesce((p_movement ->> 'amount')::integer, 0);
    v_override_id := nullif(p_movement ->> 'override_id', '')::uuid;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'The cash movement wasn''t sent correctly' using errcode = '22023';
  end;
  if v_id is null or v_type is null then
    raise exception 'The cash movement wasn''t sent correctly' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  select * into v_existing from public.cash_movements where id = v_id;
  if v_existing.id is not null then
    if v_existing.branch_id <> v_session.branch_id or v_existing.type <> v_type then
      raise exception 'That cash movement id is already in use' using errcode = '23505';
    end if;
    return jsonb_build_object('id', v_existing.id, 'type', v_existing.type, 'amount', v_existing.amount);
  end if;

  v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);

  if v_type = 'no_sale' then
    if v_amount <> 0 then
      raise exception 'A no-sale doesn''t move money' using errcode = '22023';
    end if;
  elsif v_amount <= 0 then
    raise exception 'Enter an amount' using errcode = '22023';
  end if;
  if v_type <> 'drop' and v_reason is null then
    raise exception 'Give a reason' using errcode = '22023';
  end if;

  v_permission := case v_type
    when 'drop' then 'shift.close_own'
    when 'no_sale' then 'drawer.no_sale'
    else 'shift.reconcile'
  end;
  if not public.staff_has_permission(v_session.staff_id, v_permission) then
    if v_override_id is null then
      raise exception '% needs a manager''s approval', v_labels ->> v_type::text using errcode = '42501';
    end if;
    v_approver_id := public.consume_override(v_override_id, v_session.branch_id, v_permission);
  end if;

  insert into public.cash_movements (
    id, shift_id, branch_id, type, amount, reason, staff_id, approved_by, device_id, pos_session_id,
    client_created_at
  )
  values (
    v_id, v_shift.id, v_session.branch_id, v_type, v_amount, v_reason, v_session.staff_id, v_approver_id,
    v_session.device_id, v_session.id,
    case when p_movement ? 'client_created_at' then (p_movement ->> 'client_created_at')::timestamptz end
  );

  perform public.write_audit(
    p_action => 'cash.' || v_type::text,
    p_entity => 'cash_movements',
    p_entity_id => v_id::text,
    p_after => jsonb_build_object('amount', v_amount, 'shift_id', v_shift.id),
    p_reason => v_reason,
    p_branch_id => v_session.branch_id,
    p_approver_staff_id => v_approver_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return jsonb_build_object('id', v_id, 'type', v_type, 'amount', v_amount);
end;
$$;

-- Ends a shift with a blind count: the cashier sends what they counted and
-- never gets the expected cash back. A manager (shift.reconcile) can close
-- another cashier's forgotten shift with p_shift_id. Safe to repeat.
create function public.close_shift(
  p_session_id uuid,
  p_counted_denominations jsonb,
  p_shift_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_shift public.shifts;
  v_counted bigint;
  v_expected bigint;
begin
  if p_shift_id is null then
    v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);
  else
    select * into v_shift from public.shifts where id = p_shift_id;
    if v_shift.id is null or v_shift.branch_id <> v_session.branch_id then
      raise exception 'Shift not found' using errcode = 'P0002';
    end if;
  end if;

  if not public.staff_has_permission(
    v_session.staff_id,
    case when v_shift.staff_id = v_session.staff_id then 'shift.close_own' else 'shift.reconcile' end
  ) then
    raise exception 'You are not allowed to close this shift' using errcode = '42501';
  end if;

  select * into v_shift from public.shifts where id = v_shift.id for update;
  if v_shift.status <> 'open' then
    return public.shift_summary(v_shift.id);
  end if;

  v_counted := public.count_denominations(p_counted_denominations);
  v_expected := public.shift_expected_cash(v_shift.id);

  update public.shifts
  set counted_cash = v_counted,
      counted_denominations = p_counted_denominations,
      expected_cash = v_expected,
      variance = v_counted - v_expected,
      status = 'pending_review',
      closed_at = now(),
      closed_by = v_session.staff_id
  where id = v_shift.id;

  perform public.write_audit(
    p_action => 'shift.close',
    p_entity => 'shifts',
    p_entity_id => v_shift.id::text,
    p_after => jsonb_build_object('counted', v_counted, 'expected', v_expected, 'variance', v_counted - v_expected),
    p_branch_id => v_shift.branch_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return public.shift_summary(v_shift.id);
end;
$$;

-- Open shifts at the branch, for a manager on a till who has to count and
-- close a forgotten one before closing the day. No expected cash: those
-- drawers are counted blind too.
create function public.list_open_shifts(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
begin
  if not public.staff_has_permission(v_session.staff_id, 'shift.reconcile') then
    raise exception 'Only a manager can see other cashiers'' shifts' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public.shift_summary(s.id) order by s.opened_at)
    from public.shifts s
    where s.branch_id = v_session.branch_id and s.status = 'open'
  ), '[]'::jsonb);
end;
$$;

-- A manager approves or flags a closed shift from the back office.
create function public.review_shift(p_shift_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts;
  v_note text := nullif(btrim(p_note), '');
begin
  select * into v_shift from public.shifts where id = p_shift_id for update;
  if v_shift.id is null
    or public.is_device()
    or not public.has_permission('shift.reconcile')
    or not public.can_access_branch(v_shift.branch_id) then
    raise exception 'You can''t review this shift' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'flagged') then
    raise exception 'Choose approve or flag' using errcode = '22023';
  end if;
  if v_shift.status = 'open' then
    raise exception 'The shift is still open' using errcode = '22023';
  end if;
  if p_status = 'flagged' and v_note is null then
    raise exception 'Add a note saying why the shift is flagged' using errcode = '22023';
  end if;

  update public.shifts
  set status = p_status::public.shift_status,
      review_note = v_note,
      reviewed_by = public.current_staff_id(),
      reviewed_at = now()
  where id = p_shift_id;

  perform public.write_audit(
    p_action => 'shift.review',
    p_entity => 'shifts',
    p_entity_id => p_shift_id::text,
    p_before => jsonb_build_object('status', v_shift.status),
    p_after => jsonb_build_object('status', p_status, 'variance', v_shift.variance),
    p_reason => v_note,
    p_branch_id => v_shift.branch_id
  );
  return public.shift_manager_view(p_shift_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- X report for the cashier's open shift (no expected cash).
create function public.x_report(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_shift public.shifts;
begin
  if not public.staff_has_permission(v_session.staff_id, 'reports.own_shift') then
    raise exception 'You are not allowed to see shift reports' using errcode = '42501';
  end if;
  v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);
  return public.shift_report(v_shift.id, false);
end;
$$;

-- A business day for the back office: the stored Z report once closed (the
-- live figures while open), and every shift with its current review status.
create function public.get_day_report(p_day_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day public.business_days;
begin
  select * into v_day from public.business_days where id = p_day_id;
  if v_day.id is null
    or public.is_device()
    or not public.has_permission('reports.branch')
    or not public.can_access_branch(v_day.branch_id) then
    raise exception 'Business day not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'day', public.business_day_summary(v_day.id),
    'report', coalesce(v_day.z_report, public.day_report(v_day.id)),
    'shifts', coalesce((
      select jsonb_agg(public.shift_manager_view(s.id) order by s.opened_at)
      from public.shifts s
      where s.business_day_id = v_day.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders and payments now need an open shift (and so an open day).
-- submit_order: as in Phase 5, plus the shift and the day's business date.
-- ---------------------------------------------------------------------------

create or replace function public.submit_order(p_session_id uuid, p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_shift public.shifts;
  v_branch public.branches;
  v_order_id uuid;
  v_existing public.orders;
  v_order_type public.order_type;
  v_channel public.order_channel;
  v_phone text := nullif(btrim(p_order ->> 'customer_phone'), '');
  v_address text := nullif(btrim(p_order ->> 'delivery_address'), '');
  v_business_date date;
  v_reset_daily boolean;
  v_number integer;
  v_order_number text;
  v_line jsonb;
  v_line_index bigint;
  v_line_id uuid;
  v_quantity integer;
  v_item public.menu_items;
  v_price integer;
  v_available boolean;
  v_mods jsonb;
  v_combo jsonb;
  v_component jsonb;
  v_component_index integer;
  v_unit integer;
  v_gross integer;
  v_tax jsonb;
  v_subtotal bigint := 0;
  v_tax_total bigint := 0;
  v_total bigint := 0;
  v_line_count integer;
begin
  if not public.staff_has_permission(v_session.staff_id, 'order.create') then
    raise exception 'You are not allowed to take orders' using errcode = '42501';
  end if;
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'The order wasn''t sent correctly' using errcode = '22023';
  end if;

  begin
    v_order_id := (p_order ->> 'id')::uuid;
  exception when invalid_text_representation then
    v_order_id := null;
  end;
  if v_order_id is null then
    raise exception 'The order needs an id' using errcode = '22023';
  end if;

  -- Idempotency: the same order sent twice (e.g. after a network failure)
  -- returns what was saved. The lock serialises concurrent retries.
  perform pg_advisory_xact_lock(hashtextextended(v_order_id::text, 0));
  select * into v_existing from public.orders where id = v_order_id;
  if found then
    if v_existing.branch_id <> v_session.branch_id then
      raise exception 'That order id is already in use' using errcode = '23505';
    end if;
    return public.order_summary(v_order_id);
  end if;

  -- New orders belong to the cashier's open shift and its business day.
  v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);
  select business_date into v_business_date from public.business_days where id = v_shift.business_day_id;

  begin
    v_order_type := coalesce(nullif(p_order ->> 'order_type', ''), 'takeaway')::public.order_type;
    v_channel := coalesce(nullif(p_order ->> 'channel', ''), 'counter')::public.order_channel;
  exception when invalid_text_representation then
    raise exception 'Unknown order type' using errcode = '22023';
  end;
  if v_order_type = 'delivery' and (v_phone is null or v_address is null) then
    raise exception 'Delivery orders need the customer''s phone number and address' using errcode = '22023';
  end if;

  if jsonb_typeof(p_order -> 'lines') is distinct from 'array' then
    raise exception 'The order has no items' using errcode = '22023';
  end if;
  v_line_count := jsonb_array_length(p_order -> 'lines');
  if v_line_count = 0 then
    raise exception 'The order has no items' using errcode = '22023';
  end if;
  if v_line_count > 200 then
    raise exception 'An order can have at most 200 lines' using errcode = '22023';
  end if;

  select * into v_branch from public.branches where id = v_session.branch_id;
  if not v_branch.is_active then
    raise exception 'This branch isn''t trading' using errcode = '22023';
  end if;

  -- Order number: the branch's next number for the day, e.g. 042.
  select coalesce((s.value #>> '{}')::boolean, true) into v_reset_daily
  from public.settings s
  where s.key = 'orders.number_reset_daily' and (s.branch_id = v_branch.id or s.branch_id is null)
  order by s.branch_id nulls last
  limit 1;
  insert into public.order_counters as c (branch_id, counter_date, last_number)
  values (v_branch.id, case when coalesce(v_reset_daily, true) then v_business_date else date '2000-01-01' end, 1)
  on conflict (branch_id, counter_date) do update set last_number = c.last_number + 1
  returning last_number into v_number;
  v_order_number := lpad(v_number::text, 3, '0');

  insert into public.orders (
    id, branch_id, device_id, staff_id, pos_session_id, shift_id, business_date, order_number,
    channel, order_type, status, customer_phone, delivery_address, notes, client_created_at
  )
  values (
    v_order_id, v_branch.id, v_session.device_id, v_session.staff_id, v_session.id, v_shift.id, v_business_date,
    v_order_number, v_channel, v_order_type, 'open', v_phone, v_address,
    nullif(btrim(p_order ->> 'notes'), ''),
    case when p_order ? 'client_created_at' then (p_order ->> 'client_created_at')::timestamptz end
  );

  for v_line, v_line_index in
    select value, ordinality from jsonb_array_elements(p_order -> 'lines') with ordinality
  loop
    begin
      v_line_id := (v_line ->> 'id')::uuid;
      v_quantity := (v_line ->> 'quantity')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'An item in the order wasn''t sent correctly' using errcode = '22023';
    end;
    if v_line_id is null then
      raise exception 'Every item needs an id' using errcode = '22023';
    end if;
    if v_quantity is null or v_quantity < 1 or v_quantity > 999 then
      raise exception 'Quantities must be between 1 and 999' using errcode = '22023';
    end if;

    begin
      select * into v_item from public.menu_items
      where id = nullif(v_line ->> 'menu_item_id', '')::uuid and is_active;
    exception when invalid_text_representation then
      v_item := null;
    end;
    if v_item.id is null then
      raise exception 'An item in the order is no longer on the menu' using errcode = '22023';
    end if;

    select coalesce(bmi.price_override, v_item.base_price), coalesce(bmi.is_available, true)
    into v_price, v_available
    from (select 1) as one
    left join public.branch_menu_items bmi
      on bmi.branch_id = v_branch.id and bmi.menu_item_id = v_item.id;
    if not v_available then
      raise exception '% is out of stock', v_item.name using errcode = '22023';
    end if;

    v_mods := public.order_line_modifiers(v_item.id, v_line -> 'modifier_ids', v_branch.id);
    v_unit := v_price + (v_mods ->> 'delta')::integer;

    if v_item.type = 'combo' then
      v_combo := public.order_line_combo(v_item.id, v_line -> 'combo', v_branch.id);
      v_unit := v_unit + (v_combo ->> 'extra')::integer;
    elsif jsonb_typeof(v_line -> 'combo') = 'array' and jsonb_array_length(v_line -> 'combo') > 0 then
      raise exception '% isn''t a meal, so it has no meal choices', v_item.name using errcode = '22023';
    else
      v_combo := null;
    end if;

    v_unit := greatest(v_unit, 0);
    v_gross := v_unit * v_quantity;
    v_tax := public.line_taxes(v_gross, v_item.tax_category);

    insert into public.order_items (
      id, order_id, branch_id, menu_item_id, name_snapshot, short_name_snapshot, quantity,
      unit_price, modifiers, line_subtotal, line_discount, line_tax, line_total, taxes,
      kds_station_id, notes, sort_order
    )
    values (
      v_line_id, v_order_id, v_branch.id, v_item.id, v_item.name, coalesce(v_item.short_name, v_item.name),
      v_quantity, v_unit, v_mods -> 'snapshot', v_gross, 0, (v_tax ->> 'tax')::integer,
      (v_tax ->> 'total')::integer, v_tax -> 'taxes', v_item.kds_station_id,
      nullif(btrim(v_line ->> 'notes'), ''), v_line_index * 10
    );

    if v_combo is not null then
      v_component_index := 0;
      for v_component in select value from jsonb_array_elements(v_combo -> 'components')
      loop
        v_component_index := v_component_index + 1;
        insert into public.order_items (
          id, order_id, branch_id, parent_item_id, menu_item_id, name_snapshot, short_name_snapshot,
          combo_slot_name, quantity, unit_price, modifiers, kds_station_id, sort_order
        )
        values (
          (v_component ->> 'id')::uuid, v_order_id, v_branch.id, v_line_id,
          (v_component ->> 'menu_item_id')::uuid, v_component ->> 'name', v_component ->> 'short_name',
          v_component ->> 'slot_name', v_quantity, 0, v_component -> 'modifiers',
          nullif(v_component ->> 'kds_station_id', '')::uuid, v_line_index * 10 + v_component_index
        );
      end loop;
    end if;

    v_subtotal := v_subtotal + v_gross;
    v_tax_total := v_tax_total + (v_tax ->> 'tax')::bigint;
    v_total := v_total + (v_tax ->> 'total')::bigint;
  end loop;

  update public.orders
  set subtotal = v_subtotal, tax_total = v_tax_total, total = v_total
  where id = v_order_id;

  perform public.write_audit(
    p_action => 'order.create',
    p_entity => 'orders',
    p_entity_id => v_order_id::text,
    p_after => jsonb_build_object('order_number', v_order_number, 'total', v_total, 'lines', v_line_count),
    p_branch_id => v_branch.id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );

  return public.order_summary(v_order_id);
end;
$$;

-- record_payments: as in Phase 6, but payments go to the shift of the till
-- that takes them (a pay-later order can be paid at another till), which is
-- where the cash ends up.
create or replace function public.record_payments(p_session_id uuid, p_order_id uuid, p_payments jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_shift public.shifts;
  v_order public.orders;
  v_ids uuid[];
  v_existing integer;
  v_payment jsonb;
  v_method public.payment_methods;
  v_amount integer;
  v_tendered integer;
  v_reference text;
  v_sum bigint := 0;
  v_summary jsonb := '[]'::jsonb;
begin
  if not public.staff_has_permission(v_session.staff_id, 'order.create') then
    raise exception 'You are not allowed to take payments' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 1));
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.branch_id <> v_session.branch_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if p_payments is null or jsonb_typeof(p_payments) <> 'array' then
    raise exception 'The payments weren''t sent correctly' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payments) > 10 then
    raise exception 'An order can have at most 10 payments' using errcode = '22023';
  end if;

  begin
    select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_ids from jsonb_array_elements(p_payments) e;
  exception when invalid_text_representation then
    raise exception 'Each payment needs an id' using errcode = '22023';
  end;
  if exists (select 1 from unnest(v_ids) as x where x is null) then
    raise exception 'Each payment needs an id' using errcode = '22023';
  end if;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x) then
    raise exception 'A payment was sent twice' using errcode = '22023';
  end if;

  -- Idempotency: the same payments sent again (e.g. after a dropped
  -- connection) return the saved order without charging twice.
  select count(*) into v_existing from public.payments where id = any (v_ids);
  if v_existing > 0 then
    if v_existing = cardinality(v_ids)
      and not exists (select 1 from public.payments where id = any (v_ids) and order_id <> p_order_id) then
      return public.order_summary(p_order_id);
    end if;
    raise exception 'These payments don''t match what was saved' using errcode = '23505';
  end if;

  v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);

  if v_order.status = 'voided' then
    raise exception 'This order was voided' using errcode = '22023';
  end if;
  if v_order.paid_at is not null then
    raise exception 'This order is already paid' using errcode = '22023';
  end if;
  if cardinality(v_ids) = 0 and v_order.total > 0 then
    raise exception 'Add a payment' using errcode = '22023';
  end if;

  for v_payment in select value from jsonb_array_elements(p_payments)
  loop
    begin
      select * into v_method from public.payment_methods
      where id = nullif(v_payment ->> 'payment_method_id', '')::uuid;
      v_amount := (v_payment ->> 'amount')::integer;
      v_tendered := nullif(v_payment ->> 'tendered', '')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'A payment wasn''t sent correctly' using errcode = '22023';
    end;
    if v_method.id is null or not v_method.is_enabled then
      raise exception 'That payment method isn''t available' using errcode = '22023';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Payment amounts must be more than zero' using errcode = '22023';
    end if;

    v_reference := nullif(btrim(v_payment ->> 'reference'), '');
    if v_method.requires_reference and v_reference is null then
      raise exception '% needs a reference number', v_method.name using errcode = '22023';
    end if;

    if v_method.type = 'cash' then
      v_tendered := coalesce(v_tendered, v_amount);
      if v_tendered < v_amount then
        raise exception 'Cash handed over can''t be less than the amount paid' using errcode = '22023';
      end if;
    else
      if v_tendered is not null and v_tendered <> v_amount then
        raise exception 'Only cash can be over-tendered' using errcode = '22023';
      end if;
      v_tendered := null;
    end if;

    v_sum := v_sum + v_amount;
    insert into public.payments (
      id, order_id, branch_id, shift_id, payment_method_id, method, method_name, amount, tendered,
      change_given, reference, staff_id, device_id, pos_session_id, client_created_at
    )
    values (
      (v_payment ->> 'id')::uuid, v_order.id, v_order.branch_id, v_shift.id, v_method.id, v_method.type,
      v_method.name, v_amount, v_tendered,
      case when v_tendered is null then null else v_tendered - v_amount end,
      v_reference, v_session.staff_id, v_session.device_id, v_session.id,
      case when v_payment ? 'client_created_at' then (v_payment ->> 'client_created_at')::timestamptz end
    );
    v_summary := v_summary || jsonb_build_object('method', v_method.name, 'amount', v_amount);
  end loop;

  if v_sum <> v_order.total then
    raise exception 'The payments don''t add up to the order total' using errcode = '22023';
  end if;

  update public.orders
  set paid_at = now(),
      status = case when status = 'open' then 'paid'::public.order_status else status end
  where id = v_order.id;
  perform public.send_order_lines_to_kitchen(v_order.id);

  perform public.write_audit(
    p_action => 'order.paid',
    p_entity => 'orders',
    p_entity_id => v_order.id::text,
    p_after => jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total, 'payments', v_summary),
    p_branch_id => v_order.branch_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );

  return public.order_summary(v_order.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.require_open_shift(uuid, uuid),
  public.count_denominations(jsonb),
  public.day_control_actor(uuid, uuid, uuid),
  public.business_day_summary(uuid),
  public.shift_summary(uuid),
  public.shift_expected_cash(uuid),
  public.shift_cash(uuid),
  public.shift_manager_view(uuid),
  public.sales_summary(uuid, uuid),
  public.shift_report(uuid, boolean),
  public.day_report(uuid),
  public.open_business_day(uuid, uuid, uuid),
  public.close_business_day(uuid, uuid, uuid),
  public.till_state(uuid),
  public.open_shift(uuid, integer, jsonb),
  public.record_cash_movement(uuid, jsonb),
  public.close_shift(uuid, jsonb, uuid),
  public.list_open_shifts(uuid),
  public.review_shift(uuid, text, text),
  public.x_report(uuid),
  public.get_day_report(uuid)
from public, anon, authenticated;

grant execute on function
  public.open_business_day(uuid, uuid, uuid),
  public.close_business_day(uuid, uuid, uuid),
  public.till_state(uuid),
  public.open_shift(uuid, integer, jsonb),
  public.record_cash_movement(uuid, jsonb),
  public.close_shift(uuid, jsonb, uuid),
  public.list_open_shifts(uuid),
  public.review_shift(uuid, text, text),
  public.x_report(uuid),
  public.get_day_report(uuid)
to authenticated;
