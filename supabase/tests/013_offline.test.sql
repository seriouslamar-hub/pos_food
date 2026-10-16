-- Phase 9: what a till did offline is accepted when it comes back online.
begin;
create extension if not exists pgtap with schema extensions;

select plan(25);

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

-- Fixtures: till A, cashier Abi (1111, 10% discount limit, open shift) and
-- manager Kwesi (9999, also a back-office login). A burger at 10.00, no tax.
insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000601', 'off-till-a@test.local'),
  ('f0000000-0000-4000-8000-000000000602', 'off-manager@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000060a', 'Offline Branch', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, discount_limit_bps, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-00000000060a', 'Abi Cashier', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)), 1000, null),
  ('f2000000-0000-4000-8000-000000000602', 'f1000000-0000-4000-8000-00000000060a', 'Kwesi Manager', 'manager',
   extensions.crypt('9999', extensions.gen_salt('bf', 4)), 5000, 'f0000000-0000-4000-8000-000000000602'),
  ('f2000000-0000-4000-8000-000000000603', 'f1000000-0000-4000-8000-00000000060a', 'No Pin Cashier', 'cashier',
   null, 0, null);
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000601', 'f1000000-0000-4000-8000-00000000060a',
   'f0000000-0000-4000-8000-000000000601', 'Offline Till A', 'till', 'T1');
insert into public.business_days (id, branch_id, business_date, opened_at) values
  ('f8000000-0000-4000-8000-00000000060a', 'f1000000-0000-4000-8000-00000000060a', current_date, now() - interval '1 hour');
insert into public.shifts (branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f1000000-0000-4000-8000-00000000060a', 'f8000000-0000-4000-8000-00000000060a',
   'f2000000-0000-4000-8000-000000000601', 'f3000000-0000-4000-8000-000000000601', 0);
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000601', 'Offline test');
insert into public.menu_items (id, category_id, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000601', 'f5000000-0000-4000-8000-000000000601', 'Off burger', 1000, 'offtest_none');
insert into public.branch_menu_items (branch_id, menu_item_id, is_available) values
  ('f1000000-0000-4000-8000-00000000060a', 'f5300000-0000-4000-8000-000000000601', false);

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.order_payload(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'lines', jsonb_build_array(jsonb_build_object(
    'id', gen_random_uuid(), 'menu_item_id', 'f5300000-0000-4000-8000-000000000601', 'quantity', 1))) || p_extra
$$;
create function pg_temp.sid_live() returns uuid language sql as $$
  select id from public.pos_sessions
  where device_id = 'f3000000-0000-4000-8000-000000000601' and ended_at is null and not is_offline
$$;
create function pg_temp.val(p_step text, p_key text) returns text language sql as $$
  select result ->> p_key from r where step = p_step
$$;
create function pg_temp.cash() returns uuid language sql as $$
  select id from public.payment_methods where type = 'cash' order by sort_order limit 1
$$;

-- What the till keeps for offline sign-ins ------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000601');
insert into r values ('bundle', public.get_offline_bundle());
select is(
  (select jsonb_agg(s ->> 'full_name' order by s ->> 'full_name') from r, jsonb_array_elements(result -> 'staff') s
   where step = 'bundle' and s ->> 'full_name' in ('Abi Cashier', 'Kwesi Manager', 'No Pin Cashier')),
  '["Abi Cashier", "Kwesi Manager"]'::jsonb,
  'a till gets the branch''s staff who have a PIN'
);
select ok(
  (select bool_and(s ->> 'pin_hash' like '$2%' and s -> 'permissions' ? 'order.create')
   from r, jsonb_array_elements(result -> 'staff') s where step = 'bundle'),
  'with PIN hashes and permissions'
);
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000602');
select throws_ok($$select public.get_offline_bundle()$$, '42501', null, 'nobody else gets PIN hashes');
reset role;

-- Offline sign-ins ------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000601');
select lives_ok(
  $$select public.start_offline_session('fb000000-0000-4000-8000-000000000601',
    'f2000000-0000-4000-8000-000000000601', now() - interval '5 minutes')$$,
  'a till registers a PIN sign-in made offline'
);
select lives_ok(
  $$select public.start_offline_session('fb000000-0000-4000-8000-000000000601',
    'f2000000-0000-4000-8000-000000000601', now() - interval '5 minutes')$$,
  'safely, more than once'
);
select throws_ok(
  $$select public.start_offline_session('fb000000-0000-4000-8000-000000000601',
    'f2000000-0000-4000-8000-000000000602', now())$$,
  '23505', null, 'but a session id can''t be reused for someone else'
);
select ok(
  (select is_offline and ended_at is not null from public.pos_sessions where id = 'fb000000-0000-4000-8000-000000000601'),
  'it''s stored as an offline session that never blocks live sign-ins'
);
select lives_ok($$select public.start_pos_session('1111')$$, 'a live sign-in still works');

-- Offline orders ---------------------------------------------------------------------

select throws_ok(
  $$select public.submit_order(pg_temp.sid_live(), pg_temp.order_payload(gen_random_uuid()::text))$$,
  '22023', 'Off burger is out of stock', 'online, an out-of-stock item is refused'
);
insert into r values ('offline order', public.submit_order('fb000000-0000-4000-8000-000000000601',
  pg_temp.order_payload('f6000000-0000-4000-8000-000000000601',
    '{"is_offline": true, "offline_number": "T1-001"}')));
select is(pg_temp.val('offline order', 'order_number'), 'T1-001', 'an offline sale keeps the till''s number');
select is(pg_temp.val('offline order', 'total'), '1000', 'and was sold even though the item is out of stock now');
select throws_ok(
  $$select public.submit_order('fb000000-0000-4000-8000-000000000601',
    pg_temp.order_payload(gen_random_uuid()::text, '{"is_offline": true, "offline_number": "t1 9"}'))$$,
  '22023', 'The order number wasn''t sent correctly', 'offline numbers look like T1-042'
);

-- Charged 9.00 offline (the price went up since): kept, with the difference.
insert into r values ('offline paid', public.record_payments('fb000000-0000-4000-8000-000000000601',
  'f6000000-0000-4000-8000-000000000601', jsonb_build_array(jsonb_build_object(
    'id', 'f7000000-0000-4000-8000-000000000601', 'payment_method_id', pg_temp.cash(), 'amount', 900))));
select is(pg_temp.val('offline paid', 'status'), 'paid', 'an offline sale charged at old prices is paid');
reset role;
select is(
  (select offline_difference from public.orders where id = 'f6000000-0000-4000-8000-000000000601'), -100,
  'and the difference is recorded'
);
select ok(
  (select bool_and(is_offline) from public.payments where order_id = 'f6000000-0000-4000-8000-000000000601'),
  'its payments are marked offline'
);
select is(
  (select array_agg(action order by id) from public.audit_log
   where entity_id = 'f6000000-0000-4000-8000-000000000601' and is_offline),
  array['order.create', 'order.offline_difference', 'order.paid'],
  'and the audit log says it happened offline'
);

-- Online, the sum still has to match.
update public.branch_menu_items set is_available = true
where menu_item_id = 'f5300000-0000-4000-8000-000000000601';
select pg_temp.login_as('f0000000-0000-4000-8000-000000000601');
insert into r values ('online order', public.submit_order(pg_temp.sid_live(),
  pg_temp.order_payload('f6000000-0000-4000-8000-000000000602')));
select throws_ok(
  $$select public.record_payments(pg_temp.sid_live(), 'f6000000-0000-4000-8000-000000000602',
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'payment_method_id', pg_temp.cash(), 'amount', 900)))$$,
  '22023', 'The payments don''t add up to the order total', 'an online sale still has to add up'
);
-- Its answer got lost, so the till finished it offline as T1-002.
select is(
  public.submit_order(pg_temp.sid_live(), pg_temp.order_payload('f6000000-0000-4000-8000-000000000602',
    '{"is_offline": true, "offline_number": "T1-002"}')) ->> 'order_number',
  'T1-002', 'an order saved just before the connection dropped takes the number on the receipt'
);

-- Approvals given offline ---------------------------------------------------------------

select throws_ok(
  $$select public.record_offline_override('fc000000-0000-4000-8000-000000000601', pg_temp.sid_live(),
    'f2000000-0000-4000-8000-000000000601', 'discount.override')$$,
  '42501', null, 'an offline approval by someone without the permission is refused'
);
select lives_ok(
  $$select public.record_offline_override('fc000000-0000-4000-8000-000000000602', 'fb000000-0000-4000-8000-000000000601',
    'f2000000-0000-4000-8000-000000000602', 'discount.override', 'Regular', now() - interval '3 minutes')$$,
  'a manager''s offline approval is recorded'
);
select is(
  public.submit_order('fb000000-0000-4000-8000-000000000601', pg_temp.order_payload('f6000000-0000-4000-8000-000000000603',
    '{"is_offline": true, "offline_number": "T1-003", "discount_override_id": "fc000000-0000-4000-8000-000000000602",
      "discount": {"type": "percent", "value": 5000, "reason": "Regular"}}')) ->> 'total',
  '500', 'and lets the offline sale with a big discount through'
);

-- A shift opened offline keeps its time; the heartbeat reports unsent work.
select lives_ok(
  $$select public.start_offline_session('fb000000-0000-4000-8000-000000000602',
    'f2000000-0000-4000-8000-000000000602', now() - interval '20 minutes')$$,
  'the manager signed in offline too'
);
select is(
  (public.open_shift('fb000000-0000-4000-8000-000000000602', 0, null, now() - interval '10 minutes') ->> 'opened_at')::timestamptz,
  now() - interval '10 minutes', 'a shift opened offline keeps when it was opened'
);
select is(
  public.get_offline_bundle() #>> '{offline_numbers,last}', '3',
  'the till learns the highest offline number it has used today'
);
select public.device_heartbeat(3);
reset role;
select is((select pending_sync from public.devices where id = 'f3000000-0000-4000-8000-000000000601'), 3,
  'the till reports how much it still has to send');

select * from finish();
rollback;
