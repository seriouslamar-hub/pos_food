-- Phase 13: promotions (types, stacking, time windows in the branch's
-- timezone, coupons and their limits) and loyalty points (consent, earn,
-- redeem, refunds take them back).
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

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
-- A branch in Auckland (UTC+13 in October). Till with cashier Ama (1111)
-- and manager Kojo (9999, also a back-office login). Burger 20.00, fries
-- 10.00, no tax. Each promotion is limited to its own order type or
-- channel so they don't meet:
--   counter takeaway: "Take 1" 1.00 off and "Take 10%" (both stack),
--     coupon BIG50 (50%, alone) and coupon ONCE (2.00 off, one use)
--   drive-thru: lunch 12:00–14:00, 10% off
--   delivery: fries buy 2 get 1 free
--   kiosk: burgers 15.00 each

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000a01', 'promo-till@test.local'),
  ('f0000000-0000-4000-8000-000000000a02', 'promo-manager@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-000000000a0a', 'Promo Branch', 'Pacific/Auckland', 'NZD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000a01', 'f1000000-0000-4000-8000-000000000a0a', 'Ama Cashier', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000a02', 'f1000000-0000-4000-8000-000000000a0a', 'Kojo Manager', 'manager',
   extensions.crypt('9999', extensions.gen_salt('bf', 4)), 'f0000000-0000-4000-8000-000000000a02');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000a01', 'f1000000-0000-4000-8000-000000000a0a',
   'f0000000-0000-4000-8000-000000000a01', 'Promo Till', 'till', 'T1');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-000000000a0a', 'f1000000-0000-4000-8000-000000000a0a', current_date);
insert into public.shifts (branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f1000000-0000-4000-8000-000000000a0a', 'f8000000-0000-4000-8000-000000000a0a',
   'f2000000-0000-4000-8000-000000000a01', 'f3000000-0000-4000-8000-000000000a01', 0),
  ('f1000000-0000-4000-8000-000000000a0a', 'f8000000-0000-4000-8000-000000000a0a',
   'f2000000-0000-4000-8000-000000000a02', 'f3000000-0000-4000-8000-000000000a01', 0);

insert into public.categories (id, name) values
  ('f5000000-0000-4000-8000-000000000a01', 'Promo mains'),
  ('f5000000-0000-4000-8000-000000000a02', 'Promo sides');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000a01', 'f5000000-0000-4000-8000-000000000a01', 'item', 'Promo burger', 2000, 'promotest'),
  ('f5300000-0000-4000-8000-000000000a02', 'f5000000-0000-4000-8000-000000000a02', 'item', 'Promo fries', 1000, 'promotest');

insert into public.promotions (name, type, value, channels, order_types, priority, stackable, branch_ids, coupon_code,
  max_uses, start_time, end_time, category_ids, buy_quantity, get_quantity) values
  ('Take 1', 'amount_off', 100, '{counter}', '{takeaway}', 5, true, '{f1000000-0000-4000-8000-000000000a0a}', null, null, null, null, '{}', null, null),
  ('Take 10%', 'percent_off', 1000, '{counter}', '{takeaway}', 4, true, '{f1000000-0000-4000-8000-000000000a0a}', null, null, null, null, '{}', null, null),
  ('Half price', 'percent_off', 5000, '{counter}', '{takeaway}', 10, false, '{f1000000-0000-4000-8000-000000000a0a}', 'BIG50', null, null, null, '{}', null, null),
  ('Once off', 'amount_off', 200, '{counter}', '{takeaway}', 20, false, '{f1000000-0000-4000-8000-000000000a0a}', 'ONCE', 1, null, null, '{}', null, null),
  ('Lunch', 'percent_off', 1000, '{drive_thru}', '{}', 0, false, '{f1000000-0000-4000-8000-000000000a0a}', null, null, '12:00', '14:00', '{}', null, null),
  ('Fries 3 for 2', 'buy_x_get_y', 0, '{counter}', '{delivery}', 0, false, '{f1000000-0000-4000-8000-000000000a0a}', null, null, null, null,
   '{f5000000-0000-4000-8000-000000000a02}', 2, 1),
  ('Kiosk burger', 'fixed_price', 1500, '{kiosk}', '{}', 0, false, '{f1000000-0000-4000-8000-000000000a0a}', null, null, null, null, '{}', null, null);
update public.promotions set item_ids = '{f5300000-0000-4000-8000-000000000a01}' where name = 'Kiosk burger';

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.sid() returns uuid language sql as $$
  select (result ->> 'session_id')::uuid from r where step = 'session'
$$;
create function pg_temp.order_of(p_extra jsonb, p_item text, p_quantity integer)
returns jsonb language sql as $$
  select jsonb_build_object('id', gen_random_uuid(), 'lines', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'menu_item_id', p_item, 'quantity', p_quantity))) || p_extra
$$;
create function pg_temp.burgers(p_extra jsonb, p_quantity integer default 1) returns jsonb language sql as $$
  select public.submit_order(pg_temp.sid(),
    pg_temp.order_of(p_extra, 'f5300000-0000-4000-8000-000000000a01', p_quantity))
$$;
create function pg_temp.fries(p_extra jsonb, p_quantity integer default 1) returns jsonb language sql as $$
  select public.submit_order(pg_temp.sid(),
    pg_temp.order_of(p_extra, 'f5300000-0000-4000-8000-000000000a02', p_quantity))
$$;
create function pg_temp.pay(p_order jsonb) returns jsonb language sql as $$
  select public.record_payments(pg_temp.sid(), (p_order ->> 'id')::uuid, jsonb_build_array(jsonb_build_object(
    -- The same payment id each time, as a till retrying would send.
    'id', md5(p_order ->> 'id')::uuid,
    'payment_method_id', (select id from public.payment_methods where type = 'cash' limit 1),
    'amount', (p_order ->> 'total')::int)))
$$;
-- Customers are hidden from tills except through find_customer.
create function pg_temp.balance() returns integer language sql as $$
  select (public.find_customer(pg_temp.sid(), '0244000001') ->> 'points_balance')::integer
$$;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000a01');
insert into r values ('session', public.start_pos_session('1111'));

-- Types and stacking -------------------------------------------------------------

insert into r values ('stack', pg_temp.burgers('{"order_type": "takeaway"}'));
select is(
  (select jsonb_build_object('promotion_total', result -> 'promotion_total', 'total', result -> 'total',
    'names', (select jsonb_agg(p ->> 'name' order by (p ->> 'amount')::int) from jsonb_array_elements(result -> 'promotions') p))
   from r where step = 'stack'),
  '{"promotion_total": 290, "total": 1710, "names": ["Take 1", "Take 10%"]}'::jsonb,
  'stacking promotions apply one after another, highest priority first (1.00 off, then 10% of what''s left)'
);
insert into r values ('coupon', pg_temp.burgers('{"order_type": "takeaway", "coupon_code": " big50 "}'));
select is(
  (select jsonb_build_object('promotion_total', result -> 'promotion_total', 'total', result -> 'total',
    'names', (select jsonb_agg(p ->> 'name') from jsonb_array_elements(result -> 'promotions') p), 'coupon', result -> 'coupon_code')
   from r where step = 'coupon'),
  '{"promotion_total": 1000, "total": 1000, "names": ["Half price"], "coupon": "BIG50"}'::jsonb,
  'a promotion that doesn''t stack applies alone (and coupon codes ignore case and spaces)'
);
select throws_ok(
  $$select pg_temp.burgers('{"order_type": "takeaway", "coupon_code": "NOPE"}')$$,
  '22023', 'That coupon isn''t valid', 'an unknown coupon is refused'
);
select is((select (pg_temp.burgers('{"order_type": "takeaway", "coupon_code": "ONCE"}') ->> 'total')::int), 1800,
  'a one-use coupon works once');
select throws_ok(
  $$select pg_temp.burgers('{"order_type": "takeaway", "coupon_code": "ONCE"}')$$,
  '22023', 'That coupon can''t be used on this order', 'and not again (max uses)'
);
select throws_ok(
  $$select public.check_coupon(pg_temp.sid(), 'once')$$,
  '22023', 'That coupon has been used up', 'checking it on the till says so too'
);
select is((public.check_coupon(pg_temp.sid(), 'big50') -> 'has_coupon')::boolean, true,
  'a valid coupon is checked on the till (without showing the code)');
select is((public.check_coupon(pg_temp.sid(), 'big50') ->> 'coupon_code'), null, 'the code itself isn''t sent back');

insert into r values ('bxgy', pg_temp.fries('{"order_type": "delivery", "customer_phone": "0244000000", "delivery_address": "1 Road"}', 3));
select is((select (result ->> 'promotion_total')::int from r where step = 'bxgy'), 1000,
  'buy 2 get 1 free: three fries, one free');
select is(
  (pg_temp.fries('{"order_type": "delivery", "customer_phone": "0244000000", "delivery_address": "1 Road"}', 5) ->> 'promotion_total')::int,
  1000, 'five fries: only one full group of three');
select is(
  (pg_temp.burgers('{"order_type": "takeaway", "channel": "kiosk"}', 2) ->> 'promotion_total')::int,
  1000, 'a fixed price: two burgers at 15.00 each on the kiosk');
select is(
  (select sum((l ->> 'line_total')::int) from jsonb_array_elements((select result -> 'lines' from r where step = 'stack')) l)::int,
  1710, 'line totals carry the promotion, so tax is worked out on what''s paid');

-- Time windows, in the branch's own time -------------------------------------------
-- 23:30 UTC on the 15th is 12:30 on the 16th in Auckland: lunchtime.

select is(
  (pg_temp.burgers('{"order_type": "takeaway", "channel": "drive_thru", "is_offline": true,
    "client_created_at": "2026-10-15T23:30:00Z"}') ->> 'promotion_total')::int,
  200, 'the lunch deal applies at 12:30 branch time (23:30 UTC the day before)'
);
select is(
  (pg_temp.burgers('{"order_type": "takeaway", "channel": "drive_thru", "is_offline": true,
    "client_created_at": "2026-10-16T03:00:00Z"}') ->> 'promotion_total')::int,
  0, 'and not at 16:00 branch time (03:00 UTC)'
);

-- Customers and points --------------------------------------------------------------

select is(public.find_customer(pg_temp.sid(), '024 400 0001'), null, 'an unknown phone number finds nobody');
select throws_ok(
  $$select public.save_customer(pg_temp.sid(), '{"id": "f9900000-0000-4000-8000-000000000a01", "phone": "0244000001", "name": "Efua"}')$$,
  '22023', null, 'a customer is only saved with their consent'
);
select is(
  (public.save_customer(pg_temp.sid(),
    '{"id": "f9900000-0000-4000-8000-000000000a01", "phone": "024-400-0001", "name": "Efua", "consent": true}') ->> 'phone'),
  '0244000001', 'with consent, the number is saved (as digits)'
);
-- 20.00 paid earns 20 points (a point per 1.00).
insert into r values ('earn', pg_temp.burgers('{"order_type": "dine_in", "customer_id": "f9900000-0000-4000-8000-000000000a01"}'));
select pg_temp.pay((select result from r where step = 'earn'));
select is(pg_temp.balance(), 20, 'paying earns points');
select pg_temp.pay((select result from r where step = 'earn'));
select is(pg_temp.balance(), 20, 'once, however often the payment is sent');
select throws_ok(
  $$select pg_temp.fries('{"order_type": "dine_in", "customer_id": "f9900000-0000-4000-8000-000000000a01", "redeem_points": 21}')$$,
  '22023', null, 'nobody spends more points than they have'
);
-- Spend 15 points (0.15) on fries: 9.85, which earns 9 points.
insert into r values ('redeem', pg_temp.fries('{"order_type": "dine_in", "customer_id": "f9900000-0000-4000-8000-000000000a01", "redeem_points": 15}'));
select is(
  (select jsonb_build_object('total', result -> 'total', 'loyalty', result -> 'loyalty') from r where step = 'redeem'),
  '{"total": 985, "loyalty": {"discount": 15, "points_earned": 0, "points_redeemed": 15}}'::jsonb,
  'points come off the order'
);
select is(pg_temp.balance(), 5, 'and off the balance');
select pg_temp.pay((select result from r where step = 'redeem'));
select is(pg_temp.balance(), 14, 'the rest is paid and earns points');
select is(jsonb_array_length(public.find_customer(pg_temp.sid(), '0244000001') -> 'recent_orders'), 2,
  'the till sees the customer''s recent orders');

-- The manager refunds the fries in full: the 9 points earned go, the 15
-- spent come back.
delete from r where step = 'session';
insert into r values ('session', public.start_pos_session('9999'));
select public.refund_order(pg_temp.sid(), jsonb_build_object(
  'id', gen_random_uuid(), 'order_id', (select result ->> 'id' from r where step = 'redeem'),
  'payment_method_id', (select id from public.payment_methods where type = 'cash' limit 1), 'reason', 'Cold'));
select is(pg_temp.balance(), 20, 'a full refund takes back the points earned and returns the points spent');
reset role;

-- Promotions aren't staff discounts --------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000a02');
select is(
  (select count(*)::int from jsonb_array_elements(public.report_exceptions('f1000000-0000-4000-8000-000000000a0a',
    current_date, current_date)) e where e ->> 'kind' = 'discount'),
  0, 'promotions and points don''t show as staff discounts in the exceptions report'
);
reset role;

select * from finish();
rollback;
