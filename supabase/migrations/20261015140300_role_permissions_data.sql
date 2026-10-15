-- Phase 1: default role → permission mapping, from the permission matrix in
-- the plan. This is reference data every environment needs, so it lives in a
-- migration rather than seed.sql. Admins can change the manager and cashier
-- rows later from the back office.
--
-- Where the matrix says "Manager PIN" for a cashier, the cashier role does not
-- get the permission: the till asks for an override from someone who has it.

insert into public.role_permissions (role, permission)
select 'admin'::public.staff_role, p
from unnest(array[
  'order.create', 'order.void_unsent', 'order.void_sent',
  'order.refund', 'discount.apply', 'discount.override',
  'price.override', 'drawer.no_sale', 'menu.edit',
  'menu.availability', 'staff.manage_cashiers', 'staff.manage_all',
  'shift.open', 'shift.close_own', 'shift.reconcile',
  'day.open_close', 'inventory.manage', 'promo.manage',
  'reports.own_shift', 'reports.branch', 'reports.all',
  'audit.view_branch', 'audit.view_all', 'settings.manage',
  'devices.manage'
]) as p
union all
select 'manager'::public.staff_role, p
from unnest(array[
  'order.create', 'order.void_unsent', 'order.void_sent',
  'order.refund', 'discount.apply', 'discount.override',
  'price.override', 'drawer.no_sale',
  'menu.availability', 'staff.manage_cashiers',
  'shift.open', 'shift.close_own', 'shift.reconcile',
  'day.open_close', 'inventory.manage',
  'reports.own_shift', 'reports.branch',
  'audit.view_branch'
]) as p
union all
select 'cashier'::public.staff_role, p
from unnest(array[
  'order.create', 'order.void_unsent', 'discount.apply',
  'shift.open', 'shift.close_own', 'reports.own_shift'
]) as p
on conflict do nothing;
