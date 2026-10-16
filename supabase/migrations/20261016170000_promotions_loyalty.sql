-- Phase 13: promotions and loyalty.
--
-- Promotions are worked out inside submit_order, after the menu prices and
-- any staff discounts, and before tax: the order is priced as before (now
-- submit_order_core), then promotions and loyalty points come off what's
-- left on each line, and the taxes and totals are worked out again.
-- lib/promotions.ts mirrors the engine for the cart preview only.
--
-- Loyalty: a customer (phone number, stored only with their consent) earns
-- points when an order is paid, can spend points as a discount, and loses
-- what a refund takes back.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create type public.promotion_type as enum ('percent_off', 'amount_off', 'fixed_price', 'buy_x_get_y');
create type public.loyalty_type as enum ('earn', 'redeem', 'reverse_earn', 'return_redeem', 'adjust');

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  description text,
  type public.promotion_type not null,
  -- percent_off: basis points; amount_off: minor units off; fixed_price:
  -- the price of each qualifying item; buy_x_get_y: unused.
  value integer not null default 0 check (value >= 0),
  -- Which items qualify (empty: every item).
  item_ids uuid[] not null default '{}',
  category_ids uuid[] not null default '{}',
  -- Buy X, get Y at get_discount_bps off (10000 = free; the cheapest go).
  buy_quantity integer check (buy_quantity >= 1),
  get_quantity integer check (get_quantity >= 1),
  get_discount_bps integer not null default 10000 check (get_discount_bps between 1 and 10000),
  -- When, in each branch's local time.
  start_date date,
  end_date date,
  days_of_week integer[] not null default '{}', -- ISO: 1 = Monday … 7 = Sunday; empty: every day
  start_time time,
  end_time time,
  -- Where (empty: everywhere).
  branch_ids uuid[] not null default '{}',
  channels text[] not null default '{}',
  order_types text[] not null default '{}',
  min_spend integer not null default 0 check (min_spend >= 0),
  coupon_code text check (coupon_code ~ '^[A-Z0-9-]{3,24}$'),
  max_uses integer check (max_uses >= 1),
  max_uses_per_customer integer check (max_uses_per_customer >= 1),
  -- Higher first. A promotion that doesn't stack applies only on its own.
  priority integer not null default 0,
  stackable boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotions_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint promotions_times check ((start_time is null) = (end_time is null) and (start_time is null or end_time > start_time)),
  constraint promotions_days check (days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]),
  constraint promotions_percent check (type <> 'percent_off' or value between 1 and 10000),
  constraint promotions_amount check (type not in ('amount_off') or value >= 1),
  constraint promotions_bxgy check (type <> 'buy_x_get_y' or (buy_quantity is not null and get_quantity is not null)),
  constraint promotions_channels check (channels <@ array['counter', 'kiosk', 'online', 'drive_thru']),
  constraint promotions_order_types check (order_types <@ array['dine_in', 'takeaway', 'delivery'])
);
create unique index promotions_coupon_idx on public.promotions (coupon_code) where coupon_code is not null;

create table public.customers (
  id uuid primary key,
  phone text not null unique check (phone ~ '^\+?[0-9]{7,15}$'),
  name text check (length(name) <= 80),
  points_balance integer not null default 0,
  consent_at timestamptz not null,
  created_branch_id uuid references public.branches (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotions (id),
  order_id uuid not null references public.orders (id),
  branch_id uuid not null references public.branches (id),
  customer_id uuid references public.customers (id),
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (promotion_id, order_id)
);
create index promotion_redemptions_order_idx on public.promotion_redemptions (order_id);
create index promotion_redemptions_customer_idx on public.promotion_redemptions (promotion_id, customer_id);
create index promotion_redemptions_branch_idx on public.promotion_redemptions (branch_id, created_at);

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  order_id uuid references public.orders (id),
  refund_id uuid references public.refunds (id),
  branch_id uuid references public.branches (id),
  type public.loyalty_type not null,
  points integer not null,
  created_at timestamptz not null default now()
);
create index loyalty_transactions_customer_idx on public.loyalty_transactions (customer_id, created_at desc);
create index loyalty_transactions_order_idx on public.loyalty_transactions (order_id);
create index loyalty_transactions_branch_idx on public.loyalty_transactions (branch_id, created_at);
-- Each order earns, spends and is given back points once.
create unique index loyalty_once_per_order on public.loyalty_transactions (order_id, type)
  where type in ('earn', 'redeem', 'return_redeem');
create unique index loyalty_once_per_refund on public.loyalty_transactions (refund_id, type)
  where refund_id is not null;

alter table public.orders
  add column coupon_code text,
  add column promotion_total integer not null default 0 check (promotion_total >= 0),
  add column loyalty_points_redeemed integer not null default 0 check (loyalty_points_redeemed >= 0),
  add column loyalty_discount integer not null default 0 check (loyalty_discount >= 0);
alter table public.orders
  add constraint orders_customer_fk foreign key (customer_id) references public.customers (id) not valid;
create index orders_customer_idx on public.orders (customer_id);
alter table public.order_items
  add column promo_discount integer not null default 0 check (promo_discount >= 0),
  add column loyalty_discount integer not null default 0 check (loyalty_discount >= 0);

create trigger promotions_set_updated_at before update on public.promotions
  for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create trigger promotions_audit after insert or update or delete on public.promotions
  for each row execute function public.audit_row_change();

alter table public.promotions enable row level security;
alter table public.customers enable row level security;
alter table public.promotion_redemptions enable row level security;
alter table public.loyalty_transactions enable row level security;

grant select, insert, update on public.promotions to authenticated;
grant select on public.customers, public.promotion_redemptions, public.loyalty_transactions to authenticated;

-- Promotions: set up by whoever has promo.manage (admins); managers see them.
create policy promotions_select on public.promotions for select to authenticated
  using ((select public.is_admin()) or (select public.is_manager()));
create policy promotions_insert on public.promotions for insert to authenticated
  with check (not (select public.is_device()) and (select public.has_permission('promo.manage')));
create policy promotions_update on public.promotions for update to authenticated
  using (not (select public.is_device()) and (select public.has_permission('promo.manage')))
  with check (not (select public.is_device()) and (select public.has_permission('promo.manage')));

-- Customers: personal data. Tills reach them only through find_customer
-- and save_customer; in the back office only admins see the list.
create policy customers_select on public.customers for select to authenticated
  using ((select public.is_admin()));
create policy promotion_redemptions_select on public.promotion_redemptions for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));
create policy loyalty_transactions_select on public.loyalty_transactions for select to authenticated
  using ((select public.is_admin()) or (not public.is_device() and public.can_access_branch(branch_id)));

insert into public.settings (branch_id, key, value) values
  (null, 'loyalty.enabled', 'true'),
  -- Minor units spent per point earned (100: a point per 1.00).
  (null, 'loyalty.earn_per', '100'),
  -- What a point is worth when spent, in minor units.
  (null, 'loyalty.point_value', '1')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- A phone number as stored: digits, with a leading + kept. Null if it
-- isn't one.
create function public.normalize_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when x ~ '^\+?[0-9]{7,15}$' then x end
  from (select regexp_replace(btrim(coalesce(p_phone, '')), '[\s().-]', '', 'g') as x) p;
$$;

create function public.loyalty_settings(p_branch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce((public.branch_setting(p_branch_id, 'loyalty.enabled') #>> '{}')::boolean, false),
    'earn_per', greatest(coalesce((public.branch_setting(p_branch_id, 'loyalty.earn_per') #>> '{}')::integer, 100), 1),
    'point_value', greatest(coalesce((public.branch_setting(p_branch_id, 'loyalty.point_value') #>> '{}')::integer, 1), 1)
  );
$$;

-- What the till sees of a promotion (never its coupon code).
create function public.promotion_public(p public.promotions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'type', p.type, 'value', p.value,
    'item_ids', to_jsonb(p.item_ids), 'category_ids', to_jsonb(p.category_ids),
    'buy_quantity', p.buy_quantity, 'get_quantity', p.get_quantity, 'get_discount_bps', p.get_discount_bps,
    'start_date', p.start_date, 'end_date', p.end_date, 'days_of_week', to_jsonb(p.days_of_week),
    'start_time', p.start_time, 'end_time', p.end_time,
    'branch_ids', to_jsonb(p.branch_ids), 'channels', to_jsonb(p.channels), 'order_types', to_jsonb(p.order_types),
    'min_spend', p.min_spend, 'priority', p.priority, 'stackable', p.stackable,
    'has_coupon', p.coupon_code is not null,
    'needs_customer', p.max_uses_per_customer is not null,
    'created_at', p.created_at
  );
$$;

-- Whether a promotion runs at a branch at a local time (not counting the
-- order's channel, type, items or usage limits).
create function public.promotion_runs(p public.promotions, p_branch_id uuid, p_local timestamp)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.is_active
    and (p.start_date is null or p.start_date <= p_local::date)
    and (p.end_date is null or p.end_date >= p_local::date)
    and (cardinality(p.days_of_week) = 0 or extract(isodow from p_local)::integer = any (p.days_of_week))
    and (p.start_time is null or (p_local::time >= p.start_time and p_local::time < p.end_time))
    and (cardinality(p.branch_ids) = 0 or p_branch_id = any (p.branch_ids));
$$;

-- What a promotion takes off each line: [{id, amount}]. p_lines is
-- [{id, menu_item_id, category_id, quantity, left}] in order, where left
-- is what's left to pay on the line before tax.
create function public.promotion_line_discounts(p public.promotions, p_lines jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_lefts bigint[];
  v_qtys integer[];
  v_total bigint;
  v_shares bigint[];
  v_result bigint[];
  v_group integer;
  v_unit record;
  v_i integer;
begin
  select coalesce(array_agg((l ->> 'id')::uuid order by n), '{}'),
         coalesce(array_agg((l ->> 'left')::bigint order by n), '{}'),
         coalesce(array_agg((l ->> 'quantity')::integer order by n), '{}')
  into v_ids, v_lefts, v_qtys
  from jsonb_array_elements(p_lines) with ordinality as x(l, n)
  where (l ->> 'left')::bigint > 0
    and ((cardinality(p.item_ids) = 0 and cardinality(p.category_ids) = 0)
      or (l ->> 'menu_item_id')::uuid = any (p.item_ids)
      or (l ->> 'category_id')::uuid = any (p.category_ids));
  if cardinality(v_ids) = 0 then
    return '[]'::jsonb;
  end if;
  v_total := (select sum(a) from unnest(v_lefts) a);

  if p.type = 'percent_off' then
    v_result := public.allocate_discount(public.round_div(v_total * p.value, 10000), v_lefts);
  elsif p.type = 'amount_off' then
    v_result := public.allocate_discount(least(p.value::bigint, v_total), v_lefts);
  elsif p.type = 'fixed_price' then
    select array_agg(greatest(0, v_lefts[i] - p.value::bigint * v_qtys[i]) order by i)
    into v_result from generate_subscripts(v_ids, 1) i;
  else
    -- Buy X get Y: every unit at its share of the line, dearest first; in
    -- each full group of X + Y units the last Y (the cheapest) are off.
    v_result := array_fill(0::bigint, array[cardinality(v_ids)]);
    v_group := p.buy_quantity + p.get_quantity;
    v_i := 0;
    for v_unit in
      with units as (
        select i, u,
               v_lefts[i] / v_qtys[i] + case when u <= v_lefts[i] % v_qtys[i] then 1 else 0 end as price
        from generate_subscripts(v_ids, 1) i
        cross join lateral generate_series(1, v_qtys[i]) u
      )
      select i, price from units order by price desc, i, u
    loop
      exit when v_i >= (select sum(q) from unnest(v_qtys) q) / v_group * v_group;
      if v_i % v_group >= p.buy_quantity then
        v_result[v_unit.i] := v_result[v_unit.i] + public.round_div(v_unit.price * p.get_discount_bps, 10000);
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', v_ids[i], 'amount', least(v_result[i], v_lefts[i])) order by i)
    from generate_subscripts(v_ids, 1) i
    where v_result[i] > 0
  ), '[]'::jsonb);
end;
$$;

-- The order's lines as promotion_line_discounts wants them.
create function public.order_promo_lines(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', li.id, 'menu_item_id', li.menu_item_id, 'category_id', mi.category_id,
    'quantity', li.quantity, 'left', li.line_subtotal - li.line_discount
  ) order by li.sort_order), '[]'::jsonb)
  from public.order_items li
  join public.menu_items mi on mi.id = li.menu_item_id
  where li.order_id = p_order_id and li.parent_item_id is null and li.status <> 'voided';
$$;

-- Applies the promotions an order qualifies for, highest priority first.
-- A promotion that doesn't stack is used only on its own. p_strict: refuse
-- a coupon that doesn't apply (not for orders taken offline, which the
-- customer already has).
create function public.apply_promotions(p_order_id uuid, p_coupon text, p_at timestamptz, p_strict boolean)
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
      and (select count(*) from public.promotion_redemptions where promotion_id = p.id) >= p.max_uses;
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

-- Spends a customer's points as a discount on what's left of the order.
create function public.apply_loyalty_redemption(p_order_id uuid, p_points integer, p_strict boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_customer public.customers;
  v_settings jsonb;
  v_value integer;
  v_ids uuid[];
  v_lefts bigint[];
  v_amount bigint;
  v_points integer;
  v_shares bigint[];
begin
  if coalesce(p_points, 0) <= 0 then
    return;
  end if;
  select * into v_order from public.orders where id = p_order_id;
  v_settings := public.loyalty_settings(v_order.branch_id);
  if not (v_settings ->> 'enabled')::boolean then
    if p_strict then
      raise exception 'Loyalty points aren''t used at this branch' using errcode = '22023';
    end if;
    return;
  end if;
  if v_order.customer_id is null then
    raise exception 'Choose the customer to spend their points' using errcode = '22023';
  end if;
  select * into v_customer from public.customers where id = v_order.customer_id for update;
  if p_points > v_customer.points_balance then
    if p_strict then
      raise exception 'The customer has only % points', v_customer.points_balance using errcode = '22023';
    end if;
    p_points := greatest(v_customer.points_balance, 0);
    if p_points = 0 then
      return;
    end if;
  end if;
  v_value := (v_settings ->> 'point_value')::integer;

  select coalesce(array_agg(id order by sort_order), '{}'),
         coalesce(array_agg((line_subtotal - line_discount)::bigint order by sort_order), '{}')
  into v_ids, v_lefts
  from public.order_items
  where order_id = p_order_id and parent_item_id is null and status <> 'voided';
  v_amount := least(p_points::bigint * v_value, (select coalesce(sum(a), 0) from unnest(v_lefts) a));
  if v_amount <= 0 then
    return;
  end if;
  -- Points used: enough to cover the amount (never more than asked).
  v_points := ((v_amount + v_value - 1) / v_value)::integer;
  v_shares := public.allocate_discount(v_amount, v_lefts);
  for i in 1 .. cardinality(v_ids) loop
    update public.order_items
    set loyalty_discount = v_shares[i], line_discount = line_discount + v_shares[i]
    where id = v_ids[i];
  end loop;

  insert into public.loyalty_transactions (customer_id, order_id, branch_id, type, points)
  values (v_customer.id, p_order_id, v_order.branch_id, 'redeem', -v_points);
  update public.customers set points_balance = points_balance - v_points where id = v_customer.id;
  update public.orders set loyalty_points_redeemed = v_points, loyalty_discount = v_amount where id = p_order_id;
end;
$$;

-- Taxes and totals again, after promotions and points.
create function public.recompute_order_totals(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_tax jsonb;
begin
  for v_row in
    select li.id, li.line_subtotal, li.line_discount, mi.tax_category
    from public.order_items li
    join public.menu_items mi on mi.id = li.menu_item_id
    where li.order_id = p_order_id and li.parent_item_id is null
  loop
    v_tax := public.line_taxes(v_row.line_subtotal - v_row.line_discount, v_row.tax_category);
    update public.order_items
    set line_tax = (v_tax ->> 'tax')::integer,
        line_total = (v_tax ->> 'total')::integer,
        taxes = v_tax -> 'taxes'
    where id = v_row.id;
  end loop;
  update public.orders o
  set subtotal = t.subtotal, discount_total = t.discount_total, tax_total = t.tax_total, total = t.total,
      promotion_total = t.promotion_total
  from (
    select coalesce(sum(line_subtotal), 0) as subtotal, coalesce(sum(line_discount), 0) as discount_total,
           coalesce(sum(line_tax), 0) as tax_total, coalesce(sum(line_total), 0) as total,
           coalesce(sum(promo_discount), 0) as promotion_total
    from public.order_items
    where order_id = p_order_id and parent_item_id is null
  ) t
  where o.id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_order: the Phase 9 pricing (now submit_order_core), then
-- promotions and loyalty points.
--   order.customer_id: the customer (from find_customer / save_customer)
--   order.coupon_code: a coupon the customer gave
--   order.redeem_points: points to spend
-- ---------------------------------------------------------------------------

alter function public.submit_order(uuid, jsonb) rename to submit_order_core;
revoke execute on function public.submit_order_core(uuid, jsonb) from public, anon, authenticated;

create function public.submit_order(p_session_id uuid, p_order jsonb)
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

-- ---------------------------------------------------------------------------
-- order_summary: as before, plus the customer, promotions and points
-- ---------------------------------------------------------------------------

alter function public.order_summary(uuid) rename to order_summary_core;
revoke execute on function public.order_summary_core(uuid) from public, anon, authenticated;

create function public.order_summary(p_order_id uuid)
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

-- ---------------------------------------------------------------------------
-- Points: earned when paid, reversed by refunds, given back on voids and
-- full refunds
-- ---------------------------------------------------------------------------

create function public.loyalty_earn(p_order_id uuid)
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
  if v_order.customer_id is null or v_order.paid_at is null then
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

-- Gives back the points an order spent (once), e.g. when it's voided.
create function public.loyalty_return_redeemed(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.customer_id is null or v_order.loyalty_points_redeemed <= 0 then
    return;
  end if;
  insert into public.loyalty_transactions (customer_id, order_id, branch_id, type, points)
  values (v_order.customer_id, p_order_id, v_order.branch_id, 'return_redeem', v_order.loyalty_points_redeemed)
  on conflict do nothing;
  if found then
    update public.customers set points_balance = points_balance + v_order.loyalty_points_redeemed
    where id = v_order.customer_id;
  end if;
end;
$$;

-- A refund takes back its share of the points the order earned; a full
-- refund also gives back the points it spent.
create function public.loyalty_on_refund(p_refund_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds;
  v_order public.orders;
  v_earned integer;
  v_reversed integer;
  v_refunded bigint;
  v_target integer;
begin
  select * into v_refund from public.refunds where id = p_refund_id;
  select * into v_order from public.orders where id = v_refund.order_id;
  if v_order.customer_id is null then
    return;
  end if;
  select coalesce(sum(points) filter (where type = 'earn'), 0), coalesce(-sum(points) filter (where type = 'reverse_earn'), 0)
  into v_earned, v_reversed
  from public.loyalty_transactions where order_id = v_order.id;
  select coalesce(sum(amount), 0) into v_refunded from public.refunds where order_id = v_order.id;
  if v_earned > 0 and v_order.total > 0 then
    v_target := least(v_earned, public.round_div(v_earned::bigint * v_refunded, v_order.total)::integer);
    if v_target > v_reversed then
      insert into public.loyalty_transactions (customer_id, order_id, refund_id, branch_id, type, points)
      values (v_order.customer_id, v_order.id, p_refund_id, v_order.branch_id, 'reverse_earn', -(v_target - v_reversed))
      on conflict do nothing;
      if found then
        update public.customers set points_balance = points_balance - (v_target - v_reversed)
        where id = v_order.customer_id;
      end if;
    end if;
  end if;
  if v_refunded >= v_order.total then
    perform public.loyalty_return_redeemed(v_order.id);
  end if;
end;
$$;

create function public.orders_loyalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.paid_at is null and new.paid_at is not null then
    perform public.loyalty_earn(new.id);
  end if;
  if new.status = 'voided' and old.status <> 'voided' then
    perform public.loyalty_return_redeemed(new.id);
  end if;
  return new;
end;
$$;

create trigger orders_loyalty
  after update of paid_at, status on public.orders
  for each row execute function public.orders_loyalty();

create function public.refunds_loyalty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.loyalty_on_refund(new.id);
  return new;
end;
$$;

create trigger refunds_loyalty
  after insert on public.refunds
  for each row execute function public.refunds_loyalty();

-- ---------------------------------------------------------------------------
-- Till RPCs: customers and coupons
-- ---------------------------------------------------------------------------

create function public.customer_view(p_customer_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'points_balance', c.points_balance,
    'recent_orders', coalesce((
      select jsonb_agg(x order by x.created_at desc)
      from (
        select o.id, o.order_number, o.business_date, o.total, o.created_at, b.name as branch_name,
               (select coalesce(string_agg(li.quantity || ' × ' || li.name_snapshot, ', ' order by li.sort_order), '')
                from public.order_items li
                where li.order_id = o.id and li.parent_item_id is null and li.status <> 'voided') as items
        from public.orders o join public.branches b on b.id = o.branch_id
        where o.customer_id = c.id and o.paid_at is not null
        order by o.created_at desc
        limit 5
      ) x
    ), '[]'::jsonb)
  )
  from public.customers c
  where c.id = p_customer_id;
$$;

-- A customer by phone number, for the till; null if there's none.
create function public.find_customer(p_session_id uuid, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.pos_sessions := public.require_pos_session(p_session_id);
  v_phone text := public.normalize_phone(p_phone);
  v_id uuid;
begin
  if not public.staff_has_permission(v_session.staff_id, 'order.create') then
    raise exception 'You are not allowed to take orders' using errcode = '42501';
  end if;
  if v_phone is null then
    raise exception 'Enter a phone number, like 0244123456' using errcode = '22023';
  end if;
  select id into v_id from public.customers where phone = v_phone;
  if v_id is null then
    return null;
  end if;
  return public.customer_view(v_id);
end;
$$;

-- Adds a customer (only with their consent) or renames one. Safe to repeat.
-- p_customer: {id, phone, name, consent}
create function public.save_customer(p_session_id uuid, p_customer jsonb)
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

-- The promotion behind a coupon code, if it runs here now (the order's
-- items, type and spend are checked when it's charged).
create function public.check_coupon(p_session_id uuid, p_code text)
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
  if p.max_uses is not null and (select count(*) from public.promotion_redemptions where promotion_id = p.id) >= p.max_uses then
    raise exception 'That coupon has been used up' using errcode = '22023';
  end if;
  return public.promotion_public(p);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_menu: as before, plus the promotions running at the branch (not
-- coupons) and the loyalty settings, so the till can preview them offline.
-- ---------------------------------------------------------------------------

alter function public.get_menu(uuid) rename to get_menu_core;
revoke execute on function public.get_menu_core(uuid) from public, anon, authenticated;

create function public.get_menu(p_branch_id uuid)
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
    'loyalty', public.loyalty_settings(p_branch_id)
  )
  from public.get_menu_core(p_branch_id) m
  cross join public.branches b
  where b.id = p_branch_id and m is not null;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- What promotions and loyalty cost: by promotion, and points issued,
-- spent and taken back.
create function public.report_promotions(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branches uuid[] := public.report_branches(p_branch_id);
  v_result jsonb;
begin
  perform public.check_report_dates(p_from, p_to);
  with sold as (
    select o.* from public.orders o
    where o.branch_id = any (v_branches) and o.business_date between p_from and p_to
      and o.paid_at is not null and o.status <> 'voided'
  ),
  points as (
    select t.* from public.loyalty_transactions t
    join public.orders o on o.id = t.order_id
    where o.branch_id = any (v_branches) and o.business_date between p_from and p_to
  )
  select jsonb_build_object(
    'total', (select coalesce(sum(r.amount), 0) from public.promotion_redemptions r join sold o on o.id = r.order_id),
    'orders', (select count(distinct r.order_id) from public.promotion_redemptions r join sold o on o.id = r.order_id),
    'promotions', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'coupon_code', coupon_code, 'uses', uses,
        'cost', cost, 'sales', sales, 'average_cost', case when uses = 0 then 0 else public.round_div(cost, uses) end)
        order by cost desc, name)
      from (
        select p.id, p.name, p.coupon_code, count(*) as uses, sum(r.amount)::bigint as cost, sum(o.total)::bigint as sales
        from public.promotion_redemptions r
        join sold o on o.id = r.order_id
        join public.promotions p on p.id = r.promotion_id
        group by p.id, p.name, p.coupon_code
      ) x
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', business_date, 'uses', uses, 'cost', cost) order by business_date)
      from (
        select o.business_date, count(*) as uses, sum(r.amount)::bigint as cost
        from public.promotion_redemptions r join sold o on o.id = r.order_id
        group by o.business_date
      ) d
    ), '[]'::jsonb),
    'loyalty', jsonb_build_object(
      'issued', (select coalesce(sum(points), 0) from points where type = 'earn'),
      'redeemed', (select coalesce(-sum(points), 0) from points where type = 'redeem'),
      'reversed', (select coalesce(-sum(points), 0) from points where type = 'reverse_earn'),
      'returned', (select coalesce(sum(points), 0) from points where type = 'return_redeem'),
      'redeemed_value', (select coalesce(sum(loyalty_discount), 0) from sold),
      'customers', (select count(distinct customer_id) from sold where customer_id is not null),
      'orders', (select count(*) from sold where customer_id is not null),
      'sales', (select coalesce(sum(total), 0) from sold where customer_id is not null)
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reports from earlier phases: staff discounts leave out promotions and
-- points (the exceptions report, the discount report, cashier figures).
-- ---------------------------------------------------------------------------

create or replace function public.report_exceptions(p_branch_id uuid, p_from date, p_to date)
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
        select coalesce(sum(li.line_discount - li.promo_discount - li.loyalty_discount), 0)::bigint as amount
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

create or replace function public.report_discounts(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branches uuid[] := public.report_branches(p_branch_id);
  v_result jsonb;
begin
  perform public.check_report_dates(p_from, p_to);
  with given as (
    -- As given: on sold orders, every line's discount (voids don't undo it).
    select o.id as order_id, o.staff_id, o.branch_id,
           coalesce(i.discount ->> 'reason', o.discount ->> 'reason', 'No reason') as reason,
           (i.line_discount - i.promo_discount - i.loyalty_discount)::bigint as amount
    from public.orders o
    join public.order_items i on i.order_id = o.id and i.parent_item_id is null
    where o.branch_id = any (v_branches) and o.business_date between p_from and p_to
      and o.paid_at is not null and i.line_discount - i.promo_discount - i.loyalty_discount > 0
  ),
  overrides as (
    select o.staff_id, ((i.price_override_from - i.unit_price)::bigint * i.quantity) as amount
    from public.orders o
    join public.order_items i on i.order_id = o.id
    where o.branch_id = any (v_branches) and o.business_date between p_from and p_to
      and o.paid_at is not null and i.price_override_from is not null and i.status <> 'voided'
  )
  select jsonb_build_object(
    'total', (select coalesce(sum(amount), 0) from given),
    -- Promotions and points spent, which aren't staff discounts.
    'promotions', (
      select coalesce(sum(promotion_total), 0) from public.orders
      where branch_id = any (v_branches) and business_date between p_from and p_to and paid_at is not null
    ),
    'loyalty', (
      select coalesce(sum(loyalty_discount), 0) from public.orders
      where branch_id = any (v_branches) and business_date between p_from and p_to and paid_at is not null
    ),
    'orders', (select count(distinct order_id) from given),
    'price_overrides', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from overrides),
    'by_reason', coalesce((
      select jsonb_agg(jsonb_build_object('reason', reason, 'orders', orders, 'amount', amount) order by amount desc)
      from (select reason, count(distinct order_id) as orders, sum(amount) as amount from given group by reason) r
    ), '[]'::jsonb),
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', s.id, 'name', s.full_name, 'orders', g.orders,
        'amount', g.amount, 'price_overrides', coalesce(p.amount, 0)) order by g.amount desc)
      from (select staff_id, count(distinct order_id) as orders, sum(amount) as amount from given group by staff_id) g
      join public.staff s on s.id = g.staff_id
      left join (select staff_id, sum(amount) as amount from overrides group by staff_id) p on p.staff_id = g.staff_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
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
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.normalize_phone(text),
  public.loyalty_settings(uuid),
  public.promotion_public(public.promotions),
  public.promotion_runs(public.promotions, uuid, timestamp),
  public.promotion_line_discounts(public.promotions, jsonb),
  public.order_promo_lines(uuid),
  public.apply_promotions(uuid, text, timestamptz, boolean),
  public.apply_loyalty_redemption(uuid, integer, boolean),
  public.recompute_order_totals(uuid),
  public.submit_order(uuid, jsonb),
  public.order_summary(uuid),
  public.loyalty_earn(uuid),
  public.loyalty_return_redeemed(uuid),
  public.loyalty_on_refund(uuid),
  public.orders_loyalty(),
  public.refunds_loyalty(),
  public.customer_view(uuid),
  public.find_customer(uuid, text),
  public.save_customer(uuid, jsonb),
  public.check_coupon(uuid, text),
  public.get_menu(uuid),
  public.report_promotions(uuid, date, date)
from public, anon, authenticated;

grant execute on function
  public.submit_order(uuid, jsonb),
  public.find_customer(uuid, text),
  public.save_customer(uuid, jsonb),
  public.check_coupon(uuid, text),
  public.get_menu(uuid),
  public.report_promotions(uuid, date, date)
to authenticated;
