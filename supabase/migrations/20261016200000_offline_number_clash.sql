-- Phase 14: offline sales whose number is already taken still go through.

-- The offline number to use for a new order: the till's own, or (if that
-- is already taken on the cashier's business day) the first free suffix.
create function public.free_offline_number(p_session_id uuid, p_number text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_date date;
  v_candidate text := p_number;
  n integer := 1;
begin
  select d.business_date into v_date
  from public.shifts s
  join public.business_days d on d.id = s.business_day_id
  where s.staff_id = v_session.staff_id and s.device_id = v_session.device_id and s.status = 'open';
  if v_date is null or p_number !~ '^[A-Z0-9]{1,6}-[0-9]{1,6}$' then
    return p_number;
  end if;
  while exists (
    select 1 from public.orders
    where branch_id = v_session.branch_id and business_date = v_date and order_number = v_candidate
  ) loop
    n := n + 1;
    exit when n > 99;
    v_candidate := p_number || '-' || n;
  end loop;
  return v_candidate;
end;
$$;

create or replace function public.submit_order_core(p_session_id uuid, p_order jsonb)
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
  v_discount_total bigint := 0;
  v_tax_total bigint := 0;
  v_total bigint := 0;
  v_line_count integer;
  v_price_input jsonb;
  v_override_from integer;
  v_line_discount bigint;
  v_price_lines jsonb := '[]'::jsonb;
  v_order_discount jsonb := nullif(p_order -> 'discount', 'null'::jsonb);
  v_order_discount_amount bigint := 0;
  v_ids uuid[];
  v_amounts bigint[];
  v_shares bigint[];
  v_row record;
  v_limit integer;
  v_discount_approver uuid;
  v_price_approver uuid;
  -- Sold while the till was offline: already handed to the customer, so it
  -- isn't refused for being out of stock now, and it keeps the number the
  -- till printed (e.g. T1-042).
  v_offline boolean;
  v_offline_number text := nullif(btrim(p_order ->> 'offline_number'), '');
begin
  begin
    v_offline := v_session.is_offline or coalesce((p_order ->> 'is_offline')::boolean, false);
  exception when invalid_text_representation then
    raise exception 'The order wasn''t sent correctly' using errcode = '22023';
  end;
  if v_offline_number is not null and v_offline_number !~ '^[A-Z0-9]{1,6}-[0-9]{1,6}(-[0-9]{1,2})?$' then
    raise exception 'The order number wasn''t sent correctly' using errcode = '22023';
  end if;
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
    -- Saved before the connection dropped, then completed offline with the
    -- till's own number: use the number on the customer's receipt.
    if v_offline_number is not null and v_existing.order_number <> v_offline_number
      and v_existing.paid_at is null
      and not exists (
        select 1 from public.orders
        where branch_id = v_existing.branch_id and business_date = v_existing.business_date
          and order_number = v_offline_number
      ) then
      update public.orders set order_number = v_offline_number, is_offline = true where id = v_order_id;
    end if;
    return public.order_summary(v_order_id);
  end if;

  -- New orders belong to the cashier's open shift and its business day.
  v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);
  select business_date into v_business_date from public.business_days where id = v_shift.business_day_id;
  if v_offline then
    perform set_config('pos.offline_replay', 'on', true);
  end if;

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
  if v_offline_number is null then
  insert into public.order_counters as c (branch_id, counter_date, last_number)
  values (v_branch.id, case when coalesce(v_reset_daily, true) then v_business_date else date '2000-01-01' end, 1)
  on conflict (branch_id, counter_date) do update set last_number = c.last_number + 1
  returning last_number into v_number;
  end if;
  v_order_number := coalesce(v_offline_number, lpad(v_number::text, 3, '0'));

  insert into public.orders (
    id, branch_id, device_id, staff_id, pos_session_id, shift_id, business_date, order_number,
    channel, order_type, status, customer_phone, delivery_address, notes, client_created_at, is_offline
  )
  values (
    v_order_id, v_branch.id, v_session.device_id, v_session.staff_id, v_session.id, v_shift.id, v_business_date,
    v_order_number, v_channel, v_order_type, 'open', v_phone, v_address,
    nullif(btrim(p_order ->> 'notes'), ''),
    case when p_order ? 'client_created_at' then (p_order ->> 'client_created_at')::timestamptz end,
    v_offline
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
      where id = nullif(v_line ->> 'menu_item_id', '')::uuid and (is_active or v_offline);
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
    if not v_available and not v_offline then
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

    -- A price changed by the cashier replaces the menu price.
    v_override_from := null;
    v_price_input := nullif(v_line -> 'price', 'null'::jsonb);
    if v_price_input is not null then
      if jsonb_typeof(v_price_input) <> 'object'
        or jsonb_typeof(v_price_input -> 'unit_price') is distinct from 'number'
        or (v_price_input ->> 'unit_price') !~ '^[0-9]{1,9}$' then
        raise exception 'A price change wasn''t sent correctly' using errcode = '22023';
      end if;
      if nullif(btrim(v_price_input ->> 'reason'), '') is null then
        raise exception 'Give a reason for changing the price of %', v_item.name using errcode = '22023';
      end if;
      v_override_from := v_unit;
      v_unit := (v_price_input ->> 'unit_price')::integer;
      v_price_lines := v_price_lines || jsonb_build_object(
        'id', v_line_id, 'name', v_item.name, 'quantity', v_quantity, 'from', v_override_from, 'to', v_unit);
    end if;

    if v_unit::bigint * v_quantity > 2000000000 then
      raise exception 'The % line is too large', v_item.name using errcode = '22023';
    end if;
    v_gross := v_unit * v_quantity;
    v_line_discount := public.discount_amount(v_line -> 'discount', v_gross);

    -- Taxes are filled in below, once the order discount is shared out.
    insert into public.order_items (
      id, order_id, branch_id, menu_item_id, name_snapshot, short_name_snapshot, quantity,
      unit_price, modifiers, line_subtotal, line_discount, line_tax, line_total, taxes,
      kds_station_id, notes, sort_order, discount, price_override_from, price_override_reason
    )
    values (
      v_line_id, v_order_id, v_branch.id, v_item.id, v_item.name, coalesce(v_item.short_name, v_item.name),
      v_quantity, v_unit, v_mods -> 'snapshot', v_gross, v_line_discount, 0, 0, '[]'::jsonb,
      v_item.kds_station_id, nullif(btrim(v_line ->> 'notes'), ''), v_line_index * 10,
      case when v_line_discount > 0 then v_line -> 'discount' end,
      v_override_from,
      case when v_override_from is not null then btrim(v_price_input ->> 'reason') end
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
  end loop;

  -- The order discount, shared across the lines by what's left on each.
  if v_order_discount is not null then
    select array_agg(id order by sort_order), array_agg((line_subtotal - line_discount)::bigint order by sort_order)
    into v_ids, v_amounts
    from public.order_items
    where order_id = v_order_id and parent_item_id is null;
    v_order_discount_amount := public.discount_amount(
      v_order_discount, (select coalesce(sum(a), 0)::bigint from unnest(v_amounts) as a)
    );
    v_shares := public.allocate_discount(v_order_discount_amount, v_amounts);
    for v_line_index in 1 .. cardinality(v_ids) loop
      update public.order_items
      set order_discount_share = v_shares[v_line_index],
          line_discount = line_discount + v_shares[v_line_index]
      where id = v_ids[v_line_index];
    end loop;
  end if;

  -- Taxes on what each line costs after discounts.
  for v_row in
    select li.id, li.line_subtotal, li.line_discount, mi.tax_category
    from public.order_items li
    join public.menu_items mi on mi.id = li.menu_item_id
    where li.order_id = v_order_id and li.parent_item_id is null
  loop
    v_tax := public.line_taxes(v_row.line_subtotal - v_row.line_discount, v_row.tax_category);
    update public.order_items
    set line_tax = (v_tax ->> 'tax')::integer,
        line_total = (v_tax ->> 'total')::integer,
        taxes = v_tax -> 'taxes'
    where id = v_row.id;
  end loop;

  select coalesce(sum(line_subtotal), 0), coalesce(sum(line_discount), 0),
         coalesce(sum(line_tax), 0), coalesce(sum(line_total), 0)
  into v_subtotal, v_discount_total, v_tax_total, v_total
  from public.order_items
  where order_id = v_order_id and parent_item_id is null;

  -- Price changes need price.override, or a manager's approval.
  if jsonb_array_length(v_price_lines) > 0
    and not public.staff_has_permission(v_session.staff_id, 'price.override') then
    v_price_approver := public.consume_override(
      nullif(p_order ->> 'price_override_id', '')::uuid, v_branch.id, 'price.override'
    );
    update public.order_items
    set price_approved_by = v_price_approver
    where order_id = v_order_id and price_override_from is not null;
  end if;

  -- Discounts need discount.apply; above the cashier's limit (all discounts
  -- together, as a share of the subtotal) they need discount.override or a
  -- manager's approval.
  if v_discount_total > 0 then
    if not public.staff_has_permission(v_session.staff_id, 'discount.apply') then
      raise exception 'You are not allowed to give discounts' using errcode = '42501';
    end if;
    select discount_limit_bps into v_limit from public.staff where id = v_session.staff_id;
    if v_discount_total * 10000 > v_limit::bigint * v_subtotal
      and not public.staff_has_permission(v_session.staff_id, 'discount.override') then
      v_discount_approver := public.consume_override(
        nullif(p_order ->> 'discount_override_id', '')::uuid, v_branch.id, 'discount.override'
      );
    end if;
  end if;

  update public.orders
  set subtotal = v_subtotal,
      discount_total = v_discount_total,
      tax_total = v_tax_total,
      total = v_total,
      discount = case when v_order_discount_amount > 0 then v_order_discount end,
      discount_approved_by = v_discount_approver
  where id = v_order_id;

  perform public.write_audit(
    p_action => 'order.create',
    p_entity => 'orders',
    p_entity_id => v_order_id::text,
    p_after => jsonb_build_object('order_number', v_order_number, 'total', v_total, 'lines', v_line_count),
    p_branch_id => v_branch.id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id,
    p_is_offline => v_offline
  );
  if v_discount_total > 0 then
    perform public.write_audit(
      p_action => 'order.discount',
      p_entity => 'orders',
      p_entity_id => v_order_id::text,
      p_after => jsonb_build_object(
        'order_number', v_order_number,
        'discount_total', v_discount_total,
        'subtotal', v_subtotal,
        'order_discount', v_order_discount,
        'line_discounts', (
          select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name_snapshot, 'discount', discount)), '[]')
          from public.order_items where order_id = v_order_id and discount is not null
        )
      ),
      p_reason => coalesce(
        v_order_discount ->> 'reason',
        (select string_agg(distinct discount ->> 'reason', ', ') from public.order_items
         where order_id = v_order_id and discount is not null)
      ),
      p_branch_id => v_branch.id,
      p_approver_staff_id => v_discount_approver,
      p_actor_staff_id => v_session.staff_id,
      p_device_id => v_session.device_id,
      p_is_offline => v_offline
    );
  end if;
  if jsonb_array_length(v_price_lines) > 0 then
    perform public.write_audit(
      p_action => 'order.price_override',
      p_entity => 'orders',
      p_entity_id => v_order_id::text,
      p_after => jsonb_build_object('order_number', v_order_number, 'lines', v_price_lines),
      p_reason => (
        select string_agg(distinct price_override_reason, ', ') from public.order_items
        where order_id = v_order_id and price_override_from is not null
      ),
      p_branch_id => v_branch.id,
      p_approver_staff_id => v_price_approver,
      p_actor_staff_id => v_session.staff_id,
      p_device_id => v_session.device_id,
      p_is_offline => v_offline
    );
  end if;

  perform set_config('pos.offline_replay', '', true);
  return public.order_summary(v_order_id);
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

  -- A sale made offline keeps the number on its receipt, unless that number
  -- is already taken that day (the till's counter was behind, e.g. after
  -- the day was reopened): then it gets a suffix (T1-042-2), so it still
  -- goes through instead of failing on every retry.
  if not v_existed and nullif(btrim(p_order ->> 'offline_number'), '') is not null then
    p_order := jsonb_set(p_order, '{offline_number}',
      to_jsonb(public.free_offline_number(p_session_id, btrim(p_order ->> 'offline_number'))));
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

revoke execute on function public.free_offline_number(uuid, text) from public, anon, authenticated;
revoke execute on function public.submit_order_core(uuid, jsonb) from public, anon, authenticated;
