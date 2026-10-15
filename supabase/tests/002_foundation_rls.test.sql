-- Row Level Security for the foundation tables, tested as each kind of user:
-- admin, manager, a till device, a cashier with a login, and an inactive
-- manager. Fixtures are two branches (A and B) created inside this
-- transaction, so the test doesn't depend on seed.sql.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, which bypasses RLS)
-- ---------------------------------------------------------------------------

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
  ('f0000000-0000-4000-8000-0000000000a1', 'rls-admin@test.local'),
  ('f0000000-0000-4000-8000-0000000000a2', 'rls-manager-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000a3', 'rls-manager-b@test.local'),
  ('f0000000-0000-4000-8000-0000000000a4', 'rls-till-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000a5', 'rls-cashier-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000a6', 'rls-inactive-manager@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000000a', 'RLS Branch A', 'Europe/London', 'GBP'),
  ('f1000000-0000-4000-8000-00000000000b', 'RLS Branch B', 'America/New_York', 'USD');

insert into public.staff (id, auth_user_id, branch_id, full_name, role, pin_hash, is_active) values
  ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-0000000000a1', null,
   'Test Admin', 'admin', null, true),
  ('f2000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-0000000000a2', 'f1000000-0000-4000-8000-00000000000a',
   'Manager A', 'manager', null, true),
  ('f2000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-0000000000a3', 'f1000000-0000-4000-8000-00000000000b',
   'Manager B', 'manager', null, true),
  ('f2000000-0000-4000-8000-000000000004', 'f0000000-0000-4000-8000-0000000000a5', 'f1000000-0000-4000-8000-00000000000a',
   'Cashier A1 (has a login)', 'cashier', extensions.crypt('1111', extensions.gen_salt('bf', 4)), true),
  ('f2000000-0000-4000-8000-000000000005', null, 'f1000000-0000-4000-8000-00000000000a',
   'Cashier A2', 'cashier', null, true),
  ('f2000000-0000-4000-8000-000000000006', null, 'f1000000-0000-4000-8000-00000000000b',
   'Cashier B1', 'cashier', null, true),
  ('f2000000-0000-4000-8000-000000000007', 'f0000000-0000-4000-8000-0000000000a6', 'f1000000-0000-4000-8000-00000000000a',
   'Inactive Manager A', 'manager', null, false);

insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-00000000000a',
   'f0000000-0000-4000-8000-0000000000a4', 'Till A', 'till', 'T1'),
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-00000000000a',
   null, 'KDS A', 'kds', 'K1'),
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-00000000000b',
   null, 'Till B', 'till', 'T1');

insert into public.settings (branch_id, key, value) values
  (null, 'test.rls_global', '1'),
  ('f1000000-0000-4000-8000-00000000000a', 'test.rls_branch', '"A"'),
  ('f1000000-0000-4000-8000-00000000000b', 'test.rls_branch', '"B"');

-- Short names for the ids used below.
create temp table ids as select
  'f1000000-0000-4000-8000-00000000000a'::uuid as branch_a,
  'f1000000-0000-4000-8000-00000000000b'::uuid as branch_b,
  array['f1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-00000000000b']::uuid[] as both_branches;
grant select on ids to authenticated;

-- ---------------------------------------------------------------------------
-- Manager A
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000a2');

select is(public.current_branch_id(), (select branch_a from ids), 'manager: current_branch_id() is their branch');
select is(public.is_admin(), false, 'manager: is_admin() is false');

select is(
  (select count(*)::int from public.staff where branch_id = (select branch_a from ids)),
  4, 'manager sees staff in their own branch (including inactive)'
);
select is(
  (select count(*)::int from public.staff where branch_id = (select branch_b from ids)),
  0, 'manager cannot read staff from another branch'
);
select is(
  (select count(*)::int from public.staff where id = 'f2000000-0000-4000-8000-000000000001'),
  0, 'manager cannot read admins'
);
select throws_ok(
  'select pin_hash from public.staff',
  '42501', null, 'manager cannot read pin_hash'
);
select is(
  (select count(*)::int from public.branches where id in (select unnest(both_branches) from ids)),
  1, 'manager sees only their own branch'
);
select is(
  (select count(*)::int from public.devices where branch_id = (select branch_b from ids)),
  0, 'manager cannot see devices in another branch'
);
select is(
  (select array_agg(value order by value::text) from public.settings where key like 'test.rls_%'),
  array['"A"'::jsonb, '1'::jsonb],
  'manager sees global settings and their own branch overrides only'
);

select lives_ok(
  $$insert into public.staff (branch_id, full_name, role)
    values ('f1000000-0000-4000-8000-00000000000a', 'New Cashier A', 'cashier')$$,
  'manager can create a cashier in their own branch'
);
select throws_ok(
  $$insert into public.staff (branch_id, full_name, role)
    values ('f1000000-0000-4000-8000-00000000000b', 'Sneaky Cashier B', 'cashier')$$,
  '42501', null, 'manager cannot create a cashier in another branch'
);
select throws_ok(
  $$insert into public.staff (branch_id, full_name, role)
    values ('f1000000-0000-4000-8000-00000000000a', 'Sneaky Manager', 'manager')$$,
  '42501', null, 'manager cannot create a manager'
);
select throws_ok(
  $$update public.staff set role = 'manager' where id = 'f2000000-0000-4000-8000-000000000005'$$,
  '42501', null, 'manager cannot promote a cashier to manager'
);
select throws_ok(
  $$update public.staff set branch_id = 'f1000000-0000-4000-8000-00000000000b'
    where id = 'f2000000-0000-4000-8000-000000000005'$$,
  '42501', null, 'manager cannot move a cashier to another branch'
);
select lives_ok(
  $$update public.staff set full_name = 'Cashier A2 renamed' where id = 'f2000000-0000-4000-8000-000000000005'$$,
  'manager can edit a cashier in their own branch'
);
-- RLS hides the row, so this matches nothing. Checked after reset role below.
update public.staff set full_name = 'hacked' where id = 'f2000000-0000-4000-8000-000000000006';
select throws_ok(
  $$update public.staff set pin_hash = 'x' where id = 'f2000000-0000-4000-8000-000000000005'$$,
  '42501', null, 'manager cannot write pin_hash directly'
);
select throws_ok(
  $$insert into public.branches (name, timezone, currency_code) values ('Rogue', 'UTC', 'USD')$$,
  '42501', null, 'manager cannot create branches'
);
select throws_ok(
  $$insert into public.role_permissions (role, permission) values ('cashier', 'order.refund')$$,
  '42501', null, 'manager cannot change role permissions'
);
select throws_ok(
  $$insert into public.settings (branch_id, key, value) values ('f1000000-0000-4000-8000-00000000000a', 'test.x', '1')$$,
  '42501', null, 'manager cannot write settings'
);
select ok(
  (select count(*) from public.audit_log where branch_id = (select branch_a from ids)) > 0,
  'manager can read their own branch audit log'
);
select is(
  (select count(*)::int from public.audit_log where branch_id = (select branch_b from ids)),
  0, 'manager cannot read another branch audit log'
);

reset role;

select is(
  (select full_name from public.staff where id = 'f2000000-0000-4000-8000-000000000006'),
  'Cashier B1', 'manager cannot edit a cashier in another branch'
);

-- ---------------------------------------------------------------------------
-- Till device A
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000a4');

select is(public.current_device_id(), 'f3000000-0000-4000-8000-000000000001'::uuid, 'device: current_device_id() is set');
select is(
  (select count(*)::int from public.branches where id in (select unnest(both_branches) from ids)),
  1, 'device reads only its own branch'
);
select is(
  (select array_agg(id) from public.devices),
  array['f3000000-0000-4000-8000-000000000001'::uuid],
  'device reads only its own device row'
);
select ok((select count(*) from public.role_permissions) > 0, 'device can read role_permissions');
select is(
  (select array_agg(value order by value::text) from public.settings where key like 'test.rls_%'),
  array['"A"'::jsonb, '1'::jsonb],
  'device reads global settings and its own branch overrides'
);
select is((select count(*)::int from public.staff), 0, 'device cannot read staff');
select is((select count(*)::int from public.audit_log), 0, 'device cannot read the audit log');

reset role;

-- ---------------------------------------------------------------------------
-- A cashier who somehow has a login: no direct table access
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000a5');

select is((select count(*)::int from public.branches), 0, 'cashier login cannot read branches');
select is((select count(*)::int from public.staff), 0, 'cashier login cannot read staff');
select is((select count(*)::int from public.role_permissions), 0, 'cashier login cannot read role_permissions');
select is((select count(*)::int from public.settings), 0, 'cashier login cannot read settings');
select throws_ok(
  $$insert into public.staff (branch_id, full_name, role)
    values ('f1000000-0000-4000-8000-00000000000a', 'Self-made Cashier', 'cashier')$$,
  '42501', null, 'cashier login cannot create staff'
);

reset role;

-- ---------------------------------------------------------------------------
-- Inactive manager: loses all access
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000a6');

select is((select count(*)::int from public.branches), 0, 'inactive manager cannot read branches');
select is((select count(*)::int from public.staff), 0, 'inactive manager cannot read staff');

reset role;

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000a1');

select is(public.is_admin(), true, 'admin: is_admin() is true');
select is(
  (select count(*)::int from public.staff where branch_id in (select unnest(both_branches) from ids)),
  7, 'admin reads staff in every branch'
);
select is(
  (select count(*)::int from public.branches where id in (select unnest(both_branches) from ids)),
  2, 'admin reads every branch'
);
select throws_ok(
  'select pin_hash from public.staff',
  '42501', null, 'even admins cannot read pin_hash'
);
select lives_ok(
  $$insert into public.branches (name, timezone, currency_code) values ('New Branch', 'Africa/Nairobi', 'kes')$$,
  'admin can create a branch'
);
select lives_ok(
  $$insert into public.role_permissions (role, permission) values ('cashier', 'order.refund')$$,
  'admin can grant a permission to cashiers'
);
select throws_ok(
  $$insert into public.role_permissions (role, permission) values ('cashier', 'order.made_up')$$,
  '23514', null, 'unknown permission keys are rejected'
);
-- RLS hides admin rows from delete, so this matches nothing. Checked below.
delete from public.role_permissions where role = 'admin';

reset role;

select is(
  (select count(*)::int from public.role_permissions where role = 'admin'),
  25, 'admin role permissions cannot be removed'
);

select * from finish();
rollback;
