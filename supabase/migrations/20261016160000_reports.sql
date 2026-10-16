-- Phase 12: reports and dashboards.
--
-- Every number is computed here, never in the browser. Sales follow the Z
-- report's rules exactly: an order counts on its business date once it is
-- paid (and not voided); payments and refunds count on the business day of
-- the shift that took them. Closed days are read from daily_sales_summary
-- (a copy of each Z report's totals), so long date ranges stay fast.

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists orders_branch_business_date_idx on public.orders (branch_id, business_date);
create index if not exists shifts_business_day_idx on public.shifts (business_day_id);
create index if not exists business_days_branch_date_idx on public.business_days (branch_id, business_date);

-- ---------------------------------------------------------------------------
-- Daily sales summary: one row per closed business day
-- ---------------------------------------------------------------------------

create table public.daily_sales_summary (
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  business_day_id uuid not null unique references public.business_days (id),
  orders integer not null default 0,
  gross_sales bigint not null default 0,
  discounts bigint not null default 0,
  tax bigint not null default 0,
  net_sales bigint not null default 0,
  items_sold bigint not null default 0,
  refunds_count integer not null default 0,
  refunds_amount bigint not null default 0,
  voids_count integer not null default 0,
  voids_amount bigint not null default 0,
  -- Hourly, channel, product, cashier, payment and speed figures for the
  -- day, merged across days by report_sales.
  breakdown jsonb,
  created_at timestamptz not null default now(),
  primary key (branch_id, business_date)
);

alter table public.daily_sales_summary enable row level security;

create policy "Back office reads its branches' daily sales"
  on public.daily_sales_summary for select to authenticated
  using (not public.is_device() and public.can_access_branch(branch_id));

grant select on public.daily_sales_summary to authenticated;

-- The summary row for a day's report (its Z report, or the live figures).
create function public.summary_row(
  p_branch_id uuid, p_date date, p_day_id uuid, p_report jsonb, p_breakdown jsonb default null
)
returns public.daily_sales_summary
language sql
stable
set search_path = ''
as $$
  select
    p_branch_id,
    p_date,
    p_day_id,
    coalesce((p_report ->> 'orders')::integer, 0),
    coalesce((p_report ->> 'gross_sales')::bigint, 0),
    coalesce((p_report ->> 'discounts')::bigint, 0),
    coalesce((p_report ->> 'tax')::bigint, 0),
    coalesce((p_report ->> 'net_sales')::bigint, 0),
    coalesce((p_report ->> 'items_sold')::bigint, 0),
    coalesce((p_report #>> '{refunds,count}')::integer, 0),
    coalesce((p_report #>> '{refunds,amount}')::bigint, 0),
    coalesce((p_report #>> '{voids,count}')::integer, 0),
    coalesce((p_report #>> '{voids,amount}')::bigint, 0),
    p_breakdown,
    now();
$$;

-- One business day's figures by hour, channel, order type, payment method,
-- product and cashier, and speed of service as 15-second histograms (so
-- medians can be found across many days). Same rules as the Z report.
create function public.day_breakdown(p_day_id uuid)
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
      left join (select staff_id, count(*) as orders, sum(total) as net_sales, sum(discount_total) as discounts
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

-- Filled when a day closes (its Z report is stored); removed if it reopens.
create function public.business_days_sync_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and new.z_report is not null then
    delete from public.daily_sales_summary where business_day_id = new.id;
    insert into public.daily_sales_summary
    select * from public.summary_row(new.branch_id, new.business_date, new.id, new.z_report,
      public.day_breakdown(new.id));
  elsif new.status = 'open' then
    delete from public.daily_sales_summary where business_day_id = new.id;
  end if;
  return null;
end;
$$;

create trigger business_days_sync_summary
  after update of status, z_report on public.business_days
  for each row execute function public.business_days_sync_summary();

insert into public.daily_sales_summary
select s.*
from public.business_days d
cross join lateral public.summary_row(d.branch_id, d.business_date, d.id, d.z_report,
  public.day_breakdown(d.id)) s
where d.status = 'closed' and d.z_report is not null;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- The branches a report covers: one branch (reports.branch for your own,
-- reports.all for any), or every branch (null; reports.all). Raises if
-- the caller may not see them. Never devices.
create function public.report_branches(p_branch_id uuid)
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
    where public.can_access_branch(id);
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

create function public.check_report_dates(p_from date, p_to date)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose dates up to a year apart' using errcode = '22023';
  end if;
end;
$$;

-- Daily totals per branch: closed days from the summary, the open day live
-- (the same figures its Z report will hold).
create function public.report_daily_totals(p_branches uuid[], p_from date, p_to date)
returns setof public.daily_sales_summary
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.daily_sales_summary s
  where s.branch_id = any (p_branches) and s.business_date between p_from and p_to
  union all
  select s.*
  from public.business_days d
  cross join lateral public.summary_row(d.branch_id, d.business_date, d.id, public.sales_summary(d.id, null)) s
  where d.branch_id = any (p_branches) and d.business_date between p_from and p_to
    and not exists (select 1 from public.daily_sales_summary x where x.business_day_id = d.id);
$$;

-- ---------------------------------------------------------------------------
-- Sales report
-- ---------------------------------------------------------------------------

-- Everything the sales pages show, for one branch or (null) every branch.
-- Totals come from report_daily_totals; the breakdowns merge each day's
-- stored breakdown (the open day's is worked out live). Times are local to
-- each branch; offline sales keep the till's own clock.
create function public.report_sales(p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branches uuid[] := public.report_branches(p_branch_id);
  v_currencies text[];
  v_result jsonb;
begin
  perform public.check_report_dates(p_from, p_to);
  select array_agg(distinct currency_code) into v_currencies from public.branches where id = any (v_branches);

  with totals as (
    select * from public.report_daily_totals(v_branches, p_from, p_to)
  ),
  parts as (
    select coalesce(s.breakdown, public.day_breakdown(d.id)) as b
    from public.business_days d
    left join public.daily_sales_summary s on s.business_day_id = d.id
    where d.branch_id = any (v_branches) and d.business_date between p_from and p_to
  ),
  speed_totals as (
    select k.key as kind, sum((k.value ->> 'count')::bigint) as n, sum((k.value ->> 'sum')::numeric) as total
    from parts, jsonb_each(b -> 'speed') k
    group by k.key
  ),
  speed_buckets as (
    select kind, bucket, sum(n) over (partition by kind order by bucket) as running, sum(n) over (partition by kind) as n_all
    from (
      select k.key as kind, bk.key::integer as bucket, sum(bk.value::bigint) as n
      from parts, jsonb_each(b -> 'speed') k, jsonb_each(k.value -> 'buckets') bk
      group by 1, 2
    ) x
  ),
  speed as (
    select t.kind, t.n, round(t.total / nullif(t.n, 0))::integer as average,
           -- To the middle of a 15-second bucket.
           (select min(bucket) * 15 + 7 from speed_buckets b where b.kind = t.kind and b.running >= 0.5 * b.n_all) as median,
           (select min(bucket) * 15 + 7 from speed_buckets b where b.kind = t.kind and b.running >= 0.9 * b.n_all) as p90
    from speed_totals t
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'currency_code', case when cardinality(v_currencies) = 1 then v_currencies[1] end,
    'branches', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'currency_code', currency_code,
        'timezone', timezone) order by name), '[]'::jsonb)
      from public.branches where id = any (v_branches)
    ),
    'summary', (
      select jsonb_build_object(
        'orders', coalesce(sum(orders), 0),
        'gross_sales', coalesce(sum(gross_sales), 0),
        'discounts', coalesce(sum(discounts), 0),
        'tax', coalesce(sum(tax), 0),
        'net_sales', coalesce(sum(net_sales), 0),
        'average_order', case when coalesce(sum(orders), 0) = 0 then 0
          else public.round_div(sum(net_sales)::bigint, sum(orders)::bigint) end,
        'items_sold', coalesce(sum(items_sold), 0),
        'refunds', jsonb_build_object('count', coalesce(sum(refunds_count), 0), 'amount', coalesce(sum(refunds_amount), 0)),
        'voids', jsonb_build_object('count', coalesce(sum(voids_count), 0), 'amount', coalesce(sum(voids_amount), 0)),
        'days', count(distinct business_date)
      )
      from totals
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', business_date, 'orders', orders, 'net_sales', net_sales,
        'refunds', refunds_amount) order by business_date)
      from (
        select business_date, sum(orders) as orders, sum(net_sales) as net_sales, sum(refunds_amount) as refunds_amount
        from totals group by business_date
      ) d
    ), '[]'::jsonb),
    'by_branch', coalesce((
      select jsonb_agg(jsonb_build_object(
        'branch_id', b.id, 'name', b.name, 'currency_code', b.currency_code,
        'orders', coalesce(t.orders, 0), 'net_sales', coalesce(t.net_sales, 0),
        'average_order', case when coalesce(t.orders, 0) = 0 then 0 else public.round_div(t.net_sales, t.orders) end,
        'refunds', coalesce(t.refunds, 0), 'discounts', coalesce(t.discounts, 0)
      ) order by coalesce(t.net_sales, 0) desc, b.name)
      from public.branches b
      left join (
        select branch_id, sum(orders)::bigint as orders, sum(net_sales)::bigint as net_sales,
               sum(refunds_amount)::bigint as refunds, sum(discounts)::bigint as discounts
        from totals group by branch_id
      ) t on t.branch_id = b.id
      where b.id = any (v_branches)
    ), '[]'::jsonb),
    'hourly', (
      select jsonb_agg(jsonb_build_object('hour', h, 'orders', coalesce(x.orders, 0), 'net_sales', coalesce(x.net_sales, 0))
        order by h)
      from generate_series(0, 23) h
      left join (
        select (e ->> 'hour')::integer as hour, sum((e ->> 'orders')::bigint) as orders,
               sum((e ->> 'net_sales')::bigint) as net_sales
        from parts, jsonb_array_elements(b -> 'hourly') e group by 1
      ) x on x.hour = h
    ),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object('channel', channel, 'orders', n, 'net_sales', amount) order by amount desc)
      from (
        select e ->> 'channel' as channel, sum((e ->> 'orders')::bigint) as n, sum((e ->> 'net_sales')::bigint) as amount
        from parts, jsonb_array_elements(b -> 'channels') e group by 1
      ) c
    ), '[]'::jsonb),
    'order_types', coalesce((
      select jsonb_agg(jsonb_build_object('order_type', order_type, 'orders', n, 'net_sales', amount) order by amount desc)
      from (
        select e ->> 'order_type' as order_type, sum((e ->> 'orders')::bigint) as n,
               sum((e ->> 'net_sales')::bigint) as amount
        from parts, jsonb_array_elements(b -> 'order_types') e group by 1
      ) c
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object('method', method, 'name', name, 'count', n, 'amount', amount)
        order by amount desc, name)
      from (
        select e ->> 'method' as method, e ->> 'name' as name, sum((e ->> 'count')::bigint) as n,
               sum((e ->> 'amount')::bigint) as amount
        from parts, jsonb_array_elements(b -> 'payments') e group by 1, 2
      ) m
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'amount', amount, 'orders', orders)
        order by amount desc, name)
      from (
        select e ->> 'name' as name, sum((e ->> 'quantity')::bigint) as quantity, sum((e ->> 'amount')::bigint) as amount,
               sum((e ->> 'orders')::bigint) as orders
        from parts, jsonb_array_elements(b -> 'products') e group by 1
      ) p
    ), '[]'::jsonb),
    'cashiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', c.staff_id, 'name', coalesce(st.full_name, 'Unknown'),
        'orders', c.orders, 'net_sales', c.net_sales,
        'average_order', case when c.orders = 0 then 0 else public.round_div(c.net_sales, c.orders) end,
        'discounts', c.discounts, 'voids_count', c.voids_count, 'voids_amount', c.voids_amount,
        'refunds_count', c.refunds_count, 'refunds_amount', c.refunds_amount
      ) order by c.net_sales desc, st.full_name)
      from (
        select (e ->> 'staff_id')::uuid as staff_id,
               sum((e ->> 'orders')::bigint)::bigint as orders, sum((e ->> 'net_sales')::bigint)::bigint as net_sales,
               sum((e ->> 'discounts')::bigint) as discounts,
               sum((e ->> 'voids_count')::bigint) as voids_count, sum((e ->> 'voids_amount')::bigint) as voids_amount,
               sum((e ->> 'refunds_count')::bigint) as refunds_count,
               sum((e ->> 'refunds_amount')::bigint) as refunds_amount
        from parts, jsonb_array_elements(b -> 'cashiers') e group by 1
      ) c
      left join public.staff st on st.id = c.staff_id
    ), '[]'::jsonb),
    'speed', jsonb_build_object(
      'orders', (select coalesce(sum((b ->> 'kitchen_orders')::bigint), 0) from parts),
      'to_ready', (select jsonb_build_object('count', n, 'average', average, 'median', median, 'p90', p90)
                   from speed where kind = 'to_ready'),
      'to_collected', (select jsonb_build_object('count', n, 'average', average, 'median', median, 'p90', p90)
                       from speed where kind = 'to_collected'),
      'total', (select jsonb_build_object('count', n, 'average', average, 'median', median, 'p90', p90)
                from speed where kind = 'total'),
      'by_hour', coalesce((
        select jsonb_agg(jsonb_build_object('hour', hour, 'orders', n, 'average_seconds', round(total / n)::integer)
          order by hour)
        from (
          select (e ->> 'hour')::integer as hour, sum((e ->> 'count')::bigint) as n, sum((e ->> 'sum')::numeric) as total
          from parts, jsonb_array_elements(b -> 'speed_by_hour') e group by 1
        ) h
        where n > 0
      ), '[]'::jsonb)
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: today so far against the same weekday last week
-- ---------------------------------------------------------------------------

create function public.report_dashboard(p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branches uuid[] := public.report_branches(p_branch_id);
  v_currencies text[];
  v_result jsonb;
begin
  select array_agg(distinct currency_code) into v_currencies from public.branches where id = any (v_branches);

  with today as (
    -- Each branch's day: the open business day, or today in its timezone.
    select b.id as branch_id, b.timezone,
           coalesce(d.business_date, (now() at time zone b.timezone)::date) as business_date,
           (now() at time zone b.timezone)::time as time_of_day,
           d.id as day_id
    from public.branches b
    left join public.business_days d on d.branch_id = b.id and d.status = 'open'
    where b.id = any (v_branches)
  ),
  sold as (
    select o.*, t.business_date = o.business_date as is_today, t.time_of_day,
           (case when o.is_offline then coalesce(o.client_created_at, o.created_at) else o.created_at end) at time zone t.timezone as local_at
    from today t
    join public.orders o on o.branch_id = t.branch_id
      and o.business_date in (t.business_date, t.business_date - 7)
    where o.paid_at is not null and o.status <> 'voided'
  ),
  live as (
    select o.*, t.timezone
    from today t
    join public.orders o on o.branch_id = t.branch_id and o.business_date = t.business_date
    where o.status in ('open', 'paid', 'in_kitchen', 'ready') and o.collected_at is null
  )
  select jsonb_build_object(
    'currency_code', case when cardinality(v_currencies) = 1 then v_currencies[1] end,
    'business_date', (select min(business_date) from today),
    'day_open', (select bool_and(day_id is not null) from today),
    'today', (
      select jsonb_build_object(
        'orders', count(*), 'net_sales', coalesce(sum(total), 0),
        'average_order', case when count(*) = 0 then 0 else public.round_div(sum(total)::bigint, count(*)) end
      ) from sold where is_today
    ),
    -- Same weekday last week, up to the same time of day, and all day.
    'last_week_so_far', (
      select jsonb_build_object(
        'orders', count(*), 'net_sales', coalesce(sum(total), 0),
        'average_order', case when count(*) = 0 then 0 else public.round_div(sum(total)::bigint, count(*)) end
      ) from sold where not is_today and local_at::time <= time_of_day
    ),
    'last_week_day', (
      select jsonb_build_object(
        'orders', count(*), 'net_sales', coalesce(sum(total), 0),
        'average_order', case when count(*) = 0 then 0 else public.round_div(sum(total)::bigint, count(*)) end
      ) from sold where not is_today
    ),
    'hourly', (
      select jsonb_agg(jsonb_build_object('hour', h,
        'today', coalesce(x.today, 0), 'last_week', coalesce(x.last_week, 0)) order by h)
      from generate_series(0, 23) h
      left join (
        select extract(hour from local_at)::integer as hour,
               sum(total) filter (where is_today) as today,
               sum(total) filter (where not is_today) as last_week
        from sold group by 1
      ) x on x.hour = h
    ),
    'open_orders', jsonb_build_object(
      'count', (select count(*) from live),
      'by_status', coalesce((
        select jsonb_object_agg(status, n) from (select status::text, count(*) as n from live group by status) s
      ), '{}'::jsonb),
      'recent', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id, 'order_number', order_number, 'status', status, 'order_type', order_type,
          'channel', channel, 'total', total, 'created_at', created_at, 'branch_id', branch_id
        ) order by created_at desc)
        from (select * from live order by created_at desc limit 20) l
      ), '[]'::jsonb)
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tax and discounts
-- ---------------------------------------------------------------------------

create function public.report_tax(p_branch_id uuid, p_from date, p_to date)
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
  with tax_lines as (
    select o.branch_id, o.business_date, x ->> 'name' as name, (x ->> 'rate_bps')::integer as rate_bps,
           coalesce((x ->> 'inclusive')::boolean, false) as inclusive,
           (x ->> 'amount')::bigint as amount,
           (i.line_subtotal - i.line_discount)::bigint as base
    from public.orders o
    join public.order_items i on i.order_id = o.id
    cross join jsonb_array_elements(coalesce(i.taxes, '[]'::jsonb)) x
    where o.branch_id = any (v_branches) and o.business_date between p_from and p_to
      and o.paid_at is not null and o.status <> 'voided'
      -- Voided lines were never charged; lines a refund stopped were (the
      -- refund is reported on its own), as in the order's tax total.
      and (i.status <> 'voided' or i.refund_id is not null)
  )
  select jsonb_build_object(
    'total', (
      select coalesce(sum(tax_total), 0) from public.orders
      where branch_id = any (v_branches) and business_date between p_from and p_to
        and paid_at is not null and status <> 'voided'
    ),
    'taxes', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'rate_bps', rate_bps, 'inclusive', inclusive,
        'taxable', taxable, 'amount', amount) order by name, rate_bps)
      from (
        -- An inclusive tax's base is the price without it.
        select name, rate_bps, inclusive, sum(case when inclusive then base - amount else base end) as taxable,
               sum(amount) as amount
        from tax_lines group by name, rate_bps, inclusive
      ) t
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date', business_date, 'branch_id', branch_id, 'name', name,
        'rate_bps', rate_bps, 'inclusive', inclusive, 'taxable', taxable, 'amount', amount)
        order by business_date, name)
      from (
        select business_date, branch_id, name, rate_bps, inclusive,
               sum(case when inclusive then base - amount else base end) as taxable, sum(amount) as amount
        from tax_lines group by business_date, branch_id, name, rate_bps, inclusive
      ) d
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- What discounts and price changes cost, by reason and by staff member.
-- Promotions are added to this report when they exist.
create function public.report_discounts(p_branch_id uuid, p_from date, p_to date)
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
           i.line_discount::bigint as amount
    from public.orders o
    join public.order_items i on i.order_id = o.id and i.parent_item_id is null
    where o.branch_id = any (v_branches) and o.business_date between p_from and p_to
      and o.paid_at is not null and i.line_discount > 0
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

-- ---------------------------------------------------------------------------
-- Exports for the accountant (rows; the app turns them into CSV)
-- ---------------------------------------------------------------------------

-- p_kind: 'sales' (an order per row), 'payments' (a payment or refund per
-- row) or 'tax' (a tax per branch per day). Up to 31 days per call; the app
-- asks month by month.
create function public.report_export(p_kind text, p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branches uuid[] := public.report_branches(p_branch_id);
begin
  perform public.check_report_dates(p_from, p_to);
  if p_to - p_from > 31 then
    raise exception 'Export up to 31 days at a time' using errcode = '22023';
  end if;

  if p_kind = 'sales' then
    return coalesce((
      select jsonb_agg(jsonb_build_array(
        o.business_date, b.name, o.order_number,
        to_char((case when o.is_offline then coalesce(o.client_created_at, o.created_at) else o.created_at end) at time zone b.timezone, 'YYYY-MM-DD HH24:MI'),
        o.channel, o.order_type, o.status, st.full_name,
        o.subtotal, o.discount_total, o.tax_total, o.total,
        coalesce((select sum(r.amount) from public.refunds r where r.order_id = o.id), 0),
        b.currency_code, o.is_offline
      ) order by o.business_date, b.name, o.created_at)
      from public.orders o
      join public.branches b on b.id = o.branch_id
      left join public.staff st on st.id = o.staff_id
      where o.branch_id = any (v_branches) and o.business_date between p_from and p_to
        and o.paid_at is not null and o.status <> 'voided'
    ), '[]'::jsonb);
  elsif p_kind = 'payments' then
    return coalesce((
      select jsonb_agg(row_data order by d, branch_name, at)
      from (
        select d.business_date as d, b.name as branch_name, p.created_at as at,
               jsonb_build_array(d.business_date, b.name, o.order_number,
                 to_char(p.created_at at time zone b.timezone, 'YYYY-MM-DD HH24:MI'),
                 'payment', p.method_name, p.amount, p.tendered, p.change_given, p.reference, st.full_name,
                 b.currency_code) as row_data
        from public.payments p
        join public.shifts sh on sh.id = p.shift_id
        join public.business_days d on d.id = sh.business_day_id
        join public.orders o on o.id = p.order_id
        join public.branches b on b.id = p.branch_id
        left join public.staff st on st.id = p.staff_id
        where p.branch_id = any (v_branches) and d.business_date between p_from and p_to
        union all
        select d.business_date, b.name, r.created_at,
               jsonb_build_array(d.business_date, b.name, o.order_number,
                 to_char(r.created_at at time zone b.timezone, 'YYYY-MM-DD HH24:MI'),
                 'refund', r.method_name, -r.amount, null, null, r.reference, st.full_name, b.currency_code)
        from public.refunds r
        join public.shifts sh on sh.id = r.shift_id
        join public.business_days d on d.id = sh.business_day_id
        join public.orders o on o.id = r.order_id
        join public.branches b on b.id = r.branch_id
        left join public.staff st on st.id = r.staff_id
        where r.branch_id = any (v_branches) and d.business_date between p_from and p_to
      ) x
    ), '[]'::jsonb);
  elsif p_kind = 'tax' then
    return coalesce((
      select jsonb_agg(jsonb_build_array(
        t ->> 'date', b.name, t ->> 'name', (t ->> 'rate_bps')::integer, (t ->> 'inclusive')::boolean,
        (t ->> 'taxable')::bigint, (t ->> 'amount')::bigint, b.currency_code
      ) order by t ->> 'date', b.name, t ->> 'name')
      from jsonb_array_elements(public.report_tax(p_branch_id, p_from, p_to) -> 'daily') t
      join public.branches b on b.id = (t ->> 'branch_id')::uuid
    ), '[]'::jsonb);
  end if;
  raise exception 'Unknown export' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  public.summary_row(uuid, date, uuid, jsonb, jsonb),
  public.day_breakdown(uuid),
  public.business_days_sync_summary(),
  public.report_branches(uuid),
  public.check_report_dates(date, date),
  public.report_daily_totals(uuid[], date, date),
  public.report_sales(uuid, date, date),
  public.report_dashboard(uuid),
  public.report_tax(uuid, date, date),
  public.report_discounts(uuid, date, date),
  public.report_export(text, uuid, date, date)
from public, anon, authenticated;

grant execute on function
  public.report_sales(uuid, date, date),
  public.report_dashboard(uuid),
  public.report_tax(uuid, date, date),
  public.report_discounts(uuid, date, date),
  public.report_export(text, uuid, date, date)
to authenticated;
