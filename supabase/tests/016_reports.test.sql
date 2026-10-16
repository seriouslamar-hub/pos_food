-- Phase 12: reports match the Z report, the daily summary is filled when
-- a day closes, and nobody sees another branch's reports.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

create function pg_temp.login_as(p_auth_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_auth_user_id, 'role', 'authenticated')::text,
    true
  );
end;
$$;

-- Fixtures ------------------------------------------------------------------
-- Branches A and B. Till A with cashier Esi (1111) and manager Yaw (9999,
-- also a back-office login). An admin. A 10% tax on top of every item.

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000901', 'rpt-till@test.local'),
  ('f0000000-0000-4000-8000-000000000902', 'rpt-manager@test.local'),
  ('f0000000-0000-4000-8000-000000000903', 'rpt-admin@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000090a', 'Report Branch A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-00000000090b', 'Report Branch B', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000901', 'f1000000-0000-4000-8000-00000000090a', 'Esi Cashier', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000902', 'f1000000-0000-4000-8000-00000000090a', 'Yaw Manager', 'manager',
   extensions.crypt('9999', extensions.gen_salt('bf', 4)), 'f0000000-0000-4000-8000-000000000902'),
  ('f2000000-0000-4000-8000-000000000903', null, 'Ama Admin', 'admin', null, 'f0000000-0000-4000-8000-000000000903');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000901', 'f1000000-0000-4000-8000-00000000090a',
   'f0000000-0000-4000-8000-000000000901', 'Report Till', 'till', 'T1');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-00000000090a', 'f1000000-0000-4000-8000-00000000090a', current_date);
insert into public.shifts (branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f1000000-0000-4000-8000-00000000090a', 'f8000000-0000-4000-8000-00000000090a',
   'f2000000-0000-4000-8000-000000000901', 'f3000000-0000-4000-8000-000000000901', 0),
  ('f1000000-0000-4000-8000-00000000090a', 'f8000000-0000-4000-8000-00000000090a',
   'f2000000-0000-4000-8000-000000000902', 'f3000000-0000-4000-8000-000000000901', 0);

insert into public.taxes (name, rate_bps, is_inclusive, tax_category) values ('Rpt VAT', 1000, false, 'rpttest');
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000901', 'Report test');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000901', 'f5000000-0000-4000-8000-000000000901', 'item', 'Rpt burger', 2000, 'rpttest'),
  ('f5300000-0000-4000-8000-000000000902', 'f5000000-0000-4000-8000-000000000901', 'item', 'Rpt fries', 1000, 'rpttest');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.sid() returns uuid language sql as $$
  select (result ->> 'session_id')::uuid from r where step = 'session'
$$;
create function pg_temp.order_of(p_order text, p_item text, p_quantity integer, p_line text default null)
returns jsonb language sql as $$
  select jsonb_build_object('id', p_order, 'lines', jsonb_build_array(jsonb_build_object(
    'id', coalesce(p_line, gen_random_uuid()::text), 'menu_item_id', p_item, 'quantity', p_quantity)))
$$;
create function pg_temp.pay(p_order text, p_payment text, p_amount integer, p_type text default 'cash')
returns jsonb language sql as $$
  select public.record_payments(pg_temp.sid(), p_order::uuid, jsonb_build_array(jsonb_build_object(
    'id', p_payment,
    'payment_method_id', (select id from public.payment_methods where type::text = p_type limit 1),
    'reference', 'REF-1',
    'amount', p_amount)))
$$;
create function pg_temp.report(p_branch text default 'f1000000-0000-4000-8000-00000000090a')
returns jsonb language sql as $$
  select public.report_sales(p_branch::uuid, current_date, current_date)
$$;

-- A day of sales -------------------------------------------------------------
-- Order 1: 2 burgers (4000 + 400 tax), cash. Order 2: 1 fries (1000 + 100),
-- card, later refunded. Order 3: burger + fries, unpaid, fries voided.

select pg_temp.login_as('f0000000-0000-4000-8000-000000000901');
insert into r values ('session', public.start_pos_session('1111'));
select public.submit_order(pg_temp.sid(),
  pg_temp.order_of('f6000000-0000-4000-8000-000000000901', 'f5300000-0000-4000-8000-000000000901', 2));
select pg_temp.pay('f6000000-0000-4000-8000-000000000901', 'f7000000-0000-4000-8000-000000000901', 4400);
select public.submit_order(pg_temp.sid(),
  pg_temp.order_of('f6000000-0000-4000-8000-000000000902', 'f5300000-0000-4000-8000-000000000902', 1));
select pg_temp.pay('f6000000-0000-4000-8000-000000000902', 'f7000000-0000-4000-8000-000000000902', 1100, 'card');
select public.submit_order(pg_temp.sid(), jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000903',
  'lines', jsonb_build_array(
    jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000931', 'menu_item_id', 'f5300000-0000-4000-8000-000000000901', 'quantity', 1),
    jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000932', 'menu_item_id', 'f5300000-0000-4000-8000-000000000902', 'quantity', 1))));
select public.void_order_items(pg_temp.sid(), 'f6000000-0000-4000-8000-000000000903',
  array['f6100000-0000-4000-8000-000000000932']::uuid[], 'Customer changed mind', null);
-- The manager refunds order 2 on the till.
delete from r where step = 'session';
insert into r values ('session', public.start_pos_session('9999'));
select public.refund_order(pg_temp.sid(), jsonb_build_object(
  'id', 'f7100000-0000-4000-8000-000000000901', 'order_id', 'f6000000-0000-4000-8000-000000000902',
  'payment_method_id', (select id from public.payment_methods where type = 'cash' limit 1),
  'reason', 'Cold'));
reset role;

-- While the day is open ---------------------------------------------------------
-- Order 1 was ready 125 seconds after reaching the kitchen, and collected a
-- minute later.
update public.orders
set ready_at = sent_to_kitchen_at + interval '125 seconds', collected_at = sent_to_kitchen_at + interval '185 seconds'
where id = 'f6000000-0000-4000-8000-000000000901';

select pg_temp.login_as('f0000000-0000-4000-8000-000000000902');
insert into r values ('live', pg_temp.report());
insert into r values ('dashboard', public.report_dashboard('f1000000-0000-4000-8000-00000000090a'));
reset role;

select is(
  (select result -> 'summary' from r where step = 'live') - 'days' - 'average_order' - 'items_sold',
  jsonb_build_object('orders', 2, 'gross_sales', 5000, 'discounts', 0, 'tax', 500, 'net_sales', 5500,
    'refunds', jsonb_build_object('count', 1, 'amount', 1100),
    'voids', jsonb_build_object('count', 1, 'amount', 1000)),
  'the open day is reported live: two paid orders, the refund and the void'
);
select is(
  (select (result -> 'summary') - 'days' - 'average_order' from r where step = 'live'),
  (select jsonb_build_object(
    'orders', s -> 'orders', 'gross_sales', s -> 'gross_sales', 'discounts', s -> 'discounts', 'tax', s -> 'tax',
    'net_sales', s -> 'net_sales', 'items_sold', s -> 'items_sold',
    'refunds', (s -> 'refunds') - 'cash', 'voids', s -> 'voids')
   from (select public.sales_summary('f8000000-0000-4000-8000-00000000090a', null) as s) x),
  'and matches what the Z report will say'
);
select is((select (result #>> '{summary,average_order}')::int from r where step = 'live'), 2750,
  'average order value');
select is(
  (select jsonb_agg(jsonb_build_object('name', p ->> 'name', 'quantity', (p ->> 'quantity')::int) order by p ->> 'name')
   from r, jsonb_array_elements(result -> 'products') p where step = 'live'),
  '[{"name": "Rpt burger", "quantity": 2}]'::jsonb,
  'product mix counts what was made and paid for (not the unpaid order, nor fries refunded before making)'
);
select is(
  (select jsonb_object_agg(p ->> 'method', (p ->> 'amount')::int) from r, jsonb_array_elements(result -> 'payments') p
   where step = 'live'),
  '{"cash": 4400, "card": 1100}'::jsonb,
  'payments by method'
);
select is(
  (select (h ->> 'orders')::int from r, jsonb_array_elements(result -> 'hourly') h
   where step = 'live' and (h ->> 'hour')::int = extract(hour from now() at time zone 'UTC')::int),
  2, 'sales land in the hour they happened (branch time)'
);
select is(
  (select jsonb_build_object('orders', c -> 'orders', 'net_sales', c -> 'net_sales', 'voids', c -> 'voids_count')
   from r, jsonb_array_elements(result -> 'cashiers') c
   where step = 'live' and c ->> 'name' = 'Esi Cashier'),
  '{"orders": 2, "net_sales": 5500, "voids": 1}'::jsonb,
  'cashier performance'
);
select is(
  (select (c ->> 'refunds_amount')::int from r, jsonb_array_elements(result -> 'cashiers') c
   where step = 'live' and c ->> 'name' = 'Yaw Manager'),
  1100, 'refunds count against who gave them'
);
select is(
  (select jsonb_build_object('orders', result #> '{today,orders}', 'net', result #> '{today,net_sales}',
    'open', result #> '{open_orders,count}', 'day_open', result -> 'day_open') from r where step = 'dashboard'),
  '{"orders": 2, "net": 5500, "open": 1, "day_open": true}'::jsonb,
  'the dashboard: today so far, and the order still open (order 1 was collected)'
);
select is(
  (select result #> '{speed,to_ready}' from r where step = 'live'),
  '{"count": 1, "average": 125, "median": 127, "p90": 127}'::jsonb,
  'speed of service: average exact, median to the nearest 15 seconds'
);
select is((select (result #>> '{last_week_day,orders}')::int from r where step = 'dashboard'), 0,
  'and last week''s same day to compare');

-- Closing the day ------------------------------------------------------------------

update public.shifts
set status = 'approved', closed_at = now(), expected_cash = 0, counted_cash = 0, variance = 0
where business_day_id = 'f8000000-0000-4000-8000-00000000090a';
select is((select count(*)::int from public.daily_sales_summary
  where business_day_id = 'f8000000-0000-4000-8000-00000000090a'), 0, 'no summary while the day is open');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000902');
select lives_ok($$select public.close_business_day('f1000000-0000-4000-8000-00000000090a')$$, 'the day closes');
insert into r values ('closed', pg_temp.report());
insert into r values ('tax', public.report_tax('f1000000-0000-4000-8000-00000000090a', current_date, current_date));
reset role;

select is(
  (select to_jsonb(s) - 'created_at' - 'branch_id' - 'business_date' - 'business_day_id' - 'breakdown'
   from public.daily_sales_summary s where business_day_id = 'f8000000-0000-4000-8000-00000000090a'),
  '{"orders": 2, "gross_sales": 5000, "discounts": 0, "tax": 500, "net_sales": 5500, "items_sold": 2,
    "refunds_count": 1, "refunds_amount": 1100, "voids_count": 1, "voids_amount": 1000}'::jsonb,
  'closing the day stores its totals in the daily summary'
);
select is(
  (select result -> 'summary' from r where step = 'closed'),
  (select result -> 'summary' from r where step = 'live'),
  'the report reads the same from the summary as it did live'
);
select is(
  (select jsonb_build_array(z -> 'orders', z -> 'net_sales', z -> 'tax', z -> 'gross_sales', z #> '{refunds,amount}')
   from (select z_report as z from public.business_days where id = 'f8000000-0000-4000-8000-00000000090a') x),
  (select jsonb_build_array(s -> 'orders', s -> 'net_sales', s -> 'tax', s -> 'gross_sales', s #> '{refunds,amount}')
   from (select result -> 'summary' as s from r where step = 'closed') x),
  'report totals match the Z report for the day'
);
select is(
  (select jsonb_build_object('total', result -> 'total', 'taxes', result -> 'taxes') from r where step = 'tax'),
  '{"total": 500, "taxes": [{"name": "Rpt VAT", "rate_bps": 1000, "inclusive": false, "taxable": 5000, "amount": 500}]}'::jsonb,
  'the tax report: what was taxed, and the tax, matching the Z report'
);
select is(
  (select (z_report -> 'tax')::int from public.business_days where id = 'f8000000-0000-4000-8000-00000000090a'),
  500, 'the Z report''s tax is the same'
);

-- Exports ----------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000902');
select is(
  jsonb_array_length(public.report_export('sales', 'f1000000-0000-4000-8000-00000000090a', current_date, current_date)),
  2, 'the sales export has a row per paid order'
);
select is(
  (select jsonb_agg((x ->> 6)::int order by (x ->> 6)::int)
   from jsonb_array_elements(public.report_export('payments', 'f1000000-0000-4000-8000-00000000090a',
     current_date, current_date)) x),
  '[-1100, 1100, 4400]'::jsonb, 'the payments export lists payments and refunds'
);

-- Who can see what --------------------------------------------------------------------

select throws_ok(
  $$select public.report_sales('f1000000-0000-4000-8000-00000000090b', current_date, current_date)$$,
  '42501', null, 'a manager can''t run reports for another branch'
);
select throws_ok(
  $$select public.report_sales(null, current_date, current_date)$$,
  '42501', null, 'nor for every branch'
);
select throws_ok(
  $$select public.report_sales('f1000000-0000-4000-8000-00000000090a', current_date - 400, current_date)$$,
  '22023', null, 'a report covers up to a year'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000901');
select throws_ok(
  $$select public.report_dashboard('f1000000-0000-4000-8000-00000000090a')$$,
  '42501', null, 'a till can''t read reports'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000903');
select ok(
  (select array_agg(b ->> 'name') from jsonb_array_elements(public.report_sales(null, current_date, current_date) -> 'branches') b)
    @> array['Report Branch A', 'Report Branch B'],
  'an admin reports on every branch'
);

select * from finish();
rollback;
