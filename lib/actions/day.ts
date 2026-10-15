"use server";

import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const MANAGERS = ["admin", "manager"] as const;

/** Opens today's business day for a branch. The RPC checks day.open_close. */
export async function openDay(branchId: string): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) {
    return { ok: false, error: "Only a manager can open the day." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("open_business_day", {
    p_branch_id: branchId,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

/** Closes the branch's open day (every shift must be closed first). */
export async function closeDay(branchId: string): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) {
    return { ok: false, error: "Only a manager can close the day." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_business_day", {
    p_branch_id: branchId,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}

/** Approves or flags a closed shift. Flagging needs a note. */
export async function reviewShift(
  shiftId: string,
  status: "approved" | "flagged",
  note: string,
): Promise<ActionResult> {
  if (!(await getActionStaff(MANAGERS))) {
    return { ok: false, error: "Only a manager can review shifts." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_shift", {
    p_shift_id: shiftId,
    p_status: status,
    p_note: note.trim() || undefined,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}
