-- Phase 7: business days, shifts, cash movements, blind counts, X/Z reports.
begin;
create extension if not exists pgtap with schema extensions;

select plan(50);

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

-- Fixtures ------------------------------------------------------------------
-- One branch, two tills, cashiers Esi (1111) and Yaw (2222), manager Mansa
-- (9999, also signs in to the back office).

insert into auth.users (id, email) values
  ('f0000000-0000-4000-8000-000000000401', 'shift-till-a@test.local'),
  ('f0000000-0000-4000-8000-000000000402', 'shift-till-b@test.local'),
  ('f0000000-0000-4000-8000-000000000403', 'shift-manager@test.local');
insert into public.branches (id, name, timezone, currency_code) values
  ('f1000000-0000-4000-8000-00000000040a', 'Shift Branch', 'UTC', 'USD');
insert into public.staff (id, branch_id, full_name, role, pin_hash, auth_user_id) values
  ('f2000000-0000-4000-8000-000000000401', 'f1000000-0000-4000-8000-00000000040a', 'Esi Cashier', 'cashier',
   extensions.crypt('1111', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000402', 'f1000000-0000-4000-8000-00000000040a', 'Yaw Cashier', 'cashier',
   extensions.crypt('2222', extensions.gen_salt('bf', 4)), null),
  ('f2000000-0000-4000-8000-000000000403', 'f1000000-0000-4000-8000-00000000040a', 'Mansa Manager', 'manager',
   extensions.crypt('9999', extensions.gen_salt('bf', 4)), 'f0000000-0000-4000-8000-000000000403');
insert into public.devices (id, branch_id, auth_user_id, name, type, code) values
  ('f3000000-0000-4000-8000-000000000401', 'f1000000-0000-4000-8000-00000000040a',
   'f0000000-0000-4000-8000-000000000401', 'Shift Till A', 'till', 'T1'),
  ('f3000000-0000-4000-8000-000000000402', 'f1000000-0000-4000-8000-00000000040a',
   'f0000000-0000-4000-8000-000000000402', 'Shift Till B', 'till', 'T2');
insert into public.categories (id, name) values ('f5000000-0000-4000-8000-000000000401', 'Shift test');
insert into public.menu_items (id, category_id, name, base_price, tax_category) values
  ('f5300000-0000-4000-8000-000000000401', 'f5000000-0000-4000-8000-000000000401', 'Shift burger', 1000, 'shifttest_none');

create temp table r (step text primary key, result jsonb);
grant all on r to authenticated;

create function pg_temp.sid(p_step text) returns uuid language sql as $$
  select (result ->> 'session_id')::uuid from r where step = p_step
$$;
create function pg_temp.val(p_step text, p_key text) returns text language sql as $$
  select result ->> p_key from r where step = p_step
$$;
create function pg_temp.method(p_type text) returns uuid language sql as $$
  select id from public.payment_methods where type = p_type::public.payment_method_type order by sort_order limit 1
$$;
create function pg_temp.order_payload(p_id text, p_qty integer) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id,
    'lines', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(),
      'menu_item_id', 'f5300000-0000-4000-8000-000000000401', 'quantity', p_qty)))
$$;
create function pg_temp.approve(p_session_step text, p_permission text) returns uuid language sql as $$
  select (public.verify_override(pg_temp.sid(p_session_step), '9999', p_permission, null) ->> 'override_id')::uuid
$$;

-- Nothing is open yet --------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000401');
insert into r values ('esi', public.start_pos_session('1111'));

select throws_ok(
  $$select public.submit_order(pg_temp.sid('esi'), pg_temp.order_payload('f6000000-0000-4000-8000-000000000400', 1))$$,
  'PS410', null, 'selling needs an open shift'
);
select throws_ok(
  $$select public.open_shift(pg_temp.sid('esi'), 0)$$,
  'PS411', null, 'a shift needs an open business day'
);
select throws_ok(
  $$select public.open_business_day(null, pg_temp.sid('esi'), null)$$,
  '42501', null, 'a cashier can''t open the day alone'
);
insert into r values ('day', public.open_business_day(null, pg_temp.sid('esi'), pg_temp.approve('esi', 'day.open_close')));
select is(pg_temp.val('day', 'status'), 'open', 'a manager''s PIN lets the cashier open the day');
select is(pg_temp.val('day', 'business_date'), (now() at time zone 'UTC')::date::text,
  'the business date is today in the branch''s timezone');

-- Opening a shift --------------------------------------------------------------

select throws_ok(
  $$select public.open_shift(pg_temp.sid('esi'), 10000, '{"5000": 1}')$$,
  '22023', 'The float doesn''t match the notes and coins counted', 'the float must match the count'
);
select throws_ok(
  $$select public.open_shift(pg_temp.sid('esi'), 100, '{"25": 1.5, "50": 1}')$$,
  '22023', 'The cash count wasn''t sent correctly', 'counts are whole numbers'
);
insert into r values ('shift', public.open_shift(pg_temp.sid('esi'), 10000, '{"5000": 1, "2000": 2, "1000": 1}'));
select is(pg_temp.val('shift', 'opening_float'), '10000', 'the shift opens with the counted float');
select is(public.open_shift(pg_temp.sid('esi'), 5) ->> 'id', pg_temp.val('shift', 'id'),
  'opening again returns the same shift');

-- Selling ----------------------------------------------------------------------------

insert into r values ('o1', public.submit_order(pg_temp.sid('esi'), pg_temp.order_payload('f6000000-0000-4000-8000-000000000401', 2)));
insert into r values ('p1', public.record_payments(pg_temp.sid('esi'), 'f6000000-0000-4000-8000-000000000401',
  jsonb_build_array(jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000401',
    'payment_method_id', pg_temp.method('cash'), 'amount', 2000, 'tendered', 5000))));
insert into r values ('o2', public.submit_order(pg_temp.sid('esi'), pg_temp.order_payload('f6000000-0000-4000-8000-000000000402', 1)));
insert into r values ('p2', public.record_payments(pg_temp.sid('esi'), 'f6000000-0000-4000-8000-000000000402',
  jsonb_build_array(jsonb_build_object('id', 'f7000000-0000-4000-8000-000000000402',
    'payment_method_id', pg_temp.method('card'), 'amount', 1000, 'reference', 'C1'))));
select is(pg_temp.val('o1', 'business_date'), pg_temp.val('day', 'business_date'), 'orders take the business day''s date');
reset role;
select is(
  (select array_agg(distinct shift_id::text) from public.orders where branch_id = 'f1000000-0000-4000-8000-00000000040a'),
  array[(select result ->> 'id' from r where step = 'shift')],
  'orders belong to the shift'
);
select is(
  (select array_agg(distinct shift_id::text) from public.payments where branch_id = 'f1000000-0000-4000-8000-00000000040a'),
  array[(select result ->> 'id' from r where step = 'shift')],
  'payments belong to the shift that took them'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000401');

-- Cash movements ----------------------------------------------------------------------

insert into r values ('drop', public.record_cash_movement(pg_temp.sid('esi'),
  '{"id": "f9000000-0000-4000-8000-000000000401", "type": "drop", "amount": 5000}'));
select is(pg_temp.val('drop', 'amount'), '5000', 'a cashier can drop cash');
select lives_ok(
  $$select public.record_cash_movement(pg_temp.sid('esi'),
    '{"id": "f9000000-0000-4000-8000-000000000401", "type": "drop", "amount": 5000}')$$,
  'sending a movement again is safe'
);
select throws_ok(
  $$select public.record_cash_movement(pg_temp.sid('esi'),
    '{"id": "f9000000-0000-4000-8000-000000000402", "type": "paid_out", "amount": 300, "reason": "Bread"}')$$,
  '42501', 'Paid out needs a manager''s approval', 'paying out needs a manager'
);
select throws_ok(
  $$select public.record_cash_movement(pg_temp.sid('esi'),
    '{"id": "f9000000-0000-4000-8000-000000000403", "type": "paid_in", "amount": 500}')$$,
  '22023', 'Give a reason', 'paying in needs a reason'
);
select lives_ok(
  $$select public.record_cash_movement(pg_temp.sid('esi'), jsonb_build_object(
    'id', 'f9000000-0000-4000-8000-000000000402', 'type', 'paid_out', 'amount', 300, 'reason', 'Bread',
    'override_id', pg_temp.approve('esi', 'shift.reconcile')))$$,
  'a manager''s PIN approves a paid out'
);
select lives_ok(
  $$select public.record_cash_movement(pg_temp.sid('esi'), jsonb_build_object(
    'id', 'f9000000-0000-4000-8000-000000000403', 'type', 'paid_in', 'amount', 500, 'reason', 'Change from the bank',
    'override_id', pg_temp.approve('esi', 'shift.reconcile')))$$,
  'and a paid in'
);
select throws_ok(
  $$select public.record_cash_movement(pg_temp.sid('esi'),
    '{"id": "f9000000-0000-4000-8000-000000000404", "type": "no_sale", "amount": 0, "reason": "Check the till roll"}')$$,
  '42501', 'No sale needs a manager''s approval', 'a no-sale needs a manager'
);
select lives_ok(
  $$select public.record_cash_movement(pg_temp.sid('esi'), jsonb_build_object(
    'id', 'f9000000-0000-4000-8000-000000000404', 'type', 'no_sale', 'amount', 0, 'reason', 'Check the till roll',
    'override_id', pg_temp.approve('esi', 'drawer.no_sale')))$$,
  'and goes through with one'
);
reset role;
select is(
  (select approved_by::text from public.cash_movements where id = 'f9000000-0000-4000-8000-000000000402'),
  'f2000000-0000-4000-8000-000000000403',
  'the approving manager is recorded'
);
select pg_temp.login_as('f0000000-0000-4000-8000-000000000401');

-- Blind count ----------------------------------------------------------------------------

select is((select count(*)::int from public.shifts), 0, 'a till can''t read shifts, so expected cash stays hidden');
select is((select count(*)::int from public.cash_movements), 0, 'or cash movements');
insert into r values ('x', public.x_report(pg_temp.sid('esi')));
select is(pg_temp.val('x', 'orders'), '2', 'the X report counts the shift''s orders');
select is(
  (select result -> 'payments' from r where step = 'x'),
  '[{"method": "cash", "name": "Cash", "count": 1, "amount": 2000},
    {"method": "card", "name": "Card", "count": 1, "amount": 1000}]'::jsonb,
  'and its payments by method'
);
select ok(
  not ((select result -> 'cash' from r where step = 'x') ?| array['expected', 'counted', 'variance']),
  'the cashier''s X report has no expected cash'
);

-- Expected = 100.00 float + 20.00 cash sale (change already given) + 5.00 paid
-- in − 3.00 paid out − 50.00 dropped = 72.00. Counted: 71.50.
insert into r values ('closed', public.close_shift(pg_temp.sid('esi'), '{"5000": 1, "2000": 1, "100": 1, "50": 1}'));
select is(pg_temp.val('closed', 'counted_cash'), '7150', 'the count is saved');
select ok(
  not ((select result from r where step = 'closed') ?| array['expected_cash', 'variance', 'cash'])
    and (select result::text from r where step = 'closed') !~ '7200',
  'closing never shows the cashier the expected cash'
);
select throws_ok(
  $$select public.submit_order(pg_temp.sid('esi'), pg_temp.order_payload('f6000000-0000-4000-8000-000000000403', 1))$$,
  'PS410', null, 'a closed shift can''t sell'
);
reset role;

-- The manager reconciles and closes the day (back office) -------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000403');
select is((select expected_cash from public.shifts where id = (select (result ->> 'id')::uuid from r where step = 'shift')),
  7200, 'expected cash = float + cash sales + paid in − paid out − drops');
select is((select variance from public.shifts where id = (select (result ->> 'id')::uuid from r where step = 'shift')),
  -50, 'variance = counted − expected');
select throws_ok(
  $$select public.review_shift((select (result ->> 'id')::uuid from r where step = 'shift'), 'flagged', ' ')$$,
  '22023', 'Add a note saying why the shift is flagged', 'flagging needs a note'
);
insert into r values ('review', public.review_shift((select (result ->> 'id')::uuid from r where step = 'shift'), 'flagged', 'Short by 0.50'));
select is(pg_temp.val('review', 'status'), 'flagged', 'a manager can flag a shift');
select is((select result #>> '{cash,expected}' from r where step = 'review'), '7200', 'managers see the expected cash');

insert into r values ('z', public.close_business_day('f1000000-0000-4000-8000-00000000040a'));
select is(pg_temp.val('z', 'status'), 'closed', 'the day closes once every shift is closed');
select is((select result #>> '{z_report,net_sales}' from r where step = 'z'), '3000', 'the Z report has the day''s sales');
select is((select result #>> '{z_report,cash,variance}' from r where step = 'z'), '-50', 'and the cash variance');
select is((select z_report ->> 'orders' from public.business_days where id = (select (result ->> 'id')::uuid from r where step = 'day')),
  '2', 'the Z report is stored with the day');
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000401');
insert into r values ('esi2', public.start_pos_session('1111'));
select throws_ok(
  $$select public.open_shift(pg_temp.sid('esi2'), 0)$$,
  'PS411', null, 'no new shifts once the day is closed'
);
reset role;

-- Reopening, and a forgotten shift ----------------------------------------------------------

select pg_temp.login_as('f0000000-0000-4000-8000-000000000403');
insert into r values ('reopen', public.open_business_day('f1000000-0000-4000-8000-00000000040a'));
select is(pg_temp.val('reopen', 'id'), pg_temp.val('day', 'id'), 'a day closed too early can be reopened');
select is(public.open_business_day('f1000000-0000-4000-8000-00000000040a') ->> 'id', pg_temp.val('day', 'id'),
  'opening an open day again is safe');
reset role;

select pg_temp.login_as('f0000000-0000-4000-8000-000000000402');
insert into r values ('yaw', public.start_pos_session('2222'));
insert into r values ('yaw shift', public.open_shift(pg_temp.sid('yaw'), 0));
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000401');
select throws_ok(
  $$select public.close_shift(pg_temp.sid('esi2'), '{}', (select (result ->> 'id')::uuid from r where step = 'yaw shift'))$$,
  '42501', null, 'a cashier can''t close someone else''s shift'
);
select throws_ok(
  $$select public.list_open_shifts(pg_temp.sid('esi2'))$$,
  '42501', null, 'or list other cashiers'' shifts'
);
insert into r values ('mansa', public.start_pos_session('9999'));
select is(
  (select jsonb_agg(s ->> 'staff_name') from jsonb_array_elements(public.list_open_shifts(pg_temp.sid('mansa'))) s),
  '["Yaw Cashier"]'::jsonb,
  'a manager on the till sees the shift left open'
);
select is(
  public.close_shift(pg_temp.sid('mansa'), '{}', (select (result ->> 'id')::uuid from r where step = 'yaw shift')) ->> 'status',
  'pending_review',
  'a manager can close a forgotten shift'
);

-- Back-office reports aren't for tills -----------------------------------------------------

select throws_ok(
  $$select public.get_day_report((select (result ->> 'id')::uuid from r where step = 'day'))$$,
  'P0002', null, 'tills can''t read day reports'
);
select throws_ok(
  $$select public.review_shift((select (result ->> 'id')::uuid from r where step = 'shift'), 'approved')$$,
  '42501', null, 'or review shifts'
);
reset role;
select pg_temp.login_as('f0000000-0000-4000-8000-000000000403');
select is(
  public.get_day_report((select (result ->> 'id')::uuid from r where step = 'day')) #>> '{shifts,0,cash,expected}',
  '7200', 'managers read the day with each shift''s cash'
);
reset role;

-- A day left open from before blocks a new one ------------------------------------------------

update public.business_days set business_date = business_date - 1
where id = (select (result ->> 'id')::uuid from r where step = 'day');
select pg_temp.login_as('f0000000-0000-4000-8000-000000000403');
select throws_ok(
  $$select public.open_business_day('f1000000-0000-4000-8000-00000000040a')$$,
  '22023', null, 'yesterday''s day must be closed before opening today'
);
reset role;
select is(
  (select array_agg(action order by id) from public.audit_log
   where branch_id = 'f1000000-0000-4000-8000-00000000040a' and action like any (array['day.%', 'shift.%', 'cash.%'])),
  array['day.open', 'shift.open', 'cash.drop', 'cash.paid_out', 'cash.paid_in', 'cash.no_sale', 'shift.close',
        'shift.review', 'day.close', 'day.reopen', 'shift.open', 'shift.close'],
  'every step is audited'
);

select * from finish();
rollback;
