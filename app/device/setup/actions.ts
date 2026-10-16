"use server";

import { TOO_MANY_ATTEMPTS, withinRateLimit } from "@/lib/rate-limit";
import { getSignedInUser } from "@/lib/auth";
import {
  ensureDeviceLogin,
  signInAsDevice,
  takeSetupCode,
} from "@/lib/devices.server";
import { deviceHome } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RegisterDeviceResult =
  { ok: true; deviceId: string; home: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signs this browser in as the chosen device. The caller must be an active
 * admin or manager who can see the device through RLS (managers: their own
 * branch only). Creates the device's login on first setup. Device logins have
 * no password: the server issues a one-time token and redeems it straight
 * away, replacing the staff member's session in this browser.
 */
export async function registerDevice(
  deviceId: string,
): Promise<RegisterDeviceResult> {
  if (!(await withinRateLimit("device.register", 20))) return TOO_MANY_ATTEMPTS;
  if (!UUID.test(deviceId)) {
    return { ok: false, error: "Choose a device first." };
  }

  const user = await getSignedInUser();
  const staff = user?.staff;
  if (!staff || (staff.role !== "admin" && staff.role !== "manager")) {
    return {
      ok: false,
      error: "Sign in as an admin or manager to set up devices.",
    };
  }

  const supabase = await createClient();
  const { data: device } = await supabase
    .from("devices")
    .select("id, type, branch_id, auth_user_id, is_active")
    .eq("id", deviceId)
    .maybeSingle();

  if (!device || !device.is_active) {
    return {
      ok: false,
      error: "That device isn't available. Refresh the page and choose again.",
    };
  }
  if (device.type === "kiosk") {
    return { ok: false, error: "Kiosk screens arrive in a later phase." };
  }

  const admin = createAdminClient();
  const login = await ensureDeviceLogin(admin, device);
  if (!login.ok) return login;

  await admin.rpc("write_audit", {
    p_action: "device.setup",
    p_entity: "devices",
    p_entity_id: device.id,
    p_after: { method: "staff_sign_in" },
    p_branch_id: device.branch_id,
    p_actor_staff_id: staff.id,
    p_device_id: device.id,
  });

  if (!(await signInAsDevice(supabase, admin, login.email))) {
    return {
      ok: false,
      error: "Couldn't sign this browser in as the device. Try again.",
    };
  }
  return { ok: true, deviceId: device.id, home: deviceHome(device.type) };
}

/**
 * Signs this browser in as a device using the one-time code an admin got when
 * creating it. Nobody needs to sign in on the device. The code works once.
 */
export async function redeemSetupCode(
  code: string,
): Promise<RegisterDeviceResult> {
  if (!(await withinRateLimit("device.redeem_code", 10)))
    return TOO_MANY_ATTEMPTS;
  const admin = createAdminClient();
  const taken = await takeSetupCode(admin, code);
  if (!taken) {
    return {
      ok: false,
      error:
        "That code isn't valid. It may have expired or been used already. Ask an admin for a new one.",
    };
  }

  const { data: device } = await admin
    .from("devices")
    .select("id, type, branch_id, auth_user_id, is_active")
    .eq("id", taken.deviceId)
    .maybeSingle();
  if (!device || !device.is_active || device.type === "kiosk") {
    return {
      ok: false,
      error: "That device isn't active. Ask an admin to check it.",
    };
  }

  const login = await ensureDeviceLogin(admin, device);
  if (!login.ok) return login;

  await admin.rpc("write_audit", {
    p_action: "device.setup",
    p_entity: "devices",
    p_entity_id: device.id,
    p_after: { method: "setup_code" },
    p_branch_id: device.branch_id,
    p_actor_staff_id: taken.createdByStaffId ?? undefined,
    p_device_id: device.id,
  });

  const supabase = await createClient();
  if (!(await signInAsDevice(supabase, admin, login.email))) {
    return {
      ok: false,
      error: "Couldn't sign this browser in as the device. Try again.",
    };
  }
  return { ok: true, deviceId: device.id, home: deviceHome(device.type) };
}
