-- Phase 14 security review: every table, as a manager and a till device of
-- branch A, against real data in branch B. Plus: who may write tables
-- directly at all (everything else goes through RPCs).
begin;
create extension if not exists pgtap with schema extensions;

select plan(21);

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

-- Tables (with a branch_id) where the current user can see rows of a branch.
create function pg_temp.visible_tables(p_branch uuid)
returns text[]
language plpgsql
as $$
declare
  t record;
  n bigint;
  found_tables text[] := '{}';
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x using (table_schema, table_name)
    where c.table_schema = 'public' and c.column_name = 'branch_id' and x.table_type = 'BASE TABLE'
    order by 1
  loop
    begin
      execute format('select count(*) from public.%I where branch_id = $1', t.table_name) into n using p_branch;
    exception when insufficient_privilege then
      n := 0;
    end;
    if n > 0 then
      found_tables := found_tables || t.table_name::text;
    end if;
  end loop;
  return found_tables;
end;
$$;

-- Of the given tables, those where the current user can see any row.
create function pg_temp.readable(p_tables text[])
returns text[]
language plpgsql
as $$
declare
  t text;
  n bigint;
  found_tables text[] := '{}';
begin
  foreach t in array p_tables loop
    begin
      execute format('select count(*) from public.%I', t) into n;
    exception when insufficient_privilege then
      n := 0;
    end;
    if n > 0 then
      found_tables := found_tables || t;
    end if;
  end loop;
  return found_tables;
end;
$$;
grant execute on function pg_temp.visible_tables(uuid), pg_temp.readable(text[]) to authenticated;

-- Fixtures ------------------------------------------------------------------
-- Branch A: manager Abena (back office) and till A. Branch B: manager Bayo,
-- till B and cashier Bisi, with a day of real activity.

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000b01', 'sec-manager-a@test.local'),
  ('f0000000-0000-4000-8000-000000000b02', 'sec-till-a@test.local'),
  ('f0000000-0000-4000-8000-000000000b03', 'sec-till-b@test.local'),
  ('f0000000-0000-4000-8000-000000000b04', 'sec-manager-b@test.local'),
  ('f0000000-0000-4000-8000-000000000b05', 'sec-admin@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-000000000b0a', 'Security A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-000000000b0b', 'Security B', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000b01', 'f1000000-0000-4000-8000-000000000b0a', 'Abena Manager', 'manager',
   extensions.crypt('9001', extensions.gen_salt('bf', 4)), 'f0000000-0000-4000-8000-000000000b01'),
  ('f2000000-0000-4000-8000-000000000b02', 'f1000000-0000-4000-8000-000000000b0b', 'Bayo Manager', 'manager',
   extensions.crypt('9002', extensions.gen_salt('bf', 4)), 'f0000000-0000-4000-8000-000000000b04'),
  ('f2000000-0000-4000-8000-000000000b03', 'f1000000-0000-4000-8000-000000000b0b', 'Bisi Cashier', 'cashier',
   extensions.crypt('1002', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000b05', null, 'Sec Admin', 'admin', null, 'f0000000-0000-4000-8000-000000000b05');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000b0a', 'f1000000-0000-4000-8000-000000000b0a',
   'f0000000-0000-4000-8000-000000000b02', 'Till A', 'till', 'TA'),
  ('f3000000-0000-4000-8000-000000000b0b', 'f1000000-0000-4000-8000-000000000b0b',
   'f0000000-0000-4000-8000-000000000b03', 'Till B', 'till', 'TB');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-000000000b0b', 'f1000000-0000-4000-8000-000000000b0b', current_date);
insert into public.shifts (id, branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f8100000-0000-4000-8000-000000000b01', 'f1000000-0000-4000-8000-000000000b0b', 'f8000000-0000-4000-8000-000000000b0b',
   'f2000000-0000-4000-8000-000000000b03', 'f3000000-0000-4000-8000-000000000b0b', 5000),
  ('f8100000-0000-4000-8000-000000000b02', 'f1000000-0000-4000-8000-000000000b0b', 'f8000000-0000-4000-8000-000000000b0b',
   'f2000000-0000-4000-8000-000000000b02', 'f3000000-0000-4000-8000-000000000b0b', 0);
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000b01', 'Security test');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000b01', 'f5000000-0000-4000-8000-000000000b01', 'item', 'Sec burger', 2000, 'sectest');
insert into public.branch_menu_items (branch_id, menu_item_id, price_override, is_available) values
  ('f1000000-0000-4000-8000-000000000b0b', 'f5300000-0000-4000-8000-000000000b01', 2100, true);
insert into public.settings (branch_id, key, value) values
  ('f1000000-0000-4000-8000-000000000b0b', 'till.auto_lock_minutes', '7');
insert into public.ingredients (id, name, unit, cost_per_unit, reorder_level) values
  ('f9200000-0000-4000-8000-000000000b01', 'Sec patty', 'pc', 300, 5);
insert into public.recipes (menu_item_id, ingredient_id, quantity) values
  ('f5300000-0000-4000-8000-000000000b01', 'f9200000-0000-4000-8000-000000000b01', 1);
insert into public.suppliers (id, name) values ('f9100000-0000-4000-8000-000000000b01', 'Sec supplier');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;

-- A day at branch B: two orders paid (one refunded), a cash drop, a
-- customer with points, a waste record and a purchase order.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000b03');
insert into r values ('cashier', public.start_pos_session('1002'));
insert into r values ('customer', public.save_customer((select (result ->> 'session_id')::uuid from r where step = 'cashier'),
  '{"id": "f9900000-0000-4000-8000-000000000b01", "phone": "0200000001", "consent": true}'));
insert into r values ('order1', public.submit_order((select (result ->> 'session_id')::uuid from r where step = 'cashier'),
  jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000b01', 'customer_id', 'f9900000-0000-4000-8000-000000000b01',
    'lines', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'menu_item_id', 'f5300000-0000-4000-8000-000000000b01', 'quantity', 1)))));
select public.record_payments((select (result ->> 'session_id')::uuid from r where step = 'cashier'),
  'f6000000-0000-4000-8000-000000000b01', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
    'payment_method_id', (select id from public.payment_methods where type = 'cash' limit 1), 'amount', 2100, 'tendered', 2100)));
select public.record_cash_movement((select (result ->> 'session_id')::uuid from r where step = 'cashier'),
  jsonb_build_object('id', gen_random_uuid(), 'type', 'drop', 'amount', 1000, 'reason', 'Safe'));
select public.verify_override((select (result ->> 'session_id')::uuid from r where step = 'cashier'), '9002', 'order.refund', 'Test');
insert into r values ('manager', public.start_pos_session('9002'));
select public.refund_order((select (result ->> 'session_id')::uuid from r where step = 'manager'), jsonb_build_object(
  'id', gen_random_uuid(), 'order_id', 'f6000000-0000-4000-8000-000000000b01',
  'payment_method_id', (select id from public.payment_methods where type = 'cash' limit 1), 'reason', 'Cold'));
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000b04');
select public.record_waste('f1000000-0000-4000-8000-000000000b0b', jsonb_build_object('id', gen_random_uuid(),
  'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000b01', 'quantity', 1, 'reason', 'Dropped'))));
select public.save_purchase_order('f1000000-0000-4000-8000-000000000b0b', jsonb_build_object(
  'id', 'fa100000-0000-4000-8000-000000000b01', 'supplier_id', 'f9100000-0000-4000-8000-000000000b01',
  'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000b01', 'quantity', 10))));
select public.submit_stock_count('f1000000-0000-4000-8000-000000000b0b', jsonb_build_object('id', gen_random_uuid(),
  'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000b01', 'quantity', 3))));
reset role;
insert into public.daily_sales_summary (branch_id, business_date, business_day_id)
values ('f1000000-0000-4000-8000-000000000b0b', current_date - 1,
  (select id from public.business_days where id = 'f8000000-0000-4000-8000-000000000b0b'));

-- The fixture really reaches most branch tables (so the checks below bite).
select ok(
  cardinality(pg_temp.visible_tables('f1000000-0000-4000-8000-000000000b0b')) >= 18,
  'branch B has data in at least 18 tables: ' || array_to_string(pg_temp.visible_tables('f1000000-0000-4000-8000-000000000b0b'), ', ')
);

-- Reads across branches ------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000b01');
select is(pg_temp.visible_tables('f1000000-0000-4000-8000-000000000b0b'), '{}'::text[],
  'a manager of branch A sees no rows of branch B in any table');
select is(pg_temp.readable(array['customers']), '{}'::text[], 'nor customers (only admins see those)');
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000b02');
select is(pg_temp.visible_tables('f1000000-0000-4000-8000-000000000b0b'), '{}'::text[],
  'a till of branch A sees no rows of branch B in any table');
select is(
  pg_temp.readable(array['staff', 'audit_log', 'customers', 'loyalty_transactions', 'promotion_redemptions',
    'pin_attempts', 'override_approvals', 'cash_movements', 'refunds', 'shifts', 'stock_movements', 'branch_stock',
    'purchase_orders', 'purchase_order_lines', 'stock_counts', 'stock_count_lines', 'daily_sales_summary',
    'rate_limits', 'promotions', 'suppliers', 'ingredients', 'recipes', 'order_counters', 'pos_sessions']),
  '{}'::text[],
  'a till reads none of the back-office tables directly (PIN hashes, audit, cash, stock, customers)'
);
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000b04');
select ok(cardinality(pg_temp.visible_tables('f1000000-0000-4000-8000-000000000b0b')) >= 15,
  'branch B''s own manager does see their branch');
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000b05');
select ok(cardinality(pg_temp.visible_tables('f1000000-0000-4000-8000-000000000b0b')) >= 18,
  'and an admin sees every branch');
reset role;

-- Writes across branches ------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000b01');
update public.settings set value = '99' where branch_id = 'f1000000-0000-4000-8000-000000000b0b';
delete from public.settings where branch_id = 'f1000000-0000-4000-8000-000000000b0b';
reset role;
select is((select value #>> '{}' from public.settings where branch_id = 'f1000000-0000-4000-8000-000000000b0b'
  and key = 'till.auto_lock_minutes'), '7', 'a manager can''t change or delete another branch''s settings');

select pg_temp.login_as('f0000000-0000-4000-8000-000000000b01');
select throws_ok($$select public.open_business_day('f1000000-0000-4000-8000-000000000b0b')$$, null, null,
  'nor open or close its day');
select throws_ok($$select public.set_branch_price('f1000000-0000-4000-8000-000000000b0b', 'f5300000-0000-4000-8000-000000000b01', 1)$$,
  null, null, 'nor change its prices');
select throws_ok($$select public.set_availability('f1000000-0000-4000-8000-000000000b0b', 'item', 'f5300000-0000-4000-8000-000000000b01', false)$$,
  null, null, 'nor its availability');
select throws_ok($$select public.review_shift('f8100000-0000-4000-8000-000000000b01', 'approved', null)$$,
  null, null, 'nor review its shifts');
select throws_ok($$select public.set_staff_pin('f2000000-0000-4000-8000-000000000b03', '4321')$$,
  null, null, 'nor set its staff''s PINs');
select throws_ok($$select public.record_waste('f1000000-0000-4000-8000-000000000b0b', jsonb_build_object('id', gen_random_uuid(),
  'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000b01', 'quantity', 1, 'reason', 'x'))))$$,
  null, null, 'nor record its waste');
select throws_ok($$select public.receive_purchase_order('fa100000-0000-4000-8000-000000000b01')$$,
  null, null, 'nor receive its deliveries');
select throws_ok($$select public.search_orders('f1000000-0000-4000-8000-000000000b0b')$$,
  null, null, 'nor search its orders');
reset role;

-- Direct writes that only RPCs may make ---------------------------------------------

-- Signed-in users can write a table only where a policy allows that kind
-- of write, and can never TRUNCATE (RLS doesn't cover it).
select is(
  (select coalesce(array_agg(g.table_name || ':' || g.privilege_type order by 1), '{}')
   from information_schema.role_table_grants g
   where g.grantee in ('authenticated', 'anon', 'PUBLIC') and g.table_schema = 'public'
     and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = g.table_name and p.cmd in (g.privilege_type, 'ALL')
     )),
  '{}'::text[],
  'no table can be written directly without a policy for it'
);
select is(
  (select coalesce(array_agg(distinct g.table_name::text), '{}') from information_schema.role_table_grants g
   where g.grantee in ('authenticated', 'anon', 'PUBLIC') and g.table_schema = 'public'
     and g.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  '{}'::text[],
  'nobody can TRUNCATE (or add triggers or references to) any table'
);

select pg_temp.login_as('f0000000-0000-4000-8000-000000000b05');
select throws_ok(
  $$insert into public.orders (id, branch_id, business_date, order_number) values (gen_random_uuid(), 'f1000000-0000-4000-8000-000000000b0a', current_date, 'X1')$$,
  '42501', null, 'even an admin can''t insert an order directly (submit_order only)'
);
select throws_ok(
  $$update public.payments set amount = 1$$,
  '42501', null, 'or change a payment'
);
select throws_ok(
  $$update public.customers set points_balance = 1000000$$,
  '42501', null, 'or give a customer points'
);
reset role;

select * from finish();
rollback;
