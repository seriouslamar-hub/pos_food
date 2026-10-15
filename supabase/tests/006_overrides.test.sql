-- verify_override (manager PIN approval on the till) and consume_override
-- (how later RPCs use an approval exactly once).
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
  ('f0000000-0000-4000-8000-0000000000e1', 'ovr-till-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000e2', 'ovr-till-b@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-0000000000ea', 'Override Branch A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-0000000000eb', 'Override Branch B', 'UTC', 'USD');

insert into public.staff (id, branch_id, full_name, role, pin_hash) values
  ('f2000000-0000-4000-8000-0000000000e1', 'f1000000-0000-4000-8000-0000000000ea', 'Override Manager A', 'manager',
   extensions.crypt('9999', extensions.gen_salt('bf', 4))),
  ('f2000000-0000-4000-8000-0000000000e2', 'f1000000-0000-4000-8000-0000000000ea', 'Override Cashier A1', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4))),
  ('f2000000-0000-4000-8000-0000000000e3', 'f1000000-0000-4000-8000-0000000000ea', 'Override Cashier A2', 'cashier',
   extensions.crypt('4444', extensions.gen_salt('bf', 4)));

insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-0000000000e1', 'f1000000-0000-4000-8000-0000000000ea',
   'f0000000-0000-4000-8000-0000000000e1', 'Override Till A', 'till', 'T1'),
  ('f3000000-0000-4000-8000-0000000000e2', 'f1000000-0000-4000-8000-0000000000eb',
   'f0000000-0000-4000-8000-0000000000e2', 'Override Till B', 'till', 'T1');

create temp table results (step text primary key, result jsonb);
grant all on results to authenticated;

-- Cashier A1 signs in on till A.
select pg_temp.login_as('f0000000-0000-4000-8000-0000000000e1');
insert into results values ('session', public.start_pos_session('1111'));

-- ---------------------------------------------------------------------------
-- verify_override
-- ---------------------------------------------------------------------------

insert into results values ('own_pin', public.verify_override(
  (select (result ->> 'session_id')::uuid from results where step = 'session'), '1111', 'order.refund', 'customer complaint'));
select is((select result ->> 'error' from results where step = 'own_pin'), 'not_permitted',
  'verify_override rejects a cashier PIN (their own)');

insert into results values ('other_cashier', public.verify_override(
  (select (result ->> 'session_id')::uuid from results where step = 'session'), '4444', 'order.refund', null));
select is((select result ->> 'error' from results where step = 'other_cashier'), 'not_permitted',
  'verify_override rejects another cashier''s PIN');

insert into results values ('wrong_pin', public.verify_override(
  (select (result ->> 'session_id')::uuid from results where step = 'session'), '0000', 'order.refund', null));
select is((select result ->> 'error' from results where step = 'wrong_pin'), 'invalid_pin',
  'verify_override rejects a PIN nobody has');

insert into results values ('manager', public.verify_override(
  (select (result ->> 'session_id')::uuid from results where step = 'session'), '9999', 'order.refund', 'customer complaint'));
select is((select result ->> 'ok' from results where step = 'manager'), 'true',
  'a manager PIN approves the action');
select is((select result #>> '{approver,full_name}' from results where step = 'manager'), 'Override Manager A',
  'the approval names the manager');

select throws_ok(
  $$select public.verify_override((select (result ->> 'session_id')::uuid from results where step = 'session'),
    '9999', 'order.made_up', null)$$,
  '22023', null, 'unknown permissions are rejected'
);
select throws_ok(
  $$select public.consume_override((select (result ->> 'override_id')::uuid from results where step = 'manager'),
    'f1000000-0000-4000-8000-0000000000ea', 'order.refund')$$,
  '42501', null, 'the till cannot call consume_override directly'
);

reset role;

-- Till B cannot use till A's session.
select pg_temp.login_as('f0000000-0000-4000-8000-0000000000e2');
select throws_ok(
  $$select public.verify_override((select (result ->> 'session_id')::uuid from results where step = 'session'),
    '9999', 'order.refund', null)$$,
  'PS401', null, 'another till cannot use this session'
);
reset role;

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.audit_log
   where action = 'override.denied' and device_id = 'f3000000-0000-4000-8000-0000000000e1'),
  3, 'every rejected override attempt is audited'
);
select is(
  (select array[actor_staff_id, approver_staff_id]::text[] from public.audit_log
   where action = 'override.approved' and entity_id = (select result ->> 'override_id' from results where step = 'manager')),
  array['f2000000-0000-4000-8000-0000000000e2', 'f2000000-0000-4000-8000-0000000000e1'],
  'the approval is audited with the cashier as actor and the manager as approver'
);
select is(
  (select reason from public.audit_log
   where action = 'override.approved' and entity_id = (select result ->> 'override_id' from results where step = 'manager')),
  'customer complaint', 'the reason is recorded'
);
select is(
  (select expires_at - created_at from public.override_approvals
   where id = (select (result ->> 'override_id')::uuid from results where step = 'manager')),
  interval '2 minutes', 'approvals expire after 2 minutes'
);

-- ---------------------------------------------------------------------------
-- consume_override (called by later RPCs as postgres)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$select public.consume_override((select (result ->> 'override_id')::uuid from results where step = 'manager'),
    'f1000000-0000-4000-8000-0000000000ea', 'order.void_sent')$$,
  'PS403', null, 'an approval cannot be used for a different permission'
);
select throws_ok(
  $$select public.consume_override((select (result ->> 'override_id')::uuid from results where step = 'manager'),
    'f1000000-0000-4000-8000-0000000000eb', 'order.refund')$$,
  'PS403', null, 'an approval cannot be used in another branch'
);
select is(
  public.consume_override((select (result ->> 'override_id')::uuid from results where step = 'manager'),
    'f1000000-0000-4000-8000-0000000000ea', 'order.refund'),
  'f2000000-0000-4000-8000-0000000000e1'::uuid,
  'a valid approval is accepted and returns the approver'
);
select throws_ok(
  $$select public.consume_override((select (result ->> 'override_id')::uuid from results where step = 'manager'),
    'f1000000-0000-4000-8000-0000000000ea', 'order.refund')$$,
  'PS403', null, 'an approval cannot be used twice'
);

-- An approval that expired.
insert into public.override_approvals (id, branch_id, device_id, requested_by_staff_id, approved_by_staff_id,
  permission, created_at, expires_at)
values ('f4000000-0000-4000-8000-0000000000e1', 'f1000000-0000-4000-8000-0000000000ea',
  'f3000000-0000-4000-8000-0000000000e1', 'f2000000-0000-4000-8000-0000000000e2',
  'f2000000-0000-4000-8000-0000000000e1', 'order.refund', now() - interval '5 minutes', now() - interval '3 minutes');

select throws_ok(
  $$select public.consume_override('f4000000-0000-4000-8000-0000000000e1',
    'f1000000-0000-4000-8000-0000000000ea', 'order.refund')$$,
  'PS403', null, 'an expired approval is rejected'
);
select is(
  (select used_at from public.override_approvals where id = 'f4000000-0000-4000-8000-0000000000e1'),
  null, 'a rejected approval is not marked used'
);

-- ---------------------------------------------------------------------------
-- Ended sessions
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000e1');
select public.end_pos_session((select (result ->> 'session_id')::uuid from results where step = 'session'));
select throws_ok(
  $$select public.verify_override((select (result ->> 'session_id')::uuid from results where step = 'session'),
    '9999', 'order.refund', null)$$,
  'PS401', null, 'an ended session cannot request approvals'
);
reset role;

-- Deactivating the cashier ends their access even with an open session.
select pg_temp.login_as('f0000000-0000-4000-8000-0000000000e1');
insert into results values ('session2', public.start_pos_session('1111'));
reset role;
update public.staff set is_active = false where id = 'f2000000-0000-4000-8000-0000000000e2';
select pg_temp.login_as('f0000000-0000-4000-8000-0000000000e1');
select throws_ok(
  $$select public.verify_override((select (result ->> 'session_id')::uuid from results where step = 'session2'),
    '9999', 'order.refund', null)$$,
  'PS401', null, 'a deactivated cashier''s open session stops working'
);
reset role;

select * from finish();
rollback;
