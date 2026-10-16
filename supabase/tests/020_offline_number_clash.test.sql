-- Phase 14: an offline sale whose number is already taken that day (the
-- till's counter was behind) still goes through, with a suffix.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

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

insert into auth.users (id, email) values ('f0000000-0000-4000-8000-000000000d01', 'clash-till@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-000000000d0a', 'Clash Branch', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash) values
  ('f2000000-0000-4000-8000-000000000d01', 'f1000000-0000-4000-8000-000000000d0a', 'Clash Cashier', 'cashier',
   extensions.crypt('1470', extensions.gen_salt('bf', 4)));
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000d01', 'f1000000-0000-4000-8000-000000000d0a',
   'f0000000-0000-4000-8000-000000000d01', 'Clash Till', 'till', 'T9');
insert into public.business_days (id, branch_id, business_date) values
  ('f8000000-0000-4000-8000-000000000d0a', 'f1000000-0000-4000-8000-000000000d0a', current_date);
insert into public.shifts (branch_id, business_day_id, staff_id, device_id, opening_float) values
  ('f1000000-0000-4000-8000-000000000d0a', 'f8000000-0000-4000-8000-000000000d0a',
   'f2000000-0000-4000-8000-000000000d01', 'f3000000-0000-4000-8000-000000000d01', 0);
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000d01', 'Clash test');
insert into public.menu_items (id, category_id, type, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000d01', 'f5000000-0000-4000-8000-000000000d01', 'item', 'Clash water', 500, 'clashtest');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;
create function pg_temp.sale(p_id text) returns jsonb language sql as $$
  select public.submit_order((select (result ->> 'session_id')::uuid from r where step = 'session'),
    jsonb_build_object('id', p_id, 'is_offline', true, 'offline_number', 'T9-001',
      'lines', jsonb_build_array(jsonb_build_object('id', md5(p_id)::uuid, 'menu_item_id', 'f5300000-0000-4000-8000-000000000d01', 'quantity', 1))))
$$;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000d01');
insert into r values ('session', public.start_pos_session('1470'));
select is(pg_temp.sale('f6000000-0000-4000-8000-000000000d01') ->> 'order_number', 'T9-001',
  'an offline sale keeps the number on its receipt');
select is(pg_temp.sale('f6000000-0000-4000-8000-000000000d02') ->> 'order_number', 'T9-001-2',
  'a second sale with the same number (the till''s counter was behind) gets a suffix instead of failing');
select is(pg_temp.sale('f6000000-0000-4000-8000-000000000d03') ->> 'order_number', 'T9-001-3', 'and the next one along');
select is(pg_temp.sale('f6000000-0000-4000-8000-000000000d02') ->> 'order_number', 'T9-001-2',
  'resending a sale returns it as saved');
reset role;

select * from finish();
rollback;
