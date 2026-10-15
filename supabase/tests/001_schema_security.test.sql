-- Schema-wide security checks. These cover every table and function in the
-- public schema, so they also guard tables added in later phases.
begin;
create extension if not exists pgtap with schema extensions;

-- 5 schema checks, plus one live query per table as anon.
select plan(5 + (select count(*)::int from pg_tables where schemaname = 'public'));

-- Every table in public has RLS enabled.
select is(
  array(
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by 1
  ),
  array[]::text[],
  'RLS is enabled on every table in public'
);

-- anon has no table privileges at all.
select is(
  array(
    select c.relname::text || ':' || priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) as priv
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and has_table_privilege('anon', c.oid, priv)
    order by 1
  ),
  array[]::text[],
  'anon has no privileges on any table or view in public'
);

-- anon can't execute any function in public.
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array[]::text[],
  'anon cannot execute any function in public'
);

-- Signed-in users can execute only the API functions listed here. Internal
-- helpers (current_staff, staff_has_permission, write_audit, ...) must stay
-- private. Add new RPCs to this list as later phases create them.
select is(
  array(
    select p.proname::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by 1
  ),
  array[
    'can_access_branch',
    'current_branch_id',
    'current_device_id',
    'current_staff_id',
    'current_staff_role',
    'end_pos_session',
    'has_permission',
    'is_admin',
    'is_device',
    'is_manager',
    'set_staff_pin',
    'start_pos_session',
    'verify_override'
  ],
  'authenticated can execute only the allowed API functions'
);

-- Every security definer function in public pins its search_path.
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as c
        where c like 'search_path=%'
      )
    order by 1
  ),
  array[]::text[],
  'every security definer function sets search_path'
);

-- anon really is refused when it queries each table.
set local role anon;
select throws_ok(
  format('select count(*) from public.%I', tablename),
  '42501',
  null,
  format('anon cannot read %s', tablename)
)
from pg_tables
where schemaname = 'public'
order by tablename;
reset role;

select * from finish();
rollback;
