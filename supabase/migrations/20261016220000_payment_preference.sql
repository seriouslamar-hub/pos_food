-- Kiosk and online customers choose how they'll pay at the counter (cash,
-- card or mobile money, from the branch's payment methods). No payment
-- gateway: the cashier takes the payment on the till as for any order.

alter table public.orders add column payment_preference public.payment_method_type;

-- Online orders are paid at the counter.
update public.settings set value = 'true' where key = 'online.pay_at_counter' and branch_id is null;

-- A customer's choice, if it's a payment method the branch takes.
create function public.payment_choice(p_branch_id uuid, p_choice text)
returns public.payment_method_type
language sql
stable
security definer
set search_path = ''
as $$
  select m.type from public.payment_methods m
  where m.is_enabled and m.type::text = p_choice
  limit 1;
$$;

create or replace function public.submit_kiosk_order(p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.devices;
  v_result jsonb;
begin
  select * into v_device from public.devices
  where id = public.current_device_id() and is_active and type = 'kiosk';
  if v_device.id is null then
    raise exception 'Only a kiosk can place kiosk orders' using errcode = '42501';
  end if;
  update public.devices set last_seen_at = now() where id = v_device.id;
  v_result := public.submit_channel_order_core(v_device.branch_id, v_device.id, 'kiosk',
    public.customer_order_payload(p_order) || jsonb_build_object('order_type',
      case when p_order ->> 'order_type' = 'dine_in' then 'dine_in' else 'takeaway' end));
  perform public.apply_promotions((v_result ->> 'id')::uuid, null, now(), false);
  perform public.recompute_order_totals((v_result ->> 'id')::uuid);
  update public.orders
  set pay_at_counter = true,
      payment_preference = public.payment_choice(v_device.branch_id, p_order ->> 'payment_preference')
  where id = (v_result ->> 'id')::uuid and paid_at is null;
  return public.order_summary((v_result ->> 'id')::uuid);
end;
$$;

create or replace function public.place_online_order(p_branch_id uuid, p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_phone text := nullif(auth.jwt() ->> 'phone', '');
  v_settings jsonb := public.online_settings(p_branch_id);
  v_pickup timestamptz;
  v_counter boolean := coalesce((p_order ->> 'pay_at_counter')::boolean, false);
  v_existing public.orders;
  v_result jsonb;
  v_id uuid;
begin
  if v_user is null or v_phone is null then
    raise exception 'Verify your phone number first' using errcode = '42501';
  end if;
  if public.current_staff_id() is not null or public.current_device_id() is not null then
    raise exception 'Staff and devices order through the till' using errcode = '42501';
  end if;
  begin
    v_id := (p_order ->> 'id')::uuid;
    v_pickup := (p_order ->> 'pickup_at')::timestamptz;
  exception when others then
    raise exception 'The order wasn''t sent correctly' using errcode = '22023';
  end;
  select * into v_existing from public.orders where id = v_id;
  if v_existing.id is not null then
    if v_existing.online_user_id is distinct from v_user then
      raise exception 'That order id is already in use' using errcode = '23505';
    end if;
    return public.online_order_view(v_id);
  end if;
  if not (v_settings ->> 'enabled')::boolean
    or not exists (select 1 from public.branches where id = p_branch_id and is_active and training_for is null) then
    raise exception 'This branch doesn''t take online orders' using errcode = 'P0002';
  end if;
  if (v_settings ->> 'paused')::boolean then
    raise exception 'Online ordering is paused at this branch right now. Please try again soon.' using errcode = '22023';
  end if;
  if v_counter and not (v_settings ->> 'pay_at_counter')::boolean then
    raise exception 'This branch takes online orders paid online only' using errcode = '22023';
  end if;
  if v_pickup is null
    or v_pickup < now() + make_interval(mins => (v_settings ->> 'prep_minutes')::integer) - interval '2 minutes'
    or v_pickup > now() + interval '4 hours' then
    raise exception 'Choose one of the pickup times shown' using errcode = '22023';
  end if;
  v_phone := '+' || ltrim(v_phone, '+');

  v_result := public.submit_channel_order_core(p_branch_id, null, 'online',
    public.customer_order_payload(p_order) || jsonb_build_object('order_type', 'takeaway'));
  update public.orders
  set customer_phone = v_phone, online_user_id = v_user, pickup_at = v_pickup, pay_at_counter = v_counter,
      payment_preference = public.payment_choice(p_branch_id, p_order ->> 'payment_preference')
  where id = v_id;
  perform public.apply_promotions(v_id, null, now(), false);
  perform public.recompute_order_totals(v_id);
  return public.online_order_view(v_id);
end;
$$;

create or replace function public.get_public_menu(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := public.online_settings(p_branch_id);
  v_menu jsonb;
begin
  if not (v_settings ->> 'enabled')::boolean
    or not exists (select 1 from public.branches where id = p_branch_id and is_active and training_for is null) then
    raise exception 'This branch doesn''t take online orders' using errcode = 'P0002';
  end if;
  -- Payment methods only as choices for the customer (paid at the counter).
  v_menu := public.menu_document(p_branch_id) - 'stations';
  v_menu := jsonb_set(v_menu, '{payment_methods}', coalesce((
    select jsonb_agg(jsonb_build_object('id', m ->> 'id', 'type', m ->> 'type', 'name', m ->> 'name'))
    from jsonb_array_elements(v_menu -> 'payment_methods') m
  ), '[]'::jsonb));
  return v_menu || jsonb_build_object(
    'online', v_settings,
    'promotions', coalesce((
      select jsonb_agg(public.promotion_public(p) order by p.priority desc, p.created_at, p.id)
      from public.promotions p
      where p.is_active and p.coupon_code is null
        and (cardinality(p.channels) = 0 or 'online' = any (p.channels))
        and (cardinality(p.branch_ids) = 0 or p_branch_id = any (p.branch_ids))
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.online_order_view(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'branch_id', o.branch_id, 'branch_name', b.name,
    'currency_code', b.currency_code, 'timezone', b.timezone,
    'status', o.status, 'total', o.total, 'subtotal', o.subtotal, 'discount_total', o.discount_total,
    'tax_total', o.tax_total, 'paid', o.paid_at is not null, 'pay_at_counter', o.pay_at_counter,
    'pickup_at', o.pickup_at, 'payment_preference', o.payment_preference, 'ready', o.ready_at is not null, 'collected', o.collected_at is not null,
    'created_at', o.created_at,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('name', li.name_snapshot, 'quantity', li.quantity,
        'modifiers', li.modifiers, 'total', li.line_total) order by li.sort_order)
      from public.order_items li where li.order_id = o.id and li.parent_item_id is null and li.status <> 'voided'
    ), '[]'::jsonb)
  )
  from public.orders o join public.branches b on b.id = o.branch_id
  where o.id = p_order_id;
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
    'payment_preference', o.payment_preference,
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

revoke execute on function public.payment_choice(uuid, text) from public, anon, authenticated;
