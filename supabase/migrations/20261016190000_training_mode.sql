-- Phase 14: training mode.
--
-- An admin can switch a device into training. It then belongs to its
-- branch's training twin ("Main branch (training)", made the first time),
-- so practice sales, shifts, cash and stock land there and never in the
-- real branch's reports. The branch's staff still sign in with their own
-- PINs. Practice sales don't earn or spend loyalty points or use up
-- coupons. Switching back returns the device to its branch.

alter table public.branches
  add column training_for uuid unique references public.branches (id),
  add constraint branches_training_not_self check (training_for <> id);
alter table public.devices
  add column home_branch_id uuid references public.branches (id);
create index devices_home_branch_idx on public.devices (home_branch_id);

create function public.is_training_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.branches where id = p_branch_id and training_for is not null);
$$;

-- Whose staff work at a branch: a training branch's are its real branch's.
create function public.staff_branch_for(p_branch_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select training_for from public.branches where id = p_branch_id), p_branch_id);
$$;

create or replace function public.find_staff_by_pin(p_branch_id uuid, p_pin text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.staff s
  where p_pin ~ '^[0-9]{4,6}$'
    and s.is_active
    and s.pin_hash is not null
    and (s.branch_id = public.staff_branch_for(p_branch_id) or (s.branch_id is null and s.role = 'admin'))
    and s.pin_hash = extensions.crypt(p_pin, s.pin_hash)
  limit 1;
$$;

-- Switches a device into or out of training (admins). Not while it has an
-- open shift; its till sessions end.
create function public.set_device_training(p_device_id uuid, p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_branch public.branches;
  v_twin uuid;
  v_target uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can switch training mode' using errcode = '42501';
  end if;
  select * into v_device from public.devices where id = p_device_id for update;
  if v_device.id is null then
    raise exception 'Device not found' using errcode = 'P0002';
  end if;
  if (v_device.home_branch_id is not null) = p_on then
    return jsonb_build_object('id', v_device.id, 'branch_id', v_device.branch_id, 'training', p_on);
  end if;
  if exists (select 1 from public.shifts where device_id = p_device_id and status = 'open') then
    raise exception 'Close the open shift on % first', v_device.name using errcode = '22023';
  end if;

  if p_on then
    select * into v_branch from public.branches where id = v_device.branch_id;
    select id into v_twin from public.branches where training_for = v_branch.id;
    if v_twin is null then
      insert into public.branches (name, address, phone, timezone, currency_code, receipt_header, receipt_footer,
        logo_url, training_for)
      values (left(v_branch.name, 60) || ' (training)', v_branch.address, v_branch.phone, v_branch.timezone,
        v_branch.currency_code, 'TRAINING - NOT A REAL SALE', v_branch.receipt_footer, v_branch.logo_url, v_branch.id)
      returning id into v_twin;
    end if;
    v_target := v_twin;
  else
    v_target := v_device.home_branch_id;
  end if;
  if exists (select 1 from public.devices where branch_id = v_target and code = v_device.code and id <> v_device.id) then
    raise exception 'Another device there already uses code %', v_device.code using errcode = '23505';
  end if;

  update public.pos_sessions set ended_at = now() where device_id = p_device_id and ended_at is null;
  update public.devices
  set branch_id = v_target,
      home_branch_id = case when p_on then v_device.branch_id end
  where id = p_device_id;
  perform public.write_audit(
    p_action => case when p_on then 'device.training_on' else 'device.training_off' end,
    p_entity => 'devices',
    p_entity_id => p_device_id::text,
    p_before => jsonb_build_object('branch_id', v_device.branch_id),
    p_after => jsonb_build_object('branch_id', v_target),
    p_branch_id => coalesce(v_device.home_branch_id, v_device.branch_id)
  );
  return jsonb_build_object('id', v_device.id, 'branch_id', v_target, 'training', p_on);
end;
$$;

-- ---------------------------------------------------------------------------
-- Earlier functions, aware of training branches
-- ---------------------------------------------------------------------------

create or replace function public.get_offline_bundle()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
begin
  select * into v_device from public.devices
  where id = public.current_device_id() and is_active and type = 'till';
  if v_device.id is null then
    raise exception 'Only a till can do this' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'branch_id', v_device.branch_id,
    -- The highest offline number this till has used on the open business
    -- day, so its counter never goes back (e.g. after the browser's data
    -- was cleared).
    'offline_numbers', (
      select jsonb_build_object(
        'business_date', d.business_date,
        'last', coalesce((
          select max(nullif(regexp_replace(o.order_number, '^.*-', ''), '')::integer)
          from public.orders o
          where o.branch_id = d.branch_id and o.business_date = d.business_date
            and o.order_number like upper(regexp_replace(v_device.code, '[^A-Za-z0-9]', '', 'g')) || '-%'
        ), 0)
      )
      from public.business_days d
      where d.branch_id = v_device.branch_id and d.status = 'open'
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'full_name', s.full_name, 'role', s.role, 'pin_hash', s.pin_hash,
        'discount_limit_bps', s.discount_limit_bps, 'permissions', to_jsonb(public.staff_permissions(s.id))
      ) order by s.full_name)
      from public.staff s
      where s.is_active and s.pin_hash is not null
        and (s.branch_id = public.staff_branch_for(v_device.branch_id) or s.role = 'admin')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.start_offline_session(p_session_id uuid, p_staff_id uuid, p_started_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_staff public.staff;
  v_existing public.pos_sessions;
  v_started timestamptz := least(coalesce(p_started_at, now()), now());
begin
  select * into v_device from public.devices
  where id = public.current_device_id() and is_active and type = 'till';
  if v_device.id is null then
    raise exception 'Only a till can do this' using errcode = '42501';
  end if;
  select * into v_existing from public.pos_sessions where id = p_session_id;
  if v_existing.id is not null then
    if v_existing.device_id <> v_device.id or v_existing.staff_id <> p_staff_id then
      raise exception 'That session id is already in use' using errcode = '23505';
    end if;
    return jsonb_build_object('ok', true, 'session_id', p_session_id);
  end if;
  select * into v_staff from public.staff
  where id = p_staff_id and is_active and (branch_id = public.staff_branch_for(v_device.branch_id) or role = 'admin');
  if v_staff.id is null then
    raise exception 'That person can''t use this till' using errcode = '42501';
  end if;

  insert into public.pos_sessions (id, branch_id, device_id, staff_id, started_at, ended_at, is_offline)
  values (p_session_id, v_device.branch_id, v_device.id, v_staff.id, v_started, v_started, true);
  perform public.write_audit(
    p_action => 'pos_session.start',
    p_entity => 'pos_sessions',
    p_entity_id => p_session_id::text,
    p_after => jsonb_build_object('staff', v_staff.full_name, 'started_at', v_started),
    p_branch_id => v_device.branch_id,
    p_actor_staff_id => v_staff.id,
    p_device_id => v_device.id,
    p_is_offline => true
  );
  return jsonb_build_object('ok', true, 'session_id', p_session_id);
end;
$$;

create or replace function public.record_offline_override(
  p_override_id uuid,
  p_session_id uuid,
  p_approver_staff_id uuid,
  p_permission text,
  p_reason text default null,
  p_approved_at timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_approver public.staff;
begin
  if exists (select 1 from public.override_approvals where id = p_override_id) then
    return jsonb_build_object('ok', true, 'override_id', p_override_id);
  end if;
  select * into v_approver from public.staff
  where id = p_approver_staff_id and is_active and (branch_id = public.staff_branch_for(v_session.branch_id) or role = 'admin');
  if v_approver.id is null or not public.staff_has_permission(v_approver.id, p_permission) then
    raise exception 'That approval can''t be accepted: the approver can''t do this' using errcode = '42501';
  end if;
  insert into public.override_approvals (
    id, branch_id, device_id, requested_by_staff_id, approved_by_staff_id, permission, created_at, expires_at
  )
  values (
    p_override_id, v_session.branch_id, v_session.device_id, v_session.staff_id, v_approver.id, p_permission,
    now(), now() + interval '10 minutes'
  );
  perform public.write_audit(
    p_action => 'override.approved',
    p_entity => 'override_approvals',
    p_entity_id => p_override_id::text,
    p_after => jsonb_build_object('permission', p_permission, 'approved_at', p_approved_at),
    p_reason => nullif(btrim(p_reason), ''),
    p_branch_id => v_session.branch_id,
    p_approver_staff_id => v_approver.id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id,
    p_is_offline => true
  );
  return jsonb_build_object('ok', true, 'override_id', p_override_id);
end;
$$;

create or replace function public.apply_promotions(p_order_id uuid, p_coupon text, p_at timestamptz, p_strict boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_local timestamp;
  v_coupon text := nullif(upper(btrim(coalesce(p_coupon, ''))), '');
  v_coupon_found boolean := false;
  v_coupon_used boolean := false;
  v_applied integer := 0;
  v_order_left bigint;
  v_lines jsonb;
  v_discounts jsonb;
  v_amount bigint;
  p public.promotions;
begin
  select * into v_order from public.orders where id = p_order_id;
  select (p_at at time zone b.timezone) into v_local from public.branches b where b.id = v_order.branch_id;

  for p in
    select * from public.promotions pr
    where public.promotion_runs(pr, v_order.branch_id, v_local)
      and (cardinality(pr.channels) = 0 or v_order.channel::text = any (pr.channels))
      and (cardinality(pr.order_types) = 0 or v_order.order_type::text = any (pr.order_types))
      and (pr.coupon_code is null or pr.coupon_code = v_coupon)
    order by pr.priority desc, pr.created_at, pr.id
    for update
  loop
    if p.coupon_code is not null then
      v_coupon_found := true;
    end if;
    -- A promotion that doesn't stack can't join others, and none join it.
    exit when v_applied > 0 and exists (
      select 1 from public.promotion_redemptions r join public.promotions x on x.id = r.promotion_id
      where r.order_id = p_order_id and not x.stackable
    );
    continue when v_applied > 0 and not p.stackable;
    continue when p.max_uses is not null
      and (select count(*) from public.promotion_redemptions r join public.branches rb on rb.id = r.branch_id
          where r.promotion_id = p.id and rb.training_for is null) >= p.max_uses;
    continue when p.max_uses_per_customer is not null and (
      v_order.customer_id is null
      or (select count(*) from public.promotion_redemptions
          where promotion_id = p.id and customer_id = v_order.customer_id) >= p.max_uses_per_customer
    );
    v_lines := public.order_promo_lines(p_order_id);
    select coalesce(sum((l ->> 'left')::bigint), 0) into v_order_left from jsonb_array_elements(v_lines) l;
    continue when v_order_left < p.min_spend;

    v_discounts := public.promotion_line_discounts(p, v_lines);
    select coalesce(sum((d ->> 'amount')::bigint), 0) into v_amount from jsonb_array_elements(v_discounts) d;
    continue when v_amount <= 0;

    update public.order_items li
    set promo_discount = li.promo_discount + (d ->> 'amount')::integer,
        line_discount = li.line_discount + (d ->> 'amount')::integer
    from jsonb_array_elements(v_discounts) d
    where li.id = (d ->> 'id')::uuid;
    insert into public.promotion_redemptions (promotion_id, order_id, branch_id, customer_id, amount)
    values (p.id, p_order_id, v_order.branch_id, v_order.customer_id, v_amount);
    v_applied := v_applied + 1;
    if p.coupon_code is not null then
      v_coupon_used := true;
    end if;
  end loop;

  if v_coupon is not null and not v_coupon_used and p_strict then
    if v_coupon_found then
      raise exception 'That coupon can''t be used on this order' using errcode = '22023';
    end if;
    raise exception 'That coupon isn''t valid' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.check_coupon(p_session_id uuid, p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_local timestamp;
  p public.promotions;
begin
  select now() at time zone timezone into v_local from public.branches where id = v_session.branch_id;
  select * into p from public.promotions where coupon_code = upper(btrim(coalesce(p_code, '')));
  if p.id is null or not public.promotion_runs(p, v_session.branch_id, v_local) then
    raise exception 'That coupon isn''t valid' using errcode = 'P0002';
  end if;
  if p.max_uses is not null and (select count(*) from public.promotion_redemptions r join public.branches rb on rb.id = r.branch_id
          where r.promotion_id = p.id and rb.training_for is null) >= p.max_uses then
    raise exception 'That coupon has been used up' using errcode = '22023';
  end if;
  return public.promotion_public(p);
end;
$$;

create or replace function public.report_branches(p_branch_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branches uuid[];
begin
  if public.is_device() or public.current_staff_id() is null then
    raise exception 'You can''t see reports' using errcode = '42501';
  end if;
  if p_branch_id is null then
    if not public.has_permission('reports.all') then
      raise exception 'You can only see your own branch''s reports' using errcode = '42501';
    end if;
    select coalesce(array_agg(id order by name), '{}') into v_branches
    from public.branches
    -- Training branches only when chosen on their own.
    where public.can_access_branch(id) and training_for is null;
    return v_branches;
  end if;
  if not public.can_access_branch(p_branch_id)
    or not (public.has_permission('reports.branch') or public.has_permission('reports.all')) then
    raise exception 'You can''t see this branch''s reports' using errcode = '42501';
  end if;
  if not exists (select 1 from public.branches where id = p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;
  return array[p_branch_id];
end;
$$;

create or replace function public.loyalty_earn(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_settings jsonb;
  v_points integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.customer_id is null or v_order.paid_at is null or public.is_training_branch(v_order.branch_id) then
    return;
  end if;
  v_settings := public.loyalty_settings(v_order.branch_id);
  if not (v_settings ->> 'enabled')::boolean then
    return;
  end if;
  v_points := (v_order.total / (v_settings ->> 'earn_per')::integer)::integer;
  if v_points <= 0 then
    return;
  end if;
  insert into public.loyalty_transactions (customer_id, order_id, branch_id, type, points)
  values (v_order.customer_id, p_order_id, v_order.branch_id, 'earn', v_points)
  on conflict do nothing;
  if found then
    update public.customers set points_balance = points_balance + v_points where id = v_order.customer_id;
  end if;
end;
$$;

create or replace function public.save_customer(p_session_id uuid, p_customer jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_id uuid;
  v_phone text := public.normalize_phone(p_customer ->> 'phone');
  v_name text := nullif(btrim(coalesce(p_customer ->> 'name', '')), '');
  v_existing public.customers;
begin
  if not public.staff_has_permission(v_session.staff_id, 'order.create') then
    raise exception 'You are not allowed to take orders' using errcode = '42501';
  end if;
  begin
    v_id := (p_customer ->> 'id')::uuid;
  exception when invalid_text_representation then
    v_id := null;
  end;
  if public.is_training_branch(v_session.branch_id) then
    raise exception 'Loyalty customers can''t be added in training mode' using errcode = '22023';
  end if;
  if v_id is null or v_phone is null then
    raise exception 'Enter a phone number, like 0244123456' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'The name is too long' using errcode = '22023';
  end if;
  select * into v_existing from public.customers where id = v_id or phone = v_phone limit 1;
  if v_existing.id is not null then
    if v_name is not null and v_name is distinct from v_existing.name then
      update public.customers set name = v_name where id = v_existing.id;
    end if;
    return public.customer_view(v_existing.id);
  end if;
  if coalesce((p_customer ->> 'consent')::boolean, false) is not true then
    raise exception 'Ask the customer first: their phone number is only kept with their consent'
      using errcode = '22023';
  end if;
  insert into public.customers (id, phone, name, consent_at, created_branch_id)
  values (v_id, v_phone, v_name, now(), v_session.branch_id);
  perform public.write_audit(
    p_action => 'customer.create',
    p_entity => 'customers',
    p_entity_id => v_id::text,
    p_after => jsonb_build_object('consent', true),
    p_branch_id => v_session.branch_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return public.customer_view(v_id);
end;
$$;

create or replace function public.submit_order(p_session_id uuid, p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_existed boolean := false;
  v_result jsonb;
  v_order public.orders;
  v_customer_id uuid;
  v_points integer;
  v_strict boolean;
  v_at timestamptz;
begin
  begin
    v_order_id := (p_order ->> 'id')::uuid;
  exception when invalid_text_representation then
    v_order_id := null;
  end;
  if v_order_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_order_id::text, 0));
    v_existed := exists (select 1 from public.orders where id = v_order_id);
  end if;

  v_result := public.submit_order_core(p_session_id, p_order);
  if v_existed then
    return v_result;
  end if;

  begin
    v_customer_id := nullif(p_order ->> 'customer_id', '')::uuid;
    v_points := coalesce(nullif(p_order ->> 'redeem_points', '')::integer, 0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'The customer or points weren''t sent correctly' using errcode = '22023';
  end;
  if v_points < 0 then
    raise exception 'The customer or points weren''t sent correctly' using errcode = '22023';
  end if;
  if v_customer_id is not null and not exists (select 1 from public.customers where id = v_customer_id) then
    raise exception 'That customer wasn''t found' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = v_order_id;
  -- Practice sales never touch real customers' points.
  if public.is_training_branch(v_order.branch_id) then
    v_customer_id := null;
    v_points := 0;
  end if;
  v_strict := not v_order.is_offline;
  -- Offline sales are judged by when they happened.
  v_at := case when v_order.is_offline then coalesce(v_order.client_created_at, now()) else now() end;
  update public.orders
  set customer_id = v_customer_id,
      coupon_code = nullif(upper(btrim(coalesce(p_order ->> 'coupon_code', ''))), '')
  where id = v_order_id;

  perform public.apply_promotions(v_order_id, p_order ->> 'coupon_code', v_at, v_strict);
  perform public.apply_loyalty_redemption(v_order_id, v_points, v_strict);
  perform public.recompute_order_totals(v_order_id);

  select * into v_order from public.orders where id = v_order_id;
  if v_order.promotion_total > 0 or v_order.loyalty_discount > 0 then
    perform public.write_audit(
      p_action => 'order.promotion',
      p_entity => 'orders',
      p_entity_id => v_order_id::text,
      p_after => jsonb_build_object(
        'order_number', v_order.order_number,
        'promotion_total', v_order.promotion_total,
        'promotions', (
          select coalesce(jsonb_agg(jsonb_build_object('id', r.promotion_id, 'name', p.name, 'amount', r.amount)), '[]')
          from public.promotion_redemptions r join public.promotions p on p.id = r.promotion_id
          where r.order_id = v_order_id
        ),
        'coupon_code', v_order.coupon_code,
        'loyalty_points', v_order.loyalty_points_redeemed,
        'loyalty_discount', v_order.loyalty_discount,
        'total', v_order.total
      ),
      p_branch_id => v_order.branch_id,
      p_actor_staff_id => v_order.staff_id,
      p_device_id => v_order.device_id,
      p_is_offline => v_order.is_offline
    );
  end if;
  return public.order_summary(v_order_id);
end;
$$;

create or replace function public.get_menu(p_branch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select m || jsonb_build_object(
    'promotions', coalesce((
      select jsonb_agg(public.promotion_public(p) order by p.priority desc, p.created_at, p.id)
      from public.promotions p
      where p.is_active and p.coupon_code is null
        and (p.end_date is null or p.end_date >= (now() at time zone b.timezone)::date - 1)
        and (cardinality(p.branch_ids) = 0 or p_branch_id = any (p.branch_ids))
    ), '[]'::jsonb),
    'loyalty', public.loyalty_settings(p_branch_id),
    'training', b.training_for is not null
  )
  from public.get_menu_core(p_branch_id) m
  cross join public.branches b
  where b.id = p_branch_id and m is not null;
$$;

create or replace function public.order_summary(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select c.core || jsonb_build_object(
    -- Each line also says what promotions and points took off it.
    'lines', coalesce((
      select jsonb_agg(l || jsonb_build_object(
        'promo_discount', coalesce(li.promo_discount, 0), 'loyalty_discount', coalesce(li.loyalty_discount, 0)
      ) order by n)
      from jsonb_array_elements(c.core -> 'lines') with ordinality as x(l, n)
      left join public.order_items li on li.id = (l ->> 'id')::uuid
    ), '[]'::jsonb),
    'training', public.is_training_branch(o.branch_id),
    'promotion_total', o.promotion_total,
    'coupon_code', o.coupon_code,
    'promotions', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.promotion_id, 'name', p.name, 'amount', r.amount)
        order by r.created_at, p.name)
      from public.promotion_redemptions r join public.promotions p on p.id = r.promotion_id
      where r.order_id = o.id
    ), '[]'::jsonb),
    'customer', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points_balance', c.points_balance)
      from public.customers c where c.id = o.customer_id
    ),
    'loyalty', jsonb_build_object(
      'points_redeemed', o.loyalty_points_redeemed,
      'discount', o.loyalty_discount,
      'points_earned', coalesce((
        select sum(points) from public.loyalty_transactions where order_id = o.id and type in ('earn', 'reverse_earn')
      ), 0)
    )
  )
  from public.orders o
  cross join lateral (select public.order_summary_core(o.id) as core) c
  where o.id = p_order_id;
$$;

revoke execute on function
  public.is_training_branch(uuid),
  public.staff_branch_for(uuid),
  public.set_device_training(uuid, boolean)
from public, anon, authenticated;
grant execute on function public.set_device_training(uuid, boolean) to authenticated;
