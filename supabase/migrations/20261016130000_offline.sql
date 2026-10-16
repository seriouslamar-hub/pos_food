-- Phase 9: offline mode.
--
-- A till that loses its connection keeps selling: it checks PINs against
-- cached hashes and keeps every write in a local outbox, sent in order once
-- it's back online. Every write was already idempotent on its device id;
-- this lets the server accept what was done offline:
-- - start_offline_session registers a PIN sign-in made offline; such a
--   session can be used to send that till's offline work (require_pos_session).
-- - record_offline_override records a manager's PIN approval made offline.
-- - submit_order keeps the till's offline order number (T1-042) and doesn't
--   refuse an offline sale for being out of stock now.
-- - record_payments accepts an offline sale charged at the till's prices
--   and records any difference with today's prices.
-- - get_offline_bundle gives a till what it needs to sign people in offline.

alter table public.pos_sessions add column is_offline boolean not null default false;
alter table public.orders add column offline_difference integer;
alter table public.devices
  add column pending_sync integer,
  add column pending_sync_at timestamptz;

insert into public.settings (branch_id, key, value) values
  (null, 'offline.print_kitchen_tickets', 'true'),
  (null, 'offline.card_payments', 'true');

-- The session check accepts offline sessions.
create or replace function public.require_pos_session(p_session_id uuid)
returns public.pos_sessions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions;
begin
  select ps.* into v_session
  from public.pos_sessions ps
  join public.staff s on s.id = ps.staff_id and s.is_active
  where ps.id = p_session_id
    and ps.device_id = public.current_device_id()
    -- An open session, or one the till started offline (registered when it
    -- came back online, and used to send what it did meanwhile).
    and (ps.ended_at is null or ps.is_offline);

  if v_session.id is null then
    raise exception 'Your till session has ended. Sign in with your PIN again.'
      using errcode = 'PS401';
  end if;

  return v_session;
end;
$$;

-- Offline replays skip the out-of-stock check.
create or replace function public.order_line_modifiers(p_menu_item_id uuid, p_modifier_ids jsonb, p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item_name text;
  v_ids uuid[];
  v_delta integer := 0;
  v_snapshot jsonb := '[]'::jsonb;
  v_count integer;
  m record;
  g record;
begin
  select name into v_item_name from public.menu_items where id = p_menu_item_id;

  if p_modifier_ids is null or jsonb_typeof(p_modifier_ids) = 'null' then
    v_ids := '{}';
  elsif jsonb_typeof(p_modifier_ids) <> 'array' then
    raise exception 'The options for % weren''t sent correctly', v_item_name using errcode = '22023';
  else
    begin
      select coalesce(array_agg(value::uuid), '{}') into v_ids from jsonb_array_elements_text(p_modifier_ids);
    exception when invalid_text_representation then
      raise exception 'The options for % weren''t sent correctly', v_item_name using errcode = '22023';
    end;
  end if;

  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) as x) then
    raise exception 'An option for % was chosen twice', v_item_name using errcode = '22023';
  end if;

  for m in
    select x.id as chosen_id, mo.id, mo.name, mo.price_delta, mo.kds_station_id, mo.group_id,
           mg.name as group_name, img.menu_item_id as linked,
           coalesce(bm.is_available, true) as available
    from unnest(v_ids) with ordinality as x(id, n)
    left join public.modifiers mo on mo.id = x.id and mo.is_active
    left join public.modifier_groups mg on mg.id = mo.group_id and mg.is_active
    left join public.item_modifier_groups img
      on img.modifier_group_id = mo.group_id and img.menu_item_id = p_menu_item_id
    left join public.branch_modifiers bm on bm.modifier_id = mo.id and bm.branch_id = p_branch_id
    order by img.sort_order, mo.sort_order, x.n
  loop
    if m.id is null or m.group_name is null or m.linked is null then
      raise exception '% doesn''t offer one of the chosen options', v_item_name using errcode = '22023';
    end if;
    if not m.available and coalesce(current_setting('pos.offline_replay', true), '') <> 'on' then
      raise exception '% is out of stock', m.name using errcode = '22023';
    end if;
    v_delta := v_delta + m.price_delta;
    v_snapshot := v_snapshot || jsonb_build_object(
      'id', m.id, 'name', m.name, 'group', m.group_name,
      'price_delta', m.price_delta, 'kds_station_id', m.kds_station_id);
  end loop;

  for g in
    select mg.*
    from public.item_modifier_groups img
    join public.modifier_groups mg on mg.id = img.modifier_group_id and mg.is_active
    where img.menu_item_id = p_menu_item_id
  loop
    select count(*) into v_count from public.modifiers where id = any (v_ids) and group_id = g.id;
    if v_count < g.min_select then
      raise exception 'Choose % (%) for %', lower(g.name), g.min_select, v_item_name using errcode = '22023';
    end if;
    if v_count > g.max_select then
      raise exception 'Choose at most % for % (%)', g.max_select, lower(g.name), v_item_name
        using errcode = '22023';
    end if;
  end loop;

  return jsonb_build_object('delta', v_delta, 'snapshot', v_snapshot);
end;
$$;

create or replace function public.order_line_combo(p_combo_id uuid, p_selections jsonb, p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_combo_name text;
  v_selections jsonb := coalesce(p_selections, '[]'::jsonb);
  v_selection jsonb;
  v_count integer;
  v_mods jsonb;
  v_extra integer := 0;
  v_components jsonb := '[]'::jsonb;
  v_component_id uuid;
  s record;
  o record;
begin
  select name into v_combo_name from public.menu_items where id = p_combo_id;
  if jsonb_typeof(v_selections) = 'null' then
    v_selections := '[]'::jsonb;
  elsif jsonb_typeof(v_selections) <> 'array' then
    raise exception 'The choices for % weren''t sent correctly', v_combo_name using errcode = '22023';
  end if;

  begin
    if exists (
      select 1 from jsonb_array_elements(v_selections) e
      where not exists (
        select 1 from public.combo_slots cs
        where cs.id = (e ->> 'slot_id')::uuid and cs.combo_item_id = p_combo_id
      )
    ) then
      raise exception 'A choice doesn''t belong to %', v_combo_name using errcode = '22023';
    end if;
  exception when invalid_text_representation then
    raise exception 'The choices for % weren''t sent correctly', v_combo_name using errcode = '22023';
  end;

  for s in
    select * from public.combo_slots where combo_item_id = p_combo_id order by sort_order, name
  loop
    select count(*) into v_count
    from jsonb_array_elements(v_selections) e where (e ->> 'slot_id')::uuid = s.id;
    if v_count > 1 then
      raise exception 'Only one % for %', lower(s.name), v_combo_name using errcode = '22023';
    end if;
    if v_count = 0 then
      if s.required then
        raise exception 'Choose the % for %', lower(s.name), v_combo_name using errcode = '22023';
      end if;
      continue;
    end if;

    select e into v_selection
    from jsonb_array_elements(v_selections) e where (e ->> 'slot_id')::uuid = s.id;

    select mi.id, mi.name, coalesce(mi.short_name, mi.name) as short_name, mi.kds_station_id,
           opt.upcharge, coalesce(bmi.is_available, true) as available
    into o
    from public.combo_slot_options opt
    join public.menu_items mi on mi.id = opt.menu_item_id and mi.is_active
    left join public.branch_menu_items bmi on bmi.menu_item_id = mi.id and bmi.branch_id = p_branch_id
    where opt.slot_id = s.id
      and opt.menu_item_id = nullif(v_selection ->> 'menu_item_id', '')::uuid;
    if not found then
      raise exception 'That isn''t a % choice for %', lower(s.name), v_combo_name using errcode = '22023';
    end if;
    if not o.available and coalesce(current_setting('pos.offline_replay', true), '') <> 'on' then
      raise exception '% is out of stock', o.name using errcode = '22023';
    end if;

    v_mods := public.order_line_modifiers(o.id, v_selection -> 'modifier_ids', p_branch_id);
    v_extra := v_extra + o.upcharge + (v_mods ->> 'delta')::integer;

    begin
      v_component_id := coalesce(nullif(v_selection ->> 'id', '')::uuid, gen_random_uuid());
    exception when invalid_text_representation then
      v_component_id := gen_random_uuid();
    end;

    v_components := v_components || jsonb_build_object(
      'id', v_component_id,
      'slot_name', s.name,
      'menu_item_id', o.id,
      'name', o.name,
      'short_name', o.short_name,
      'kds_station_id', o.kds_station_id,
      'upcharge', o.upcharge,
      'modifiers', v_mods -> 'snapshot'
    );
  end loop;

  return jsonb_build_object('extra', v_extra, 'components', v_components);
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
  if v_offline_number is not null and v_offline_number !~ '^[A-Z0-9]{1,6}-[0-9]{1,6}$' then
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
      change_given, reference, staff_id, device_id, pos_session_id, client_created_at, is_offline
    )
    values (
      (v_payment ->> 'id')::uuid, v_order.id, v_order.branch_id, v_shift.id, v_method.id, v_method.type,
      v_method.name, v_amount, v_tendered,
      case when v_tendered is null then null else v_tendered - v_amount end,
      v_reference, v_session.staff_id, v_session.device_id, v_session.id,
      case when v_payment ? 'client_created_at' then (v_payment ->> 'client_created_at')::timestamptz end,
      v_order.is_offline or v_session.is_offline
    );
    v_summary := v_summary || jsonb_build_object('method', v_method.name, 'amount', v_amount);
  end loop;

  if v_sum <> v_order.total then
    -- An offline sale was charged at the till's prices; if the menu changed
    -- meanwhile, keep what was taken and record the difference.
    if not v_order.is_offline then
      raise exception 'The payments don''t add up to the order total' using errcode = '22023';
    end if;
    update public.orders set offline_difference = v_sum - v_order.total where id = v_order.id;
    perform public.write_audit(
      p_action => 'order.offline_difference',
      p_entity => 'orders',
      p_entity_id => v_order.id::text,
      p_after => jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total,
        'paid', v_sum, 'difference', v_sum - v_order.total),
      p_branch_id => v_order.branch_id,
      p_actor_staff_id => v_session.staff_id,
      p_device_id => v_session.device_id,
      p_is_offline => true
    );
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
    p_device_id => v_session.device_id,
    p_is_offline => v_order.is_offline or v_session.is_offline
  );

  return public.order_summary(v_order.id);
end;
$$;

create or replace function public.record_cash_movement(p_session_id uuid, p_movement jsonb)
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
    p_device_id => v_session.device_id,
    p_is_offline => v_session.is_offline
  );
  return jsonb_build_object('id', v_id, 'type', v_type, 'amount', v_amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- Offline sign-ins and approvals
-- ---------------------------------------------------------------------------

-- Registers a PIN sign-in the till checked offline. It's stored ended (it
-- never blocks the till's live sessions) and marked offline, so the till
-- can send what was done under it. Safe to repeat.
create function public.start_offline_session(p_session_id uuid, p_staff_id uuid, p_started_at timestamptz)
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
  where id = p_staff_id and is_active and (branch_id = v_device.branch_id or role = 'admin');
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

-- Records a manager's PIN approval given on a till while it was offline, so
-- the action it approved can be sent with it. The approver's permission is
-- checked again here. Safe to repeat.
create function public.record_offline_override(
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
  where id = p_approver_staff_id and is_active and (branch_id = v_session.branch_id or role = 'admin');
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

-- What a till keeps for working offline: who can sign in on it (with their
-- PIN hashes and permissions). Only the till's own branch, and admins.
create function public.get_offline_bundle()
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
        and (s.branch_id = v_device.branch_id or s.role = 'admin')
    ), '[]'::jsonb)
  );
end;
$$;

-- The till's heartbeat now also says how much it still has to send.
drop function public.device_heartbeat();
create function public.device_heartbeat(p_pending integer default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.devices
  set last_seen_at = now(),
      pending_sync = coalesce(p_pending, pending_sync),
      pending_sync_at = case when p_pending is null then pending_sync_at else now() end
  where id = public.current_device_id();
$$;

drop function public.open_shift(uuid, integer, jsonb);

create function public.open_shift(
  p_session_id uuid,
  p_opening_float integer,
  p_denominations jsonb default null,
  -- When the shift was opened on a till that was offline at the time.
  p_opened_at timestamptz default null
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
    branch_id, business_day_id, staff_id, device_id, pos_session_id, opening_float, opening_denominations,
    opened_at
  )
  values (
    v_session.branch_id, v_day.id, v_session.staff_id, v_session.device_id, v_session.id,
    p_opening_float, p_denominations,
    case when p_opened_at between v_day.opened_at and now() then p_opened_at else now() end
  )
  returning * into v_shift;

  perform public.write_audit(
    p_action => 'shift.open',
    p_entity => 'shifts',
    p_entity_id => v_shift.id::text,
    p_after => jsonb_build_object('opening_float', p_opening_float),
    p_branch_id => v_session.branch_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id,
    p_is_offline => v_session.is_offline
  );
  return public.shift_summary(v_shift.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.start_offline_session(uuid, uuid, timestamptz),
  public.record_offline_override(uuid, uuid, uuid, text, text, timestamptz),
  public.get_offline_bundle(),
  public.device_heartbeat(integer),
  public.open_shift(uuid, integer, jsonb, timestamptz)
from public, anon, authenticated;

grant execute on function
  public.start_offline_session(uuid, uuid, timestamptz),
  public.record_offline_override(uuid, uuid, uuid, text, text, timestamptz),
  public.get_offline_bundle(),
  public.device_heartbeat(integer),
  public.open_shift(uuid, integer, jsonb, timestamptz)
to authenticated;
