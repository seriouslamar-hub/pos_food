"use server";

import { getSignedInUser } from "@/lib/auth";
import { deviceHome } from "@/lib/routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type RegisterDeviceResult =
  { ok: true; deviceId: string; home: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Login email for a device account. Devices never receive email. */
function deviceEmail(deviceId: string) {
  return `device-${deviceId}@devices.invalid`;
}

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
    .select("id, name, type, branch_id, auth_user_id, is_active")
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
  let email: string;

  if (device.auth_user_id) {
    const { data, error } = await admin.auth.admin.getUserById(
      device.auth_user_id,
    );
    if (error || !data.user?.email) {
      return {
        ok: false,
        error: "This device's login is missing. Ask an admin to check it.",
      };
    }
    email = data.user.email;
  } else {
    email = deviceEmail(device.id);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { kind: "device", device_id: device.id },
    });
    if (error || !data.user) {
      return {
        ok: false,
        error: "Couldn't create a login for this device. Try again.",
      };
    }
    const { data: linked, error: linkError } = await admin
      .from("devices")
      .update({ auth_user_id: data.user.id })
      .eq("id", device.id)
      .is("auth_user_id", null)
      .select("id");
    if (linkError || !linked?.length) {
      await admin.auth.admin.deleteUser(data.user.id);
      return {
        ok: false,
        error: "Couldn't link a login to this device. Try again.",
      };
    }
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link.properties?.hashed_token) {
    return {
      ok: false,
      error: "Couldn't sign this browser in as the device. Try again.",
    };
  }

  await admin.rpc("write_audit", {
    p_action: "device.setup",
    p_entity: "devices",
    p_entity_id: device.id,
    p_branch_id: device.branch_id,
    p_actor_staff_id: staff.id,
    p_device_id: device.id,
  });

  // Swap this browser's login from the staff member to the device.
  await supabase.auth.signOut({ scope: "local" });
  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  if (otpError) {
    return {
      ok: false,
      error: "Couldn't sign this browser in as the device. Try again.",
    };
  }

  return { ok: true, deviceId: device.id, home: deviceHome(device.type) };
}
