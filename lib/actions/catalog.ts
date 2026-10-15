"use server";

import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import { isPermission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import {
  fieldErrors,
  paymentMethodSchema,
  taxSchema,
  type PaymentMethodFormValues,
  type TaxFormValues,
} from "@/lib/validation";

const NOT_ALLOWED = {
  ok: false,
  error: "Only an admin can change system setup.",
} as const;
const CHECK_FIELDS = "Check the highlighted fields.";

// ---------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------

function taxRow(values: TaxFormValues) {
  const parsed = taxSchema.safeParse(values);
  if (!parsed.success) return { error: fieldErrors(parsed.error) } as const;
  const v = parsed.data;
  return {
    row: {
      name: v.name,
      rate_bps: v.ratePercent,
      is_inclusive: v.isInclusive,
      tax_category: v.taxCategory,
      sort_order: v.sortOrder,
      is_active: v.isActive,
    },
  } as const;
}

export async function createTax(values: TaxFormValues): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const result = taxRow(values);
  if ("error" in result)
    return { ok: false, error: CHECK_FIELDS, fieldErrors: result.error };
  const supabase = await createClient();
  const { error } = await supabase.from("taxes").insert(result.row);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true };
}

export async function updateTax(
  id: string,
  values: TaxFormValues,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const result = taxRow(values);
  if ("error" in result)
    return { ok: false, error: CHECK_FIELDS, fieldErrors: result.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("taxes")
    .update(result.row)
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data?.length) return { ok: false, error: "That tax no longer exists." };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

export async function savePaymentMethod(
  id: string | null,
  values: PaymentMethodFormValues,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const parsed = paymentMethodSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const v = parsed.data;
  const row = {
    type: v.type,
    name: v.name,
    is_enabled: v.isEnabled,
    requires_reference: v.requiresReference,
    sort_order: v.sortOrder,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("payment_methods").update(row).eq("id", id)
    : await supabase.from("payment_methods").insert(row);
  if (error) {
    const message = dbErrorMessage(error);
    return {
      ok: false,
      error: message,
      fieldErrors: /name/i.test(message) ? { name: message } : undefined,
    };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Role permissions
// ---------------------------------------------------------------------------

export async function setRolePermission(
  role: string,
  permission: string,
  granted: boolean,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  if ((role !== "manager" && role !== "cashier") || !isPermission(permission)) {
    return {
      ok: false,
      error: "Only manager and cashier permissions can change.",
    };
  }
  const supabase = await createClient();
  const { error } = granted
    ? await supabase
        .from("role_permissions")
        .upsert(
          { role, permission },
          { onConflict: "role,permission", ignoreDuplicates: true },
        )
    : await supabase
        .from("role_permissions")
        .delete()
        .eq("role", role)
        .eq("permission", permission);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}
