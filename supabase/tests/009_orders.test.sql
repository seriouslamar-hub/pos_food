-- Phase 5: submit_order pricing, validation, idempotency and order numbers.
-- The tax examples here are mirrored in lib/pricing.test.ts.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

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
  ('f0000000-0000-4000-8000-000000000201', 'ord-till-a@test.local'),
  ('f0000000-0000-4000-8000-000000000202', 'ord-till-b@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000020a', 'Order Branch A', 'Africa/Accra', 'GHS'),
  ('f1000000-0000-4000-8000-00000000020b', 'Order Branch B', 'UTC', 'GHS');

insert into public.staff (id, branch_id, full_name, role, pin_hash) values
  ('f2000000-0000-4000-8000-000000000201', 'f1000000-0000-4000-8000-00000000020a', 'Order Cashier A', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4))),
  ('f2000000-0000-4000-8000-000000000202', 'f1000000-0000-4000-8000-00000000020b', 'Order Cashier B', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)));

insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000201', 'f1000000-0000-4000-8000-00000000020a',
   'f0000000-0000-4000-8000-000000000201', 'Order Till A', 'till', 'T1'),
  ('f3000000-0000-4000-8000-000000000202', 'f1000000-0000-4000-8000-00000000020b',
   'f0000000-0000-4000-8000-000000000202', 'Order Till B', 'till', 'T1');

insert into public.taxes (name, rate_bps, is_inclusive, tax_category, sort_order) values
  ('Ex 15', 1500, false, 'ordtest_ex', 1),
  ('Inc 15', 1500, true, 'ordtest_inc', 1),
  ('Inc VAT', 1250, true, 'ordtest_mix', 1),
  ('Inc levy', 250, true, 'ordtest_mix', 2),
  ('Ex 1', 100, false, 'ordtest_mix', 3);

insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000201', 'Order test');

insert into public.modifier_groups (id, name, min_select, max_select) values
  ('f5100000-0000-4000-8000-000000000201', 'Size', 1, 1),
  ('f5100000-0000-4000-8000-000000000202', 'Extras', 0, 2);
insert into public.modifiers (id, group_id, name, price_delta) values
  ('f5200000-0000-4000-8000-000000000201', 'f5100000-0000-4000-8000-000000000201', 'Regular', 0),
  ('f5200000-0000-4000-8000-000000000202', 'f5100000-0000-4000-8000-000000000201', 'Large', 250),
  ('f5200000-0000-4000-8000-000000000203', 'f5100000-0000-4000-8000-000000000202', 'Cheese', 200),
  ('f5200000-0000-4000-8000-000000000204', 'f5100000-0000-4000-8000-000000000202', 'Bacon', 300),
  ('f5200000-0000-4000-8000-000000000205', 'f5100000-0000-4000-8000-000000000202', 'Egg', 100);

insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000201', 'f5000000-0000-4000-8000-000000000201', 'item', 'Burger', 1000, 'ordtest_ex'),
  ('f5300000-0000-4000-8000-000000000202', 'f5000000-0000-4000-8000-000000000201', 'item', 'Wrap', 2000, 'ordtest_inc'),
  ('f5300000-0000-4000-8000-000000000203', 'f5000000-0000-4000-8000-000000000201', 'item', 'Chips', 500, 'ordtest_ex'),
  ('f5300000-0000-4000-8000-000000000204', 'f5000000-0000-4000-8000-000000000201', 'item', 'Drink', 300, 'ordtest_none'),
  ('f5300000-0000-4000-8000-000000000205', 'f5000000-0000-4000-8000-000000000201', 'combo', 'Meal', 1500, 'ordtest_ex'),
  ('f5300000-0000-4000-8000-000000000206', 'f5000000-0000-4000-8000-000000000201', 'item', 'Platter', 4500, 'ordtest_mix');

insert into public.item_modifier_groups (menu_item_id, modifier_group_id) values
  ('f5300000-0000-4000-8000-000000000203', 'f5100000-0000-4000-8000-000000000201'),
  ('f5300000-0000-4000-8000-000000000201', 'f5100000-0000-4000-8000-000000000202');

insert into public.combo_slots (id, combo_item_id, name, required, sort_order) values
  ('f5400000-0000-4000-8000-000000000201', 'f5300000-0000-4000-8000-000000000205', 'Main', true, 1),
  ('f5400000-0000-4000-8000-000000000202', 'f5300000-0000-4000-8000-000000000205', 'Side', true, 2),
  ('f5400000-0000-4000-8000-000000000203', 'f5300000-0000-4000-8000-000000000205', 'Drink', false, 3);
insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default) values
  ('f5400000-0000-4000-8000-000000000201', 'f5300000-0000-4000-8000-000000000201', 0, true),
  ('f5400000-0000-4000-8000-000000000202', 'f5300000-0000-4000-8000-000000000203', 0, true),
  ('f5400000-0000-4000-8000-000000000202', 'f5300000-0000-4000-8000-000000000202', 100, false),
  ('f5400000-0000-4000-8000-000000000203', 'f5300000-0000-4000-8000-000000000204', 0, true);

-- Egg is out of stock in branch A.
insert into public.branch_modifiers (branch_id, modifier_id, is_available) values
  ('f1000000-0000-4000-8000-00000000020a', 'f5200000-0000-4000-8000-000000000205', false);

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;

-- Helpers to call submit_order as till A with the signed-in session.
create function pg_temp.sid() returns uuid language sql as $$ select (result ->> 'session_id')::uuid from r where step = 'session' $$;
create function pg_temp.submit(p_step text, p_order jsonb) returns void language plpgsql as $$
begin
  insert into r values (p_step, public.submit_order(pg_temp.sid(), p_order));
end $$;
create function pg_temp.res(p_step text, p_key text) returns text language sql as $$ select result ->> p_key from r where step = p_step $$;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000201');
insert into r values ('session', public.start_pos_session('1111'));

-- Prices come from the server ----------------------------------------------------

select pg_temp.submit('burgers', jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000001',
  'order_type', 'takeaway',
  'total', 1, 'subtotal', 1,
  'lines', jsonb_build_array(jsonb_build_object(
    'id', 'f6100000-0000-4000-8000-000000000001',
    'menu_item_id', 'f5300000-0000-4000-8000-000000000201',
    'quantity', 2,
    'unit_price', 1, 'line_total', 1,
    'modifier_ids', jsonb_build_array('f5200000-0000-4000-8000-000000000203')
  ))
));
select is(pg_temp.res('burgers', 'subtotal'), '2400', 'subtotal uses menu prices plus modifiers, not the client''s');
select is(pg_temp.res('burgers', 'tax_total'), '360', 'exclusive 15% tax on 24.00 is 3.60');
select is(pg_temp.res('burgers', 'total'), '2760', 'a fake price from the client doesn''t change the saved total');
select is(pg_temp.res('burgers', 'order_number'), '001', 'the first order of the day is 001');
select is(pg_temp.res('burgers', 'status'), 'open', 'a new order is open');

-- Idempotency -------------------------------------------------------------------

select pg_temp.submit('burgers again', jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000001',
  'lines', jsonb_build_array(jsonb_build_object(
    'id', 'f6100000-0000-4000-8000-000000000001',
    'menu_item_id', 'f5300000-0000-4000-8000-000000000201', 'quantity', 5))
));
select is(pg_temp.res('burgers again', 'order_number'), '001', 'sending the same order again returns it');
select is(pg_temp.res('burgers again', 'total'), '2760', 'a resend can''t change a saved order');
reset role;
select is((select count(*)::int from public.orders where id = 'f6000000-0000-4000-8000-000000000001'), 1,
  'submitting the same order twice creates only one order');
select is((select count(*)::int from public.order_items where order_id = 'f6000000-0000-4000-8000-000000000001'), 1,
  'and only one set of lines');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000201');

-- Taxes (examples shared with lib/pricing.test.ts) ----------------------------------

select pg_temp.submit('wrap', jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000002',
  'lines', jsonb_build_array(jsonb_build_object(
    'id', 'f6100000-0000-4000-8000-000000000002', 'menu_item_id', 'f5300000-0000-4000-8000-000000000202', 'quantity', 1))
));
select is(pg_temp.res('wrap', 'total'), '2000', 'inclusive tax is already in the price');
select is(pg_temp.res('wrap', 'tax_total'), '261', 'inclusive 15% inside 20.00 is 2.61');
select is(pg_temp.res('wrap', 'order_number'), '002', 'numbers go up through the day');

select pg_temp.submit('platter', jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000003',
  'lines', jsonb_build_array(jsonb_build_object(
    'id', 'f6100000-0000-4000-8000-000000000003', 'menu_item_id', 'f5300000-0000-4000-8000-000000000206', 'quantity', 1))
));
select is(pg_temp.res('platter', 'tax_total'), '626', 'two inclusive taxes and one exclusive: 4.89 + 0.98 + 0.39');
select is(pg_temp.res('platter', 'total'), '4539', 'the exclusive tax is added on the net amount');
select is(
  (select jsonb_agg(t ->> 'amount' order by t ->> 'name') from r, jsonb_array_elements(result -> 'taxes') t where step = 'platter'),
  '["39", "98", "489"]'::jsonb,
  'the receipt breakdown lists each tax'
);

-- Combos ------------------------------------------------------------------------

select pg_temp.submit('meal', jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000004',
  'lines', jsonb_build_array(jsonb_build_object(
    'id', 'f6100000-0000-4000-8000-000000000004',
    'menu_item_id', 'f5300000-0000-4000-8000-000000000205',
    'quantity', 1,
    'combo', jsonb_build_array(
      jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000201', 'menu_item_id', 'f5300000-0000-4000-8000-000000000201',
                         'modifier_ids', jsonb_build_array('f5200000-0000-4000-8000-000000000204')),
      jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000202', 'menu_item_id', 'f5300000-0000-4000-8000-000000000203',
                         'modifier_ids', jsonb_build_array('f5200000-0000-4000-8000-000000000202'))
    )
  ))
));
select is(pg_temp.res('meal', 'subtotal'), '2050', 'combo price plus part modifiers: 15.00 + bacon 3.00 + large 2.50');
select is(pg_temp.res('meal', 'total'), '2358', '15% on 20.50 rounds 3.075 up to 3.08');
reset role;
select is(
  (select array_agg(name_snapshot || ':' || unit_price || ':' || coalesce(combo_slot_name, '') order by sort_order)
   from public.order_items where order_id = 'f6000000-0000-4000-8000-000000000004'),
  array['Meal:2050:', 'Burger:0:Main', 'Chips:0:Side'],
  'combo parts are their own kitchen lines, priced inside the combo'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000201');

-- Validation ----------------------------------------------------------------------

select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000010',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000010',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000205', 'quantity', 1,
      'combo', jsonb_build_array(jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000202',
        'menu_item_id', 'f5300000-0000-4000-8000-000000000203',
        'modifier_ids', jsonb_build_array('f5200000-0000-4000-8000-000000000201'))))))),
  '22023', 'Choose the main for Meal', 'a required combo slot must be chosen'
);
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000011',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000011',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000205', 'quantity', 1,
      'combo', jsonb_build_array(
        jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000201', 'menu_item_id', 'f5300000-0000-4000-8000-000000000201'),
        jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000202', 'menu_item_id', 'f5300000-0000-4000-8000-000000000204')))))),
  '22023', 'That isn''t a side choice for Meal', 'combo choices must be options of their slot'
);
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000012',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000012',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000203', 'quantity', 1)))),
  '22023', 'Choose size (1) for Chips', 'a required modifier group must be answered'
);
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000013',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000013',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000203', 'quantity', 1,
      'modifier_ids', jsonb_build_array('f5200000-0000-4000-8000-000000000201', 'f5200000-0000-4000-8000-000000000202'))))),
  '22023', 'Choose at most 1 for size (Chips)', 'a group''s maximum is enforced'
);
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000014',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000014',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000203', 'quantity', 1,
      'modifier_ids', jsonb_build_array('f5200000-0000-4000-8000-000000000201', 'f5200000-0000-4000-8000-000000000203'))))),
  '22023', 'Chips doesn''t offer one of the chosen options', 'modifiers from another item''s groups are rejected'
);
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000015',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000015',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000201', 'quantity', 1,
      'modifier_ids', jsonb_build_array('f5200000-0000-4000-8000-000000000205'))))),
  '22023', 'Egg is out of stock', 'an out-of-stock modifier is rejected'
);
reset role;
insert into public.branch_menu_items (branch_id, menu_item_id, is_available)
values ('f1000000-0000-4000-8000-00000000020a', 'f5300000-0000-4000-8000-000000000204', false);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000201');
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000016',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000016',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000204', 'quantity', 1)))),
  '22023', 'Drink is out of stock', 'an unavailable item is rejected'
);
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000017', 'order_type', 'delivery',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000017',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000201', 'quantity', 1)))),
  '22023', null, 'delivery orders need a phone number and address'
);
select is(
  (select count(*)::int from public.orders where id in (
    'f6000000-0000-4000-8000-000000000010', 'f6000000-0000-4000-8000-000000000011',
    'f6000000-0000-4000-8000-000000000016')),
  0, 'rejected orders leave nothing behind'
);

-- Branch prices and snapshots ----------------------------------------------------------

reset role;
insert into public.branch_menu_items (branch_id, menu_item_id, price_override)
values ('f1000000-0000-4000-8000-00000000020a', 'f5300000-0000-4000-8000-000000000201', 1100);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000201');
select pg_temp.submit('override', jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000005',
  'lines', jsonb_build_array(jsonb_build_object(
    'id', 'f6100000-0000-4000-8000-000000000005', 'menu_item_id', 'f5300000-0000-4000-8000-000000000201', 'quantity', 1))
));
select is(pg_temp.res('override', 'subtotal'), '1100', 'the branch price is charged where there is one');
reset role;
update public.menu_items set name = 'Renamed burger' where id = 'f5300000-0000-4000-8000-000000000201';
select is(
  (select name_snapshot from public.order_items where id = 'f6100000-0000-4000-8000-000000000001'),
  'Burger', 'renaming an item doesn''t change old orders'
);
select is(
  (select count(*)::int from public.audit_log where action = 'order.create'
     and actor_staff_id = 'f2000000-0000-4000-8000-000000000201'
     and device_id = 'f3000000-0000-4000-8000-000000000201'),
  5, 'each new order is audited once, with the cashier and till'
);

-- Other tills and branches -------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000202');
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000020',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000020',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000201', 'quantity', 1)))),
  'PS401', null, 'another till can''t use this till''s session'
);
select is((select count(*)::int from public.orders where branch_id = 'f1000000-0000-4000-8000-00000000020a'), 0,
  'another branch''s till can''t read these orders');
select throws_ok(
  $$select public.get_order('f6000000-0000-4000-8000-000000000001')$$,
  'P0002', null, 'or open them by id'
);
insert into r values ('session b', public.start_pos_session('1111'));
insert into r values ('first in b', public.submit_order((select (result ->> 'session_id')::uuid from r where step = 'session b'),
  jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000021',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000021',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000204', 'quantity', 1)))));
select is(pg_temp.res('first in b', 'order_number'), '001', 'each branch has its own order numbers');
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000201');
select is((select count(*)::int from public.orders where branch_id = 'f1000000-0000-4000-8000-00000000020a'), 5,
  'a till reads its own branch''s orders');

-- Permissions and ended sessions ---------------------------------------------------------

reset role;
delete from public.role_permissions where role = 'cashier' and permission = 'order.create';
select pg_temp.login_as('f0000000-0000-4000-8000-000000000201');
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object(
    'id', 'f6000000-0000-4000-8000-000000000030',
    'lines', jsonb_build_array(jsonb_build_object('id', 'f6100000-0000-4000-8000-000000000030',
      'menu_item_id', 'f5300000-0000-4000-8000-000000000202', 'quantity', 1)))),
  '42501', null, 'staff without order.create can''t take orders'
);
select public.end_pos_session(pg_temp.sid());
select throws_ok(
  format($q$select public.submit_order(%L, %L)$q$, pg_temp.sid(), jsonb_build_object('id', 'f6000000-0000-4000-8000-000000000031')),
  'PS401', null, 'an ended session can''t submit orders'
);
reset role;

select * from finish();
rollback;
