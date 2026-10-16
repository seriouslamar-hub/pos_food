-- A year of sales for checking report speed. LOCAL DATABASE ONLY:
--   docker exec -i supabase_db_fastfood-pos psql -U postgres -v ON_ERROR_STOP=1 < supabase/perf/year_of_sales.sql
-- Adds a "Perf branch" with ~300 orders a day for 365 closed days (about
-- 110,000 orders), each day closed with its Z report. Run `supabase db
-- reset` to remove it.
\timing on
begin;

insert into public.branches (id, name, timezone, currency_code)
values ('1f000000-0000-4000-8000-000000000001', 'Perf branch', 'Africa/Accra', 'USD');
insert into public.staff (id, branch_id, full_name, role)
select ('2f000000-0000-4000-8000-00000000000' || n)::uuid, '1f000000-0000-4000-8000-000000000001',
       'Perf cashier ' || n, 'cashier'
from generate_series(1, 4) n;
insert into auth.users (id, email) values ('af000000-0000-4000-8000-000000000001', 'perf-till@example.com');
insert into public.devices (id, branch_id, auth_user_id, name, type, code)
values ('3f000000-0000-4000-8000-000000000001', '1f000000-0000-4000-8000-000000000001',
        'af000000-0000-4000-8000-000000000001', 'Perf till', 'till', 'T1');

create temp table perf_days as
select gen_random_uuid() as id, (current_date - n) as business_date
from generate_series(1, 365) n;

insert into public.business_days (id, branch_id, business_date, status, opened_at, closed_at)
select id, '1f000000-0000-4000-8000-000000000001', business_date, 'closed',
       (business_date + time '09:00') at time zone 'Africa/Accra',
       (business_date + time '23:30') at time zone 'Africa/Accra'
from perf_days;

create temp table perf_shifts as
select gen_random_uuid() as id, d.id as day_id, d.business_date,
       ('2f000000-0000-4000-8000-00000000000' || (1 + (s % 4)))::uuid as staff_id
from perf_days d cross join generate_series(0, 1) s;

insert into public.shifts (id, branch_id, business_day_id, staff_id, device_id, opening_float, status,
  opened_at, closed_at, expected_cash, counted_cash, variance)
select id, '1f000000-0000-4000-8000-000000000001', day_id, staff_id, '3f000000-0000-4000-8000-000000000001',
       10000, 'approved', (business_date + time '09:00') at time zone 'Africa/Accra',
       (business_date + time '23:00') at time zone 'Africa/Accra', 0, 0, 0
from perf_shifts;

create temp table perf_items as
select id, name, coalesce(short_name, name) as short_name, base_price, row_number() over (order by name) as n
from public.menu_items where type = 'item' and is_active;

create temp table perf_orders as
select gen_random_uuid() as id, s.business_date, s.id as shift_id, s.staff_id, n,
       (s.business_date + time '10:00' + random() * interval '12 hours') at time zone 'Africa/Accra' as at,
       (array['dine_in', 'takeaway', 'takeaway'])[1 + floor(random() * 3)::int]::public.order_type as order_type,
       random() < 0.6 as cash
from perf_shifts s cross join generate_series(1, 150) n;

create temp table perf_picks as
select gen_random_uuid() as id, o.id as order_id, l as sort_order,
       1 + floor(random() * (select count(*) from perf_items))::int as pick,
       1 + floor(random() * 2)::int as quantity
from perf_orders o
cross join generate_series(1, 2) l;

create temp table perf_lines as
select p.id, p.order_id, i.id as item_id, i.name, i.short_name, i.base_price, p.quantity, p.sort_order
from perf_picks p
join perf_items i on i.n = p.pick;

insert into public.orders (id, branch_id, device_id, staff_id, shift_id, business_date, order_number, channel,
  order_type, status, subtotal, discount_total, tax_total, total, client_created_at, created_at,
  sent_to_kitchen_at, paid_at, ready_at, collected_at)
select o.id, '1f000000-0000-4000-8000-000000000001', '3f000000-0000-4000-8000-000000000001', o.staff_id,
       o.shift_id, o.business_date, lpad((row_number() over (partition by o.business_date order by o.at))::text, 3, '0'),
       'counter', o.order_type, 'collected', t.total, 0, 0, t.total, o.at, o.at,
       o.at + interval '1 minute', o.at + interval '1 minute',
       o.at + interval '1 minute' + (120 + random() * 360) * interval '1 second',
       o.at + interval '9 minutes'
from perf_orders o
join (select order_id, sum(base_price * quantity)::int as total from perf_lines group by order_id) t on t.order_id = o.id;

insert into public.order_items (id, order_id, branch_id, menu_item_id, name_snapshot, short_name_snapshot, quantity,
  unit_price, line_subtotal, line_discount, line_tax, line_total, status, sort_order)
select id, order_id, '1f000000-0000-4000-8000-000000000001', item_id, name, short_name, quantity, base_price,
       base_price * quantity, 0, 0, base_price * quantity, 'ready', sort_order
from perf_lines;

insert into public.payments (id, order_id, branch_id, shift_id, payment_method_id, method, method_name, amount,
  tendered, change_given, status, staff_id, device_id, created_at)
select gen_random_uuid(), o.id, o.branch_id, o.shift_id, m.id, m.type, m.name, o.total,
       case when m.type = 'cash' then o.total end, case when m.type = 'cash' then 0 end,
       'captured', o.staff_id, o.device_id, o.paid_at
from public.orders o
join perf_orders p on p.id = o.id
join public.payment_methods m on m.type = case when p.cash then 'cash' else 'card' end::public.payment_method_type
where o.branch_id = '1f000000-0000-4000-8000-000000000001';

commit;
analyze;

-- Close every day with its Z report (fills daily_sales_summary).
begin;
update public.business_days set z_report = public.day_report(id)
where branch_id = '1f000000-0000-4000-8000-000000000001';

commit;
analyze;

select count(*) as orders from public.orders where branch_id = '1f000000-0000-4000-8000-000000000001';
select count(*) as summary_days from public.daily_sales_summary where branch_id = '1f000000-0000-4000-8000-000000000001';
