-- Phase 4: menu permissions, combo rules, branch prices, availability and get_menu.
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
  ('f0000000-0000-4000-8000-000000000101', 'menu-admin@test.local'),
  ('f0000000-0000-4000-8000-000000000102', 'menu-manager-a@test.local'),
  ('f0000000-0000-4000-8000-000000000103', 'menu-till-a@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000010a', 'Menu Branch A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-00000000010b', 'Menu Branch B', 'UTC', 'USD');

insert into public.staff (id, auth_user_id, branch_id, full_name, role) values
  ('f2000000-0000-4000-8000-000000000101', 'f0000000-0000-4000-8000-000000000101', null, 'Menu Admin', 'admin'),
  ('f2000000-0000-4000-8000-000000000102', 'f0000000-0000-4000-8000-000000000102',
   'f1000000-0000-4000-8000-00000000010a', 'Menu Manager A', 'manager');

insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000101', 'f1000000-0000-4000-8000-00000000010a',
   'f0000000-0000-4000-8000-000000000103', 'Menu Till A', 'till', 'T1');

insert into public.categories (id, name) values
  ('f5000000-0000-4000-8000-000000000001', 'Test category');
insert into public.modifier_groups (id, name, min_select, max_select) values
  ('f5100000-0000-4000-8000-000000000001', 'Test size', 1, 1);
insert into public.modifiers (id, group_id, name, price_delta) values
  ('f5200000-0000-4000-8000-000000000001', 'f5100000-0000-4000-8000-000000000001', 'Test regular', 0),
  ('f5200000-0000-4000-8000-000000000002', 'f5100000-0000-4000-8000-000000000001', 'Test large', 250);
insert into public.menu_items (id, category_id, type, name, base_price) values
  ('f5300000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001', 'item', 'Test burger', 1000),
  ('f5300000-0000-4000-8000-000000000002', 'f5000000-0000-4000-8000-000000000001', 'item', 'Test fries', 500),
  ('f5300000-0000-4000-8000-000000000003', 'f5000000-0000-4000-8000-000000000001', 'combo', 'Test meal', 1400),
  ('f5300000-0000-4000-8000-000000000004', 'f5000000-0000-4000-8000-000000000001', 'item', 'Retired item', 999);
update public.menu_items set is_active = false where id = 'f5300000-0000-4000-8000-000000000004';
insert into public.item_modifier_groups (menu_item_id, modifier_group_id) values
  ('f5300000-0000-4000-8000-000000000002', 'f5100000-0000-4000-8000-000000000001');
insert into public.combo_slots (id, combo_item_id, name) values
  ('f5400000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000003', 'Main'),
  ('f5400000-0000-4000-8000-000000000002', 'f5300000-0000-4000-8000-000000000003', 'Side');
insert into public.combo_slot_options (slot_id, menu_item_id, upcharge, is_default) values
  ('f5400000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000001', 0, true),
  ('f5400000-0000-4000-8000-000000000002', 'f5300000-0000-4000-8000-000000000002', 0, true),
  ('f5400000-0000-4000-8000-000000000002', 'f5300000-0000-4000-8000-000000000004', 100, false);

create temp table menus (name text primary key, doc jsonb);
grant all on menus to authenticated;

create function pg_temp.item(p_menu text, p_item uuid)
returns jsonb
language sql
as $$
  select i from menus m, jsonb_array_elements(m.doc -> 'items') i
  where m.name = p_menu and (i ->> 'id')::uuid = p_item;
$$;

-- Who can change the menu ----------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000101');
select lives_ok(
  $$insert into public.menu_items (category_id, name, base_price)
    values ('f5000000-0000-4000-8000-000000000001', 'Admin special', 1200)$$,
  'an admin can add menu items'
);
select throws_ok(
  $$insert into public.combo_slots (combo_item_id, name) values ('f5300000-0000-4000-8000-000000000001', 'Nope')$$,
  '22023', 'Slots can only be added to combos', 'slots only go on combos'
);
select throws_ok(
  $$insert into public.combo_slot_options (slot_id, menu_item_id)
    values ('f5400000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000003')$$,
  '22023', 'A combo can''t contain another combo', 'a combo cannot contain a combo'
);
select throws_ok(
  $$update public.menu_items set type = 'item' where id = 'f5300000-0000-4000-8000-000000000003'$$,
  '22023', null, 'a combo with slots cannot become a plain item'
);
select throws_ok(
  $$update public.menu_items set type = 'combo' where id = 'f5300000-0000-4000-8000-000000000002'$$,
  '22023', null, 'an item used in a combo cannot become a combo'
);
select throws_ok(
  $$insert into public.combo_slot_options (slot_id, menu_item_id, is_default)
    values ('f5400000-0000-4000-8000-000000000002', 'f5300000-0000-4000-8000-000000000001', true)$$,
  '23505', null, 'a slot has at most one default option'
);
select lives_ok(
  $$select public.set_branch_price('f1000000-0000-4000-8000-00000000010a', 'f5300000-0000-4000-8000-000000000001', 1100)$$,
  'an admin can set a branch price'
);
select throws_ok(
  $$select public.set_branch_price('f1000000-0000-4000-8000-00000000010a', 'f5300000-0000-4000-8000-000000000001', -1)$$,
  '22023', null, 'negative prices are rejected'
);
select lives_ok(
  $$select public.reorder_menu('menu_items', array[
      'f5300000-0000-4000-8000-000000000002', 'f5300000-0000-4000-8000-000000000001']::uuid[])$$,
  'an admin can reorder items'
);
reset role;

select is(
  (select array_agg(name order by sort_order) from public.menu_items
   where id in ('f5300000-0000-4000-8000-000000000001', 'f5300000-0000-4000-8000-000000000002')),
  array['Test fries', 'Test burger'], 'reordering saves the new order'
);

select pg_temp.login_as('f0000000-0000-4000-8000-000000000102');
select throws_ok(
  $$insert into public.menu_items (category_id, name, base_price)
    values ('f5000000-0000-4000-8000-000000000001', 'Manager special', 100)$$,
  '42501', null, 'a manager cannot add menu items'
);
select throws_ok(
  $$select public.set_branch_price('f1000000-0000-4000-8000-00000000010a', 'f5300000-0000-4000-8000-000000000001', 1)$$,
  '42501', null, 'a manager cannot change prices'
);
select throws_ok(
  $$select public.reorder_menu('menu_items', array['f5300000-0000-4000-8000-000000000001']::uuid[])$$,
  '42501', null, 'a manager cannot reorder the menu'
);
select lives_ok(
  $$select public.set_availability('f1000000-0000-4000-8000-00000000010a', 'item', 'f5300000-0000-4000-8000-000000000002', false)$$,
  'a manager can mark an item out of stock in their branch'
);
select lives_ok(
  $$select public.set_availability('f1000000-0000-4000-8000-00000000010a', 'modifier', 'f5200000-0000-4000-8000-000000000002', false)$$,
  'a manager can mark a modifier out of stock in their branch'
);
select throws_ok(
  $$select public.set_availability('f1000000-0000-4000-8000-00000000010b', 'item', 'f5300000-0000-4000-8000-000000000002', false)$$,
  '42501', null, 'a manager cannot change another branch'
);
select is(
  (select count(*)::int from public.branch_menu_items where branch_id = 'f1000000-0000-4000-8000-00000000010a'),
  2, 'a manager can read their branch''s price and availability rows'
);
reset role;

select is(
  (select actor_staff_id from public.audit_log
   where entity = 'branch_menu_items' and branch_id = 'f1000000-0000-4000-8000-00000000010a'
     and (after ->> 'is_available') = 'false'),
  'f2000000-0000-4000-8000-000000000102'::uuid,
  'availability changes are audited with the manager as actor'
);

-- The till reads the menu -----------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000103');
select ok((select count(*) from public.menu_items) > 0, 'a till can read menu items');
select throws_ok(
  $$select public.set_availability('f1000000-0000-4000-8000-00000000010a', 'item', 'f5300000-0000-4000-8000-000000000002', true)$$,
  '42501', null, 'a till cannot change availability'
);
insert into menus values ('a', public.get_menu('f1000000-0000-4000-8000-00000000010a'));
select throws_ok(
  $$select public.get_menu('f1000000-0000-4000-8000-00000000010b')$$,
  '42501', null, 'a till cannot read another branch''s menu'
);
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000101');
insert into menus values ('b', public.get_menu('f1000000-0000-4000-8000-00000000010b'));
reset role;

select is((pg_temp.item('a', 'f5300000-0000-4000-8000-000000000001') ->> 'price')::int, 1100,
  'get_menu uses the branch price where there is one');
select is((pg_temp.item('b', 'f5300000-0000-4000-8000-000000000001') ->> 'price')::int, 1000,
  'other branches keep the base price');
select is((pg_temp.item('a', 'f5300000-0000-4000-8000-000000000002') ->> 'is_available')::boolean, false,
  'an out-of-stock item is unavailable in its branch');
select is((pg_temp.item('b', 'f5300000-0000-4000-8000-000000000002') ->> 'is_available')::boolean, true,
  'it is still available in other branches');
select is(
  (select (m ->> 'is_available')::boolean
   from jsonb_array_elements(pg_temp.item('a', 'f5300000-0000-4000-8000-000000000002') -> 'modifier_groups' -> 0 -> 'modifiers') m
   where m ->> 'name' = 'Test large'),
  false, 'an out-of-stock modifier is unavailable in its branch'
);
select is(pg_temp.item('a', 'f5300000-0000-4000-8000-000000000004'), null,
  'inactive items are left out of the menu');
select is(
  (select jsonb_agg(o ->> 'menu_item_id')
   from jsonb_array_elements(pg_temp.item('a', 'f5300000-0000-4000-8000-000000000003') -> 'combo_slots') s,
        jsonb_array_elements(s -> 'options') o
   where s ->> 'name' = 'Side'),
  '["f5300000-0000-4000-8000-000000000002"]'::jsonb,
  'combo options skip inactive items'
);
select is((select doc ->> 'currency_code' from menus where name = 'a'), 'USD',
  'the menu carries the branch currency');

-- The sample menu only goes into an empty menu ---------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000101');
select throws_ok(
  'select public.load_sample_menu()',
  '22023', null, 'the sample menu is refused when the menu already has items'
);
reset role;

select * from finish();
rollback;
