"use server";

import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import { parseQuantity, STOCK_UNITS, type StockUnit } from "@/lib/inventory";
import { getMenuCurrency } from "@/lib/menu.server";
import { MoneyParseError, parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const NOT_ALLOWED: ActionResult = {
  ok: false,
  error: "You don't have permission to do that.",
};
const MANAGERS = ["admin", "manager"] as const;

async function done<T>(
  result: PromiseLike<{
    error: { code?: string; message?: string } | null;
    data?: T;
  }>,
): Promise<ActionResult> {
  const { error } = await result;
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Setup (admins): suppliers, ingredients, recipes
// ---------------------------------------------------------------------------

export type SupplierInput = {
  name: string;
  phone: string;
  email: string;
  isActive: boolean;
};

export async function saveSupplier(
  id: string | null,
  input: SupplierInput,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const name = input.name.trim();
  if (!name)
    return {
      ok: false,
      error: "Check the form.",
      fieldErrors: { name: "Enter a name." },
    };
  const row = {
    name,
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
    is_active: input.isActive,
  };
  const supabase = await createClient();
  return done(
    id
      ? supabase.from("suppliers").update(row).eq("id", id)
      : supabase.from("suppliers").insert(row),
  );
}

export type IngredientInput = {
  name: string;
  unit: string;
  category: string;
  cost: string;
  reorderLevel: string;
  supplierId: string;
  isActive: boolean;
};

export async function saveIngredient(
  id: string | null,
  input: IngredientInput,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const supabase = await createClient();
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  if (!name) errors.name = "Enter a name.";
  if (!STOCK_UNITS.includes(input.unit as StockUnit))
    errors.unit = "Choose a unit.";
  let cost = 0;
  try {
    cost = parseMoney(
      input.cost.trim() || "0",
      await getMenuCurrency(supabase),
    );
    if (cost < 0) errors.cost = "Enter a cost of zero or more.";
  } catch (e) {
    if (!(e instanceof MoneyParseError)) throw e;
    errors.cost = "Enter a cost, like 4 or 0.35.";
  }
  const reorder = parseQuantity(input.reorderLevel.trim() || "0");
  if (reorder === null)
    errors.reorderLevel = "Enter a quantity, like 10 or 2.5.";
  if (Object.keys(errors).length)
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: errors,
    };
  const row = {
    name,
    unit: input.unit as StockUnit,
    category: input.category.trim() || null,
    cost_per_unit: cost,
    reorder_level: reorder!,
    supplier_id: input.supplierId || null,
    is_active: input.isActive,
  };
  return done(
    id
      ? supabase.from("ingredients").update(row).eq("id", id)
      : supabase.from("ingredients").insert(row),
  );
}

/** Replaces what one menu item (or modifier) uses. */
export async function saveRecipe(
  owner: { kind: "item" | "modifier"; id: string },
  lines: { ingredientId: string; quantity: string }[],
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const rows: { ingredient_id: string; quantity: number }[] = [];
  for (const line of lines) {
    if (!line.ingredientId) continue;
    const quantity = parseQuantity(line.quantity);
    if (quantity === null || quantity <= 0)
      return {
        ok: false,
        error: "Every quantity must be more than zero (up to 3 decimals).",
      };
    if (rows.some((r) => r.ingredient_id === line.ingredientId))
      return { ok: false, error: "Each ingredient can only be listed once." };
    rows.push({ ingredient_id: line.ingredientId, quantity });
  }
  const supabase = await createClient();
  const column = owner.kind === "item" ? "menu_item_id" : "modifier_id";
  const { error: deleteError } = await supabase
    .from("recipes")
    .delete()
    .eq(column, owner.id);
  if (deleteError) return { ok: false, error: dbErrorMessage(deleteError) };
  if (rows.length) {
    const { error } = await supabase
      .from("recipes")
      .insert(rows.map((r) => ({ ...r, [column]: owner.id })));
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }
  refresh();
  return { ok: true };
}

export async function loadSampleInventory(): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const supabase = await createClient();
  return done(supabase.rpc("load_sample_inventory"));
}

// ---------------------------------------------------------------------------
// Stock (managers and admins)
// ---------------------------------------------------------------------------

type Line = {
  ingredientId: string;
  quantity: string;
  reason?: string;
  unitCost?: string;
};

async function toLines(
  lines: Line[],
  options: { reason?: boolean; cost?: boolean; allowZero?: boolean } = {},
): Promise<{ ok: true; lines: Json[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  const currency = options.cost ? await getMenuCurrency(supabase) : "USD";
  const out: Json[] = [];
  for (const line of lines) {
    if (!line.ingredientId) continue;
    const quantity = parseQuantity(line.quantity);
    if (quantity === null || (!options.allowZero && quantity <= 0))
      return {
        ok: false,
        error: "Every quantity must be a number (up to 3 decimals) above zero.",
      };
    const row: Record<string, Json> = {
      ingredient_id: line.ingredientId,
      quantity,
    };
    if (options.reason) {
      if (!line.reason?.trim())
        return { ok: false, error: "Give a reason for each line." };
      row.reason = line.reason.trim();
    }
    if (options.cost && line.unitCost?.trim()) {
      try {
        row.unit_cost = parseMoney(line.unitCost, currency);
      } catch {
        return { ok: false, error: "Enter costs like 4 or 0.35." };
      }
    }
    out.push(row);
  }
  if (out.length === 0)
    return { ok: false, error: "Add at least one ingredient." };
  return { ok: true, lines: out };
}

export async function recordWaste(
  branchId: string,
  id: string,
  lines: Line[],
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  const parsed = await toLines(lines, { reason: true });
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  return done(
    supabase.rpc("record_waste", {
      p_branch_id: branchId,
      p_waste: { id, lines: parsed.lines },
    }),
  );
}

export async function transferStock(
  branchId: string,
  id: string,
  toBranchId: string,
  note: string,
  lines: Line[],
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  if (!toBranchId) return { ok: false, error: "Choose the branch to send to." };
  const parsed = await toLines(lines);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  return done(
    supabase.rpc("transfer_stock", {
      p_branch_id: branchId,
      p_transfer: { id, to_branch_id: toBranchId, note, lines: parsed.lines },
    }),
  );
}

export async function savePurchaseOrder(
  branchId: string,
  order: {
    id: string;
    supplierId: string;
    expectedOn: string;
    notes: string;
    lines: Line[];
  },
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  if (!order.supplierId) return { ok: false, error: "Choose a supplier." };
  const parsed = await toLines(order.lines, { cost: true });
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  return done(
    supabase.rpc("save_purchase_order", {
      p_branch_id: branchId,
      p_order: {
        id: order.id,
        supplier_id: order.supplierId,
        expected_on: order.expectedOn || null,
        notes: order.notes,
        lines: parsed.lines,
      },
    }),
  );
}

export async function setPurchaseOrderStatus(
  orderId: string,
  status: "sent" | "cancelled",
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  const supabase = await createClient();
  return done(
    supabase.rpc("set_purchase_order_status", {
      p_order_id: orderId,
      p_status: status,
    }),
  );
}

export async function receivePurchaseOrder(
  orderId: string,
  lines: Line[],
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  const parsed = await toLines(lines, { cost: true, allowZero: true });
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  return done(
    supabase.rpc("receive_purchase_order", {
      p_order_id: orderId,
      p_lines: parsed.lines,
    }),
  );
}

export async function submitStockCount(
  branchId: string,
  id: string,
  category: string | null,
  lines: Line[],
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  const counted = lines.filter((l) => l.quantity.trim() !== "");
  const parsed = await toLines(counted, { allowZero: true });
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  return done(
    supabase.rpc("submit_stock_count", {
      p_branch_id: branchId,
      p_count: { id, category, lines: parsed.lines },
    }),
  );
}

export async function reviewStockCount(
  countId: string,
  approve: boolean,
  note: string,
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  const supabase = await createClient();
  return done(
    supabase.rpc("review_stock_count", {
      p_count_id: countId,
      p_approve: approve,
      p_note: note || undefined,
    }),
  );
}

export type SuggestedLine = {
  ingredient_id: string;
  name: string;
  unit: string;
  cost_per_unit: number;
  supplier_id: string | null;
  supplier_name: string | null;
  on_hand: number;
  reorder_level: number;
  daily_use: number;
  suggested: number;
};

/** What to order, from the last `days` days of use. */
export async function suggestPurchase(
  branchId: string,
  days: number,
): Promise<ActionResult<SuggestedLine[]>> {
  if (!(await getActionStaff(MANAGERS))) return NOT_ALLOWED;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("suggest_purchase", {
    p_branch_id: branchId,
    p_days: days,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: (data as SuggestedLine[] | null) ?? [] };
}
