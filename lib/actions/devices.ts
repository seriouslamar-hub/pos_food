"use server";

import { TOO_MANY_ATTEMPTS, withinRateLimit } from "@/lib/rate-limit";
import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import {
  createSetupCode,
  ensureDeviceLogin,
  resetDeviceLogin as deleteDeviceLogin,
} from "@/lib/devices.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  deviceSchema,
  fieldErrors,
  type DeviceFormValues,
} from "@/lib/validation";

export type SetupCode = { code: string; expiresAt: string };

const NOT_ALLOWED = {
  ok: false,
  error: "Only an admin can manage devices.",
} as const;

/** Creates the device and its login, and returns a one-time setup code. */
export async function createDevice(
  values: DeviceFormValues,
): Promise<ActionResult<{ id: string; setupCode: SetupCode | null }>> {
  if (!(await withinRateLimit("device.create", 20))) return TOO_MANY_ATTEMPTS;
  const actor = await getActionStaff(["admin"]);
  if (!actor) return NOT_ALLOWED;
  const parsed = deviceSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data: device, error } = await supabase
    .from("devices")
    .insert({
      branch_id: v.branchId,
      name: v.name,
      type: v.type,
      code: v.code,
      station: v.station,
      is_active: v.isActive,
    })
    .select("id, branch_id, auth_user_id")
    .single();
  if (error || !device) {
    const message = dbErrorMessage(error);
    return {
      ok: false,
      error: message,
      fieldErrors: /code/i.test(message) ? { code: message } : undefined,
    };
  }

  const admin = createAdminClient();
  // Not fatal: redeeming the setup code creates the login if this fails.
  await ensureDeviceLogin(admin, device);
  const code = await createSetupCode(admin, device, actor.id);
  return {
    ok: true,
    data: {
      id: device.id,
      setupCode: code.ok
        ? { code: code.code, expiresAt: code.expiresAt }
        : null,
    },
  };
}

export async function updateDevice(
  id: string,
  values: DeviceFormValues,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const parsed = deviceSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("devices")
    .update({
      branch_id: v.branchId,
      name: v.name,
      type: v.type,
      code: v.code,
      station: v.station,
      is_active: v.isActive,
    })
    .eq("id", id)
    .select("id");
  if (error) {
    const message = dbErrorMessage(error);
    return {
      ok: false,
      error: message,
      fieldErrors: /code/i.test(message) ? { code: message } : undefined,
    };
  }
  if (!data?.length)
    return { ok: false, error: "That device no longer exists." };
  return { ok: true };
}

async function loadDevice(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("devices")
    .select("id, branch_id, auth_user_id, is_active")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** A fresh one-time setup code (replaces any unused one). */
export async function newSetupCode(
  id: string,
): Promise<ActionResult<SetupCode>> {
  if (!(await withinRateLimit("device.setup_code", 30)))
    return TOO_MANY_ATTEMPTS;
  const actor = await getActionStaff(["admin"]);
  if (!actor) return NOT_ALLOWED;
  const device = await loadDevice(id);
  if (!device) return { ok: false, error: "That device no longer exists." };
  if (!device.is_active)
    return { ok: false, error: "Activate the device first." };

  const code = await createSetupCode(createAdminClient(), device, actor.id);
  if (!code.ok) return code;
  return { ok: true, data: { code: code.code, expiresAt: code.expiresAt } };
}

/**
 * Signs the device out everywhere (for a lost or replaced tablet) and returns
 * a new setup code for whichever device should take its place.
 */
export async function resetDeviceLogin(
  id: string,
): Promise<ActionResult<SetupCode>> {
  if (!(await withinRateLimit("device.reset_login", 20)))
    return TOO_MANY_ATTEMPTS;
  const actor = await getActionStaff(["admin"]);
  if (!actor) return NOT_ALLOWED;
  const device = await loadDevice(id);
  if (!device) return { ok: false, error: "That device no longer exists." };

  const admin = createAdminClient();
  if (!(await deleteDeviceLogin(admin, device, actor.id))) {
    return { ok: false, error: "Couldn't sign the device out. Try again." };
  }
  refresh();
  if (!device.is_active) return { ok: true };
  const code = await createSetupCode(admin, device, actor.id);
  if (!code.ok) return code;
  return { ok: true, data: { code: code.code, expiresAt: code.expiresAt } };
}

/** Switches a device into or out of training mode (its branch's training twin). */
export async function setDeviceTraining(
  id: string,
  on: boolean,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin"]))) return NOT_ALLOWED;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_device_training", {
    p_device_id: id,
    p_on: on,
  });
  if (error) return { ok: false, error: dbErrorMessage(error) };
  refresh();
  return { ok: true };
}
