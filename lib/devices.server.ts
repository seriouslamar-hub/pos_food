import "server-only";
import { createHash, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import {
  generateSetupCode,
  normalizeSetupCode,
  SETUP_CODE_TTL_HOURS,
} from "@/lib/setup-code";

type Client = SupabaseClient<Database>;
type DeviceRow = Pick<
  Database["public"]["Tables"]["devices"]["Row"],
  "id" | "branch_id" | "auth_user_id"
>;

/** Login email for a device account. Devices never receive email. */
export function deviceEmail(deviceId: string) {
  return `device-${deviceId}@devices.invalid`;
}

export function hashSetupCode(normalizedCode: string) {
  return createHash("sha256").update(normalizedCode).digest("hex");
}

/**
 * Returns the email of the device's login, creating and linking one if the
 * device doesn't have it yet. Uses the service-role client.
 */
export async function ensureDeviceLogin(
  admin: Client,
  device: DeviceRow,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (device.auth_user_id) {
    const { data, error } = await admin.auth.admin.getUserById(
      device.auth_user_id,
    );
    if (error || !data.user?.email) {
      return {
        ok: false,
        error:
          "This device's login is missing. Reset the device login and try again.",
      };
    }
    return { ok: true, email: data.user.email };
  }

  const email = deviceEmail(device.id);
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
  return { ok: true, email };
}

/**
 * Signs the browser behind `supabase` (the cookie-bound server client) in as
 * the device, replacing whatever session it had, using a one-time token.
 */
export async function signInAsDevice(
  supabase: Client,
  admin: Client,
  email: string,
): Promise<boolean> {
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !link.properties?.hashed_token) return false;

  await supabase.auth.signOut({ scope: "local" });
  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  return !otpError;
}

/** Creates (or replaces) the device's one-time setup code. Returns it once. */
export async function createSetupCode(
  admin: Client,
  device: Pick<DeviceRow, "id" | "branch_id">,
  actorStaffId: string,
): Promise<
  { ok: true; code: string; expiresAt: string } | { ok: false; error: string }
> {
  const code = generateSetupCode((max) => randomInt(max));
  const expiresAt = new Date(
    Date.now() + SETUP_CODE_TTL_HOURS * 3600_000,
  ).toISOString();

  const { error } = await admin.from("device_setup_codes").upsert(
    {
      device_id: device.id,
      code_hash: hashSetupCode(normalizeSetupCode(code)!),
      expires_at: expiresAt,
      created_by_staff_id: actorStaffId,
    },
    { onConflict: "device_id" },
  );
  if (error)
    return { ok: false, error: "Couldn't create a setup code. Try again." };

  await admin.rpc("write_audit", {
    p_action: "device.setup_code_created",
    p_entity: "devices",
    p_entity_id: device.id,
    p_after: { expires_at: expiresAt },
    p_branch_id: device.branch_id,
    p_actor_staff_id: actorStaffId,
    p_device_id: device.id,
  });
  return { ok: true, code, expiresAt };
}

/**
 * Uses a setup code: it must exist and not have expired, and it is deleted in
 * the same statement, so it works exactly once.
 */
export async function takeSetupCode(
  admin: Client,
  input: string,
): Promise<{ deviceId: string; createdByStaffId: string | null } | null> {
  const normalized = normalizeSetupCode(input);
  if (!normalized) return null;
  const { data } = await admin
    .from("device_setup_codes")
    .delete()
    .eq("code_hash", hashSetupCode(normalized))
    .gt("expires_at", new Date().toISOString())
    .select("device_id, created_by_staff_id")
    .maybeSingle();
  return data
    ? { deviceId: data.device_id, createdByStaffId: data.created_by_staff_id }
    : null;
}

/**
 * Signs the device out everywhere by deleting its login (any session it holds
 * stops working at once, because the device row no longer points at it). The
 * next setup creates a fresh login.
 */
export async function resetDeviceLogin(
  admin: Client,
  device: DeviceRow,
  actorStaffId: string,
): Promise<boolean> {
  if (device.auth_user_id) {
    const { error } = await admin.auth.admin.deleteUser(device.auth_user_id);
    if (error) return false;
  }
  await admin.rpc("write_audit", {
    p_action: "device.login_reset",
    p_entity: "devices",
    p_entity_id: device.id,
    p_branch_id: device.branch_id,
    p_actor_staff_id: actorStaffId,
    p_device_id: device.id,
  });
  return true;
}
