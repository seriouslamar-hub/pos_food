-- Phase 3: taxes, payment methods, staff guards, staff logins, device
-- heartbeats, setup codes and the branding bucket.
begin;
create extension if not exists pgtap with schema extensions;

select plan(36);

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
  ('f0000000-0000-4000-8000-0000000000f1', 'p3-admin@test.local'),
  ('f0000000-0000-4000-8000-0000000000f2', 'p3-manager-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000f3', 'p3-till-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000f4', 'p3-new-login@test.local'),
  ('f0000000-0000-4000-8000-0000000000f5', 'p3-second-admin@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-0000000000fa', 'P3 Branch A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-0000000000fb', 'P3 Branch B', 'UTC', 'USD');

insert into public.staff (id, auth_user_id, branch_id, full_name, role, discount_limit_bps, pin_hash, is_active) values
  ('f2000000-0000-4000-8000-0000000000f1', 'f0000000-0000-4000-8000-0000000000f1', null,
   'P3 Admin', 'admin', 10000, null, true),
  ('f2000000-0000-4000-8000-0000000000f2', 'f0000000-0000-4000-8000-0000000000f2', 'f1000000-0000-4000-8000-0000000000fa',
   'P3 Manager A', 'manager', 2000, null, true),
  ('f2000000-0000-4000-8000-0000000000f3', null, 'f1000000-0000-4000-8000-0000000000fa',
   'P3 Cashier A', 'cashier', 500, extensions.crypt('1357', extensions.gen_salt('bf', 4)), true),
  ('f2000000-0000-4000-8000-0000000000f4', null, 'f1000000-0000-4000-8000-0000000000fa',
   'P3 Inactive Cashier', 'cashier', 0, extensions.crypt('2468', extensions.gen_salt('bf', 4)), false),
  ('f2000000-0000-4000-8000-0000000000f5', null, 'f1000000-0000-4000-8000-0000000000fa',
   'P3 Future Manager', 'manager', 0, null, true);

insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-0000000000f1', 'f1000000-0000-4000-8000-0000000000fa',
   'f0000000-0000-4000-8000-0000000000f3', 'P3 Till A', 'till', 'T1');

-- ---------------------------------------------------------------------------
-- Taxes and payment methods
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f1');
select lives_ok(
  $$insert into public.taxes (name, rate_bps, is_inclusive, tax_category) values ('P3 VAT', 1500, false, 'standard')$$,
  'an admin can add a tax'
);
select throws_ok(
  $$insert into public.taxes (name, rate_bps) values ('Too much', 10001)$$,
  '23514', null, 'tax rates above 100% are rejected'
);
select throws_ok(
  $$insert into public.taxes (name, rate_bps, tax_category) values ('Bad category', 100, 'Food & Drink')$$,
  '23514', null, 'tax categories must be simple keys'
);
select lives_ok(
  $$insert into public.payment_methods (type, name, requires_reference) values ('mobile_money', 'P3 MoMo', true)$$,
  'an admin can add a payment method'
);
select throws_ok(
  $$insert into public.payment_methods (type, name) values ('cash', 'Second drawer')$$,
  '23505', null, 'there is only one cash method'
);
select throws_ok(
  $$update public.payment_methods set requires_reference = true where type = 'cash'$$,
  '23514', null, 'cash never needs a reference'
);
select throws_ok(
  $$insert into public.payment_methods (type, name) values ('card', 'p3 momo')$$,
  '23505', null, 'payment method names are unique, ignoring case'
);
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f2');
select ok((select count(*) from public.taxes where name = 'P3 VAT') = 1, 'a manager can read taxes');
select ok((select count(*) from public.payment_methods) >= 4, 'a manager can read payment methods');
select throws_ok(
  $$insert into public.taxes (name, rate_bps) values ('Manager tax', 100)$$,
  '42501', null, 'a manager cannot add taxes'
);
select throws_ok(
  $$insert into public.payment_methods (type, name) values ('other', 'Manager voucher')$$,
  '42501', null, 'a manager cannot add payment methods'
);
-- RLS hides the row from update, so nothing changes. Checked below.
update public.payment_methods set is_enabled = false where type = 'cash';
reset role;
select is((select is_enabled from public.payment_methods where type = 'cash'), true,
  'a manager cannot disable payment methods');

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f3');
select ok((select count(*) from public.taxes where name = 'P3 VAT') = 1, 'a till can read taxes');
select ok((select count(*) from public.payment_methods where is_enabled) >= 3, 'a till can read payment methods');
reset role;

select is(
  (select count(*)::int from public.audit_log where entity in ('taxes', 'payment_methods')
     and actor_staff_id = 'f2000000-0000-4000-8000-0000000000f1'),
  2, 'tax and payment method changes are audited with the admin as actor'
);

-- ---------------------------------------------------------------------------
-- Staff guards
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f2');
select throws_ok(
  $$insert into public.staff (branch_id, full_name, role, discount_limit_bps)
    values ('f1000000-0000-4000-8000-0000000000fa', 'Generous Cashier', 'cashier', 2500)$$,
  '42501', 'Discount limit can''t be higher than your own (20%)',
  'a manager cannot give a cashier more discount than they have'
);
select lives_ok(
  $$insert into public.staff (branch_id, full_name, role, discount_limit_bps)
    values ('f1000000-0000-4000-8000-0000000000fa', 'Fair Cashier', 'cashier', 2000)$$,
  'a manager can give a discount limit up to their own'
);
select throws_ok(
  $$update public.staff set discount_limit_bps = 3000 where id = 'f2000000-0000-4000-8000-0000000000f3'$$,
  '42501', null, 'a manager cannot raise a cashier above their own limit'
);
select lives_ok(
  $$update public.staff set is_active = true where id = 'f2000000-0000-4000-8000-0000000000f4'$$,
  'a manager can reactivate a cashier'
);
reset role;

select is(
  (select has_pin from public.staff where id = 'f2000000-0000-4000-8000-0000000000f4'),
  false, 'reactivating someone clears their PIN, which may now clash'
);
select ok(
  exists (
    select 1 from public.audit_log
    where entity_id = 'f2000000-0000-4000-8000-0000000000f4'
      and action = 'staff.update'
      and (before ->> 'has_pin')::boolean and not (after ->> 'has_pin')::boolean
  ),
  'the PIN removal shows in the audit log'
);

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f1');
update public.staff set branch_id = 'f1000000-0000-4000-8000-0000000000fb'
where id = 'f2000000-0000-4000-8000-0000000000f3';
reset role;
select is(
  (select has_pin from public.staff where id = 'f2000000-0000-4000-8000-0000000000f3'),
  false, 'moving someone to another branch clears their PIN'
);

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f1');
select lives_ok(
  $$update public.staff set full_name = 'P3 Admin Renamed' where id = 'f2000000-0000-4000-8000-0000000000f1'$$,
  'admins can be edited'
);
reset role;

-- Every other admin (including seed data) is deactivated so P3 Admin is the last one.
update public.staff set is_active = false where role = 'admin' and id <> 'f2000000-0000-4000-8000-0000000000f1';

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f1');
select throws_ok(
  $$update public.staff set is_active = false where id = 'f2000000-0000-4000-8000-0000000000f1'$$,
  '42501', 'This is the last active admin. Make someone else an admin first.',
  'the last active admin cannot be deactivated'
);
select throws_ok(
  $$update public.staff set role = 'manager', branch_id = 'f1000000-0000-4000-8000-0000000000fa'
    where id = 'f2000000-0000-4000-8000-0000000000f1'$$,
  '42501', null, 'the last active admin cannot be demoted'
);

-- ---------------------------------------------------------------------------
-- set_staff_login
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.set_staff_login('f2000000-0000-4000-8000-0000000000f5', 'f0000000-0000-4000-8000-0000000000f4')$$,
  'an admin can link a login to a manager'
);
select throws_ok(
  $$select public.set_staff_login('f2000000-0000-4000-8000-0000000000f5', 'f0000000-0000-4000-8000-0000000000f3')$$,
  '23505', null, 'a device''s login cannot be linked to staff'
);
select throws_ok(
  $$select public.set_staff_login('f2000000-0000-4000-8000-0000000000f5', 'f0000000-0000-4000-8000-0000000000f2')$$,
  '23505', null, 'another staff member''s login cannot be linked'
);
select throws_ok(
  $$select public.set_staff_login('f2000000-0000-4000-8000-0000000000f3', 'f0000000-0000-4000-8000-0000000000f5')$$,
  '22023', null, 'cashiers cannot have a login'
);
reset role;

select is(
  (select actor_staff_id from public.audit_log
   where entity_id = 'f2000000-0000-4000-8000-0000000000f5' and after ->> 'auth_user_id' = 'f0000000-0000-4000-8000-0000000000f4'),
  'f2000000-0000-4000-8000-0000000000f1'::uuid,
  'linking a login is audited with the admin as actor'
);

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f2');
select throws_ok(
  $$select public.set_staff_login('f2000000-0000-4000-8000-0000000000f5', null)$$,
  '42501', null, 'a manager cannot manage logins'
);
reset role;

-- ---------------------------------------------------------------------------
-- Devices: heartbeat and setup codes
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f3');
select public.device_heartbeat();
reset role;
select ok(
  (select last_seen_at > now() - interval '1 minute' from public.devices where id = 'f3000000-0000-4000-8000-0000000000f1'),
  'a device heartbeat updates last_seen_at'
);
select is(
  (select count(*)::int from public.audit_log where entity_id = 'f3000000-0000-4000-8000-0000000000f1' and action = 'devices.update'),
  0, 'heartbeats are not audited'
);

insert into public.device_setup_codes (device_id, code_hash, expires_at)
values ('f3000000-0000-4000-8000-0000000000f1', 'p3-test-hash', now() + interval '1 day');

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f1');
select throws_ok(
  'select count(*) from public.device_setup_codes',
  '42501', null, 'even admins cannot read setup codes through the API'
);
reset role;

-- ---------------------------------------------------------------------------
-- Branding bucket
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f1');
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('branding', 'branches/p3/logo.png')$$,
  'an admin can upload to the branding bucket'
);
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000f2');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('branding', 'branches/p3/rogue.png')$$,
  '42501', null, 'a manager cannot upload to the branding bucket'
);
reset role;

select * from finish();
rollback;
