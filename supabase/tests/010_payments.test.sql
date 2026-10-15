-- Phase 6: record_payments (totals, split, cash change, references,
-- idempotency) and pay-later dine-in.
begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

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

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000301', 'pay-till-a@test.local'),
  ('f0000000-0000-4000-8000-000000000302', 'pay-till-b@test.local');
insert into public.branches (id, name, timezone, currency_code, receipt_footer) values
  ('f1000000-0000-4000-8000-00000000030a', 'Pay Branch A', 'UTC', 'USD', 'Thanks for coming'),
  ('f1000000-0000-4000-8000-00000000030b', 'Pay Branch B', 'UTC', 'USD', null);
insert into public.staff (id, branch_id, full_name, role, pin_hash) values
  ('f2000000-0000-4000-8000-000000000301', 'f1000000-0000-4000-8000-00000000030a', 'Pay Cashier A', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4))),
  ('f2000000-0000-4000-8000-000000000302', 'f1000000-0000-4000-8000-00000000030b', 'Pay Cashier B', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)));
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000301', 'f1000000-0000-4000-8000-00000000030a',
   'f0000000-0000-4000-8000-000000000301', 'Pay Till A', 'till', 'T1'),
  ('f3000000-0000-4000-8000-000000000302', 'f1000000-0000-4000-8000-00000000030b',
   'f0000000-0000-4000-8000-000000000302', 'Pay Till B', 'till', 'T1');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-00000000030a', 'f1000000-0000-4000-8000-00000000030a', current_date),
  ('f8000000-0000-4000-8000-00000000030b', 'f1000000-0000-4000-8000-00000000030b', current_date);
insert into public.shifts (branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f1000000-0000-4000-8000-00000000030a', 'f8000000-0000-4000-8000-00000000030a',
   'f2000000-0000-4000-8000-000000000301', 'f3000000-0000-4000-8000-000000000301', 0),
  ('f1000000-0000-4000-8000-00000000030b', 'f8000000-0000-4000-8000-00000000030b',
   'f2000000-0000-4000-8000-000000000302', 'f3000000-0000-4000-8000-000000000302', 0);
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000301', 'Pay test');
insert into public.menu_items (id, category_id, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000301', 'f5000000-0000-4000-8000-000000000301', 'Pay burger', 1000, 'paytest_none');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;

create function pg_temp.sid() returns uuid language sql as $$ select (result ->> 'session_id')::uuid from r where step = 'session' $$;
create function pg_temp.method(p_type text) returns uuid language sql as $$
  select id from public.payment_methods where type = p_type::public.payment_method_type order by sort_order limit 1
$$;
create function pg_temp.order_payload(p_id text, p_type text default 'takeaway', p_qty integer default 2) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'order_type', p_type,
    'lines', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
      'menu_item_id', 'f5300000-0000-4000-8000-000000000301', 'quantity', p_qty)))
$$;
create function pg_temp.pay(p_order text, p_payments jsonb) returns jsonb language sql as $$
  select public.record_payments(pg_temp.sid(), p_order::uuid, p_payments)
$$;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000301');
insert into r values ('session', public.start_pos_session('1111'));
insert into r values ('o1', public.submit_order(pg_temp.sid(), pg_temp.order_payload('f6000000-0000-4000-8000-000000000301')));
select is((select result ->> 'total' from r where step = 'o1'), '2000', 'the test order costs 20.00');

-- Validation ---------------------------------------------------------------------

select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000001', 'payment_method_id', pg_temp.method('cash'), 'amount', 1000))),
  '22023', 'The payments don''t add up to the order total', 'payments must add up to the total'
);
select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000002', 'payment_method_id', pg_temp.method('card'), 'amount', 2000))),
  '22023', 'Card needs a reference number', 'card payments need a reference'
);
select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000003', 'payment_method_id', pg_temp.method('other'), 'amount', 2000))),
  '22023', 'That payment method isn''t available', 'disabled payment methods are refused'
);
select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000004', 'payment_method_id', pg_temp.method('card'),
      'amount', 2000, 'tendered', 2500, 'reference', 'X'))),
  '22023', 'Only cash can be over-tendered', 'only cash can be over-tendered'
);
select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000005', 'payment_method_id', pg_temp.method('cash'),
      'amount', 2000, 'tendered', 1500))),
  '22023', null, 'cash handed over can''t be less than the amount'
);
select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000006', 'payment_method_id', pg_temp.method('cash'), 'amount', 0))),
  '22023', 'Payment amounts must be more than zero', 'zero amounts are refused'
);
reset role;
select is((select count(*)::int from public.payments where order_id = 'f6000000-0000-4000-8000-000000000301'), 0,
  'refused payments leave nothing behind');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000301');

-- A split payment with cash change -------------------------------------------------

insert into r values ('paid', pg_temp.pay('f6000000-0000-4000-8000-000000000301', jsonb_build_array(
  jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000010', 'payment_method_id', pg_temp.method('card'),
    'amount', 500, 'reference', 'AUTH-1'),
  jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000011', 'payment_method_id', pg_temp.method('cash'),
    'amount', 1500, 'tendered', 2000))));
select is((select result ->> 'status' from r where step = 'paid'), 'paid', 'a fully paid order is paid');
select is((select result ->> 'amount_paid' from r where step = 'paid'), '2000', 'split payments cover the total');
select is((select result ->> 'change_given' from r where step = 'paid'), '500', 'change is tendered minus the cash amount');
select is(
  (select jsonb_agg(p ->> 'method_name' || ':' || (p ->> 'amount') || ':' || coalesce(p ->> 'reference', '-'))
   from r, jsonb_array_elements(result -> 'payments') p where step = 'paid'),
  '["Card:500:AUTH-1", "Cash:1500:-"]'::jsonb,
  'the receipt lists each payment'
);
select ok((select result ->> 'sent_to_kitchen_at' from r where step = 'paid') is not null, 'paying sends the order to the kitchen');
select is((select result #>> '{branch,receipt_footer}' from r where step = 'paid'), 'Thanks for coming',
  'the receipt carries the branch''s footer');
select is((select result ->> 'staff_name' from r where step = 'paid'), 'Pay Cashier A', 'and the cashier''s name');
reset role;
select is(
  (select array_agg(distinct status::text) from public.order_items where order_id = 'f6000000-0000-4000-8000-000000000301'),
  array['sent'], 'paid lines become sent'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000301');

-- Idempotency ----------------------------------------------------------------------

select lives_ok(
  $$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000010', 'payment_method_id', pg_temp.method('card'), 'amount', 500, 'reference', 'AUTH-1'),
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000011', 'payment_method_id', pg_temp.method('cash'), 'amount', 1500, 'tendered', 2000)))$$,
  'sending the same payments again is safe'
);
reset role;
select is((select count(*)::int from public.payments where order_id = 'f6000000-0000-4000-8000-000000000301'), 2,
  'and doesn''t charge twice');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000301');
select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000301', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000012', 'payment_method_id', pg_temp.method('cash'), 'amount', 2000))),
  '22023', 'This order is already paid', 'a paid order can''t be paid again'
);
insert into r values ('o3', public.submit_order(pg_temp.sid(), pg_temp.order_payload('f6000000-0000-4000-8000-000000000303', 'takeaway', 1)));
select throws_ok(
  format($q$select pg_temp.pay('f6000000-0000-4000-8000-000000000303', %L)$q$, jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000011', 'payment_method_id', pg_temp.method('cash'), 'amount', 1000))),
  '23505', null, 'a payment id from another order can''t be reused'
);
select is(
  (pg_temp.pay('f6000000-0000-4000-8000-000000000303', jsonb_build_array(
    jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000013', 'payment_method_id', pg_temp.method('mobile_money'),
      'amount', 1000, 'reference', 'MOMO-77')))) ->> 'status',
  'paid', 'mobile money with a reference pays the order'
);
reset role;
select is(
  (select count(*)::int from public.audit_log where action = 'order.paid' and branch_id = 'f1000000-0000-4000-8000-00000000030a'),
  2, 'each payment is audited'
);

-- Visibility --------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000301');
select is((select count(*)::int from public.payments), 3, 'a till reads its branch''s payments');
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000302');
select is((select count(*)::int from public.payments where branch_id = 'f1000000-0000-4000-8000-00000000030a'), 0,
  'another branch''s till can''t');
reset role;

-- Pay later (dine-in) -------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000301');
insert into r values ('o2', public.submit_order(pg_temp.sid(), pg_temp.order_payload('f6000000-0000-4000-8000-000000000302', 'dine_in', 1)));
select throws_ok(
  $$select public.send_to_kitchen(pg_temp.sid(), 'f6000000-0000-4000-8000-000000000302')$$,
  '22023', null, 'pay-later is off unless the setting is on'
);
reset role;
insert into public.settings (branch_id, key, value) values ('f1000000-0000-4000-8000-00000000030a', 'orders.pay_later_dine_in', 'true');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000301');
insert into r values ('sent', public.send_to_kitchen(pg_temp.sid(), 'f6000000-0000-4000-8000-000000000302'));
select is((select result ->> 'status' from r where step = 'sent'), 'in_kitchen', 'a dine-in order goes to the kitchen unpaid');
select is((select result ->> 'paid_at' from r where step = 'sent'), null, 'and stays unpaid');
insert into r values ('later', pg_temp.pay('f6000000-0000-4000-8000-000000000302', jsonb_build_array(
  jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000020', 'payment_method_id', pg_temp.method('cash'), 'amount', 1000))));
select is((select result ->> 'status' from r where step = 'later'), 'in_kitchen', 'paying later keeps the kitchen status');
select ok((select result ->> 'paid_at' from r where step = 'later') is not null, 'and records the payment');
insert into r values ('o4', public.submit_order(pg_temp.sid(), pg_temp.order_payload('f6000000-0000-4000-8000-000000000304', 'takeaway', 1)));
select throws_ok(
  $$select public.send_to_kitchen(pg_temp.sid(), 'f6000000-0000-4000-8000-000000000304')$$,
  '22023', null, 'takeaway orders are paid first'
);
reset role;

select * from finish();
rollback;
