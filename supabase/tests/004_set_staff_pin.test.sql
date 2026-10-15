-- set_staff_pin(p_staff_id, p_pin)
begin;
create extension if not exists pgtap with schema extensions;

select plan(20);

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
  ('f0000000-0000-4000-8000-0000000000c1', 'pin-admin@test.local'),
  ('f0000000-0000-4000-8000-0000000000c2', 'pin-manager-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000c3', 'pin-till-a@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-0000000000ca', 'PIN Branch A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-0000000000cb', 'PIN Branch B', 'UTC', 'USD');

insert into public.staff (id, auth_user_id, branch_id, full_name, role, is_active) values
  ('f2000000-0000-4000-8000-0000000000c1', 'f0000000-0000-4000-8000-0000000000c1', null, 'PIN Admin', 'admin', true),
  ('f2000000-0000-4000-8000-0000000000c2', 'f0000000-0000-4000-8000-0000000000c2', 'f1000000-0000-4000-8000-0000000000ca', 'PIN Manager A', 'manager', true),
  ('f2000000-0000-4000-8000-0000000000c3', null, 'f1000000-0000-4000-8000-0000000000ca', 'PIN Cashier A1', 'cashier', true),
  ('f2000000-0000-4000-8000-0000000000c4', null, 'f1000000-0000-4000-8000-0000000000ca', 'PIN Cashier A2', 'cashier', true),
  ('f2000000-0000-4000-8000-0000000000c5', null, 'f1000000-0000-4000-8000-0000000000cb', 'PIN Cashier B1', 'cashier', true),
  ('f2000000-0000-4000-8000-0000000000c6', null, 'f1000000-0000-4000-8000-0000000000ca', 'PIN Inactive A', 'cashier', false);

insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-0000000000c1', 'f1000000-0000-4000-8000-0000000000ca',
   'f0000000-0000-4000-8000-0000000000c3', 'PIN Till A', 'till', 'T1');

-- An inactive cashier already uses 5555; inactive staff don't block a PIN.
update public.staff set pin_hash = extensions.crypt('5555', extensions.gen_salt('bf', 4))
where id = 'f2000000-0000-4000-8000-0000000000c6';

-- ---------------------------------------------------------------------------
-- Manager A
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000c2');

select lives_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', '1234')$$,
  'manager can set a PIN for a cashier in their branch'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c4', '1234')$$,
  '23505', null, 'set_staff_pin rejects a PIN already used in the same branch'
);
select lives_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c4', '5555')$$,
  'a PIN used only by inactive staff is allowed'
);
select lives_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', '1234')$$,
  'staff can keep their own PIN when it is set again'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c5', '7777')$$,
  '42501', null, 'manager cannot set a PIN for a cashier in another branch'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c2', '7777')$$,
  '42501', null, 'manager cannot set a manager PIN, even their own'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', '123')$$,
  '22023', 'PIN must be 4 to 6 digits', 'PINs shorter than 4 digits are rejected'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', '1234567')$$,
  '22023', 'PIN must be 4 to 6 digits', 'PINs longer than 6 digits are rejected'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', '12a4')$$,
  '22023', 'PIN must be 4 to 6 digits', 'PINs with non-digits are rejected'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', null)$$,
  '22023', 'PIN must be 4 to 6 digits', 'a null PIN is rejected'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c6', '8888')$$,
  '22023', null, 'cannot set a PIN for inactive staff'
);

reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000c1');

select lives_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c5', '1234')$$,
  'the same PIN is allowed in a different branch'
);
select lives_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c2', '4242')$$,
  'admin can set a manager PIN'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c1', '1234')$$,
  '23505', null, 'an admin PIN must not clash with any branch, since admins can use every till'
);
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-000000000999', '1234')$$,
  'P0002', null, 'unknown staff id is reported'
);

reset role;

-- ---------------------------------------------------------------------------
-- Devices and anon
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000c3');
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', '9876')$$,
  '42501', null, 'a device login cannot set PINs'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.set_staff_pin('f2000000-0000-4000-8000-0000000000c3', '9876')$$,
  '42501', null, 'anon cannot call set_staff_pin'
);
reset role;

-- ---------------------------------------------------------------------------
-- What got stored
-- ---------------------------------------------------------------------------

select ok(
  (select pin_hash = extensions.crypt('1234', pin_hash) and pin_hash like '$2a$08$%'
   from public.staff where id = 'f2000000-0000-4000-8000-0000000000c3'),
  'the PIN is stored as a bcrypt hash that verifies'
);
select is(
  (select count(*)::int from public.audit_log
   where action = 'staff.pin_set' and entity_id = 'f2000000-0000-4000-8000-0000000000c3'
     and actor_staff_id = 'f2000000-0000-4000-8000-0000000000c2'),
  2, 'every PIN change is audited with the actor'
);
select ok(
  not exists (
    select 1 from public.audit_log
    where entity = 'staff'
      and (before::text like '%$2a$%' or after::text like '%$2a$%')
  ),
  'no audit row contains a PIN hash'
);

select * from finish();
rollback;
