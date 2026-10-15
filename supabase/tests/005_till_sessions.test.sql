-- start_pos_session / end_pos_session: PIN sign-in on a till, and lockout.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

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
  ('f0000000-0000-4000-8000-0000000000d1', 'sess-till-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000d2', 'sess-kds-a@test.local'),
  ('f0000000-0000-4000-8000-0000000000d3', 'sess-till-b@test.local'),
  ('f0000000-0000-4000-8000-0000000000d4', 'sess-manager-a@test.local');

insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-0000000000da', 'Session Branch A', 'UTC', 'USD'),
  ('f1000000-0000-4000-8000-0000000000db', 'Session Branch B', 'UTC', 'USD');

insert into public.staff (id, auth_user_id, branch_id, full_name, role, pin_hash, is_active) values
  ('f2000000-0000-4000-8000-0000000000d1', null, null, 'Session Admin', 'admin',
   extensions.crypt('9000', extensions.gen_salt('bf', 4)), true),
  ('f2000000-0000-4000-8000-0000000000d2', 'f0000000-0000-4000-8000-0000000000d4', 'f1000000-0000-4000-8000-0000000000da',
   'Session Manager A', 'manager', extensions.crypt('9999', extensions.gen_salt('bf', 4)), true),
  ('f2000000-0000-4000-8000-0000000000d3', null, 'f1000000-0000-4000-8000-0000000000da',
   'Session Cashier A', 'cashier', extensions.crypt('1111', extensions.gen_salt('bf', 4)), true),
  ('f2000000-0000-4000-8000-0000000000d4', null, 'f1000000-0000-4000-8000-0000000000db',
   'Session Cashier B', 'cashier', extensions.crypt('2222', extensions.gen_salt('bf', 4)), true),
  ('f2000000-0000-4000-8000-0000000000d5', null, 'f1000000-0000-4000-8000-0000000000da',
   'Session Inactive A', 'cashier', extensions.crypt('3333', extensions.gen_salt('bf', 4)), false);

insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-0000000000d1', 'f1000000-0000-4000-8000-0000000000da',
   'f0000000-0000-4000-8000-0000000000d1', 'Session Till A', 'till', 'T1'),
  ('f3000000-0000-4000-8000-0000000000d2', 'f1000000-0000-4000-8000-0000000000da',
   'f0000000-0000-4000-8000-0000000000d2', 'Session KDS A', 'kds', 'K1'),
  ('f3000000-0000-4000-8000-0000000000d3', 'f1000000-0000-4000-8000-0000000000db',
   'f0000000-0000-4000-8000-0000000000d3', 'Session Till B', 'till', 'T1');

-- Results are kept here so they can be checked after switching back to postgres.
create temp table results (step text primary key, result jsonb);
grant all on results to authenticated;

-- ---------------------------------------------------------------------------
-- Who may start a session
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000d2');
select throws_ok($$select public.start_pos_session('1111')$$, '42501', null,
  'a KDS device cannot start a till session');
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000d4');
select throws_ok($$select public.start_pos_session('1111')$$, '42501', null,
  'a back-office login cannot start a till session');
reset role;

-- ---------------------------------------------------------------------------
-- Till A: PINs
-- ---------------------------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000d1');

insert into results values ('cashier', public.start_pos_session('1111'));
select is((select result ->> 'ok' from results where step = 'cashier'), 'true', 'the right PIN opens the till');
select is((select result #>> '{staff,full_name}' from results where step = 'cashier'), 'Session Cashier A',
  'the session is for the PIN owner');
select ok((select result -> 'permissions' ? 'order.create' from results where step = 'cashier'),
  'the cashier gets their permissions');
select ok(not (select result -> 'permissions' ? 'order.refund' from results where step = 'cashier'),
  'the cashier does not get permissions their role lacks');

insert into results values ('admin', public.start_pos_session('9000'));
select is((select result #>> '{staff,role}' from results where step = 'admin'), 'admin',
  'an admin PIN works on any branch till');

insert into results values ('other_branch', public.start_pos_session('2222'));
select is((select result ->> 'error' from results where step = 'other_branch'), 'invalid_pin',
  'a cashier from another branch cannot sign in here');

insert into results values ('inactive', public.start_pos_session('3333'));
select is((select result ->> 'error' from results where step = 'inactive'), 'invalid_pin',
  'inactive staff cannot sign in');

insert into results values ('malformed', public.start_pos_session('12'));
select is((select result ->> 'error' from results where step = 'malformed'), 'invalid_pin',
  'a malformed PIN is a failed attempt');

insert into results values ('fail4', public.start_pos_session('0001'));
select is((select result ->> 'error' from results where step = 'fail4'), 'invalid_pin',
  'four failures do not lock the till');

insert into results values ('fail5', public.start_pos_session('0002'));
select is((select result ->> 'error' from results where step = 'fail5'), 'locked_out',
  'the fifth failure in 5 minutes locks the till');
select ok((select (result ->> 'retry_after_seconds')::int between 1 and 60 from results where step = 'fail5'),
  'lockout reports how long to wait');

insert into results values ('locked_right_pin', public.start_pos_session('1111'));
select is((select result ->> 'error' from results where step = 'locked_right_pin'), 'locked_out',
  'while locked, even the right PIN is refused');

reset role;

-- Move the failures more than a minute into the past: the lock has expired.
update public.pin_attempts
set attempted_at = attempted_at - interval '2 minutes'
where device_id = 'f3000000-0000-4000-8000-0000000000d1';

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000d1');
insert into results values ('after_lock', public.start_pos_session('1111'));
reset role;

select is((select result ->> 'ok' from results where step = 'after_lock'), 'true',
  'after one minute the till accepts PINs again');

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.pos_sessions
   where device_id = 'f3000000-0000-4000-8000-0000000000d1' and ended_at is null),
  1, 'signing in ends the previous session: one open session per till'
);
select is(
  (select staff_id from public.pos_sessions
   where device_id = 'f3000000-0000-4000-8000-0000000000d1' and ended_at is null),
  'f2000000-0000-4000-8000-0000000000d3'::uuid, 'the open session belongs to the last person who signed in'
);
select is(
  (select count(*)::int from public.pin_attempts where device_id = 'f3000000-0000-4000-8000-0000000000d1'),
  8, 'every checked attempt is recorded, but refused attempts while locked are not'
);
select is(
  (select count(*)::int from public.audit_log
   where action = 'pos_session.start' and device_id = 'f3000000-0000-4000-8000-0000000000d1'),
  3, 'each successful sign-in is audited'
);
select is(
  (select last_seen_at is not null from public.devices where id = 'f3000000-0000-4000-8000-0000000000d1'),
  true, 'the till''s last_seen_at is updated'
);

-- Till B cannot end till A's session.
select pg_temp.login_as('f0000000-0000-4000-8000-0000000000d3');
select public.end_pos_session((select (result ->> 'session_id')::uuid from results where step = 'after_lock'));
reset role;
select is(
  (select ended_at from public.pos_sessions where id = (select (result ->> 'session_id')::uuid from results where step = 'after_lock')),
  null, 'another device cannot end this till''s session'
);

select pg_temp.login_as('f0000000-0000-4000-8000-0000000000d1');
select lives_ok(
  $$select public.end_pos_session((select (result ->> 'session_id')::uuid from results where step = 'after_lock'))$$,
  'the till can end its own session'
);
select lives_ok(
  $$select public.end_pos_session((select (result ->> 'session_id')::uuid from results where step = 'after_lock'))$$,
  'ending a session twice is harmless'
);
reset role;

select isnt(
  (select ended_at from public.pos_sessions where id = (select (result ->> 'session_id')::uuid from results where step = 'after_lock')),
  null, 'the session is ended'
);

select * from finish();
rollback;
