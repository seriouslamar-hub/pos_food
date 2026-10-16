"use server";

import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import { getMenuCurrency } from "@/lib/menu.server";
import { parsePromotion, type PromotionFormValues } from "@/lib/promotion-form";
import { createClient } from "@/lib/supabase/server";

/** Creates or updates a promotion (admins with promo.manage; RLS checks it). */
export async function savePromotion(
  id: string | null,
  values: PromotionFormValues,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"])))
    return { ok: false, error: "You don't have permission to do that." };
  const supabase = await createClient();
  const parsed = parsePromotion(values, await getMenuCurrency(supabase));
  if (!parsed.ok)
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: parsed.errors,
    };
  const { error } = id
    ? await supabase.from("promotions").update(parsed.row).eq("id", id)
    : await supabase.from("promotions").insert(parsed.row);
  if (error) {
    if (error.code === "23505")
      return {
        ok: false,
        error: "Another promotion already uses that coupon code.",
        fieldErrors: { couponCode: "Already in use." },
      };
    return { ok: false, error: dbErrorMessage(error) };
  }
  refresh();
  return { ok: true };
}
