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

-- anon can execute only the read-only public ordering pages' functions
-- (Phase 15): the branches taking online orders and their menus.
select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array['get_public_menu(uuid)', 'list_online_branches()']::text[],
  'anon can execute only the public menu functions'
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
    'bump_items',
    'can_access_branch',
    'check_coupon',
    'close_business_day',
    'close_shift',
    'current_branch_id',
    'current_device_id',
    'current_staff_id',
    'current_staff_role',
    'device_heartbeat',
    'end_pos_session',
    'find_customer',
    'get_day_report',
    'get_menu',
    'get_offline_bundle',
    'get_online_order',
    'get_order',
    'get_public_menu',
    'has_permission',
    'inventory_report',
    'is_admin',
    'is_device',
    'is_manager',
    'list_online_branches',
    'list_open_shifts',
    'load_sample_inventory',
    'load_sample_menu',
    'mark_order_collected',
    'open_business_day',
    'open_shift',
    'order_audit_trail',
    'place_online_order',
    'recall_items',
    'receive_purchase_order',
    'record_cash_movement',
    'record_offline_override',
    'record_payments',
    'record_waste',
    'refund_order',
    'reorder_menu',
    'report_dashboard',
    'report_discounts',
    'report_exceptions',
    'report_export',
    'report_promotions',
    'report_sales',
    'report_tax',
    'review_shift',
    'review_stock_count',
    'save_customer',
    'save_purchase_order',
    'search_orders',
    'send_to_kitchen',
    'set_availability',
    'set_branch_price',
    'set_device_training',
    'set_online_ordering',
    'set_purchase_order_status',
    'set_staff_login',
    'set_staff_pin',
    'start_offline_session',
    'start_pos_session',
    'submit_kiosk_order',
    'submit_order',
    'submit_stock_count',
    'suggest_purchase',
    'till_state',
    'transfer_stock',
    'verify_override',
    'void_order_items',
    'x_report'
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
