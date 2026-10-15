-- Phase 5: orders and submit_order.
--
-- The till builds a cart and sends it to submit_order, which ignores any
-- prices from the client and recalculates everything from the menu, branch
-- prices, modifiers, combo upcharges and taxes. Orders and lines get their
-- ids on the device; sending the same order again returns the saved one.
--
-- Money is integer minor units. Per line:
--   unit_price  = item price + modifier deltas + combo upcharges
--                 + component modifier deltas (never below zero)
--   gross       = unit_price * quantity - line_discount
--   inclusive taxes are extracted from gross: round(gross * rate / (10000 + all inclusive rates))
--   exclusive taxes are charged on net (gross minus inclusive taxes): round(net * rate / 10000)
--   line_total  = gross + exclusive taxes
-- Rounding is half away from zero. lib/pricing.ts mirrors this for the cart
-- preview; both are tested against the same examples.

create type public.order_status as enum (
  'open', 'paid', 'in_kitchen', 'ready', 'collected', 'voided', 'refunded', 'partially_refunded'
);
create type public.order_channel as enum ('counter', 'kiosk', 'online', 'drive_thru');
create type public.order_type as enum ('dine_in', 'takeaway', 'delivery');
create type public.order_item_status as enum ('pending', 'sent', 'ready', 'voided');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key,
  branch_id uuid not null references public.branches (id),
  device_id uuid references public.devices (id),
  staff_id uuid references public.staff (id),
  pos_session_id uuid references public.pos_sessions (id),
  -- Phase 7 makes shifts required for new orders.
  shift_id uuid,
  -- Branch-local date the order belongs to; order numbers restart per date.
  business_date date not null,
  order_number text not null,
  channel public.order_channel not null default 'counter',
  order_type public.order_type not null default 'takeaway',
  status public.order_status not null default 'open',
  customer_id uuid,
  customer_phone text,
  delivery_address text,
  notes text,
  subtotal integer not null default 0 check (subtotal >= 0),
  discount_total integer not null default 0 check (discount_total >= 0),
  tax_total integer not null default 0 check (tax_total >= 0),
  total integer not null default 0 check (total >= 0),
  is_offline boolean not null default false,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_to_kitchen_at timestamptz,
  paid_at timestamptz,
  ready_at timestamptz,
  collected_at timestamptz,
  constraint orders_number_unique unique (branch_id, business_date, order_number),
  constraint orders_delivery_details check (
    order_type <> 'delivery' or (customer_phone is not null and delivery_address is not null)
  )
);
create index orders_branch_created_idx on public.orders (branch_id, created_at desc);
create index orders_branch_status_idx on public.orders (branch_id, status);
create index orders_staff_idx on public.orders (staff_id);
create index orders_device_idx on public.orders (device_id);
create index orders_session_idx on public.orders (pos_session_id);

create table public.order_items (
  id uuid primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  branch_id uuid not null references public.branches (id),
  -- Set on the parts of a combo: each part is its own kitchen line, priced
  -- at zero because the combo line carries the price.
  parent_item_id uuid references public.order_items (id) on delete cascade,
  menu_item_id uuid not null references public.menu_items (id),
  name_snapshot text not null,
  short_name_snapshot text not null,
  combo_slot_name text,
  quantity integer not null check (quantity between 1 and 999),
  unit_price integer not null check (unit_price >= 0),
  -- Snapshot of chosen modifiers: [{id, name, group, price_delta, kds_station_id}]
  modifiers jsonb not null default '[]'::jsonb,
  line_subtotal integer not null default 0,
  line_discount integer not null default 0 check (line_discount >= 0),
  line_tax integer not null default 0,
  line_total integer not null default 0,
  -- Snapshot of taxes: [{tax_id, name, rate_bps, inclusive, amount}]
  taxes jsonb not null default '[]'::jsonb,
  kds_station_id uuid references public.kds_stations (id),
  notes text,
  status public.order_item_status not null default 'pending',
  sort_order integer not null default 0,
  voided_at timestamptz,
  void_reason text,
  voided_by uuid references public.staff (id),
  approved_by uuid references public.staff (id),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id, sort_order);
create index order_items_parent_idx on public.order_items (parent_item_id);
create index order_items_menu_item_idx on public.order_items (menu_item_id);
create index order_items_branch_idx on public.order_items (branch_id);
create index order_items_station_idx on public.order_items (kds_station_id);
create index order_items_voided_by_idx on public.order_items (voided_by);
create index order_items_approved_by_idx on public.order_items (approved_by);

-- Order number sequence per branch and date (or one long sequence when
-- numbers don't restart daily). Only submit_order touches it.
create table public.order_counters (
  branch_id uuid not null references public.branches (id),
  counter_date date not null,
  last_number integer not null default 0,
  primary key (branch_id, counter_date)
);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pricing helpers (internal)
-- ---------------------------------------------------------------------------

-- p_numerator / p_denominator rounded half away from zero (denominator > 0).
create function public.round_div(p_numerator bigint, p_denominator bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_numerator >= 0 then (2 * p_numerator + p_denominator) / (2 * p_denominator)
    else -((2 * (-p_numerator) + p_denominator) / (2 * p_denominator))
  end;
$$;

-- Taxes on one line's gross amount: {"taxes": [...], "tax": n, "total": n}.
create function public.line_taxes(p_gross integer, p_tax_category text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inclusive_rate integer;
  v_inclusive_total bigint := 0;
  v_exclusive_total bigint := 0;
  v_net bigint;
  v_amount bigint;
  v_taxes jsonb := '[]'::jsonb;
  t record;
begin
  select coalesce(sum(rate_bps), 0) into v_inclusive_rate
  from public.taxes
  where is_active and is_inclusive and tax_category = p_tax_category;

  for t in
    select * from public.taxes
    where is_active and is_inclusive and tax_category = p_tax_category
    order by sort_order, name, id
  loop
    v_amount := public.round_div(p_gross::bigint * t.rate_bps, 10000 + v_inclusive_rate);
    v_inclusive_total := v_inclusive_total + v_amount;
    v_taxes := v_taxes || jsonb_build_object(
      'tax_id', t.id, 'name', t.name, 'rate_bps', t.rate_bps, 'inclusive', true, 'amount', v_amount);
  end loop;

  v_net := p_gross - v_inclusive_total;
  for t in
    select * from public.taxes
    where is_active and not is_inclusive and tax_category = p_tax_category
    order by sort_order, name, id
  loop
    v_amount := public.round_div(v_net * t.rate_bps, 10000);
    v_exclusive_total := v_exclusive_total + v_amount;
    v_taxes := v_taxes || jsonb_build_object(
      'tax_id', t.id, 'name', t.name, 'rate_bps', t.rate_bps, 'inclusive', false, 'amount', v_amount);
  end loop;

  return jsonb_build_object(
    'taxes', v_taxes,
    'tax', v_inclusive_total + v_exclusive_total,
    'total', p_gross + v_exclusive_total
  );
end;
$$;

-- Validates the modifiers chosen for one item and returns their snapshot and
-- price change: {"delta": n, "snapshot": [...]}. Raises (22023) with a
-- message for the cashier when a choice isn't allowed.
create function public.order_line_modifiers(p_menu_item_id uuid, p_modifier_ids jsonb, p_branch_id uuid)
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
    if not m.available then
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

-- Validates the choices for a combo and returns its parts and price extra:
-- {"extra": n, "components": [...]}. Raises (22023) for bad choices.
create function public.order_line_combo(p_combo_id uuid, p_selections jsonb, p_branch_id uuid)
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
    if not o.available then
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

-- The saved order as the till shows it (lines with combo parts, and taxes).
create function public.order_summary(p_order_id uuid)
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
    'tax_total', o.tax_total,
    'total', o.total,
    'paid_at', o.paid_at,
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
        'status', li.status,
        'components', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.id, 'name', c.name_snapshot, 'slot', c.combo_slot_name, 'modifiers', c.modifiers
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
    ), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- submit_order
-- ---------------------------------------------------------------------------

create function public.submit_order(p_session_id uuid, p_order jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
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
  v_business_date := (now() at time zone v_branch.timezone)::date;

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
    id, branch_id, device_id, staff_id, pos_session_id, business_date, order_number,
    channel, order_type, status, customer_phone, delivery_address, notes, client_created_at
  )
  values (
    v_order_id, v_branch.id, v_session.device_id, v_session.staff_id, v_session.id, v_business_date,
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

-- The till (or back office) reads one order in its branch.
create function public.get_order(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid;
begin
  select branch_id into v_branch_id from public.orders where id = p_order_id;
  if v_branch_id is null or not public.can_access_branch(v_branch_id) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  return public.order_summary(p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: read your branch's orders; all writes go through RPCs.
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_counters enable row level security;

grant select on public.orders, public.order_items to authenticated;
revoke all on public.order_counters from anon, authenticated;

create policy orders_select on public.orders
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      branch_id = (select public.current_branch_id())
      and ((select public.is_manager()) or (select public.is_device()))
    )
  );

create policy order_items_select on public.order_items
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      branch_id = (select public.current_branch_id())
      and ((select public.is_manager()) or (select public.is_device()))
    )
  );

alter publication supabase_realtime add table public.orders, public.order_items;

revoke execute on function
  public.round_div(bigint, bigint),
  public.line_taxes(integer, text),
  public.order_line_modifiers(uuid, jsonb, uuid),
  public.order_line_combo(uuid, jsonb, uuid),
  public.order_summary(uuid),
  public.submit_order(uuid, jsonb),
  public.get_order(uuid)
from public, anon, authenticated;

grant execute on function
  public.submit_order(uuid, jsonb),
  public.get_order(uuid)
to authenticated;
