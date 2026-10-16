-- Phase 15: kiosk and online orders are priced by the server, wait unpaid
-- (and out of the kitchen) until paid, and online payments are confirmed
-- only by the server, once, for the right amount.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

create function pg_temp.login_as(p_auth_user_id uuid, p_phone text default null)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_auth_user_id, 'role', 'authenticated', 'phone', p_phone))::text,
    true
  );
end;
$$;

insert into auth.users (id, email, phone) values
  ('f0000000-0000-4000-8000-000000000e01', 'kiosk@test.local', null),
  ('f0000000-0000-4000-8000-000000000e02', 'online-till@test.local', null),
  ('f0000000-0000-4000-8000-000000000e03', null, '233200000001'),
  ('f0000000-0000-4000-8000-000000000e04', null, '233200000002'),
  ('f0000000-0000-4000-8000-000000000e05', 'online-manager@test.local', null);
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-000000000e0a', 'Online Branch', 'UTC', 'GHS'),
  ('f1000000-0000-4000-8000-000000000e0b', 'Offline Branch', 'UTC', 'GHS');
insert into public.staff (id, branch_id, full_name, role, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000e05', 'f1000000-0000-4000-8000-000000000e0a', 'Online Manager', 'manager',
   'f0000000-0000-4000-8000-000000000e05');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000e01', 'f1000000-0000-4000-8000-000000000e0a',
   'f0000000-0000-4000-8000-000000000e01', 'Front kiosk', 'kiosk', 'K1'),
  ('f3000000-0000-4000-8000-000000000e02', 'f1000000-0000-4000-8000-000000000e0a',
   'f0000000-0000-4000-8000-000000000e02', 'Online till', 'till', 'T1');
insert into public.business_days (branch_id, business_date) values
  ('f1000000-0000-4000-8000-000000000e0a', current_date);
insert into public.settings (branch_id, key, value) values
  ('f1000000-0000-4000-8000-000000000e0a', 'online.enabled', 'true'),
  ('f1000000-0000-4000-8000-000000000e0a', 'online.prep_minutes', '15');
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000e01', 'Online test');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000e01', 'f5000000-0000-4000-8000-000000000e01', 'item', 'Online burger', 3000, 'onlinetest');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated, anon, service_role;
create function pg_temp.order_json(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'lines', jsonb_build_array(jsonb_build_object(
    'id', md5(p_id)::uuid, 'menu_item_id', 'f5300000-0000-4000-8000-000000000e01', 'quantity', 2,
    -- A customer can't send prices or discounts; these are ignored.
    'price', jsonb_build_object('unit_price', 1, 'reason', 'x'),
    'discount', jsonb_build_object('type', 'percent', 'value', 10000, 'reason', 'x')))) || p_extra
$$;

-- Kiosk -----------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000e01');
insert into r values ('kiosk', public.submit_kiosk_order(pg_temp.order_json('f6000000-0000-4000-8000-000000000e01',
  '{"discount": {"type": "percent", "value": 5000, "reason": "free"}}')));
reset role;
select is(
  (select jsonb_build_object('channel', result -> 'channel', 'total', result -> 'total', 'paid', result -> 'paid_at')
   from r where step = 'kiosk'),
  '{"channel": "kiosk", "total": 6000, "paid": null}'::jsonb,
  'a kiosk order is priced from the menu (prices and discounts sent are ignored) and waits unpaid'
);
select is((select sent_to_kitchen_at from public.orders where id = 'f6000000-0000-4000-8000-000000000e01'), null,
  'and doesn''t reach the kitchen yet');
select is((select pay_at_counter from public.orders where id = 'f6000000-0000-4000-8000-000000000e01'), true,
  'it''s paid at the counter');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000e01');
insert into r values ('kiosk2', public.submit_kiosk_order(pg_temp.order_json('f6000000-0000-4000-8000-000000000e09',
  '{"payment_preference": "card"}')));
insert into r values ('kiosk3', public.submit_kiosk_order(pg_temp.order_json('f6000000-0000-4000-8000-000000000e08',
  '{"payment_preference": "bitcoin"}')));
reset role;
select is(
  array[(select result ->> 'payment_preference' from r where step = 'kiosk2'), (select result ->> 'payment_preference' from r where step = 'kiosk3')],
  array['card', null], 'the customer''s choice of payment is kept (only methods the branch takes)');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000e02');
select throws_ok($$select public.submit_kiosk_order(pg_temp.order_json(gen_random_uuid()::text))$$, '42501', null,
  'a till can''t place kiosk orders');
reset role;

-- The public menu ---------------------------------------------------------------------

set local role anon;
select is(
  (select array_agg(b ->> 'name') from jsonb_array_elements(public.list_online_branches()) b),
  array['Online Branch'], 'anyone sees the branches taking online orders (only those)'
);
select is(
  (select array_agg(k order by k) from jsonb_array_elements(public.get_public_menu('f1000000-0000-4000-8000-000000000e0a') -> 'payment_methods') m,
     jsonb_object_keys(m) k where m ->> 'type' = 'cash'),
  array['id', 'name', 'type'], 'the public menu lists payment methods only as choices (no settings)');
select ok(jsonb_array_length(public.get_public_menu('f1000000-0000-4000-8000-000000000e0a') -> 'items') >= 1,
  'and shows the items');
select throws_ok($$select public.get_public_menu('f1000000-0000-4000-8000-000000000e0b')$$, 'P0002', null,
  'a branch without online ordering has no public menu');
select throws_ok($$select public.place_online_order('f1000000-0000-4000-8000-000000000e0a', '{}')$$, '42501', null,
  'and nobody orders without signing in');
reset role;

-- Online orders --------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000e03', '233200000001');
select throws_ok(
  $$select public.place_online_order('f1000000-0000-4000-8000-000000000e0a',
    pg_temp.order_json(gen_random_uuid()::text, jsonb_build_object('pickup_at', now() + interval '5 minutes')))$$,
  '22023', null, 'a pickup time sooner than the kitchen needs is refused');
insert into r values ('online', public.place_online_order('f1000000-0000-4000-8000-000000000e0a',
  pg_temp.order_json('f6000000-0000-4000-8000-000000000e02', jsonb_build_object('pickup_at', now() + interval '30 minutes'))));
select is(
  (select jsonb_build_object('total', result -> 'total', 'paid', result -> 'paid') from r where step = 'online'),
  '{"total": 6000, "paid": false}'::jsonb, 'a verified customer''s online order is priced by the server and unpaid'
);
select is((public.get_online_order('f6000000-0000-4000-8000-000000000e02') ->> 'order_number'),
  (select result ->> 'order_number' from r where step = 'online'), 'they can follow it');
reset role;
select is(
  (select jsonb_build_object('channel', channel, 'phone', customer_phone, 'kitchen', sent_to_kitchen_at)
   from public.orders where id = 'f6000000-0000-4000-8000-000000000e02'),
  '{"channel": "online", "phone": "+233200000001", "kitchen": null}'::jsonb,
  'it has the verified phone number and isn''t in the kitchen'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000e04', '233200000002');
select throws_ok($$select public.get_online_order('f6000000-0000-4000-8000-000000000e02')$$, 'P0002', null,
  'another customer can''t see it');
reset role;
insert into public.settings (branch_id, key, value) values ('f1000000-0000-4000-8000-000000000e0a', 'online.pay_at_counter', 'false');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000e04', '233200000002');
select throws_ok($$select public.place_online_order('f1000000-0000-4000-8000-000000000e0a',
    pg_temp.order_json(gen_random_uuid()::text, jsonb_build_object('pickup_at', now() + interval '30 minutes', 'pay_at_counter', true)))$$,
  '22023', null, 'paying at the counter only where the branch allows it');
reset role;
delete from public.settings where branch_id = 'f1000000-0000-4000-8000-000000000e0a' and key = 'online.pay_at_counter';
select pg_temp.login_as('f0000000-0000-4000-8000-000000000e04', '233200000002');
select is(
  (public.place_online_order('f1000000-0000-4000-8000-000000000e0a', pg_temp.order_json(gen_random_uuid()::text,
    jsonb_build_object('pickup_at', now() + interval '30 minutes', 'pay_at_counter', true, 'payment_preference', 'mobile_money')))
   ->> 'payment_preference'),
  'mobile_money', 'online orders are paid at the counter by default, with the customer''s choice of method');
select throws_ok($$select public.confirm_online_payment('x', 1, 'GHS')$$, '42501', null,
  'customers can''t confirm payments themselves');
reset role;

-- Payments, confirmed by the server ------------------------------------------------------

set local role service_role;
select public.start_online_payment('f6000000-0000-4000-8000-000000000e02', 'test', 'REF-E1');
select throws_ok($$select public.confirm_online_payment('REF-E1', 100, 'GHS')$$, '22023', null,
  'a payment for the wrong amount is refused');
reset role;
select is((select paid_at from public.orders where id = 'f6000000-0000-4000-8000-000000000e02'), null,
  'and the order stays unpaid, out of the kitchen');
set local role service_role;
select public.start_online_payment('f6000000-0000-4000-8000-000000000e02', 'test', 'REF-E2');
select is((public.confirm_online_payment('REF-E2', 6000, 'ghs') ->> 'ok')::boolean, true, 'the right payment is accepted');
select is((public.confirm_online_payment('REF-E2', 6000, 'GHS') ->> 'already')::boolean, true,
  'and the provider sending it again changes nothing');
reset role;
select is(
  (select jsonb_build_object('status', o.status, 'kitchen', o.sent_to_kitchen_at is not null,
     'payments', (select count(*) from public.payments p where p.order_id = o.id and p.shift_id is null))
   from public.orders o where o.id = 'f6000000-0000-4000-8000-000000000e02'),
  '{"status": "paid", "kitchen": true, "payments": 1}'::jsonb,
  'paid, it goes to the kitchen, with one payment'
);
select is(
  (select (p ->> 'amount')::int from jsonb_array_elements(
     public.sales_summary((select id from public.business_days where branch_id = 'f1000000-0000-4000-8000-000000000e0a'), null) -> 'payments') p
   where p ->> 'name' = 'Paid online'),
  6000, 'online payments count in the Z report''s payments'
);

-- Pausing --------------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000e05');
select is((public.set_online_ordering('f1000000-0000-4000-8000-000000000e0a', true) ->> 'paused')::boolean, true,
  'a manager pauses online ordering');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000e03', '233200000001');
select throws_ok($$select public.place_online_order('f1000000-0000-4000-8000-000000000e0a',
    pg_temp.order_json(gen_random_uuid()::text, jsonb_build_object('pickup_at', now() + interval '30 minutes')))$$,
  '22023', null, 'and new online orders wait until it resumes');
reset role;

select * from finish();
rollback;
