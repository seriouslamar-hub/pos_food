-- Phase 10: kitchen screens bump items; orders become ready and collected.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

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

-- Fixtures: a till (cashier Dede, 1111) and a kitchen screen. A burger made
-- at the grill and a drink at the drinks station.
insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000701', 'kit-till@test.local'),
  ('f0000000-0000-4000-8000-000000000702', 'kit-kds@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000070a', 'Kitchen Branch', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash) values
  ('f2000000-0000-4000-8000-000000000701', 'f1000000-0000-4000-8000-00000000070a', 'Dede Cashier', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)));
insert into public.devices (id, branch_id, auth_user_id, name, type, code, station) values
  ('f3000000-0000-4000-8000-000000000701', 'f1000000-0000-4000-8000-00000000070a',
   'f0000000-0000-4000-8000-000000000701', 'Kitchen Till', 'till', 'T1', null),
  ('f3000000-0000-4000-8000-000000000702', 'f1000000-0000-4000-8000-00000000070a',
   'f0000000-0000-4000-8000-000000000702', 'Grill Screen', 'kds', 'K1', 'Grill');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-00000000070a', 'f1000000-0000-4000-8000-00000000070a', current_date);
insert into public.shifts (branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f1000000-0000-4000-8000-00000000070a', 'f8000000-0000-4000-8000-00000000070a',
   'f2000000-0000-4000-8000-000000000701', 'f3000000-0000-4000-8000-000000000701', 0);
insert into public.kds_stations (id, name) values
  ('f4000000-0000-4000-8000-000000000701', 'Kit grill'),
  ('f4000000-0000-4000-8000-000000000702', 'Kit drinks');
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000701', 'Kitchen test');
insert into public.menu_items (id, category_id, name, base_price, tax_category, kds_station_id) values
  ('f5300000-0000-4000-8000-000000000701', 'f5000000-0000-4000-8000-000000000701', 'Kit burger', 1000, 'kittest',
   'f4000000-0000-4000-8000-000000000701'),
  ('f5300000-0000-4000-8000-000000000702', 'f5000000-0000-4000-8000-000000000701', 'Kit drink', 500, 'kittest',
   'f4000000-0000-4000-8000-000000000702');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.sid() returns uuid language sql as $$
  select (result ->> 'session_id')::uuid from r where step = 'session'
$$;
create function pg_temp.line_id(p_name text) returns uuid language sql as $$
  select id from public.order_items where order_id = 'f6000000-0000-4000-8000-000000000701' and name_snapshot = p_name
$$;

-- A paid order goes to the kitchen.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000701');
insert into r values ('session', public.start_pos_session('1111'));
insert into r values ('order', public.submit_order(pg_temp.sid(), jsonb_build_object(
  'id', 'f6000000-0000-4000-8000-000000000701',
  'lines', jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'menu_item_id', 'f5300000-0000-4000-8000-000000000701', 'quantity', 1),
    jsonb_build_object('id', gen_random_uuid(), 'menu_item_id', 'f5300000-0000-4000-8000-000000000702', 'quantity', 1)))));
select public.record_payments(pg_temp.sid(), 'f6000000-0000-4000-8000-000000000701', jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid(), 'payment_method_id',
    (select id from public.payment_methods where type = 'cash' limit 1), 'amount', 1500)));
select throws_ok(
  $$select public.bump_items(array[pg_temp.line_id('Kit burger')])$$,
  '42501', null, 'a till can''t bump kitchen items'
);
reset role;

-- The kitchen screen reads the branch's orders and bumps them.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000702');
select is(
  (select count(*)::int from public.order_items where order_id = 'f6000000-0000-4000-8000-000000000701'),
  2, 'a kitchen screen reads its branch''s order items'
);
select is(public.bump_items(array[pg_temp.line_id('Kit burger')]), '[]'::jsonb,
  'bumping the burger doesn''t finish the order');
reset role;
select is(
  (select array[status::text, (bumped_at is not null)::text] from public.order_items
   where id = pg_temp.line_id('Kit burger')),
  array['ready', 'true'], 'the burger is ready'
);
select is((select status::text from public.orders where id = 'f6000000-0000-4000-8000-000000000701'), 'paid',
  'the order is still being made');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000702');
select is(public.bump_items(array[pg_temp.line_id('Kit drink')]),
  '["f6000000-0000-4000-8000-000000000701"]'::jsonb, 'the last item makes the order ready');
select lives_ok($$select public.bump_items(array[pg_temp.line_id('Kit drink')])$$, 'bumping again is safe');
reset role;
select ok(
  (select status = 'ready' and ready_at is not null from public.orders where id = 'f6000000-0000-4000-8000-000000000701'),
  'the order is ready, with the time'
);

-- Recall puts it back.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000702');
select lives_ok($$select public.recall_items(array[pg_temp.line_id('Kit drink')])$$, 'a bumped item can be recalled');
reset role;
select is(
  (select array[o.status::text, (o.ready_at is null)::text, i.status::text, (i.bumped_at is null)::text]
   from public.orders o join public.order_items i on i.order_id = o.id
   where o.id = 'f6000000-0000-4000-8000-000000000701' and i.name_snapshot = 'Kit drink'),
  array['paid', 'true', 'sent', 'true'], 'and the order is back in the kitchen'
);

-- The till hands it over.
select pg_temp.login_as('f0000000-0000-4000-8000-000000000701');
insert into r values ('collected', public.mark_order_collected(pg_temp.sid(), 'f6000000-0000-4000-8000-000000000701'));
select is((select result ->> 'status' from r where step = 'collected'), 'collected', 'the till marks it collected');
select lives_ok($$select public.mark_order_collected(pg_temp.sid(), 'f6000000-0000-4000-8000-000000000701')$$,
  'safely, more than once');
reset role;
select ok(
  (select collected_at is not null and ready_at is not null
     and not exists (select 1 from public.order_items where order_id = o.id and bumped_at is null)
   from public.orders o where o.id = 'f6000000-0000-4000-8000-000000000701'),
  'it leaves the kitchen screens, with the times kept'
);

-- A meal is ready when its parts are; voided lines don't hold an order up.
insert into public.orders (id, branch_id, business_date, order_number, channel, status, paid_at, sent_to_kitchen_at)
values ('f6000000-0000-4000-8000-000000000702', 'f1000000-0000-4000-8000-00000000070a', current_date, 'K-1',
  'kiosk', 'paid', now(), now());
insert into public.order_items (id, order_id, branch_id, menu_item_id, name_snapshot, short_name_snapshot, quantity, unit_price, status) values
  ('f6100000-0000-4000-8000-000000000710', 'f6000000-0000-4000-8000-000000000702', 'f1000000-0000-4000-8000-00000000070a',
   'f5300000-0000-4000-8000-000000000701', 'Kit meal', 'Meal', 1, 1500, 'sent'),
  ('f6100000-0000-4000-8000-000000000713', 'f6000000-0000-4000-8000-000000000702', 'f1000000-0000-4000-8000-00000000070a',
   'f5300000-0000-4000-8000-000000000702', 'Kit drink', 'Drink', 1, 500, 'voided');
insert into public.order_items (id, order_id, branch_id, parent_item_id, menu_item_id, name_snapshot, short_name_snapshot, quantity, unit_price, status) values
  ('f6100000-0000-4000-8000-000000000711', 'f6000000-0000-4000-8000-000000000702', 'f1000000-0000-4000-8000-00000000070a',
   'f6100000-0000-4000-8000-000000000710', 'f5300000-0000-4000-8000-000000000701', 'Kit burger', 'Burger', 1, 0, 'sent'),
  ('f6100000-0000-4000-8000-000000000712', 'f6000000-0000-4000-8000-000000000702', 'f1000000-0000-4000-8000-00000000070a',
   'f6100000-0000-4000-8000-000000000710', 'f5300000-0000-4000-8000-000000000702', 'Kit drink', 'Drink', 1, 0, 'sent');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000702');
select is(public.bump_items(array['f6100000-0000-4000-8000-000000000711']::uuid[]), '[]'::jsonb,
  'one part of a meal isn''t the whole meal');
select is(public.bump_items(array['f6100000-0000-4000-8000-000000000712']::uuid[]),
  '["f6000000-0000-4000-8000-000000000702"]'::jsonb,
  'the last part finishes the meal and the order (the voided drink doesn''t count)');
reset role;
select is((select status::text from public.order_items where id = 'f6100000-0000-4000-8000-000000000710'), 'ready',
  'the meal line is ready');

select * from finish();
rollback;
