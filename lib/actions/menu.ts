"use server";

import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  branchPriceSchema,
  categorySchema,
  comboOptionsSchema,
  comboSlotSchema,
  fieldErrors,
  menuItemSchema,
  modifierGroupSchema,
  modifierSchema,
  stationSchema,
  type CategoryFormValues,
  type ComboOptionFormValues,
  type ComboSlotFormValues,
  type MenuItemFormValues,
  type ModifierFormValues,
  type ModifierGroupFormValues,
  type StationFormValues,
} from "@/lib/validation";

// The database enforces menu.edit (RLS and RPC checks); this keeps the
// back-office actions to admins, who own the master menu.
const NOT_ALLOWED = {
  ok: false,
  error: "Only an admin can change the menu.",
} as const;
const CHECK_FIELDS = "Check the highlighted fields.";

async function admin() {
  return (await getActionStaff(["admin"])) !== null;
}

// ---------------------------------------------------------------------------
// Categories, items and stations
// ---------------------------------------------------------------------------

export async function saveCategory(
  id: string | null,
  values: CategoryFormValues,
): Promise<ActionResult<{ id: string }>> {
  if (!(await admin())) return NOT_ALLOWED;
  const parsed = categorySchema.safeParse(values);
  if (!parsed.success)
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  const row = {
    name: parsed.data.name,
    colour: parsed.data.colour,
    is_active: parsed.data.isActive,
  };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase
        .from("categories")
        .update(row)
        .eq("id", id)
        .select("id")
        .single()
    : await supabase.from("categories").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: { id: data.id } };
}

export async function saveMenuItem(
  id: string | null,
  values: MenuItemFormValues,
): Promise<ActionResult<{ id: string }>> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  const parsed = menuItemSchema(await getMenuCurrency(supabase)).safeParse(
    values,
  );
  if (!parsed.success)
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  const v = parsed.data;
  const row = {
    category_id: v.categoryId,
    type: v.type,
    name: v.name,
    short_name: v.shortName,
    description: v.description,
    base_price: v.price,
    tax_category: v.taxCategory,
    kds_station_id: v.type === "combo" ? null : v.kdsStationId,
    is_active: v.isActive,
  };
  const { data, error } = id
    ? await supabase
        .from("menu_items")
        .update(row)
        .eq("id", id)
        .select("id")
        .single()
    : await supabase.from("menu_items").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: { id: data.id } };
}

export async function setMenuItemImage(
  id: string,
  imageUrl: string | null,
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const { url } = getSupabaseEnv();
  if (
    imageUrl !== null &&
    !imageUrl.startsWith(
      `${url}/storage/v1/object/public/menu-images/items/${id}/`,
    )
  ) {
    return { ok: false, error: "That image wasn't uploaded for this item." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_items")
    .update({ image_url: imageUrl })
    .eq("id", id);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

export async function saveStation(
  id: string | null,
  values: StationFormValues,
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const parsed = stationSchema.safeParse(values);
  if (!parsed.success)
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  const row = { name: parsed.data.name, is_active: parsed.data.isActive };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("kds_stations").update(row).eq("id", id)
    : await supabase.from("kds_stations").insert(row);
  if (error) {
    const message = /duplicate|already/i.test(error.message ?? "")
      ? "Another station already has that name."
      : dbErrorMessage(error);
    return { ok: false, error: message, fieldErrors: { name: message } };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

export async function saveModifierGroup(
  id: string | null,
  values: ModifierGroupFormValues,
): Promise<ActionResult<{ id: string }>> {
  if (!(await admin())) return NOT_ALLOWED;
  const parsed = modifierGroupSchema.safeParse(values);
  if (!parsed.success)
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  const v = parsed.data;
  const row = {
    name: v.name,
    min_select: v.minSelect,
    max_select: v.maxSelect,
    is_active: v.isActive,
  };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase
        .from("modifier_groups")
        .update(row)
        .eq("id", id)
        .select("id")
        .single()
    : await supabase.from("modifier_groups").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: { id: data.id } };
}

export async function saveModifier(
  groupId: string,
  id: string | null,
  values: ModifierFormValues,
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  const parsed = modifierSchema(await getMenuCurrency(supabase)).safeParse(
    values,
  );
  if (!parsed.success)
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  const v = parsed.data;
  const row = {
    group_id: groupId,
    name: v.name,
    price_delta: v.priceDelta,
    kds_station_id: v.kdsStationId,
    is_active: v.isActive,
  };
  const { error } = id
    ? await supabase.from("modifiers").update(row).eq("id", id)
    : await supabase.from("modifiers").insert(row);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

/** Which modifier groups an item offers, in this order. */
export async function setItemModifierGroups(
  itemId: string,
  groupIds: string[],
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  let remove = supabase
    .from("item_modifier_groups")
    .delete()
    .eq("menu_item_id", itemId);
  if (groupIds.length)
    remove = remove.not("modifier_group_id", "in", `(${groupIds.join(",")})`);
  const { error: deleteError } = await remove;
  if (deleteError) return { ok: false, error: dbErrorMessage(deleteError) };
  if (groupIds.length) {
    const { error } = await supabase.from("item_modifier_groups").upsert(
      groupIds.map((groupId, i) => ({
        menu_item_id: itemId,
        modifier_group_id: groupId,
        sort_order: (i + 1) * 10,
      })),
      { onConflict: "menu_item_id,modifier_group_id" },
    );
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------

export async function saveComboSlot(
  comboItemId: string,
  slotId: string | null,
  values: ComboSlotFormValues,
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const parsed = comboSlotSchema.safeParse(values);
  if (!parsed.success)
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  const row = {
    combo_item_id: comboItemId,
    name: parsed.data.name,
    required: parsed.data.required,
  };
  const supabase = await createClient();
  const { error } = slotId
    ? await supabase.from("combo_slots").update(row).eq("id", slotId)
    : await supabase.from("combo_slots").insert({ ...row, sort_order: 1000 });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

export async function deleteComboSlot(slotId: string): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  const { error } = await supabase
    .from("combo_slots")
    .delete()
    .eq("id", slotId);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

/** Replaces a slot's options (items, upcharges and the default). */
export async function setComboSlotOptions(
  slotId: string,
  options: ComboOptionFormValues[],
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  const parsed = comboOptionsSchema(await getMenuCurrency(supabase)).safeParse(
    options,
  );
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? CHECK_FIELDS,
    };
  const ids = parsed.data.map((o) => o.menuItemId);

  let remove = supabase
    .from("combo_slot_options")
    .delete()
    .eq("slot_id", slotId);
  if (ids.length)
    remove = remove.not("menu_item_id", "in", `(${ids.join(",")})`);
  const { error: deleteError } = await remove;
  if (deleteError) return { ok: false, error: dbErrorMessage(deleteError) };

  // Clear the old default first: only one option per slot may be the default.
  const { error: clearError } = await supabase
    .from("combo_slot_options")
    .update({ is_default: false })
    .eq("slot_id", slotId)
    .eq("is_default", true);
  if (clearError) return { ok: false, error: dbErrorMessage(clearError) };

  if (parsed.data.length) {
    const { error } = await supabase.from("combo_slot_options").upsert(
      parsed.data.map((o, i) => ({
        slot_id: slotId,
        menu_item_id: o.menuItemId,
        upcharge: o.upcharge,
        is_default: o.isDefault,
        sort_order: (i + 1) * 10,
      })),
      { onConflict: "slot_id,menu_item_id" },
    );
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Branch prices, ordering, sample menu
// ---------------------------------------------------------------------------

export async function setBranchPrice(
  branchId: string,
  itemId: string,
  price: string,
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  const { data: branch } = await supabase
    .from("branches")
    .select("currency_code")
    .eq("id", branchId)
    .single();
  if (!branch) return { ok: false, error: "That branch no longer exists." };
  const parsed = branchPriceSchema(branch.currency_code).safeParse(price);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? CHECK_FIELDS,
    };
  const { error } = await supabase.rpc("set_branch_price", {
    p_branch_id: branchId,
    p_menu_item_id: itemId,
    // null removes the override; the generated types don't allow null.
    p_price: parsed.data as number,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

export type MenuList =
  | "categories"
  | "menu_items"
  | "modifier_groups"
  | "modifiers"
  | "kds_stations"
  | "combo_slots"
  | "item_modifier_groups"
  | "combo_slot_options";

export async function reorderMenu(
  kind: MenuList,
  ids: string[],
  parentId?: string,
): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_menu", {
    p_kind: kind,
    p_ids: ids,
    p_parent_id: parentId,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

export async function loadSampleMenu(): Promise<ActionResult> {
  if (!(await admin())) return NOT_ALLOWED;
  const supabase = await createClient();
  const { error } = await supabase.rpc("load_sample_menu");
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Availability (managers for their branch; admins for any)
// ---------------------------------------------------------------------------

export async function setAvailability(
  branchId: string,
  kind: "item" | "modifier",
  id: string,
  available: boolean,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin", "manager"]))) {
    return { ok: false, error: "Sign in as a manager to change availability." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_availability", {
    p_branch_id: branchId,
    p_kind: kind,
    p_target_id: id,
    p_available: available,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true };
}
