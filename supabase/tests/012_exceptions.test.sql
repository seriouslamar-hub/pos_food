-- Phase 8: discounts, price changes, voids, refunds, the exceptions report,
-- order lookup and the audit trail.
begin;
create extension if not exists pgtap with schema extensions;

select plan(62);

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
-- Cashiers Efua (1111, limit 10%) on till A and Kojo (2222) on till B,
-- manager Nana (9999) on till C and in the back office. Items are taxed 10%
-- on top, so totals are easy to check by hand.

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000501', 'exc-till-a@test.local'),
  ('f0000000-0000-4000-8000-000000000502', 'exc-till-b@test.local'),
  ('f0000000-0000-4000-8000-000000000503', 'exc-till-c@test.local'),
  ('f0000000-0000-4000-8000-000000000504', 'exc-manager@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000050a', 'Exceptions Branch', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, discount_limit_bps, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000501', 'f1000000-0000-4000-8000-00000000050a', 'Efua Cashier', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)), 1000, null),
  ('f2000000-0000-4000-8000-000000000502', 'f1000000-0000-4000-8000-00000000050a', 'Kojo Cashier', 'cashier',
   extensions.crypt('2222', extensions.gen_salt('bf', 4)), 1000, null),
  ('f2000000-0000-4000-8000-000000000503', 'f1000000-0000-4000-8000-00000000050a', 'Nana Manager', 'manager',
   extensions.crypt('9999', extensions.gen_salt('bf', 4)), 5000, 'f0000000-0000-4000-8000-000000000504');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000501', 'f1000000-0000-4000-8000-00000000050a',
   'f0000000-0000-4000-8000-000000000501', 'Exc Till A', 'till', 'T1'),
  ('f3000000-0000-4000-8000-000000000502', 'f1000000-0000-4000-8000-00000000050a',
   'f0000000-0000-4000-8000-000000000502', 'Exc Till B', 'till', 'T2'),
  ('f3000000-0000-4000-8000-000000000503', 'f1000000-0000-4000-8000-00000000050a',
   'f0000000-0000-4000-8000-000000000503', 'Exc Till C', 'till', 'T3');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-00000000050a', 'f1000000-0000-4000-8000-00000000050a', current_date);
insert into public.shifts (id, branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f8100000-0000-4000-8000-000000000501', 'f1000000-0000-4000-8000-00000000050a', 'f8000000-0000-4000-8000-00000000050a',
   'f2000000-0000-4000-8000-000000000501', 'f3000000-0000-4000-8000-000000000501', 10000),
  ('f8100000-0000-4000-8000-000000000502', 'f1000000-0000-4000-8000-00000000050a', 'f8000000-0000-4000-8000-00000000050a',
   'f2000000-0000-4000-8000-000000000502', 'f3000000-0000-4000-8000-000000000502', 0),
  ('f8100000-0000-4000-8000-000000000503', 'f1000000-0000-4000-8000-00000000050a', 'f8000000-0000-4000-8000-00000000050a',
   'f2000000-0000-4000-8000-000000000503', 'f3000000-0000-4000-8000-000000000503', 0);
insert into public.settings (branch_id, key, value) values
  ('f1000000-0000-4000-8000-00000000050a', 'orders.pay_later_dine_in', 'true');
insert into public.taxes (name, rate_bps, is_inclusive, tax_category) values ('Exc tax', 1000, false, 'exctest');
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000501', 'Exceptions test');
insert into public.menu_items (id, category_id, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000501', 'f5000000-0000-4000-8000-000000000501', 'Exc burger', 1000, 'exctest'),
  ('f5300000-0000-4000-8000-000000000502', 'f5000000-0000-4000-8000-000000000501', 'Exc drink', 500, 'exctest');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;

create function pg_temp.sid(p_step text) returns uuid language sql as $$
  select (result ->> 'session_id')::uuid from r where step = p_step
$$;
create function pg_temp.val(p_step text, p_path text[]) returns text language sql as $$
  select result #>> p_path from r where step = p_step
$$;
create function pg_temp.method(p_type text) returns uuid language sql as $$
  select id from public.payment_methods where type = p_type::public.payment_method_type order by sort_order limit 1
$$;
create function pg_temp.approve(p_session_step text, p_permission text) returns uuid language sql as $$
  select (public.verify_override(pg_temp.sid(p_session_step), '9999', p_permission, null) ->> 'override_id')::uuid
$$;
-- A line: burger (b) or drink (d), with optional discount and price change.
create function pg_temp.line(p_id text, p_item text, p_qty integer, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'quantity', p_qty, 'menu_item_id',
    case p_item when 'b' then 'f5300000-0000-4000-8000-000000000501' else 'f5300000-0000-4000-8000-000000000502' end) || p_extra
$$;
create function pg_temp.pay_cash(p_step text, p_order text, p_amount integer, p_tendered integer) returns void language sql as $$
  insert into r values (p_step, public.record_payments(pg_temp.sid('efua'), p_order::uuid,
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'payment_method_id', pg_temp.method('cash'),
      'amount', p_amount, 'tendered', p_tendered))))
$$;

-- The discount maths ---------------------------------------------------------

select is(public.allocate_discount(100, array[500, 500, 500]::bigint[]), array[34, 33, 33]::bigint[],
  'an order discount is shared exactly, earlier lines first on ties');
select is(public.allocate_discount(10, array[1, 2, 3]::bigint[]), array[2, 3, 5]::bigint[],
  'what''s left goes to the largest remainders');
select is(public.allocate_discount(0, array[5, 5]::bigint[]), array[0, 0]::bigint[], 'no discount, no shares');
select is(public.discount_amount('{"type": "percent", "value": 1250, "reason": "x"}', 999), 125::bigint,
  'a percent discount rounds half away from zero');

-- Discounts ------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000501');
insert into r values ('efua', public.start_pos_session('1111'));

-- A: 2 burgers with 10% off the line (Efua's limit): 2000 − 200 = 1800 + 180 tax.
insert into r values ('a', public.submit_order(pg_temp.sid('efua'), jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000501',
  'lines', jsonb_build_array(pg_temp.line('f6100000-0000-4000-8000-000000000501', 'b', 2,
    '{"discount": {"type": "percent", "value": 1000, "reason": "Staff meal"}}')))));
select is(
  (select array[pg_temp.val('a', '{subtotal}'), pg_temp.val('a', '{discount_total}'),
                pg_temp.val('a', '{tax_total}'), pg_temp.val('a', '{total}')]),
  array['2000', '200', '180', '1980'],
  'a line discount comes off before tax'
);
select pg_temp.pay_cash('a paid', 'f6000000-0000-4000-8000-000000000501', 1980, 2000);

-- B: 1.50 off the order, shared 1.00 / 0.50 by the line amounts (exactly 10%).
insert into r values ('b', public.submit_order(pg_temp.sid('efua'), jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000502',
  'discount', jsonb_build_object('type', 'fixed', 'value', 150, 'reason', 'Loyalty'),
  'lines', jsonb_build_array(
    pg_temp.line('f6100000-0000-4000-8000-000000000502', 'b', 1),
    pg_temp.line('f6100000-0000-4000-8000-000000000503', 'd', 1)))));
select is(
  (select jsonb_agg(l -> 'order_discount_share' order by l ->> 'name') from r, jsonb_array_elements(result -> 'lines') l where step = 'b'),
  '[100, 50]'::jsonb,
  'an order discount is shared across the lines'
);
select is(pg_temp.val('b', '{total}'), '1485', 'and taxed after: 1350 + 135');
insert into r values ('b paid', public.record_payments(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000502',
  jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'payment_method_id', pg_temp.method('card'),
    'amount', 1485, 'reference', 'CARD-B42'))));

select throws_ok(
  $$select public.submit_order(pg_temp.sid('efua'), jsonb_build_object('id', gen_random_uuid(),
    'lines', jsonb_build_array(pg_temp.line(gen_random_uuid()::text, 'd', 1,
      '{"discount": {"type": "fixed", "value": 600, "reason": "x"}}'))))$$,
  '22023', 'A discount can''t be more than what it''s taken off', 'a discount can''t be more than the line'
);
select throws_ok(
  $$select public.submit_order(pg_temp.sid('efua'), jsonb_build_object('id', gen_random_uuid(),
    'lines', jsonb_build_array(pg_temp.line(gen_random_uuid()::text, 'd', 1,
      '{"discount": {"type": "percent", "value": 500, "reason": " "}}'))))$$,
  '22023', 'Give a reason for the discount', 'discounts need a reason'
);

-- C: 20% off a burger is over Efua's 10% limit (2.00 of 15.00 = 13%).
create function pg_temp.order_c(p_override uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000503',
    'discount_override_id', p_override,
    'lines', jsonb_build_array(
      pg_temp.line('f6100000-0000-4000-8000-000000000504', 'b', 1,
        '{"discount": {"type": "percent", "value": 2000, "reason": "Complaint"}}'),
      pg_temp.line('f6100000-0000-4000-8000-000000000505', 'd', 1)))
$$;
select throws_ok(
  $$select public.submit_order(pg_temp.sid('efua'), pg_temp.order_c(null))$$,
  'PS403', null, 'a discount over the cashier''s limit needs a manager'
);
insert into r values ('c approval', jsonb_build_object('id', pg_temp.approve('efua', 'discount.override')));
insert into r values ('c', public.submit_order(pg_temp.sid('efua'),
  pg_temp.order_c((select (result ->> 'id')::uuid from r where step = 'c approval'))));
select is(pg_temp.val('c', '{total}'), '1430', 'with a manager''s PIN it goes through: 880 + 550');
select throws_ok(
  $$select public.submit_order(pg_temp.sid('efua'), jsonb_build_object('id', gen_random_uuid(),
    'discount_override_id', (select (result ->> 'id')::uuid from r where step = 'c approval'),
    'lines', jsonb_build_array(pg_temp.line(gen_random_uuid()::text, 'b', 1,
      '{"discount": {"type": "percent", "value": 5000, "reason": "Again"}}'))))$$,
  'PS403', null, 'an approval can''t be used twice'
);

-- E: a burger sold at 7.00 instead of 10.00.
create function pg_temp.order_e(p_override uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000505',
    'price_override_id', p_override,
    'lines', jsonb_build_array(pg_temp.line('f6100000-0000-4000-8000-000000000507', 'b', 1,
      '{"price": {"unit_price": 700, "reason": "Damaged box"}}')))
$$;
select throws_ok(
  $$select public.submit_order(pg_temp.sid('efua'), pg_temp.order_e(null))$$,
  'PS403', null, 'a cashier needs a manager to change a price'
);
select throws_ok(
  $$select public.submit_order(pg_temp.sid('efua'), jsonb_build_object('id', gen_random_uuid(),
    'lines', jsonb_build_array(pg_temp.line(gen_random_uuid()::text, 'b', 1, '{"price": {"unit_price": 700}}'))))$$,
  '22023', null, 'price changes need a reason'
);
insert into r values ('e', public.submit_order(pg_temp.sid('efua'), pg_temp.order_e(pg_temp.approve('efua', 'price.override'))));
select is(
  (select array[l ->> 'unit_price', l ->> 'price_override_from'] from r, jsonb_array_elements(result -> 'lines') l where step = 'e'),
  array['700', '1000'],
  'the changed price is charged and the menu price kept'
);
select pg_temp.pay_cash('e paid', 'f6000000-0000-4000-8000-000000000505', 770, 1000);
reset role;
select is(
  (select array[o.discount_approved_by::text, (select price_approved_by::text from public.order_items where order_id = 'f6000000-0000-4000-8000-000000000505')]
   from public.orders o where o.id = 'f6000000-0000-4000-8000-000000000503'),
  array['f2000000-0000-4000-8000-000000000503', 'f2000000-0000-4000-8000-000000000503'],
  'the approving manager is recorded'
);

-- A manager needs no approval within their own rights.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000503');
insert into r values ('nana', public.start_pos_session('9999'));
select is(
  public.submit_order(pg_temp.sid('nana'), jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000508',
    'discount', '{"type": "percent", "value": 3000, "reason": "Manager special"}'::jsonb,
    'lines', jsonb_build_array(pg_temp.line(gen_random_uuid()::text, 'b', 1,
      '{"price": {"unit_price": 900, "reason": "Manager special"}}')))) ->> 'total',
  '693', 'a manager changes prices and discounts up to their limit alone: 900 − 270 + 63'
);
select lives_ok(
  $$select public.record_cash_movement(pg_temp.sid('nana'),
    '{"id": "f9000000-0000-4000-8000-000000000501", "type": "no_sale", "amount": 0, "reason": "Change for a note"}')$$,
  'and opens the drawer without a sale'
);
reset role;

-- Voids --------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000501');
insert into r values ('c void drink', public.void_order_items(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000503',
  array['f6100000-0000-4000-8000-000000000505']::uuid[], 'Customer changed mind'));
select is(pg_temp.val('c void drink', '{total}'), '880', 'a cashier voids an unsent line of their own order');
select is(
  (select l ->> 'status' from r, jsonb_array_elements(result -> 'lines') l where step = 'c void drink' and l ->> 'name' = 'Exc drink'),
  'voided', 'the line shows as voided'
);
select lives_ok(
  $$select public.void_order_items(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000503',
    array['f6100000-0000-4000-8000-000000000505']::uuid[], 'Customer changed mind')$$,
  'voiding it again is safe'
);
select throws_ok(
  $$select public.void_order_items(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000503',
    array['f6100000-0000-4000-8000-000000000504']::uuid[], ' ')$$,
  '22023', 'Give a reason for the void', 'voids need a reason'
);
select throws_ok(
  $$select public.void_order_items(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000501',
    array['f6100000-0000-4000-8000-000000000501']::uuid[], 'Wrong item')$$,
  '22023', 'This order is paid. Refund it instead.', 'paid orders are refunded, not voided'
);
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000502');
insert into r values ('kojo', public.start_pos_session('2222'));
select throws_ok(
  $$select public.void_order_items(pg_temp.sid('kojo'), 'f6000000-0000-4000-8000-000000000503',
    array['f6100000-0000-4000-8000-000000000504']::uuid[], 'Wrong item')$$,
  '42501', 'Voiding someone else''s order needs a manager''s approval', 'another cashier''s order needs a manager'
);
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000501');
insert into r values ('c void all', public.void_order_items(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000503',
  array['f6100000-0000-4000-8000-000000000504']::uuid[], 'Wrong item'));
select is(pg_temp.val('c void all', '{status}'), 'voided', 'voiding every line voids the order');
select is(pg_temp.val('c void all', '{total}'), '0', 'and leaves nothing to pay');

-- F: a dine-in order already with the kitchen, not paid.
insert into r values ('f', public.submit_order(pg_temp.sid('efua'), jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000506', 'order_type', 'dine_in',
  'lines', jsonb_build_array(pg_temp.line('f6100000-0000-4000-8000-000000000508', 'd', 2)))));
insert into r values ('f sent', public.send_to_kitchen(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000506'));
select throws_ok(
  $$select public.void_order_items(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000506',
    array['f6100000-0000-4000-8000-000000000508']::uuid[], 'Quality issue')$$,
  '42501', 'Voiding items the kitchen has needs a manager''s approval', 'voiding what the kitchen has needs a manager'
);
insert into r values ('f void', public.void_order_items(pg_temp.sid('efua'), 'f6000000-0000-4000-8000-000000000506',
  array['f6100000-0000-4000-8000-000000000508']::uuid[], 'Quality issue', pg_temp.approve('efua', 'order.void_sent')));
select is(pg_temp.val('f void', '{status}'), 'voided', 'and goes through with their PIN');
reset role;
select is(
  (select array[status::text, approved_by::text] from public.order_items where id = 'f6100000-0000-4000-8000-000000000508'),
  array['voided', 'f2000000-0000-4000-8000-000000000503'],
  'the kitchen sees the line voided, with who approved it'
);

-- Refunds -------------------------------------------------------------------------

-- G: a burger (11.00) and a drink (5.50), paid in cash.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000501');
insert into r values ('g', public.submit_order(pg_temp.sid('efua'), jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000507',
  'lines', jsonb_build_array(
    pg_temp.line('f6100000-0000-4000-8000-000000000509', 'b', 1),
    pg_temp.line('f6100000-0000-4000-8000-00000000050a', 'd', 1)))));
select pg_temp.pay_cash('g paid', 'f6000000-0000-4000-8000-000000000507', 1650, 2000);

create function pg_temp.refund_g(p_id text, p_lines jsonb, p_method text, p_override uuid, p_reference text default null)
returns jsonb language sql as $$
  select public.refund_order(pg_temp.sid('efua'), jsonb_build_object(
    'id', p_id, 'order_id', 'f6000000-0000-4000-8000-000000000507', 'line_ids', p_lines,
    'payment_method_id', pg_temp.method(p_method), 'reference', p_reference,
    'reason', 'Cold food', 'override_id', p_override))
$$;
select throws_ok(
  $$select pg_temp.refund_g('fa000000-0000-4000-8000-000000000501', '["f6100000-0000-4000-8000-00000000050a"]', 'cash', null)$$,
  '42501', 'Refunds need a manager''s approval', 'a cashier can''t refund without a manager'
);
insert into r values ('refund approval', jsonb_build_object('id', pg_temp.approve('efua', 'order.refund')));
insert into r values ('refund drink', pg_temp.refund_g('fa000000-0000-4000-8000-000000000501',
  '["f6100000-0000-4000-8000-00000000050a"]', 'cash', (select (result ->> 'id')::uuid from r where step = 'refund approval')));
select is(pg_temp.val('refund drink', '{status}'), 'partially_refunded', 'refunding one line is a partial refund');
select is(pg_temp.val('refund drink', '{refunded_total}'), '550', 'of that line''s total, tax included');
select is(
  (select l ->> 'status' from r, jsonb_array_elements(result -> 'lines') l where step = 'refund drink' and l ->> 'name' = 'Exc drink'),
  'voided', 'the kitchen stops making a refunded line'
);
select lives_ok(
  $$select pg_temp.refund_g('fa000000-0000-4000-8000-000000000501',
    '["f6100000-0000-4000-8000-00000000050a"]', 'cash', null)$$,
  'sending the same refund again is safe'
);
select throws_ok(
  $$select pg_temp.refund_g('fa000000-0000-4000-8000-000000000502', null, 'card',
    (select (result ->> 'id')::uuid from r where step = 'refund approval'), 'REV-1')$$,
  'PS403', null, 'a refund approval can''t be used twice'
);
select throws_ok(
  $$select pg_temp.refund_g('fa000000-0000-4000-8000-000000000502', null, 'card', pg_temp.approve('efua', 'order.refund'))$$,
  '22023', 'Card refunds need a reference number', 'card refunds need the reversal reference'
);
insert into r values ('refund rest', pg_temp.refund_g('fa000000-0000-4000-8000-000000000502', null, 'card',
  pg_temp.approve('efua', 'order.refund'), 'REV-1'));
select is(pg_temp.val('refund rest', '{status}'), 'refunded', 'refunding the rest refunds the order');
select is(pg_temp.val('refund rest', '{refunded_total}'), '1650', 'in full');
select is(
  (select jsonb_agg(p ->> 'status') from r, jsonb_array_elements(result -> 'payments') p where step = 'refund rest'),
  '["refunded"]'::jsonb, 'and marks its payments refunded'
);
select throws_ok(
  $$select pg_temp.refund_g('fa000000-0000-4000-8000-000000000503', null, 'cash', pg_temp.approve('efua', 'order.refund'))$$,
  '22023', 'This order is already refunded', 'a refunded order can''t be refunded again'
);
select throws_ok(
  $$select public.refund_order(pg_temp.sid('efua'), jsonb_build_object('id', gen_random_uuid(),
    'order_id', 'f6000000-0000-4000-8000-000000000506', 'payment_method_id', pg_temp.method('cash'),
    'reason', 'x', 'override_id', pg_temp.approve('efua', 'order.refund')))$$,
  '22023', 'This order isn''t paid. Void its items instead.', 'unpaid orders are voided, not refunded'
);
reset role;
select is(
  (select array_agg(shift_id::text || ':' || method || ':' || amount || ':' || approved_by order by created_at) from public.refunds
   where order_id = 'f6000000-0000-4000-8000-000000000507'),
  array['f8100000-0000-4000-8000-000000000501:cash:550:f2000000-0000-4000-8000-000000000503',
        'f8100000-0000-4000-8000-000000000501:card:1100:f2000000-0000-4000-8000-000000000503'],
  'refunds come out of the refunding cashier''s shift, with the approver'
);

-- Expected cash: 100.00 float + cash sales (19.80 + 7.70 + 16.50) − the 5.50
-- cash refund = 138.50. Card sales and the card refund don't touch the drawer.
select is(public.shift_expected_cash('f8100000-0000-4000-8000-000000000501'), 13850::bigint,
  'a cash refund comes out of the drawer''s expected cash');
select is(public.shift_cash('f8100000-0000-4000-8000-000000000501') ->> 'cash_refunds', '550',
  'and shows on the shift''s cash');
select is(public.sales_summary('f8000000-0000-4000-8000-00000000050a', null) -> 'refunds',
  '{"count": 2, "amount": 1650, "cash": 550}'::jsonb, 'the day''s report counts the refunds');

-- The exceptions report matches the audit log ---------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000504');
insert into r values ('exceptions', jsonb_build_object('rows',
  public.report_exceptions('f1000000-0000-4000-8000-00000000050a', current_date, current_date)));
reset role;

create function pg_temp.report(p_kind text) returns table (n bigint, amount numeric) language sql as $$
  select count(*), coalesce(sum((x ->> 'amount')::numeric), 0)
  from r, jsonb_array_elements(result -> 'rows') x
  where step = 'exceptions' and x ->> 'kind' = p_kind
$$;
create function pg_temp.audits(p_action text) returns setof jsonb language sql as $$
  select after from public.audit_log where branch_id = 'f1000000-0000-4000-8000-00000000050a' and action = p_action
$$;

select is(
  (select row(n, amount)::text from pg_temp.report('void')),
  (select row(sum(jsonb_array_length(a -> 'lines')), sum((a ->> 'amount')::numeric))::text from pg_temp.audits('order.void') a),
  'voided lines and amounts match the audit log'
);
select is((select row(n, amount)::text from pg_temp.report('void')), '(3,2500)', 'three lines were voided');
select is(
  (select row(n, amount)::text from pg_temp.report('refund')),
  (select row(count(*), sum((a ->> 'amount')::numeric))::text from pg_temp.audits('order.refund') a),
  'refunds match the audit log'
);
select is(
  (select row(n, amount)::text from pg_temp.report('discount')),
  (select row(count(*), sum((a ->> 'discount_total')::numeric))::text from pg_temp.audits('order.discount') a),
  'discounts match the audit log (a voided order keeps its discount)'
);
select is((select n from pg_temp.report('discount')), 4::bigint, 'four orders had discounts');
select is(
  (select row(n, amount)::text from pg_temp.report('price_override')),
  (select row(count(*), sum(((l ->> 'from')::numeric - (l ->> 'to')::numeric) * (l ->> 'quantity')::numeric))::text
   from pg_temp.audits('order.price_override') a, jsonb_array_elements(a -> 'lines') l),
  'price changes match the audit log'
);
select is(
  (select n from pg_temp.report('no_sale')),
  (select count(*) from pg_temp.audits('cash.no_sale')),
  'no-sales match the audit log'
);

select pg_temp.login_as('f0000000-0000-4000-8000-000000000501');
select throws_ok(
  $$select public.report_exceptions('f1000000-0000-4000-8000-00000000050a', current_date, current_date)$$,
  '42501', null, 'tills can''t run the exceptions report'
);

-- Order lookup and the audit trail -----------------------------------------------

select is(
  (select jsonb_agg(o ->> 'id') from jsonb_array_elements(public.search_orders('f1000000-0000-4000-8000-00000000050a',
    current_date, pg_temp.val('e', '{order_number}'))) o),
  '["f6000000-0000-4000-8000-000000000505"]'::jsonb, 'a till finds an order by number'
);
select is(
  (select jsonb_agg(o ->> 'id') from jsonb_array_elements(public.search_orders('f1000000-0000-4000-8000-00000000050a',
    null, null, 1485)) o),
  '["f6000000-0000-4000-8000-000000000502"]'::jsonb, 'by amount'
);
select is(
  (select jsonb_agg(o ->> 'id') from jsonb_array_elements(public.search_orders('f1000000-0000-4000-8000-00000000050a',
    null, null, null, 'card-b')) o),
  '["f6000000-0000-4000-8000-000000000502"]'::jsonb, 'or by part of a payment reference'
);
select throws_ok(
  $$select public.search_orders(gen_random_uuid())$$,
  'P0002', null, 'but not at another branch'
);
select throws_ok(
  $$select public.order_audit_trail('f6000000-0000-4000-8000-000000000507', pg_temp.sid('efua'))$$,
  '42501', null, 'cashiers can''t read an order''s history'
);
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000503');
select is(
  (select jsonb_agg(a ->> 'action') from jsonb_array_elements(
    public.order_audit_trail('f6000000-0000-4000-8000-000000000507', pg_temp.sid('nana'))) a),
  '["order.create", "order.paid", "order.refund", "order.refund"]'::jsonb,
  'a manager on the till reads an order''s history'
);
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000504');
select is(
  (select jsonb_agg(a ->> 'approver_name') from jsonb_array_elements(
    public.order_audit_trail('f6000000-0000-4000-8000-000000000507')) a where a ->> 'action' = 'order.refund'),
  '["Nana Manager", "Nana Manager"]'::jsonb,
  'and so does the back office, with who approved what'
);
select is(
  (select count(*)::int from public.refunds where branch_id = 'f1000000-0000-4000-8000-00000000050a'), 2,
  'managers read refunds'
);
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000502');
select is((select count(*)::int from public.refunds where branch_id = 'f1000000-0000-4000-8000-00000000050a'), 2,
  'and so do the branch''s tills (for receipts and lookups)');
reset role;

select * from finish();
rollback;
