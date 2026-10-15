"use server";

import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import {
  crossCheckSettings,
  parseSettingInput,
  SETTINGS,
  type SettingValue,
} from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export type SettingInput = { value: string; useDefault: boolean };

/**
 * Saves settings for one scope: the global defaults (branchId null) or one
 * branch. For a branch, "use default" removes its override.
 */
export async function saveSettings(
  branchId: string | null,
  inputs: Record<string, SettingInput>,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) {
    return { ok: false, error: "Only an admin can change settings." };
  }

  const errors: Record<string, string> = {};
  const values: Record<string, SettingValue> = {};
  const clear: string[] = [];
  for (const def of SETTINGS) {
    const input = inputs[def.key];
    if (!input) continue;
    if (branchId && input.useDefault) {
      clear.push(def.key);
      continue;
    }
    const parsed = parseSettingInput(def, input.value);
    if (parsed.ok) values[def.key] = parsed.value;
    else errors[def.key] = parsed.error;
  }
  Object.assign(errors, crossCheckSettings(values));
  if (Object.keys(errors).length) {
    return {
      ok: false,
      error: "Check the highlighted settings.",
      fieldErrors: errors,
    };
  }

  const supabase = await createClient();
  const scoped = <
    T extends {
      is: (c: "branch_id", v: null) => T;
      eq: (c: "branch_id", v: string) => T;
    },
  >(
    query: T,
  ) =>
    branchId ? query.eq("branch_id", branchId) : query.is("branch_id", null);

  const { data: existing, error: readError } = await scoped(
    supabase.from("settings").select("id, key"),
  );
  if (readError) return { ok: false, error: dbErrorMessage(readError) };
  const idByKey = new Map((existing ?? []).map((row) => [row.key, row.id]));

  for (const [key, value] of Object.entries(values)) {
    const id = idByKey.get(key);
    const { error } = id
      ? await supabase.from("settings").update({ value }).eq("id", id)
      : await supabase
          .from("settings")
          .insert({ branch_id: branchId, key, value });
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }
  for (const key of clear) {
    const id = idByKey.get(key);
    if (!id) continue;
    const { error } = await supabase.from("settings").delete().eq("id", id);
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }

  refresh();
  return { ok: true };
}
