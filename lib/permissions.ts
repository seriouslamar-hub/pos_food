/**
 * Permission keys, matching the role_permissions table and the permission
 * matrix in the plan. Which role has which permission lives in the database,
 * not here; the till receives its list from start_pos_session.
 */
export const PERMISSIONS = [
  "order.create",
  "order.void_unsent",
  "order.void_sent",
  "order.refund",
  "discount.apply",
  "discount.override",
  "price.override",
  "drawer.no_sale",
  "menu.edit",
  "menu.availability",
  "staff.manage_cashiers",
  "staff.manage_all",
  "shift.open",
  "shift.close_own",
  "shift.reconcile",
  "day.open_close",
  "inventory.manage",
  "promo.manage",
  "reports.own_shift",
  "reports.branch",
  "reports.all",
  "audit.view_branch",
  "audit.view_all",
  "settings.manage",
  "devices.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const known = new Set<string>(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return known.has(value);
}

/** True if the granted permission list includes the permission. */
export function can(
  granted: Iterable<string> | null | undefined,
  permission: Permission,
): boolean {
  if (!granted) return false;
  if (granted instanceof Set) return granted.has(permission);
  for (const p of granted) if (p === permission) return true;
  return false;
}

/** Human-readable names for override prompts and the admin permission grid. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "order.create": "Take orders and payments",
  "order.void_unsent": "Void items before they reach the kitchen",
  "order.void_sent": "Void items already sent to the kitchen",
  "order.refund": "Refund orders",
  "discount.apply": "Apply discounts within their limit",
  "discount.override": "Apply discounts above the limit",
  "price.override": "Override a price",
  "drawer.no_sale": "Open the cash drawer without a sale",
  "menu.edit": "Change the menu and prices",
  "menu.availability": "Mark items out of stock",
  "staff.manage_cashiers": "Manage cashiers in their branch",
  "staff.manage_all": "Manage all staff",
  "shift.open": "Open a shift",
  "shift.close_own": "Close their own shift",
  "shift.reconcile": "Reconcile shifts",
  "day.open_close": "Open and close the business day",
  "inventory.manage": "Manage inventory",
  "promo.manage": "Manage promotions",
  "reports.own_shift": "See their own shift report",
  "reports.branch": "See branch reports",
  "reports.all": "See reports for all branches",
  "audit.view_branch": "See the branch audit log",
  "audit.view_all": "See the full audit log",
  "settings.manage": "Change system settings",
  "devices.manage": "Manage devices",
};
