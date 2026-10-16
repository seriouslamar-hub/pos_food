import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "./page";

const ACTION_LABELS: Record<string, string> = {
  "branches.insert": "Branch created",
  "branches.update": "Branch changed",
  "staff.insert": "Staff added",
  "staff.update": "Staff changed",
  "staff.pin_set": "PIN set",
  "staff.password_reset": "Password reset",
  "devices.insert": "Device added",
  "devices.update": "Device changed",
  "device.setup": "Device set up",
  "device.setup_code_created": "Setup code created",
  "device.login_reset": "Device signed out everywhere",
  "settings.insert": "Setting added",
  "settings.update": "Setting changed",
  "settings.delete": "Setting removed",
  "role_permissions.insert": "Permission granted",
  "role_permissions.delete": "Permission removed",
  "taxes.insert": "Tax added",
  "taxes.update": "Tax changed",
  "payment_methods.insert": "Payment method added",
  "payment_methods.update": "Payment method changed",
  "categories.insert": "Menu category added",
  "categories.update": "Menu category changed",
  "menu_items.insert": "Menu item added",
  "menu_items.update": "Menu item changed",
  "modifier_groups.insert": "Modifier group added",
  "modifier_groups.update": "Modifier group changed",
  "modifiers.insert": "Modifier added",
  "modifiers.update": "Modifier changed",
  "item_modifier_groups.insert": "Modifier group attached",
  "item_modifier_groups.delete": "Modifier group detached",
  "combo_slots.insert": "Combo slot added",
  "combo_slots.update": "Combo slot changed",
  "combo_slots.delete": "Combo slot removed",
  "combo_slot_options.insert": "Combo choice added",
  "combo_slot_options.update": "Combo choice changed",
  "combo_slot_options.delete": "Combo choice removed",
  "kds_stations.insert": "Kitchen station added",
  "kds_stations.update": "Kitchen station changed",
  "branch_menu_items.insert": "Branch price or stock set",
  "branch_menu_items.update": "Branch price or stock changed",
  "branch_modifiers.insert": "Modifier stock set",
  "branch_modifiers.update": "Modifier stock changed",
  "pos_session.start": "Till sign-in",
  "override.approved": "Manager approval given",
  "override.denied": "Manager approval refused",
  "order.create": "Order taken",
  "order.paid": "Order paid",
  "order.sent_to_kitchen": "Sent to kitchen unpaid",
  "day.open": "Business day opened",
  "day.reopen": "Business day reopened",
  "day.close": "Business day closed",
  "shift.open": "Shift opened",
  "shift.close": "Shift closed",
  "shift.review": "Shift reviewed",
  "cash.drop": "Cash drop",
  "cash.paid_in": "Paid in",
  "cash.paid_out": "Paid out",
  "cash.no_sale": "No sale",
  "order.discount": "Discount given",
  "order.price_override": "Price changed",
  "order.void": "Items voided",
  "order.refund": "Refund",
  "order.offline_difference": "Offline price difference",
  "stock.waste": "Waste recorded",
  "stock.transfer": "Stock transferred",
  "stock.count": "Stock counted",
  "stock.count_approved": "Stock count approved",
  "stock.count_rejected": "Stock count rejected",
  "purchase_order.saved": "Purchase order saved",
  "purchase_order.sent": "Purchase order sent",
  "purchase_order.cancelled": "Purchase order cancelled",
  "purchase_order.received": "Delivery received",
};

export const AUDIT_ENTITIES: { value: string; label: string }[] = [
  { value: "branches", label: "Branches" },
  { value: "staff", label: "Staff" },
  { value: "devices", label: "Devices" },
  { value: "role_permissions", label: "Permissions" },
  { value: "settings", label: "Settings" },
  { value: "taxes", label: "Taxes" },
  { value: "payment_methods", label: "Payment methods" },
  { value: "menu_items", label: "Menu items" },
  { value: "branch_menu_items", label: "Branch prices and stock" },
  { value: "modifiers", label: "Modifiers" },
  { value: "pos_sessions", label: "Till sign-ins" },
  { value: "override_approvals", label: "Manager approvals" },
  { value: "ingredients", label: "Ingredients" },
  { value: "recipes", label: "Recipes" },
  { value: "suppliers", label: "Suppliers" },
  { value: "purchase_orders", label: "Purchase orders" },
  { value: "stock_counts", label: "Stock counts" },
];

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

function show(value: Json | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** "name: Old → New" for each field an update changed. */
function changes(before: Json, after: Json): string[] {
  const b = (
    before && typeof before === "object" && !Array.isArray(before) ? before : {}
  ) as Record<string, Json>;
  const a = (
    after && typeof after === "object" && !Array.isArray(after) ? after : {}
  ) as Record<string, Json>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(
    (k) =>
      k !== "id" &&
      k !== "created_at" &&
      JSON.stringify(b[k]) !== JSON.stringify(a[k]),
  );
  if (!Object.keys(b).length)
    return keys.slice(0, 6).map((k) => `${k}: ${show(a[k])}`);
  return keys.map((k) => `${k}: ${show(b[k])} → ${show(a[k])}`);
}

/**
 * The latest audit entries the signed-in user may see (RLS: admins see all;
 * managers with audit.view_branch see their branch).
 */
export async function AuditLog({
  branchId,
  entity,
}: {
  branchId?: string;
  entity?: string;
}) {
  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select(
      "id, created_at, action, entity, entity_id, branch_id, actor_staff_id, approver_staff_id, device_id, before, after, reason, is_offline",
    )
    .order("id", { ascending: false })
    .limit(100);
  if (branchId) query = query.eq("branch_id", branchId);
  if (entity) query = query.eq("entity", entity);
  const { data: entries } = await query;

  if (!entries?.length) return <EmptyState>Nothing recorded yet.</EmptyState>;

  const staffIds = [
    ...new Set(
      entries
        .flatMap((e) => [e.actor_staff_id, e.approver_staff_id])
        .filter(Boolean),
    ),
  ] as string[];
  const deviceIds = [
    ...new Set(entries.map((e) => e.device_id).filter(Boolean)),
  ] as string[];
  const [{ data: staff }, { data: devices }, { data: branches }] =
    await Promise.all([
      staffIds.length
        ? supabase.from("staff").select("id, full_name").in("id", staffIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
      deviceIds.length
        ? supabase.from("devices").select("id, name").in("id", deviceIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      supabase.from("branches").select("id, name, timezone"),
    ]);
  const staffName = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  const deviceName = new Map((devices ?? []).map((d) => [d.id, d.name]));
  const branchInfo = new Map((branches ?? []).map((b) => [b.id, b]));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>What</TableHead>
          <TableHead>Who</TableHead>
          <TableHead>Details</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((e) => {
          const branch = e.branch_id ? branchInfo.get(e.branch_id) : undefined;
          const when = new Intl.DateTimeFormat("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: branch?.timezone ?? "UTC",
          }).format(new Date(e.created_at));
          const who = e.actor_staff_id
            ? (staffName.get(e.actor_staff_id) ?? "Staff")
            : "System";
          const lines = changes(e.before as Json, e.after as Json);
          return (
            <TableRow key={e.id} data-testid="audit-row">
              <TableCell className="align-top text-sm whitespace-nowrap">
                {when}
                {branch ? (
                  <div className="text-xs text-muted-foreground">
                    {branch.name}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <div className="font-medium">
                  {ACTION_LABELS[e.action] ?? e.action}
                </div>
                {e.is_offline ? <Badge variant="outline">Offline</Badge> : null}
              </TableCell>
              <TableCell className="align-top text-sm">
                {who}
                {e.approver_staff_id ? (
                  <div className="text-muted-foreground">
                    approved by{" "}
                    {staffName.get(e.approver_staff_id) ?? "a manager"}
                  </div>
                ) : null}
                {e.device_id && deviceName.get(e.device_id) ? (
                  <div className="text-muted-foreground">
                    on {deviceName.get(e.device_id)}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="max-w-md align-top text-sm whitespace-normal">
                {e.reason ? <div>Reason: {e.reason}</div> : null}
                {lines.length ? (
                  <ul className="flex flex-col gap-0.5 font-mono text-xs break-all">
                    {lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
