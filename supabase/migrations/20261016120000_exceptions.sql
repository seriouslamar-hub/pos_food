-- Phase 8: voids, refunds, discounts and price overrides.
--
-- Discounts (per line or the whole order, percent or fixed) and price
-- changes are priced by submit_order like everything else. Above the
-- cashier's discount limit, or without price.override, a manager approves
-- with their PIN. Unpaid lines are voided; paid orders are refunded, and a
-- cash refund comes out of the refunding till's drawer.

-- ---------------------------------------------------------------------------
-- Columns and the refunds table
-- ---------------------------------------------------------------------------

alter table public.orders
  -- The order-level discount as given: {"type": "percent"|"fixed", "value", "reason"}.
  add column discount jsonb,
  add column discount_approved_by uuid references public.staff (id);

alter table public.order_items
  -- The line's own discount as given (same shape as orders.discount).
  add column discount jsonb,
  -- The line's part of the order-level discount. line_discount includes it.
  add column order_discount_share integer not null default 0 check (order_discount_share >= 0),
  -- Set when the cashier changed the price: the menu price it replaced.
  add column price_override_from integer,
  add column price_override_reason text,
  add column price_approved_by uuid references public.staff (id),
  add column refunded_at timestamptz,
  add column refund_id uuid;

create table public.refunds (
  -- Made on the device, so a resend never refunds twice.
  id uuid primary key,
  order_id uuid not null references public.orders (id),
  branch_id uuid not null references public.branches (id),
  shift_id uuid not null references public.shifts (id),
  amount integer not null check (amount > 0),
  payment_method_id uuid references public.payment_methods (id),
  method public.payment_method_type not null,
  method_name text not null,
  reference text,
  reason text not null check (length(btrim(reason)) > 0),
  -- The order lines refunded (all the remaining ones for a full refund).
  line_ids uuid[] not null default '{}',
  staff_id uuid not null references public.staff (id),
  approved_by uuid references public.staff (id),
  device_id uuid references public.devices (id),
  pos_session_id uuid references public.pos_sessions (id),
  created_at timestamptz not null default now(),
  client_created_at timestamptz
);
create index refunds_order_idx on public.refunds (order_id);
create index refunds_shift_idx on public.refunds (shift_id);
create index refunds_branch_created_idx on public.refunds (branch_id, created_at desc);

alter table public.order_items
  add constraint order_items_refund_id_fkey foreign key (refund_id) references public.refunds (id);
create index order_items_refund_idx on public.order_items (refund_id);
create index order_items_price_approved_by_idx on public.order_items (price_approved_by);
create index orders_discount_approved_by_idx on public.orders (discount_approved_by);

alter table public.refunds enable row level security;
grant select on public.refunds to authenticated;
create policy refunds_select on public.refunds
  for select to authenticated
  using (public.can_access_branch(branch_id));

-- ---------------------------------------------------------------------------
-- Discount maths (mirrored by lib/pricing.ts)
-- ---------------------------------------------------------------------------

-- The amount a discount takes off p_amount. A discount is
-- {"type": "percent", "value": <basis points>, "reason"} or
-- {"type": "fixed", "value": <minor units>, "reason"}. JSON null means none.
create function public.discount_amount(p_discount jsonb, p_amount bigint)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value bigint;
begin
  if p_discount is null or jsonb_typeof(p_discount) = 'null' then
    return 0;
  end if;
  if jsonb_typeof(p_discount) <> 'object'
    or coalesce(p_discount ->> 'type', '') not in ('percent', 'fixed')
    or jsonb_typeof(p_discount -> 'value') is distinct from 'number'
    or (p_discount ->> 'value') !~ '^[0-9]{1,9}$' then
    raise exception 'A discount wasn''t sent correctly' using errcode = '22023';
  end if;
  if nullif(btrim(p_discount ->> 'reason'), '') is null then
    raise exception 'Give a reason for the discount' using errcode = '22023';
  end if;
  v_value := (p_discount ->> 'value')::bigint;
  if v_value = 0 then
    raise exception 'A discount must be more than zero' using errcode = '22023';
  end if;
  if p_discount ->> 'type' = 'percent' then
    if v_value > 10000 then
      raise exception 'A discount can''t be more than 100%%' using errcode = '22023';
    end if;
    return public.round_div(p_amount * v_value, 10000);
  end if;
  if v_value > p_amount then
    raise exception 'A discount can''t be more than what it''s taken off' using errcode = '22023';
  end if;
  return v_value;
end;
$$;

-- Shares an order-level discount across lines in proportion to their amounts
-- (after their own discounts), so the shares add up exactly: each line gets
-- the whole part of its share, and what's left goes one unit at a time to
-- the largest remainders, earlier lines first on ties.
create function public.allocate_discount(p_discount bigint, p_amounts bigint[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n integer := coalesce(cardinality(p_amounts), 0);
  v_sum bigint := 0;
  v_shares bigint[];
  v_remainders bigint[];
  v_order integer[];
  v_left bigint;
  v_i integer;
begin
  if v_n = 0 then
    return '{}';
  end if;
  v_shares := array_fill(0::bigint, array[v_n]);
  v_remainders := array_fill(0::bigint, array[v_n]);
  for v_i in 1 .. v_n loop
    v_sum := v_sum + p_amounts[v_i];
  end loop;
  if v_sum <= 0 or p_discount <= 0 then
    return v_shares;
  end if;
  v_left := p_discount;
  for v_i in 1 .. v_n loop
    v_shares[v_i] := p_discount * p_amounts[v_i] / v_sum;
    v_remainders[v_i] := p_discount * p_amounts[v_i] % v_sum;
    v_left := v_left - v_shares[v_i];
  end loop;
  select array_agg(i order by v_remainders[i] desc, i) into v_order from generate_series(1, v_n) as i;
  for v_i in 1 .. v_left loop
    v_shares[v_order[v_i]] := v_shares[v_order[v_i]] + 1;
  end loop;
  return v_shares;
end;
$$;

-- ---------------------------------------------------------------------------
-- order_summary: as in Phase 6, plus discounts, price changes, voids and
-- refunds.
-- ---------------------------------------------------------------------------

create or replace function public.order_summary(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'branch_id', o.branch_id,
    'order_number', o.order_number,
    'status', o.status,
    'order_type', o.order_type,
    'channel', o.channel,
    'business_date', o.business_date,
    'created_at', o.created_at,
    'customer_phone', o.customer_phone,
    'delivery_address', o.delivery_address,
    'notes', o.notes,
    'subtotal', o.subtotal,
    'discount_total', o.discount_total,
    'discount', o.discount,
    'tax_total', o.tax_total,
    'total', o.total,
    'paid_at', o.paid_at,
    'sent_to_kitchen_at', o.sent_to_kitchen_at,
    'staff_id', o.staff_id,
    'staff_name', s.full_name,
    'device_code', d.code,
    'branch', jsonb_build_object(
      'name', b.name,
      'address', b.address,
      'phone', b.phone,
      'receipt_header', b.receipt_header,
      'receipt_footer', b.receipt_footer,
      'logo_url', b.logo_url,
      'timezone', b.timezone,
      'currency_code', b.currency_code
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', li.id,
        'menu_item_id', li.menu_item_id,
        'name', li.name_snapshot,
        'short_name', li.short_name_snapshot,
        'quantity', li.quantity,
        'unit_price', li.unit_price,
        'modifiers', li.modifiers,
        'notes', li.notes,
        'line_subtotal', li.line_subtotal,
        'line_discount', li.line_discount,
        'line_tax', li.line_tax,
        'line_total', li.line_total,
        'discount', li.discount,
        'order_discount_share', li.order_discount_share,
        'price_override_from', li.price_override_from,
        'price_override_reason', li.price_override_reason,
        'status', li.status,
        'voided_at', li.voided_at,
        'void_reason', li.void_reason,
        'refunded_at', li.refunded_at,
        'kds_station_id', li.kds_station_id,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.id, 'name', c.name_snapshot, 'short_name', c.short_name_snapshot,
            'slot', c.combo_slot_name, 'modifiers', c.modifiers, 'kds_station_id', c.kds_station_id,
            'status', c.status
          ) order by c.sort_order)
          from public.order_items c where c.parent_item_id = li.id
        ), '[]'::jsonb)
      ) order by li.sort_order)
      from public.order_items li
      where li.order_id = o.id and li.parent_item_id is null
    ), '[]'::jsonb),
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', t.name, 'rate_bps', t.rate_bps, 'inclusive', t.inclusive, 'amount', t.amount
      ) order by t.inclusive desc, t.name)
      from (
        select x ->> 'name' as name, (x ->> 'rate_bps')::integer as rate_bps,
               (x ->> 'inclusive')::boolean as inclusive, sum((x ->> 'amount')::integer) as amount
        from public.order_items li
        cross join jsonb_array_elements(li.taxes) x
        where li.order_id = o.id and li.status <> 'voided'
        group by 1, 2, 3
      ) t
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'method', p.method, 'method_name', p.method_name, 'amount', p.amount,
        'tendered', p.tendered, 'change_given', p.change_given, 'reference', p.reference,
        'status', p.status
      ) order by p.created_at, p.id)
      from public.payments p where p.order_id = o.id
    ), '[]'::jsonb),
    'amount_paid', coalesce((
      select sum(p.amount) from public.payments p where p.order_id = o.id
    ), 0),
    'change_given', coalesce((
      select sum(p.change_given) from public.payments p where p.order_id = o.id
    ), 0),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'amount', r.amount, 'method', r.method, 'method_name', r.method_name,
        'reference', r.reference, 'reason', r.reason, 'line_ids', to_jsonb(r.line_ids),
        'created_at', r.created_at, 'staff_name', rs.full_name, 'approved_by_name', ra.full_name
      ) order by r.created_at, r.id)
      from public.refunds r
      left join public.staff rs on rs.id = r.staff_id
      left join public.staff ra on ra.id = r.approved_by
      where r.order_id = o.id
    ), '[]'::jsonb),
    'refunded_total', coalesce((
      select sum(r.amount) from public.refunds r where r.order_id = o.id
    ), 0)
  )
  from public.orders o
  join public.branches b on b.id = o.branch_id
  left join public.staff s on s.id = o.staff_id
  left join public.devices d on d.id = o.device_id
  where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- submit_order: as in Phase 7, plus discounts and price changes.
--   line.discount, order.discount: {"type", "value", "reason"}
--   line.price: {"unit_price", "reason"}
--   order.discount_override_id: a manager's approval (discount.override)
--     when the discounts are above the cashier's limit
--   order.price_override_id: a manager's approval (price.override) for the
--     price changes, when the cashier can't change prices
-- Taxes are worked out on what's left after discounts.
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
    p_device_id => v_session.device_id
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
      p_device_id => v_session.device_id
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
      p_device_id => v_session.device_id
    );
  end if;

  return public.order_summary(v_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Voids: lines of an order that isn't paid (paid orders are refunded).
-- Unsent lines of your own order need order.void_unsent; anything sent to
-- the kitchen, or someone else's order, needs order.void_sent or a
-- manager's approval. The order's totals are worked out again; voiding
-- every line voids the order. Lines already voided are skipped, so sending
-- the same void again is safe.
-- ---------------------------------------------------------------------------

create function public.void_order_items(
  p_session_id uuid,
  p_order_id uuid,
  p_item_ids uuid[],
  p_reason text,
  p_override_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_order public.orders;
  v_reason text := nullif(btrim(p_reason), '');
  v_lines jsonb;
  v_ids uuid[];
  v_sent boolean;
  v_permission text;
  v_approver_id uuid;
  v_amount bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_order_id::text, 1));
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null or v_order.branch_id <> v_session.branch_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(p_item_ids), 0) = 0 then
    raise exception 'Choose the items to void' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_item_ids) as x(id)
    where not exists (
      select 1 from public.order_items li
      where li.id = x.id and li.order_id = p_order_id and li.parent_item_id is null
    )
  ) then
    raise exception 'Those items aren''t on this order' using errcode = '22023';
  end if;

  select array_agg(li.id), bool_or(li.status <> 'pending')
  into v_ids, v_sent
  from public.order_items li
  where li.id = any (p_item_ids) and li.status <> 'voided';
  if v_ids is null then
    return public.order_summary(p_order_id);
  end if;

  if v_order.paid_at is not null then
    raise exception 'This order is paid. Refund it instead.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for the void' using errcode = '22023';
  end if;

  v_sent := v_sent or v_order.sent_to_kitchen_at is not null;
  v_permission := case
    when not v_sent and v_order.staff_id = v_session.staff_id then 'order.void_unsent'
    else 'order.void_sent'
  end;
  if not public.staff_has_permission(v_session.staff_id, v_permission) then
    if p_override_id is null then
      raise exception '%', case when v_sent
        then 'Voiding items the kitchen has needs a manager''s approval'
        else 'Voiding someone else''s order needs a manager''s approval' end
        using errcode = '42501';
    end if;
    v_approver_id := public.consume_override(p_override_id, v_session.branch_id, 'order.void_sent');
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'name', name_snapshot, 'quantity', quantity, 'amount', line_subtotal)),
         sum(line_subtotal)
  into v_lines, v_amount
  from public.order_items where id = any (v_ids);

  update public.order_items
  set status = 'voided', voided_at = now(), void_reason = v_reason,
      voided_by = v_session.staff_id, approved_by = v_approver_id
  where (id = any (v_ids) or parent_item_id = any (v_ids)) and status <> 'voided';

  -- Totals from the lines that are left (each keeps its share of any order
  -- discount, so voiding a line also drops its share).
  update public.orders o
  set subtotal = t.subtotal, discount_total = t.discount, tax_total = t.tax, total = t.total,
      status = case when t.lines = 0 then 'voided'::public.order_status else o.status end
  from (
    select coalesce(sum(line_subtotal), 0) as subtotal, coalesce(sum(line_discount), 0) as discount,
           coalesce(sum(line_tax), 0) as tax, coalesce(sum(line_total), 0) as total, count(*) as lines
    from public.order_items
    where order_id = p_order_id and parent_item_id is null and status <> 'voided'
  ) t
  where o.id = p_order_id;

  perform public.write_audit(
    p_action => 'order.void',
    p_entity => 'orders',
    p_entity_id => p_order_id::text,
    p_after => jsonb_build_object(
      'order_number', v_order.order_number, 'lines', v_lines, 'amount', v_amount, 'sent', v_sent
    ),
    p_reason => v_reason,
    p_branch_id => v_order.branch_id,
    p_approver_staff_id => v_approver_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return public.order_summary(p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds of paid orders, whole or by line. Needs order.refund or a
-- manager's approval, and the refunding cashier's open shift: a cash refund
-- comes out of that drawer. Lines the kitchen hasn't made are voided so it
-- stops. p_refund: {id, order_id, line_ids (none = everything left),
-- payment_method_id, reference, reason, override_id, client_created_at}.
-- Safe to repeat (same id).
-- ---------------------------------------------------------------------------

create function public.refund_order(p_session_id uuid, p_refund jsonb)
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
  v_order_id uuid;
  v_override_id uuid;
  v_method public.payment_methods;
  v_order public.orders;
  v_existing public.refunds;
  v_line_ids uuid[];
  v_requested uuid[];
  v_reason text := nullif(btrim(p_refund ->> 'reason'), '');
  v_reference text := nullif(btrim(p_refund ->> 'reference'), '');
  v_refunded bigint;
  v_amount bigint;
  v_approver_id uuid;
begin
  if p_refund is null or jsonb_typeof(p_refund) <> 'object' then
    raise exception 'The refund wasn''t sent correctly' using errcode = '22023';
  end if;
  begin
    v_id := (p_refund ->> 'id')::uuid;
    v_order_id := (p_refund ->> 'order_id')::uuid;
    v_override_id := nullif(p_refund ->> 'override_id', '')::uuid;
    select * into v_method from public.payment_methods
    where id = nullif(p_refund ->> 'payment_method_id', '')::uuid;
    select coalesce(array_agg(x::uuid), '{}') into v_requested
    from jsonb_array_elements_text(coalesce(nullif(p_refund -> 'line_ids', 'null'::jsonb), '[]'::jsonb)) as x;
  exception when invalid_text_representation then
    raise exception 'The refund wasn''t sent correctly' using errcode = '22023';
  end;
  if v_id is null or v_order_id is null then
    raise exception 'The refund wasn''t sent correctly' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_order_id::text, 1));
  select * into v_existing from public.refunds where id = v_id;
  if v_existing.id is not null then
    if v_existing.order_id <> v_order_id then
      raise exception 'That refund id is already in use' using errcode = '23505';
    end if;
    return public.order_summary(v_order_id);
  end if;

  select * into v_order from public.orders where id = v_order_id for update;
  if v_order.id is null or v_order.branch_id <> v_session.branch_id then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.paid_at is null then
    raise exception 'This order isn''t paid. Void its items instead.' using errcode = '22023';
  end if;
  if v_order.status = 'refunded' then
    raise exception 'This order is already refunded' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Give a reason for the refund' using errcode = '22023';
  end if;
  if v_method.id is null or not v_method.is_enabled then
    raise exception 'Choose how the money goes back' using errcode = '22023';
  end if;
  if v_method.requires_reference and v_reference is null and v_method.type <> 'cash' then
    raise exception '% refunds need a reference number', v_method.name using errcode = '22023';
  end if;

  v_shift := public.require_open_shift(v_session.staff_id, v_session.device_id);

  if not public.staff_has_permission(v_session.staff_id, 'order.refund') then
    if v_override_id is null then
      raise exception 'Refunds need a manager''s approval' using errcode = '42501';
    end if;
    v_approver_id := public.consume_override(v_override_id, v_session.branch_id, 'order.refund');
  end if;

  select coalesce(sum(amount), 0) into v_refunded from public.refunds where order_id = v_order_id;
  if cardinality(v_requested) = 0 then
    -- Everything that's left.
    select coalesce(array_agg(id), '{}') into v_line_ids
    from public.order_items
    where order_id = v_order_id and parent_item_id is null and status <> 'voided' and refunded_at is null;
    v_amount := v_order.total - v_refunded;
  else
    if exists (
      select 1 from unnest(v_requested) as x(id)
      where not exists (
        select 1 from public.order_items li
        where li.id = x.id and li.order_id = v_order_id and li.parent_item_id is null
          and li.status <> 'voided' and li.refunded_at is null
      )
    ) then
      raise exception 'Those items can''t be refunded (already refunded, or not on this order)' using errcode = '22023';
    end if;
    v_line_ids := v_requested;
    select coalesce(sum(line_total), 0) into v_amount from public.order_items where id = any (v_line_ids);
  end if;
  if v_amount <= 0 or v_amount > v_order.total - v_refunded then
    raise exception 'There''s nothing left to refund' using errcode = '22023';
  end if;

  insert into public.refunds (
    id, order_id, branch_id, shift_id, amount, payment_method_id, method, method_name, reference, reason,
    line_ids, staff_id, approved_by, device_id, pos_session_id, client_created_at
  )
  values (
    v_id, v_order_id, v_order.branch_id, v_shift.id, v_amount, v_method.id, v_method.type, v_method.name,
    v_reference, v_reason, v_line_ids, v_session.staff_id, v_approver_id, v_session.device_id, v_session.id,
    case when p_refund ? 'client_created_at' then (p_refund ->> 'client_created_at')::timestamptz end
  );

  update public.order_items
  set refunded_at = now(), refund_id = v_id
  where id = any (v_line_ids);
  -- The kitchen stops making what was refunded before it was ready.
  update public.order_items
  set status = 'voided', voided_at = now(), void_reason = 'Refunded: ' || v_reason,
      voided_by = v_session.staff_id, approved_by = v_approver_id
  where (id = any (v_line_ids) or parent_item_id = any (v_line_ids)) and status in ('pending', 'sent');

  update public.orders
  set status = case
    when v_refunded + v_amount >= total then 'refunded'::public.order_status
    else 'partially_refunded'::public.order_status
  end
  where id = v_order_id;
  if v_refunded + v_amount >= v_order.total then
    update public.payments set status = 'refunded' where order_id = v_order_id;
  end if;

  perform public.write_audit(
    p_action => 'order.refund',
    p_entity => 'orders',
    p_entity_id => v_order_id::text,
    p_after => jsonb_build_object(
      'order_number', v_order.order_number, 'refund_id', v_id, 'amount', v_amount,
      'method', v_method.name, 'lines', to_jsonb(v_line_ids)
    ),
    p_reason => v_reason,
    p_branch_id => v_order.branch_id,
    p_approver_staff_id => v_approver_id,
    p_actor_staff_id => v_session.staff_id,
    p_device_id => v_session.device_id
  );
  return public.order_summary(v_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cash: refunds paid in cash come out of the refunding shift's drawer.
-- (Replaces the Phase 7 versions.)
-- ---------------------------------------------------------------------------

create or replace function public.shift_expected_cash(p_shift_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select s.opening_float
    + coalesce((select sum(p.amount) from public.payments p where p.shift_id = s.id and p.method = 'cash'), 0)
    - coalesce((select sum(r.amount) from public.refunds r where r.shift_id = s.id and r.method = 'cash'), 0)
    + coalesce((
        select sum(case m.type when 'paid_in' then m.amount when 'paid_out' then -m.amount when 'drop' then -m.amount else 0 end)
        from public.cash_movements m
        where m.shift_id = s.id
      ), 0)
  from public.shifts s
  where s.id = p_shift_id;
$$;

create or replace function public.shift_cash(p_shift_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'opening_float', s.opening_float,
    'cash_sales', coalesce((select sum(p.amount) from public.payments p where p.shift_id = s.id and p.method = 'cash'), 0),
    'cash_refunds', coalesce((select sum(r.amount) from public.refunds r where r.shift_id = s.id and r.method = 'cash'), 0),
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

-- Sales figures: as in Phase 7, with refunds (made in the shift or day) and
-- discounts counted from the orders.
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

-- ---------------------------------------------------------------------------
-- Order lookup, audit trail and the exceptions report
-- ---------------------------------------------------------------------------

-- Orders at a branch by business date, number, amount or payment
-- reference (any combination). For tills and the back office.
create function public.search_orders(
  p_branch_id uuid,
  p_business_date date default null,
  p_number text default null,
  p_amount integer default null,
  p_reference text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_number text := nullif(btrim(p_number), '');
  v_reference text := nullif(btrim(p_reference), '');
begin
  if not public.can_access_branch(p_branch_id) then
    raise exception 'Branch not found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(hits)::jsonb order by hits.created_at desc)
    from (
      select o.id, o.order_number, o.business_date, o.created_at, o.status, o.order_type, o.total,
             o.paid_at, s.full_name as staff_name,
             coalesce((select sum(r.amount) from public.refunds r where r.order_id = o.id), 0) as refunded_total,
             coalesce((
               select jsonb_agg(jsonb_build_object('method_name', p.method_name, 'amount', p.amount, 'reference', p.reference)
                 order by p.created_at)
               from public.payments p where p.order_id = o.id
             ), '[]'::jsonb) as payments
      from public.orders o
      left join public.staff s on s.id = o.staff_id
      where o.branch_id = p_branch_id
        and (p_business_date is null or o.business_date = p_business_date)
        and (v_number is null or o.order_number = v_number or o.order_number = lpad(v_number, 3, '0'))
        and (p_amount is null or o.total = p_amount)
        and (v_reference is null or exists (
          select 1 from public.payments p
          where p.order_id = o.id and p.reference ilike '%' || v_reference || '%'
        ))
      order by o.created_at desc
      limit 50
    ) hits
  ), '[]'::jsonb);
end;
$$;

-- Everything recorded about one order: who took it, paid it, discounted,
-- voided or refunded it, and who approved. Managers in the back office, or
-- a till session whose staff member can see the audit log.
create function public.order_audit_trail(p_order_id uuid, p_session_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions;
  v_branch_id uuid;
  v_allowed boolean;
begin
  select branch_id into v_branch_id from public.orders where id = p_order_id;
  if p_session_id is not null then
    v_session := public.require_pos_session(p_session_id);
    v_allowed := v_branch_id = v_session.branch_id
      and (public.staff_has_permission(v_session.staff_id, 'audit.view_branch')
        or public.staff_has_permission(v_session.staff_id, 'audit.view_all'));
  else
    v_allowed := not public.is_device()
      and public.can_access_branch(v_branch_id)
      and (public.has_permission('audit.view_branch') or public.has_permission('audit.view_all'));
  end if;
  if v_branch_id is null or not v_allowed then
    raise exception 'You can''t see this order''s history' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'at', a.created_at, 'action', a.action, 'actor_name', actor.full_name,
      'approver_name', approver.full_name, 'reason', a.reason, 'after', a.after
    ) order by a.id)
    from public.audit_log a
    left join public.staff actor on actor.id = a.actor_staff_id
    left join public.staff approver on approver.id = a.approver_staff_id
    where a.entity = 'orders' and a.entity_id = p_order_id::text
  ), '[]'::jsonb);
end;
$$;

-- Voids, refunds, discounts, price changes and no-sales at a branch between
-- two business dates, newest first. One row per voided line, refund,
-- discounted order, changed price and no-sale.
create function public.report_exceptions(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.is_device()
    or not public.can_access_branch(p_branch_id)
    or not (public.has_permission('reports.branch') or public.has_permission('reports.all')) then
    raise exception 'You can''t see this branch''s reports' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose dates up to a year apart' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.at desc)
    from (
      select 'void' as kind, li.voided_at as at, o.business_date, o.id as order_id, o.order_number,
             vs.full_name as staff_name, ap.full_name as approver_name, li.line_subtotal::bigint as amount,
             li.void_reason as reason, li.quantity || ' × ' || li.name_snapshot as detail
      from public.order_items li
      join public.orders o on o.id = li.order_id
      left join public.staff vs on vs.id = li.voided_by
      left join public.staff ap on ap.id = li.approved_by
      where o.branch_id = p_branch_id and o.business_date between p_from and p_to
        and li.parent_item_id is null and li.status = 'voided' and li.refund_id is null
      union all
      select 'refund', r.created_at, d.business_date, o.id, o.order_number, st.full_name, ap.full_name,
             r.amount::bigint, r.reason, r.method_name
      from public.refunds r
      join public.orders o on o.id = r.order_id
      join public.shifts sh on sh.id = r.shift_id
      join public.business_days d on d.id = sh.business_day_id
      left join public.staff st on st.id = r.staff_id
      left join public.staff ap on ap.id = r.approved_by
      where r.branch_id = p_branch_id and d.business_date between p_from and p_to
      union all
      -- The discount as given (voiding lines later doesn't undo it).
      select 'discount', o.created_at, o.business_date, o.id, o.order_number, st.full_name, ap.full_name,
             given.amount,
             coalesce(o.discount ->> 'reason', (
               select string_agg(distinct li.discount ->> 'reason', ', ')
               from public.order_items li where li.order_id = o.id and li.discount is not null
             )),
             null
      from public.orders o
      cross join lateral (
        select coalesce(sum(li.line_discount), 0)::bigint as amount
        from public.order_items li
        where li.order_id = o.id and li.parent_item_id is null
      ) given
      left join public.staff st on st.id = o.staff_id
      left join public.staff ap on ap.id = o.discount_approved_by
      where o.branch_id = p_branch_id and o.business_date between p_from and p_to and given.amount > 0
      union all
      select 'price_override', o.created_at, o.business_date, o.id, o.order_number, st.full_name, ap.full_name,
             ((li.price_override_from - li.unit_price)::bigint * li.quantity), li.price_override_reason,
             li.quantity || ' × ' || li.name_snapshot
      from public.order_items li
      join public.orders o on o.id = li.order_id
      left join public.staff st on st.id = o.staff_id
      left join public.staff ap on ap.id = li.price_approved_by
      where o.branch_id = p_branch_id and o.business_date between p_from and p_to
        and li.price_override_from is not null
      union all
      select 'no_sale', m.created_at, d.business_date, null, null, st.full_name, ap.full_name,
             0::bigint, m.reason, null
      from public.cash_movements m
      join public.shifts sh on sh.id = m.shift_id
      join public.business_days d on d.id = sh.business_day_id
      left join public.staff st on st.id = m.staff_id
      left join public.staff ap on ap.id = m.approved_by
      where m.branch_id = p_branch_id and m.type = 'no_sale' and d.business_date between p_from and p_to
    ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.discount_amount(jsonb, bigint),
  public.allocate_discount(bigint, bigint[]),
  public.void_order_items(uuid, uuid, uuid[], text, uuid),
  public.refund_order(uuid, jsonb),
  public.search_orders(uuid, date, text, integer, text),
  public.order_audit_trail(uuid, uuid),
  public.report_exceptions(uuid, date, date)
from public, anon, authenticated;

grant execute on function
  public.void_order_items(uuid, uuid, uuid[], text, uuid),
  public.refund_order(uuid, jsonb),
  public.search_orders(uuid, date, text, integer, text),
  public.order_audit_trail(uuid, uuid),
  public.report_exceptions(uuid, date, date)
to authenticated;
