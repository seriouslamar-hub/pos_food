-- Phase 15: self-order kiosk and online ordering.
--
-- Kiosk and online orders are priced by the same rules as the till
-- (submit_channel_order_core is the till's core without a cashier or shift)
-- and land in the branch's open business day with channel 'kiosk' or
-- 'online'. They stay unpaid, and out of the kitchen, until paid: at the
-- counter (Unpaid orders on the till) or online, when the payment
-- provider's webhook confirms it (confirm_online_payment, server only).

-- ---------------------------------------------------------------------------
-- Columns, settings, payment method
-- ---------------------------------------------------------------------------

alter table public.orders
  add column pickup_at timestamptz,
  -- The verified phone login that placed an online order.
  add column online_user_id uuid references auth.users (id) on delete set null,
  add column pay_at_counter boolean not null default false;
create index orders_online_user_idx on public.orders (online_user_id);

-- Payments without a shift (paid online) are allowed; till payments still
-- need one.
alter table public.payments drop constraint if exists payments_shift_required;
alter table public.payments add column online_reference text;
alter table public.payments
  add constraint payments_shift_required check (shift_id is not null or online_reference is not null) not valid;
create unique index payments_online_reference_idx on public.payments (online_reference) where online_reference is not null;

-- Online payments are recorded under the 'other' payment method, named
-- 'Paid online' on the payment.

insert into public.settings (branch_id, key, value) values
  (null, 'online.enabled', 'false'),
  (null, 'online.paused', 'false'),
  (null, 'online.prep_minutes', '20'),
  (null, 'online.pay_at_counter', 'false'),
  (null, 'kiosk.idle_seconds', '90')
on conflict do nothing;

-- A payment started with the provider: what it's for and how much.
create table public.online_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  branch_id uuid not null references public.branches (id),
  provider text not null,
  reference text not null unique,
  amount integer not null check (amount > 0),
  currency_code text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index online_payments_order_idx on public.online_payments (order_id);
create index online_payments_branch_idx on public.online_payments (branch_id);
alter table public.online_payments enable row level security;
create policy online_payments_select on public.online_payments for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));
grant select on public.online_payments to authenticated;

create function public.online_settings(p_branch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce((public.branch_setting(p_branch_id, 'online.enabled') #>> '{}')::boolean, false),
    'paused', coalesce((public.branch_setting(p_branch_id, 'online.paused') #>> '{}')::boolean, false),
    'prep_minutes', greatest(coalesce((public.branch_setting(p_branch_id, 'online.prep_minutes') #>> '{}')::integer, 20), 0),
    'pay_at_counter', coalesce((public.branch_setting(p_branch_id, 'online.pay_at_counter') #>> '{}')::boolean, false),
    'day_open', exists (select 1 from public.business_days where branch_id = p_branch_id and status = 'open')
  );
$$;

-- What a customer may send: items, choices, notes. Never discounts, prices
-- or approvals.
create function public.customer_order_payload(p_order jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_order -> 'id',
    'order_type', coalesce(p_order -> 'order_type', '"takeaway"'::jsonb),
    'notes', p_order -> 'notes',
    'lines', (
      select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', l -> 'id', 'menu_item_id', l -> 'menu_item_id', 'quantity', l -> 'quantity',
        'modifier_ids', l -> 'modifier_ids', 'combo', l -> 'combo', 'notes', l -> 'notes'
      )) order by n), '[]'::jsonb)
      from jsonb_array_elements(coalesce(p_order -> 'lines', '[]'::jsonb)) with ordinality as x(l, n)
    )
  ));
$$;

create function public.submit_channel_order_core(
  p_branch_id uuid, p_device_id uuid, p_channel public.order_channel, p_order jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions;
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
  v_session.branch_id := p_branch_id;
  v_session.device_id := p_device_id;
  v_session.is_offline := false;
  begin
    v_offline := v_session.is_offline or coalesce((p_order ->> 'is_offline')::boolean, false);
  exception when invalid_text_representation then
    raise exception 'The order wasn''t sent correctly' using errcode = '22023';
  end;
  if v_offline_number is not null and v_offline_number !~ '^[A-Z0-9]{1,6}-[0-9]{1,6}(-[0-9]{1,2})?$' then
    raise exception 'The order number wasn''t sent correctly' using errcode = '22023';
  end if;
  if false then
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
  -- No cashier and no shift: the order belongs to the branch's open day.
  select business_date into v_business_date from public.business_days
  where branch_id = v_session.branch_id and status = 'open';
  if v_business_date is null then
    raise exception 'The branch isn''t taking orders right now' using errcode = 'PS411';
  end if;
  if v_offline then
    perform set_config('pos.offline_replay', 'on', true);
  end if;

  begin
    v_order_type := coalesce(nullif(p_order ->> 'order_type', ''), 'takeaway')::public.order_type;
    v_channel := p_channel;
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

create function public.menu_document(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch public.branches;
  v_menu jsonb;
begin
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;

  with
  items as (
    select mi.*,
      coalesce(bmi.price_override, mi.base_price) as price,
      coalesce(bmi.is_available, true) as available
    from public.menu_items mi
    left join public.branch_menu_items bmi
      on bmi.menu_item_id = mi.id and bmi.branch_id = p_branch_id
    where mi.is_active
  ),
  mods as (
    select m.*, coalesce(bm.is_available, true) as available
    from public.modifiers m
    left join public.branch_modifiers bm
      on bm.modifier_id = m.id and bm.branch_id = p_branch_id
    where m.is_active
  ),
  groups as (
    select g.id, jsonb_build_object(
      'id', g.id,
      'name', g.name,
      'min_select', g.min_select,
      'max_select', g.max_select,
      'modifiers', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id,
          'name', m.name,
          'price_delta', m.price_delta,
          'kds_station_id', m.kds_station_id,
          'is_available', m.available
        ) order by m.sort_order, m.name)
        from mods m where m.group_id = g.id
      ), '[]'::jsonb)
    ) as doc
    from public.modifier_groups g
    where g.is_active
  )
  select jsonb_build_object(
    'branch_id', v_branch.id,
    'branch_name', v_branch.name,
    'currency_code', v_branch.currency_code,
    'timezone', v_branch.timezone,
    'generated_at', now(),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'colour', c.colour)
        order by c.sort_order, c.name)
      from public.categories c where c.is_active
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'category_id', i.category_id,
        'type', i.type,
        'name', i.name,
        'short_name', coalesce(i.short_name, i.name),
        'description', i.description,
        'image_url', i.image_url,
        'price', i.price,
        'base_price', i.base_price,
        'tax_category', i.tax_category,
        'kds_station_id', i.kds_station_id,
        'is_available', i.available,
        'modifier_groups', coalesce((
          select jsonb_agg(g.doc order by img.sort_order)
          from public.item_modifier_groups img
          join groups g on g.id = img.modifier_group_id
          where img.menu_item_id = i.id
        ), '[]'::jsonb),
        'combo_slots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id,
            'name', s.name,
            'required', s.required,
            'options', coalesce((
              select jsonb_agg(jsonb_build_object(
                'menu_item_id', o.menu_item_id,
                'upcharge', o.upcharge,
                'is_default', o.is_default
              ) order by o.sort_order)
              from public.combo_slot_options o
              join items oi on oi.id = o.menu_item_id
              where o.slot_id = s.id
            ), '[]'::jsonb)
          ) order by s.sort_order, s.name)
          from public.combo_slots s
          where s.combo_item_id = i.id
        ), '[]'::jsonb)
      ) order by i.sort_order, i.name)
      from items i
    ), '[]'::jsonb),
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'rate_bps', t.rate_bps,
        'is_inclusive', t.is_inclusive,
        'tax_category', t.tax_category
      ) order by t.sort_order, t.name)
      from public.taxes t where t.is_active
    ), '[]'::jsonb),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.sort_order, k.name)
      from public.kds_stations k where k.is_active
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pm.id,
        'type', pm.type,
        'name', pm.name,
        'requires_reference', pm.requires_reference
      ) order by pm.sort_order, pm.name)
      from public.payment_methods pm where pm.is_enabled
    ), '[]'::jsonb)
  ) into v_menu;

  return v_menu;
end;
$$;

create or replace function public.sales_summary(p_day_id uuid, p_shift_id uuid)
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
    union all
    -- Paid online: no shift, so the order's business day.
    select p.*
    from public.payments p
    join scope_orders o on o.id = p.order_id
    where p.shift_id is null and p_shift_id is null
  ),
  scope_refunds as (
    select r.*
    from public.refunds r
    join public.shifts s on s.id = r.shift_id
    where s.business_day_id = p_day_id and (p_shift_id is null or r.shift_id = p_shift_id)
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
      where i.parent_item_id is null and i.status = 'voided' and i.refund_id is null
    ),
    'refunds', (
      select jsonb_build_object(
        'count', count(*),
        'amount', coalesce(sum(amount), 0),
        'cash', coalesce(sum(amount) filter (where method = 'cash'), 0)
      )
      from scope_refunds
    ),
    'unpaid_orders', (
      select jsonb_build_object('count', count(*), 'amount', coalesce(sum(total), 0))
      from scope_orders
      where paid_at is null and status <> 'voided'
    )
  );
$$;

create or replace function public.day_breakdown(p_day_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with day as (
    select d.id, d.branch_id, d.business_date, b.timezone
    from public.business_days d
    join public.branches b on b.id = d.branch_id
    where d.id = p_day_id
  ),
  scope_orders as (
    select o.*,
      (case when o.is_offline then coalesce(o.client_created_at, o.created_at) else o.created_at end)
        at time zone day.timezone as local_at
    from public.orders o
    join day on o.branch_id = day.branch_id and o.business_date = day.business_date
  ),
  sold as (
    select * from scope_orders where paid_at is not null and status <> 'voided'
  ),
  scope_payments as (
    select p.* from public.payments p join public.shifts s on s.id = p.shift_id where s.business_day_id = p_day_id
    union all
    select p.* from public.payments p join scope_orders o on o.id = p.order_id where p.shift_id is null
  ),
  scope_refunds as (
    select r.* from public.refunds r join public.shifts s on s.id = r.shift_id where s.business_day_id = p_day_id
  ),
  lines as (
    select i.* from public.order_items i join sold o on o.id = i.order_id
    where i.parent_item_id is null and i.status <> 'voided'
  ),
  voided as (
    select i.* from public.order_items i join scope_orders o on o.id = i.order_id
    where i.parent_item_id is null and i.status = 'voided' and i.refund_id is null
  ),
  durations as (
    select 'to_ready' as kind, extract(hour from local_at)::integer as hour,
           extract(epoch from ready_at - sent_to_kitchen_at) as seconds
    from sold where ready_at >= sent_to_kitchen_at
    union all
    select 'to_collected', extract(hour from local_at)::integer, extract(epoch from collected_at - ready_at)
    from sold where collected_at >= ready_at
    union all
    select 'total', extract(hour from local_at)::integer, extract(epoch from collected_at - sent_to_kitchen_at)
    from sold where collected_at >= sent_to_kitchen_at
  ),
  staff_ids as (
    select staff_id as id from sold
    union select voided_by from voided
    union select staff_id from scope_refunds
  )
  select jsonb_build_object(
    'hourly', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'orders', n, 'net_sales', amount))
      from (select extract(hour from local_at)::integer as hour, count(*) as n, sum(total) as amount
            from sold group by 1) h
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'net_sales', amount))
      from (select channel::text, count(*) as n, sum(total) as amount from sold group by channel) c
    ), '[]'::jsonb),
    'order_types', coalesce((
      select jsonb_agg(jsonb_build_object('order_type', order_type, 'orders', n, 'net_sales', amount))
      from (select order_type::text, count(*) as n, sum(total) as amount from sold group by order_type) c
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'name', method_name, 'count', n, 'amount', amount))
      from (select method::text, method_name, count(*) as n, sum(amount) as amount
            from scope_payments group by method, method_name) m
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'amount', amount, 'orders', orders))
      from (select name_snapshot as name, sum(quantity) as quantity, sum(line_subtotal) as amount,
                   count(distinct order_id) as orders
            from lines group by name_snapshot) p
    ), '[]'::jsonb),
    'cashiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', ids.id,
        'orders', coalesce(s.orders, 0), 'net_sales', coalesce(s.net_sales, 0), 'discounts', coalesce(s.discounts, 0),
        'voids_count', coalesce(v.n, 0), 'voids_amount', coalesce(v.amount, 0),
        'refunds_count', coalesce(r.n, 0), 'refunds_amount', coalesce(r.amount, 0)))
      from staff_ids ids
      left join (select staff_id, count(*) as orders, sum(total) as net_sales,
                        sum(discount_total - promotion_total - loyalty_discount) as discounts
                 from sold group by staff_id) s on s.staff_id = ids.id
      left join (select voided_by, count(*) as n, sum(line_subtotal) as amount from voided group by voided_by) v
        on v.voided_by = ids.id
      left join (select staff_id, count(*) as n, sum(amount) as amount from scope_refunds group by staff_id) r
        on r.staff_id = ids.id
      where ids.id is not null
    ), '[]'::jsonb),
    'kitchen_orders', (select count(*) from sold where sent_to_kitchen_at is not null),
    'speed', coalesce((
      select jsonb_object_agg(kind, jsonb_build_object('count', n, 'sum', total, 'buckets', buckets))
      from (
        select kind, sum(n) as n, sum(total) as total, jsonb_object_agg(bucket, n) as buckets
        from (
          select kind, least(floor(seconds / 15), 480)::integer as bucket, count(*) as n, sum(seconds) as total
          from durations group by 1, 2
        ) b
        group by kind
      ) k
    ), '{}'::jsonb),
    'speed_by_hour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', hour, 'count', n, 'sum', total))
      from (select hour, count(*) as n, sum(seconds) as total from durations where kind = 'to_ready' group by hour) h
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Kiosk
-- ---------------------------------------------------------------------------

-- An order from a self-order kiosk (the signed-in kiosk device). It waits
-- unpaid until paid at the counter (or by card, online). Safe to repeat.
create function public.submit_kiosk_order(p_order jsonb)
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
  update public.orders set pay_at_counter = true where id = (v_result ->> 'id')::uuid and paid_at is null;
  return public.order_summary((v_result ->> 'id')::uuid);
end;
$$;

-- ---------------------------------------------------------------------------
-- Online ordering (public pages)
-- ---------------------------------------------------------------------------

-- Branches taking online orders (for anyone, signed in or not).
create function public.list_online_branches()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone,
    'timezone', b.timezone, 'currency_code', b.currency_code, 'logo_url', b.logo_url,
    'accepting', not (s ->> 'paused')::boolean and (s ->> 'day_open')::boolean,
    'prep_minutes', (s ->> 'prep_minutes')::integer
  ) order by b.name), '[]'::jsonb)
  from public.branches b
  cross join lateral public.online_settings(b.id) s
  where b.is_active and b.training_for is null and (s ->> 'enabled')::boolean;
$$;

-- The read-only public menu of a branch that takes online orders: active
-- items and their prices, choices and meals. Nothing else.
create function public.get_public_menu(p_branch_id uuid)
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
  v_menu := public.menu_document(p_branch_id) - 'payment_methods' - 'stations';
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

-- An online order from a customer signed in with a verified phone number.
-- p_order: {id, lines, notes, pickup_at, pay_at_counter}. It stays unpaid
-- (and out of the kitchen) until the payment is confirmed. Safe to repeat.
create function public.place_online_order(p_branch_id uuid, p_order jsonb)
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
  set customer_phone = v_phone, online_user_id = v_user, pickup_at = v_pickup, pay_at_counter = v_counter
  where id = v_id;
  perform public.apply_promotions(v_id, null, now(), false);
  perform public.recompute_order_totals(v_id);
  return public.online_order_view(v_id);
end;
$$;

-- What an online customer sees of their order.
create function public.online_order_view(p_order_id uuid)
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
    'pickup_at', o.pickup_at, 'ready', o.ready_at is not null, 'collected', o.collected_at is not null,
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

-- An online customer's own order (to follow it until pickup).
create function public.get_online_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.orders where id = p_order_id and online_user_id = auth.uid()) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  return public.online_order_view(p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Online payments (server only: the app's payment routes)
-- ---------------------------------------------------------------------------

-- Starts a payment for an unpaid online (or kiosk) order: records the
-- reference the provider will send back, for the order's total.
create function public.start_online_payment(p_order_id uuid, p_provider text, p_reference text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_currency text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.channel not in ('online', 'kiosk') then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.paid_at is not null or v_order.status = 'voided' then
    raise exception 'This order can''t be paid now' using errcode = '22023';
  end if;
  select currency_code into v_currency from public.branches where id = v_order.branch_id;
  insert into public.online_payments (order_id, branch_id, provider, reference, amount, currency_code)
  values (p_order_id, v_order.branch_id, p_provider, p_reference, v_order.total, v_currency);
  return jsonb_build_object('reference', p_reference, 'amount', v_order.total, 'currency_code', v_currency,
    'order_number', v_order.order_number, 'customer_phone', v_order.customer_phone);
end;
$$;

-- The provider confirmed a payment (its webhook, after checking the
-- signature). Pays the order and sends it to the kitchen, once. A payment
-- for the wrong amount or currency is refused and left for staff to check.
create function public.confirm_online_payment(p_reference text, p_amount integer, p_currency text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt public.online_payments;
  v_order public.orders;
  v_method public.payment_methods;
begin
  select * into v_attempt from public.online_payments where reference = p_reference for update;
  if v_attempt.id is null then
    raise exception 'Unknown payment reference' using errcode = 'P0002';
  end if;
  if v_attempt.status = 'paid' then
    return jsonb_build_object('ok', true, 'already', true, 'order_id', v_attempt.order_id);
  end if;
  if p_amount is distinct from v_attempt.amount or upper(p_currency) is distinct from v_attempt.currency_code then
    update public.online_payments set status = 'failed' where id = v_attempt.id;
    perform public.write_audit(
      p_action => 'online_payment.mismatch', p_entity => 'orders', p_entity_id => v_attempt.order_id::text,
      p_after => jsonb_build_object('reference', p_reference, 'amount', p_amount, 'currency', p_currency,
        'expected', v_attempt.amount),
      p_branch_id => v_attempt.branch_id);
    raise exception 'The amount paid doesn''t match the order' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if v_order.paid_at is not null then
    update public.online_payments set status = 'failed' where id = v_attempt.id;
    raise exception 'The order was already paid another way' using errcode = '22023';
  end if;
  select * into v_method from public.payment_methods where type = 'other' order by sort_order limit 1;

  insert into public.payments (id, order_id, branch_id, shift_id, payment_method_id, method, method_name, amount,
    reference, status, staff_id, device_id, online_reference)
  values (gen_random_uuid(), v_order.id, v_order.branch_id, null, v_method.id, v_method.type, 'Paid online',
    v_attempt.amount, p_reference, 'captured', null, v_order.device_id, p_reference);
  update public.online_payments set status = 'paid', confirmed_at = now() where id = v_attempt.id;
  update public.orders set paid_at = now(), status = 'paid', pay_at_counter = false where id = v_order.id;
  perform public.send_order_lines_to_kitchen(v_order.id);
  perform public.write_audit(
    p_action => 'order.paid', p_entity => 'orders', p_entity_id => v_order.id::text,
    p_after => jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total,
      'online', true, 'provider', v_attempt.provider, 'reference', p_reference),
    p_branch_id => v_order.branch_id);
  return jsonb_build_object('ok', true, 'order_id', v_order.id);
end;
$$;

-- Managers pause and resume online ordering at their branch.
create function public.set_online_ordering(p_branch_id uuid, p_paused boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if public.is_device() or not public.can_access_branch(p_branch_id)
    or not public.has_permission('menu.availability') then
    raise exception 'You can''t change online ordering here' using errcode = '42501';
  end if;
  insert into public.settings (branch_id, key, value)
  values (p_branch_id, 'online.paused', to_jsonb(p_paused))
  on conflict on constraint settings_branch_key_unique do update set value = excluded.value;
  perform public.write_audit(
    p_action => case when p_paused then 'online.paused' else 'online.resumed' end,
    p_entity => 'settings', p_entity_id => p_branch_id::text, p_branch_id => p_branch_id);
  return public.online_settings(p_branch_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.online_settings(uuid),
  public.customer_order_payload(jsonb),
  public.submit_channel_order_core(uuid, uuid, public.order_channel, jsonb),
  public.menu_document(uuid),
  public.submit_kiosk_order(jsonb),
  public.list_online_branches(),
  public.get_public_menu(uuid),
  public.place_online_order(uuid, jsonb),
  public.online_order_view(uuid),
  public.get_online_order(uuid),
  public.start_online_payment(uuid, text, text),
  public.confirm_online_payment(text, integer, text),
  public.set_online_ordering(uuid, boolean)
from public, anon, authenticated;

-- The public pages: anyone may see which branches take orders and their menus.
grant execute on function public.list_online_branches(), public.get_public_menu(uuid) to anon, authenticated;
grant execute on function
  public.submit_kiosk_order(jsonb),
  public.place_online_order(uuid, jsonb),
  public.get_online_order(uuid),
  public.set_online_ordering(uuid, boolean)
to authenticated;
-- Payments are started and confirmed by the app's server only.
grant execute on function
  public.start_online_payment(uuid, text, text),
  public.confirm_online_payment(text, integer, text)
to service_role;
