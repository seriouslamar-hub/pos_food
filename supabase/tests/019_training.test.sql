-- Phase 14: training mode. A device switched into training sells into its
-- branch's training twin: staff still sign in with their PINs, and nothing
-- reaches the real branch's reports, customers' points or coupon limits.
begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

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

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000c01', 'train-till@test.local'),
  ('f0000000-0000-4000-8000-000000000c02', 'train-admin@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-000000000c0a', 'Train Branch', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000c01', 'f1000000-0000-4000-8000-000000000c0a', 'Kwame Cashier', 'cashier',
   extensions.crypt('1357', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000c02', 'f1000000-0000-4000-8000-000000000c0a', 'Adjoa Manager', 'manager',
   extensions.crypt('2468', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000c03', null, 'Train Admin', 'admin', null, 'f0000000-0000-4000-8000-000000000c02');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000c01', 'f1000000-0000-4000-8000-000000000c0a',
   'f0000000-0000-4000-8000-000000000c01', 'Train Till', 'till', 'T1');
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000c01', 'Train test');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000c01', 'f5000000-0000-4000-8000-000000000c01', 'item', 'Train burger', 2000, 'traintest');
insert into public.customers (id, phone, consent_at) values ('f9900000-0000-4000-8000-000000000c01', '0200000099', now());
insert into public.promotions (name, type, value, coupon_code, max_uses)
values ('Train coupon', 'amount_off', 100, 'TRAIN1', 1);

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.sid() returns uuid language sql as $$
  select (result ->> 'session_id')::uuid from r where step = 'session'
$$;

-- Only admins switch it.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000c01');
select throws_ok($$select public.set_device_training('f3000000-0000-4000-8000-000000000c01', true)$$,
  '42501', null, 'a device can''t switch itself into training');
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000c02');
insert into r values ('on', public.set_device_training('f3000000-0000-4000-8000-000000000c01', true));
reset role;
select is((select name from public.branches where training_for = 'f1000000-0000-4000-8000-000000000c0a'),
  'Train Branch (training)', 'switching on makes the branch''s training twin');
select is((select branch_id from public.devices where id = 'f3000000-0000-4000-8000-000000000c01'),
  (select id from public.branches where training_for = 'f1000000-0000-4000-8000-000000000c0a'),
  'and moves the device to it');

-- A training day and shift at the twin, then a practice sale.
insert into public.business_days (branch_id, business_date)
select id, current_date from public.branches where training_for = 'f1000000-0000-4000-8000-000000000c0a';
select pg_temp.login_as('f0000000-0000-4000-8000-000000000c01');
insert into r values ('session', public.start_pos_session('1357'));
select is((select result #>> '{staff,id}' from r where step = 'session'), 'f2000000-0000-4000-8000-000000000c01',
  'the branch''s cashier signs in with their own PIN');
select isnt(public.verify_override(pg_temp.sid(), '2468', 'order.refund', 'Practice'), null,
  'and the branch''s manager can approve');
select public.open_shift(pg_temp.sid(), 0);
select is((public.get_menu((select id from public.branches where training_for = 'f1000000-0000-4000-8000-000000000c0a')) ->> 'training')::boolean,
  true, 'the till''s menu says it''s in training');
insert into r values ('order', public.submit_order(pg_temp.sid(), jsonb_build_object(
  'id', gen_random_uuid(), 'customer_id', 'f9900000-0000-4000-8000-000000000c01', 'coupon_code', 'TRAIN1',
  'lines', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'menu_item_id', 'f5300000-0000-4000-8000-000000000c01', 'quantity', 1)))));
select public.record_payments(pg_temp.sid(), (select (result ->> 'id')::uuid from r where step = 'order'),
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
    'payment_method_id', (select id from public.payment_methods where type = 'card' limit 1),
    'reference', 'X', 'amount', (select (result ->> 'total')::int from r where step = 'order'))));
reset role;

select is((select (result ->> 'training')::boolean from r where step = 'order'), true, 'the order is marked as training');
select is((select branch_id from public.orders where id = (select (result ->> 'id')::uuid from r where step = 'order')),
  (select id from public.branches where training_for = 'f1000000-0000-4000-8000-000000000c0a'),
  'and belongs to the training branch, not the real one');
select is((select points_balance from public.customers where id = 'f9900000-0000-4000-8000-000000000c01'), 0,
  'practice sales don''t earn real customers points');
select is((select result -> 'customer' from r where step = 'order'), 'null'::jsonb, 'nor are linked to them');

-- The coupon still works for practice, but its one real use isn't spent.
select is((select (result ->> 'promotion_total')::int from r where step = 'order'), 100, 'coupons work for practice');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000c01');
select is((public.check_coupon(pg_temp.sid(), 'TRAIN1') ->> 'name'), 'Train coupon',
  'the one-use coupon is still unused for real sales');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000c02');
select is(
  (select count(*)::int from jsonb_array_elements(public.report_sales(null, current_date, current_date) -> 'branches') b
   where b ->> 'name' like '%(training)'),
  0, 'all-branch reports leave training branches out');

-- Back again, once the shift is closed.
select throws_ok($$select public.set_device_training('f3000000-0000-4000-8000-000000000c01', false)$$,
  '22023', null, 'not while a shift is open on it');
reset role;

select * from finish();
rollback;
