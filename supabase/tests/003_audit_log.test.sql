-- audit_log is insert-only for everyone, and only write_audit() can insert.
begin;
create extension if not exists pgtap with schema extensions;

select plan(13);

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
  ('f0000000-0000-4000-8000-0000000000b1', 'audit-admin@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-0000000000b1', 'Audit Branch', 'UTC', 'USD');

insert into public.staff (id, auth_user_id, branch_id, full_name, role, pin_hash) values
  ('f2000000-0000-4000-8000-0000000000b1', 'f0000000-0000-4000-8000-0000000000b1', null, 'Audit Admin', 'admin', null),
  ('f2000000-0000-4000-8000-0000000000b2', null, 'f1000000-0000-4000-8000-0000000000b1', 'Audit Cashier', 'cashier',
   extensions.crypt('4321', extensions.gen_salt('bf', 4)));

-- ---------------------------------------------------------------------------
-- The audit trigger records changes, without secrets
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_log
   where action = 'staff.insert' and entity_id = 'f2000000-0000-4000-8000-0000000000b2'),
  1, 'inserting staff writes an audit row'
);
select is(
  (select after ? 'pin_hash' from public.audit_log
   where action = 'staff.insert' and entity_id = 'f2000000-0000-4000-8000-0000000000b2'),
  false, 'audit rows never contain pin_hash'
);

update public.staff set full_name = 'Audit Cashier Renamed' where id = 'f2000000-0000-4000-8000-0000000000b2';
select is(
  (select array[before ->> 'full_name', after ->> 'full_name'] from public.audit_log
   where action = 'staff.update' and entity_id = 'f2000000-0000-4000-8000-0000000000b2'),
  array['Audit Cashier', 'Audit Cashier Renamed'],
  'updates record before and after values'
);

-- ---------------------------------------------------------------------------
-- Signed-in admin: no update, delete or direct insert
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000b1');

select ok((select count(*) from public.audit_log) > 0, 'admin can read the audit log');
select throws_ok(
  'update public.audit_log set action = ''tampered''',
  '42501', null, 'admin cannot update audit_log'
);
select throws_ok(
  'delete from public.audit_log',
  '42501', null, 'admin cannot delete audit_log rows'
);
select throws_ok(
  $$insert into public.audit_log (action, entity) values ('forged', 'staff')$$,
  '42501', null, 'admin cannot insert into audit_log directly'
);
select throws_ok(
  $$select public.write_audit('forged', 'staff', null)$$,
  '42501', null, 'signed-in users cannot call write_audit()'
);

reset role;

-- ---------------------------------------------------------------------------
-- service_role and postgres bypass RLS, but the trigger still blocks them
-- ---------------------------------------------------------------------------

set local role service_role;
select throws_ok(
  'update public.audit_log set action = ''tampered''',
  '42501', 'audit_log is insert-only', 'service_role cannot update audit_log'
);
select throws_ok(
  'delete from public.audit_log',
  '42501', 'audit_log is insert-only', 'service_role cannot delete audit_log rows'
);
reset role;

select throws_ok(
  'update public.audit_log set action = ''tampered''',
  '42501', 'audit_log is insert-only', 'postgres cannot update audit_log'
);
select throws_ok(
  'delete from public.audit_log',
  '42501', 'audit_log is insert-only', 'postgres cannot delete audit_log rows'
);
select throws_ok(
  'truncate public.audit_log',
  '42501', 'audit_log is insert-only', 'postgres cannot truncate audit_log'
);

select * from finish();
rollback;
