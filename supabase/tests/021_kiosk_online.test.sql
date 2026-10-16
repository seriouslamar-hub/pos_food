-- The self-order kiosk (in the restaurant): orders are priced by the
-- server, keep the customer's choice of how they'll pay, and wait unpaid
-- (out of the kitchen) until paid at the counter. Online ordering is
-- closed: nobody can reach it, signed in or not.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

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
  ('f0000000-0000-4000-8000-000000000e01', 'kiosk@test.local'),
  ('f0000000-0000-4000-8000-000000000e02', 'kiosk-till@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-000000000e0a', 'Kiosk Branch', 'UTC', 'GHS');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000e01', 'f1000000-0000-4000-8000-000000000e0a',
   'f0000000-0000-4000-8000-000000000e01', 'Front kiosk', 'kiosk', 'K1'),
  ('f3000000-0000-4000-8000-000000000e02', 'f1000000-0000-4000-8000-000000000e0a',
   'f0000000-0000-4000-8000-000000000e02', 'Kiosk till', 'till', 'T1');
insert into public.business_days (branch_id, business_date) values
  ('f1000000-0000-4000-8000-000000000e0a', current_date);
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000e01', 'Kiosk test');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000e01', 'f5000000-0000-4000-8000-000000000e01', 'item', 'Kiosk burger', 3000, 'kiosktest');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.order_json(p_id text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'lines', jsonb_build_array(jsonb_build_object(
    'id', md5(p_id)::uuid, 'menu_item_id', 'f5300000-0000-4000-8000-000000000e01', 'quantity', 2,
    -- A customer can't send prices or discounts; these are ignored.
    'price', jsonb_build_object('unit_price', 1, 'reason', 'x'),
    'discount', jsonb_build_object('type', 'percent', 'value', 10000, 'reason', 'x')))) || p_extra
$$;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000e01');
insert into r values ('kiosk', public.submit_kiosk_order(pg_temp.order_json('f6000000-0000-4000-8000-000000000e01',
  '{"discount": {"type": "percent", "value": 5000, "reason": "free"}, "payment_preference": "mobile_money"}')));
insert into r values ('bad', public.submit_kiosk_order(pg_temp.order_json('f6000000-0000-4000-8000-000000000e02',
  '{"payment_preference": "bitcoin"}')));
reset role;

select is(
  (select jsonb_build_object('channel', result -> 'channel', 'total', result -> 'total', 'paid', result -> 'paid_at')
   from r where step = 'kiosk'),
  '{"channel": "kiosk", "total": 6000, "paid": null}'::jsonb,
  'a kiosk order is priced from the menu (prices and discounts sent are ignored) and waits unpaid'
);
select is((select sent_to_kitchen_at from public.orders where id = 'f6000000-0000-4000-8000-000000000e01'), null,
  'and doesn''t reach the kitchen until it''s paid');
select is(
  array[(select result ->> 'payment_preference' from r where step = 'kiosk'), (select result ->> 'payment_preference' from r where step = 'bad')],
  array['mobile_money', null], 'it keeps how the customer will pay (only methods the branch takes)'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000e02');
select throws_ok($$select public.submit_kiosk_order(pg_temp.order_json(gen_random_uuid()::text))$$, '42501', null,
  'only a kiosk places kiosk orders');
reset role;

-- Online ordering is closed.
select is(has_function_privilege('anon', 'public.get_public_menu(uuid)', 'execute'), false,
  'nobody signed out can read a public menu');
select is(has_function_privilege('anon', 'public.list_online_branches()', 'execute'), false,
  'or list branches');
select is(has_function_privilege('authenticated', 'public.place_online_order(uuid, jsonb)', 'execute'), false,
  'nobody can place an online order');
select is(has_function_privilege('service_role', 'public.confirm_online_payment(text, integer, text)', 'execute'), false,
  'or confirm an online payment');
select is((select value from public.settings where key = 'online.enabled' and branch_id is null), 'false'::jsonb,
  'online ordering is off');

select * from finish();
rollback;
