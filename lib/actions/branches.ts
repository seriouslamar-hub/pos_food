"use server";

import { refresh } from "next/cache";
import type { z } from "zod";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  branchSchema,
  fieldErrors,
  type BranchFormValues,
} from "@/lib/validation";

const NOT_ALLOWED = {
  ok: false,
  error: "Only an admin can change branches.",
} as const;

function toRow(v: z.output<typeof branchSchema>) {
  return {
    name: v.name,
    address: v.address,
    phone: v.phone,
    timezone: v.timezone,
    currency_code: v.currencyCode,
    receipt_header: v.receiptHeader,
    receipt_footer: v.receiptFooter,
    is_active: v.isActive,
  };
}

export async function createBranch(
  values: BranchFormValues,
): Promise<ActionResult<{ id: string }>> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const parsed = branchSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .insert(toRow(parsed.data))
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: dbErrorMessage(error) };
  return { ok: true, data: { id: data.id } };
}

export async function updateBranch(
  id: string,
  values: BranchFormValues,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const parsed = branchSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branches")
    .update(toRow(parsed.data))
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, error: dbErrorMessage(error) };
  if (!data?.length)
    return { ok: false, error: "That branch no longer exists." };
  return { ok: true };
}

/**
 * Saves the public URL of a logo the admin uploaded to the branding bucket,
 * or clears it. Only URLs inside this branch's folder are accepted.
 */
export async function setBranchLogo(
  id: string,
  logoUrl: string | null,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const { url } = getSupabaseEnv();
  const allowedPrefix = `${url}/storage/v1/object/public/branding/branches/${id}/`;
  if (logoUrl !== null && !logoUrl.startsWith(allowedPrefix)) {
    return { ok: false, error: "That logo wasn't uploaded for this branch." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("branches")
    .update({ logo_url: logoUrl })
    .eq("id", id);
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}
