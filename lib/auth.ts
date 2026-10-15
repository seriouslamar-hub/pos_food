import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Database } from "@/lib/supabase/database.types";
import { deviceHome } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export type StaffRole = Database["public"]["Enums"]["staff_role"];
export type DeviceType = Database["public"]["Enums"]["device_type"];

export type StaffUser = {
  id: string;
  fullName: string;
  role: StaffRole;
  branchId: string | null;
  email: string | null;
};

export type DeviceUser = {
  id: string;
  name: string;
  type: DeviceType;
  code: string;
  branchId: string;
  station: string | null;
};

export type SignedInUser = {
  authUserId: string;
  /** Set for an active admin or manager. RLS hides the row from anyone else. */
  staff: StaffUser | null;
  /** Set when this browser is signed in as a till, KDS or pickup device. */
  device: DeviceUser | null;
};

/**
 * The signed-in user with their staff or device record, or null. Cached for
 * the length of one request, so layouts and pages can both call it.
 */
export const getSignedInUser = cache(async (): Promise<SignedInUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const authUserId = data?.claims?.sub;
  if (!authUserId) return null;

  const [staffResult, deviceResult] = await Promise.all([
    supabase
      .from("staff")
      .select("id, full_name, role, branch_id, email")
      .eq("auth_user_id", authUserId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("devices")
      .select("id, name, type, code, branch_id, station")
      .eq("auth_user_id", authUserId)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const staff = staffResult.data;
  const device = deviceResult.data;

  return {
    authUserId,
    staff: staff
      ? {
          id: staff.id,
          fullName: staff.full_name,
          role: staff.role,
          branchId: staff.branch_id,
          email: staff.email,
        }
      : null,
    device: device
      ? {
          id: device.id,
          name: device.name,
          type: device.type,
          code: device.code,
          branchId: device.branch_id,
          station: device.station,
        }
      : null,
  };
});

/**
 * For back-office pages and Server Actions: returns the signed-in staff
 * member if their role is allowed, otherwise redirects. proxy.ts does the same
 * check first; this is the authoritative one.
 */
export async function requireStaff(
  allowed: readonly StaffRole[],
): Promise<StaffUser> {
  const user = await getSignedInUser();
  if (!user) redirect("/login");
  if (user.device) redirect(deviceHome(user.device.type));
  if (!user.staff) redirect("/login?error=not_allowed");
  if (!allowed.includes(user.staff.role)) {
    redirect(
      user.staff.role === "manager" ? "/manager" : "/login?error=not_allowed",
    );
  }
  return user.staff;
}
