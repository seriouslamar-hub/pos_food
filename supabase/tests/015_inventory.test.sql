-- Phase 11: stock deducted by recipe when orders are paid; deliveries,
-- waste, counts, transfers and refunds; reports.
begin;
create extension if not exists pgtap with schema extensions;

select plan(28);

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
-- Branches A and B. Till A with cashier Ife (1111), manager Kobby (9999,
-- back office). A meal like the 2-piece meal: chicken, a side and a drink.

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000801', 'inv-till@test.local'),
  ('f0000000-0000-4000-8000-000000000802', 'inv-manager@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000080a', 'Stock Branch A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-00000000080b', 'Stock Branch B', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000801', 'f1000000-0000-4000-8000-00000000080a', 'Ife Cashier', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000802', 'f1000000-0000-4000-8000-00000000080a', 'Kobby Manager', 'manager',
   extensions.crypt('9999', extensions.gen_salt('bf', 4)), 'f0000000-0000-4000-8000-000000000802');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000801', 'f1000000-0000-4000-8000-00000000080a',
   'f0000000-0000-4000-8000-000000000801', 'Stock Till', 'till', 'T1');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-00000000080a', 'f1000000-0000-4000-8000-00000000080a', current_date);
insert into public.shifts (branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f1000000-0000-4000-8000-00000000080a', 'f8000000-0000-4000-8000-00000000080a',
   'f2000000-0000-4000-8000-000000000801', 'f3000000-0000-4000-8000-000000000801', 0);

insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000801', 'Stock test');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000801', 'f5000000-0000-4000-8000-000000000801', 'combo', 'Inv meal', 6000, 'invtest'),
  ('f5300000-0000-4000-8000-000000000802', 'f5000000-0000-4000-8000-000000000801', 'item', 'Inv chicken', 4500, 'invtest'),
  ('f5300000-0000-4000-8000-000000000803', 'f5000000-0000-4000-8000-000000000801', 'item', 'Inv slaw', 1000, 'invtest'),
  ('f5300000-0000-4000-8000-000000000804', 'f5000000-0000-4000-8000-000000000801', 'item', 'Inv cola', 1000, 'invtest');
insert into public.modifier_groups (id, name, min_select, max_select) values
  ('f5100000-0000-4000-8000-000000000801', 'Inv size', 1, 1);
insert into public.modifiers (id, group_id, name, price_delta) values
  ('f5200000-0000-4000-8000-000000000801', 'f5100000-0000-4000-8000-000000000801', 'Regular', 0),
  ('f5200000-0000-4000-8000-000000000802', 'f5100000-0000-4000-8000-000000000801', 'Large', 300);
insert into public.item_modifier_groups (menu_item_id, modifier_group_id) values
  ('f5300000-0000-4000-8000-000000000804', 'f5100000-0000-4000-8000-000000000801');
insert into public.combo_slots (id, combo_item_id, name, sort_order, required) values
  ('f5400000-0000-4000-8000-000000000801', 'f5300000-0000-4000-8000-000000000801', 'Chicken', 10, true),
  ('f5400000-0000-4000-8000-000000000802', 'f5300000-0000-4000-8000-000000000801', 'Side', 20, true),
  ('f5400000-0000-4000-8000-000000000803', 'f5300000-0000-4000-8000-000000000801', 'Drink', 30, true);
insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default) values
  ('f5400000-0000-4000-8000-000000000801', 'f5300000-0000-4000-8000-000000000802', 0, true),
  ('f5400000-0000-4000-8000-000000000802', 'f5300000-0000-4000-8000-000000000803', 0, true),
  ('f5400000-0000-4000-8000-000000000803', 'f5300000-0000-4000-8000-000000000804', 0, true);

insert into public.suppliers (id, name) values ('f9100000-0000-4000-8000-000000000801', 'Inv Supplier');
insert into public.ingredients (id, name, unit, cost_per_unit, reorder_level, supplier_id) values
  ('f9200000-0000-4000-8000-000000000801', 'Inv chicken piece', 'pc', 400, 10, 'f9100000-0000-4000-8000-000000000801'),
  ('f9200000-0000-4000-8000-000000000802', 'Inv coleslaw', 'kg', 1500, 1, 'f9100000-0000-4000-8000-000000000801'),
  ('f9200000-0000-4000-8000-000000000803', 'Inv side tub', 'pc', 25, 0, 'f9100000-0000-4000-8000-000000000801'),
  ('f9200000-0000-4000-8000-000000000804', 'Inv syrup', 'l', 6000, 0, 'f9100000-0000-4000-8000-000000000801'),
  ('f9200000-0000-4000-8000-000000000805', 'Inv cup', 'pc', 30, 0, 'f9100000-0000-4000-8000-000000000801'),
  ('f9200000-0000-4000-8000-000000000806', 'Inv meal box', 'pc', 150, 0, 'f9100000-0000-4000-8000-000000000801');
insert into public.recipes (menu_item_id, modifier_id, ingredient_id, quantity) values
  ('f5300000-0000-4000-8000-000000000801', null, 'f9200000-0000-4000-8000-000000000806', 1),
  ('f5300000-0000-4000-8000-000000000802', null, 'f9200000-0000-4000-8000-000000000801', 2),
  ('f5300000-0000-4000-8000-000000000803', null, 'f9200000-0000-4000-8000-000000000802', 0.1),
  ('f5300000-0000-4000-8000-000000000803', null, 'f9200000-0000-4000-8000-000000000803', 1),
  ('f5300000-0000-4000-8000-000000000804', null, 'f9200000-0000-4000-8000-000000000804', 0.05),
  ('f5300000-0000-4000-8000-000000000804', null, 'f9200000-0000-4000-8000-000000000805', 1),
  (null, 'f5200000-0000-4000-8000-000000000802', 'f9200000-0000-4000-8000-000000000804', 0.03);

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.sid() returns uuid language sql as $$
  select (result ->> 'session_id')::uuid from r where step = 'session'
$$;
create function pg_temp.on_hand(p_ingredient text, p_branch text default 'f1000000-0000-4000-8000-00000000080a')
returns numeric language sql as $$
  select coalesce((select quantity_on_hand from public.branch_stock
    where branch_id = p_branch::uuid and ingredient_id = p_ingredient::uuid), 0)
$$;
create function pg_temp.meal(p_order text, p_drink_mod text) returns jsonb language sql as $$
  select jsonb_build_object('id', p_order, 'lines', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'menu_item_id', 'f5300000-0000-4000-8000-000000000801', 'quantity', 2,
    'combo', jsonb_build_array(
      jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000801', 'menu_item_id', 'f5300000-0000-4000-8000-000000000802'),
      jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000802', 'menu_item_id', 'f5300000-0000-4000-8000-000000000803'),
      jsonb_build_object('slot_id', 'f5400000-0000-4000-8000-000000000803', 'menu_item_id', 'f5300000-0000-4000-8000-000000000804',
        'modifier_ids', jsonb_build_array(p_drink_mod))))))
$$;
create function pg_temp.pay(p_order text, p_amount integer) returns jsonb language sql as $$
  select public.record_payments(pg_temp.sid(), p_order::uuid, jsonb_build_array(jsonb_build_object(
    'id', 'f7000000-0000-4000-8000-000000000801',
    'payment_method_id', (select id from public.payment_methods where type = 'cash' limit 1),
    'amount', p_amount)))
$$;

-- Selling deducts by recipe -------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000801');
insert into r values ('session', public.start_pos_session('1111'));
-- Two meals with a large drink: 2 × (6000 + 300).
insert into r values ('order', public.submit_order(pg_temp.sid(),
  pg_temp.meal('f6000000-0000-4000-8000-000000000801', 'f5200000-0000-4000-8000-000000000802')));
reset role;
select is((select count(*)::int from public.stock_movements where reference_id = 'f6000000-0000-4000-8000-000000000801'),
  0, 'nothing comes out of stock before payment');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000801');
select pg_temp.pay('f6000000-0000-4000-8000-000000000801', 12600);
reset role;
select is(
  (select jsonb_object_agg(i.name, -m.quantity)
   from public.stock_movements m join public.ingredients i on i.id = m.ingredient_id
   where m.reference_id = 'f6000000-0000-4000-8000-000000000801' and m.type = 'sale'),
  '{"Inv chicken piece": 4, "Inv coleslaw": 0.2, "Inv side tub": 2, "Inv syrup": 0.16, "Inv cup": 2, "Inv meal box": 2}'::jsonb,
  'two meals deduct their chicken, side, drink (large: more syrup), cups and boxes'
);
select is(pg_temp.on_hand('f9200000-0000-4000-8000-000000000801'), -4.000::numeric,
  'stock on hand goes down (it may go below zero before a delivery is booked)');
select public.deduct_order_stock('f6000000-0000-4000-8000-000000000801');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000801');
select pg_temp.pay('f6000000-0000-4000-8000-000000000801', 12600);
reset role;
select is((select count(*)::int from public.stock_movements where reference_id = 'f6000000-0000-4000-8000-000000000801'),
  6, 'stock comes out once, however often the payment is sent');

-- Deliveries --------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000802');
select is(
  public.save_purchase_order('f1000000-0000-4000-8000-00000000080a', jsonb_build_object(
    'id', 'fa100000-0000-4000-8000-000000000801', 'supplier_id', 'f9100000-0000-4000-8000-000000000801',
    'lines', jsonb_build_array(
      jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000801', 'quantity', 50, 'unit_cost', 400),
      jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000805', 'quantity', 100)))),
  'fa100000-0000-4000-8000-000000000801'::uuid, 'a manager drafts a purchase order'
);
select lives_ok(
  $$select public.set_purchase_order_status('fa100000-0000-4000-8000-000000000801', 'sent')$$,
  'and sends it'
);
-- 48 chicken pieces came, at 4.20 each; the cups as ordered.
select lives_ok(
  $$select public.receive_purchase_order('fa100000-0000-4000-8000-000000000801', jsonb_build_array(
    jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000801', 'quantity', 48, 'unit_cost', 420)))$$,
  'the delivery is received'
);
select lives_ok($$select public.receive_purchase_order('fa100000-0000-4000-8000-000000000801')$$, 'receiving again is safe');
reset role;
select is(
  array[pg_temp.on_hand('f9200000-0000-4000-8000-000000000801'), pg_temp.on_hand('f9200000-0000-4000-8000-000000000805')],
  array[44.000, 98.000]::numeric[], 'what arrived goes into stock (differences included)'
);
select is((select cost_per_unit from public.ingredients where id = 'f9200000-0000-4000-8000-000000000801'), 420,
  'the price paid becomes the ingredient''s cost');
select is((select status::text from public.purchase_orders where id = 'fa100000-0000-4000-8000-000000000801'), 'received',
  'the purchase order is received');
select is(
  array(select action from public.audit_log where entity_id = 'fa100000-0000-4000-8000-000000000801' order by id),
  array['purchase_order.saved', 'purchase_order.sent', 'purchase_order.received'],
  'every purchase order step is audited'
);

-- Waste, transfers and counts -----------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000802');
select throws_ok(
  $$select public.record_waste('f1000000-0000-4000-8000-00000000080a', jsonb_build_object('id', gen_random_uuid(),
    'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000801', 'quantity', 2))))$$,
  '22023', 'Give a reason for each line of waste', 'waste needs a reason'
);
select lives_ok(
  $$select public.record_waste('f1000000-0000-4000-8000-00000000080a', jsonb_build_object('id', 'fa200000-0000-4000-8000-000000000801',
    'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000801', 'quantity', 2, 'reason', 'Dropped'))))$$,
  'a manager records waste'
);
select lives_ok(
  $$select public.transfer_stock('f1000000-0000-4000-8000-00000000080a', jsonb_build_object('id', 'fa300000-0000-4000-8000-000000000801',
    'to_branch_id', 'f1000000-0000-4000-8000-00000000080b',
    'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000801', 'quantity', 10))))$$,
  'and sends stock to another branch'
);
reset role;
select is(
  array[pg_temp.on_hand('f9200000-0000-4000-8000-000000000801'),
        pg_temp.on_hand('f9200000-0000-4000-8000-000000000801', 'f1000000-0000-4000-8000-00000000080b')],
  array[32.000, 10.000]::numeric[], 'waste and transfers move stock (44 − 2 − 10; branch B gets 10)'
);

-- A count finds 30 pieces (2 missing); approval adjusts stock by the difference.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000802');
insert into r values ('count', jsonb_build_object('id', public.submit_stock_count('f1000000-0000-4000-8000-00000000080a',
  jsonb_build_object('id', 'fa400000-0000-4000-8000-000000000801',
    'lines', jsonb_build_array(jsonb_build_object('ingredient_id', 'f9200000-0000-4000-8000-000000000801', 'quantity', 30))))));
reset role;
select is(
  (select array[expected, counted, variance] from public.stock_count_lines where stock_count_id = 'fa400000-0000-4000-8000-000000000801'),
  array[32.000, 30.000, -2.000]::numeric[], 'the count records expected, counted and the difference'
);
select is(pg_temp.on_hand('f9200000-0000-4000-8000-000000000801'), 32.000::numeric, 'stock waits for approval');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000802');
select lives_ok($$select public.review_stock_count('fa400000-0000-4000-8000-000000000801', true)$$, 'the count is approved');
select throws_ok($$select public.review_stock_count('fa400000-0000-4000-8000-000000000801', true)$$, '22023', null,
  'and can''t be approved twice');
reset role;
select is(pg_temp.on_hand('f9200000-0000-4000-8000-000000000801'), 30.000::numeric, 'stock now matches the count');

-- A refund put back on the shelf returns its ingredients.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000801');
insert into r values ('refund', public.refund_order(pg_temp.sid(), jsonb_build_object(
  'id', gen_random_uuid(), 'order_id', 'f6000000-0000-4000-8000-000000000801', 'reason', 'Changed mind',
  'payment_method_id', (select id from public.payment_methods where type = 'cash' limit 1),
  'return_to_stock', true,
  'override_id', (public.verify_override(pg_temp.sid(), '9999', 'order.refund', null) ->> 'override_id'))));
reset role;
select is(pg_temp.on_hand('f9200000-0000-4000-8000-000000000801'), 34.000::numeric,
  'refunding two meals put back on the shelf returns 4 chicken pieces');

-- Reports and who can do what -------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000802');
insert into r values ('report', public.inventory_report('f1000000-0000-4000-8000-00000000080a', current_date, current_date));
select is(
  (select jsonb_build_object('theoretical', x -> 'theoretical', 'waste', x -> 'waste', 'count', x -> 'count_adjust',
     'returned', x -> 'returned', 'actual', x -> 'actual', 'on_hand', x -> 'on_hand', 'value', x -> 'value')
   from r, jsonb_array_elements(result -> 'ingredients') x
   where step = 'report' and x ->> 'name' = 'Inv chicken piece'),
  '{"theoretical": 4, "waste": 2, "count": -2, "returned": 4, "actual": 4, "on_hand": 34, "value": 14280}'::jsonb,
  'theoretical vs actual usage: sold 4, wasted 2, 2 missing, 4 back'
);
select is(
  (select result -> 'waste_by_reason' from r where step = 'report'),
  '[{"reason": "Dropped", "lines": 1, "value": 840}]'::jsonb, 'waste by reason, at cost'
);
select ok(
  (select bool_or(s ->> 'name' = 'Inv coleslaw') from jsonb_array_elements(
    public.suggest_purchase('f1000000-0000-4000-8000-00000000080a', 7)) s),
  'the suggested order includes what''s below its reorder level'
);
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000801');
select throws_ok(
  $$select public.record_waste('f1000000-0000-4000-8000-00000000080a', '{"id": "fa200000-0000-4000-8000-000000000809", "lines": []}')$$,
  '42501', null, 'a till can''t touch stock'
);
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000802');
select throws_ok(
  $$select public.inventory_report('f1000000-0000-4000-8000-00000000080b', current_date, current_date)$$,
  '42501', null, 'nor can a manager for another branch'
);
select is((select count(*)::int from public.branch_stock where branch_id = 'f1000000-0000-4000-8000-00000000080b'), 0,
  'whose stock they can''t read either');
reset role;

select * from finish();
rollback;
