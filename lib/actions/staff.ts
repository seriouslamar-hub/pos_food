"use server";

import { TOO_MANY_ATTEMPTS, withinRateLimit } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { dbErrorMessage, type ActionResult } from "@/lib/action-result";
import { getActionStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  cashierCreateSchema,
  cashierSchema,
  fieldErrors,
  pinSchema,
  staffCreateSchema,
  staffSchema,
  type CashierFormValues,
  type StaffFormValues,
} from "@/lib/validation";

export type Credentials = { email: string; password: string };

type Client = Awaited<ReturnType<typeof createClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

const CHECK_FIELDS = "Check the highlighted fields.";

function temporaryPassword() {
  return randomBytes(12).toString("base64url");
}

/** Creates a confirmed Supabase Auth login with a temporary password. */
async function createLogin(
  admin: AdminClient,
  email: string,
): Promise<
  { ok: true; userId: string; password: string } | { ok: false; error: string }
> {
  const password = temporaryPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { kind: "staff" },
  });
  if (error || !data.user) {
    return {
      ok: false,
      error: /already|exists|registered/i.test(error?.message ?? "")
        ? "That email is already used by another login."
        : "Couldn't create the login. Try again.",
    };
  }
  return { ok: true, userId: data.user.id, password };
}

/** Creates a login for a staff row and links it as the signed-in admin. */
async function addLogin(
  supabase: Client,
  admin: AdminClient,
  staffId: string,
  email: string,
): Promise<
  { ok: true; credentials: Credentials } | { ok: false; error: string }
> {
  const login = await createLogin(admin, email);
  if (!login.ok) return login;
  const { error } = await supabase.rpc("set_staff_login", {
    p_staff_id: staffId,
    p_auth_user_id: login.userId,
  });
  if (error) {
    await admin.auth.admin.deleteUser(login.userId);
    return {
      ok: false,
      error: dbErrorMessage(error, "Couldn't link the login. Try again."),
    };
  }
  return { ok: true, credentials: { email, password: login.password } };
}

/** set_staff_login with null unlinks; the generated types don't allow null. */
function unlinkLogin(supabase: Client, staffId: string) {
  return supabase.rpc("set_staff_login", {
    p_staff_id: staffId,
    p_auth_user_id: null as unknown as string,
  });
}

async function setPin(
  supabase: Client,
  staffId: string,
  pin: string,
): Promise<string | null> {
  const { error } = await supabase.rpc("set_staff_pin", {
    p_staff_id: staffId,
    p_pin: pin,
  });
  return error ? dbErrorMessage(error, "Couldn't set the PIN.") : null;
}

// ---------------------------------------------------------------------------
// Admin: any staff member
// ---------------------------------------------------------------------------

export async function createStaff(
  values: StaffFormValues,
): Promise<
  ActionResult<{ id: string; credentials?: Credentials; pinError?: string }>
> {
  if (!(await withinRateLimit("staff.create", 20))) return TOO_MANY_ATTEMPTS;
  if (!(await getActionStaff(["admin"]))) {
    return { ok: false, error: "Only an admin can add staff here." };
  }
  const parsed = staffCreateSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const admin = createAdminClient();

  // Check the email is free before saving anything.
  let login: { userId: string; password: string } | null = null;
  if (v.role !== "cashier") {
    const created = await createLogin(admin, v.email!);
    if (!created.ok)
      return {
        ok: false,
        error: created.error,
        fieldErrors: { email: created.error },
      };
    login = created;
  }

  const { data: row, error } = await supabase
    .from("staff")
    .insert({
      full_name: v.fullName,
      role: v.role,
      branch_id: v.branchId,
      email: v.email,
      phone: v.phone,
      discount_limit_bps: v.discountPercent,
      is_active: v.isActive,
    })
    .select("id")
    .single();
  if (error || !row) {
    if (login) await admin.auth.admin.deleteUser(login.userId);
    return { ok: false, error: dbErrorMessage(error) };
  }

  if (login) {
    const { error: linkError } = await supabase.rpc("set_staff_login", {
      p_staff_id: row.id,
      p_auth_user_id: login.userId,
    });
    if (linkError) {
      await admin.auth.admin.deleteUser(login.userId);
      return {
        ok: false,
        error: `${v.fullName} was saved without a login. Open their page and choose “Create login”.`,
      };
    }
  }

  const pinError = v.pin ? await setPin(supabase, row.id, v.pin) : null;
  return {
    ok: true,
    data: {
      id: row.id,
      credentials: login
        ? { email: v.email!, password: login.password }
        : undefined,
      pinError: pinError ?? undefined,
    },
  };
}

export async function updateStaff(
  id: string,
  values: StaffFormValues,
): Promise<ActionResult<{ credentials?: Credentials }>> {
  const actor = await getActionStaff(["admin"]);
  if (!actor) return { ok: false, error: "Only an admin can edit staff here." };
  const parsed = staffSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: existing } = await supabase
    .from("staff")
    .select("id, auth_user_id, email, role, is_active")
    .eq("id", id)
    .maybeSingle();
  if (!existing)
    return { ok: false, error: "That staff member no longer exists." };

  if (id === actor.id && (v.role !== existing.role || !v.isActive)) {
    return {
      ok: false,
      error:
        "You can't change your own role or deactivate yourself. Ask another admin.",
    };
  }

  const needsLogin = v.role !== "cashier";
  const oldLogin = existing.auth_user_id;

  // A new email for an existing login must be free before anything else changes.
  if (needsLogin && oldLogin && v.email !== existing.email) {
    const { error } = await admin.auth.admin.updateUserById(oldLogin, {
      email: v.email!,
      email_confirm: true,
    });
    if (error) {
      const message = "That email is already used by another login.";
      return { ok: false, error: message, fieldErrors: { email: message } };
    }
  }

  // Cashiers don't have a login: unlink it before the role changes.
  const dropLogin = !needsLogin && oldLogin;
  if (dropLogin) {
    const { error } = await unlinkLogin(supabase, id);
    if (error) return { ok: false, error: dbErrorMessage(error) };
  }

  const { error } = await supabase
    .from("staff")
    .update({
      full_name: v.fullName,
      role: v.role,
      branch_id: v.branchId,
      email: v.email,
      phone: v.phone,
      discount_limit_bps: v.discountPercent,
      is_active: v.isActive,
    })
    .eq("id", id);
  if (error) {
    if (dropLogin) {
      await supabase.rpc("set_staff_login", {
        p_staff_id: id,
        p_auth_user_id: oldLogin,
      });
    }
    return { ok: false, error: dbErrorMessage(error) };
  }

  if (dropLogin) await admin.auth.admin.deleteUser(oldLogin);

  if (needsLogin && !oldLogin) {
    const added = await addLogin(supabase, admin, id, v.email!);
    if (!added.ok)
      return { ok: false, error: `Saved, but ${added.error.toLowerCase()}` };
    return { ok: true, data: { credentials: added.credentials } };
  }
  return { ok: true };
}

/** For an admin or manager who has no login yet. */
export async function createStaffLogin(
  id: string,
): Promise<ActionResult<{ credentials: Credentials }>> {
  if (!(await withinRateLimit("staff.create_login", 20)))
    return TOO_MANY_ATTEMPTS;
  if (!(await getActionStaff(["admin"])))
    return { ok: false, error: "Only an admin can create logins." };
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff")
    .select("id, role, email, auth_user_id")
    .eq("id", id)
    .maybeSingle();
  if (!staff)
    return { ok: false, error: "That staff member no longer exists." };
  if (staff.role === "cashier")
    return { ok: false, error: "Cashiers sign in with a PIN, not a login." };
  if (staff.auth_user_id)
    return { ok: false, error: "They already have a login." };
  if (!staff.email) return { ok: false, error: "Add their email first." };

  const added = await addLogin(supabase, createAdminClient(), id, staff.email);
  if (!added.ok) return added;
  refresh();
  return { ok: true, data: { credentials: added.credentials } };
}

/** Gives an admin or manager a new temporary password, shown once. */
export async function resetStaffPassword(
  id: string,
): Promise<ActionResult<{ credentials: Credentials }>> {
  if (!(await withinRateLimit("staff.reset_password", 20)))
    return TOO_MANY_ATTEMPTS;
  const actor = await getActionStaff(["admin"]);
  if (!actor) return { ok: false, error: "Only an admin can reset passwords." };
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff")
    .select("id, email, branch_id, auth_user_id")
    .eq("id", id)
    .maybeSingle();
  if (!staff?.auth_user_id || !staff.email) {
    return { ok: false, error: "They don't have a login to reset." };
  }

  const admin = createAdminClient();
  const password = temporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(staff.auth_user_id, {
    password,
  });
  if (error)
    return { ok: false, error: "Couldn't reset the password. Try again." };

  await admin.rpc("write_audit", {
    p_action: "staff.password_reset",
    p_entity: "staff",
    p_entity_id: staff.id,
    p_branch_id: staff.branch_id ?? undefined,
    p_actor_staff_id: actor.id,
  });
  return { ok: true, data: { credentials: { email: staff.email, password } } };
}

// ---------------------------------------------------------------------------
// PINs (admins: anyone; managers: cashiers in their branch; set_staff_pin checks)
// ---------------------------------------------------------------------------

export async function setStaffPin(
  id: string,
  pin: string,
): Promise<ActionResult> {
  if (!(await getActionStaff(["admin", "manager"]))) {
    return { ok: false, error: "Sign in as an admin or manager to set PINs." };
  }
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) {
    return {
      ok: false,
      error: "PIN must be 4 to 6 digits",
      fieldErrors: { pin: "PIN must be 4 to 6 digits" },
    };
  }
  const supabase = await createClient();
  const pinError = await setPin(supabase, id, parsed.data);
  if (pinError)
    return { ok: false, error: pinError, fieldErrors: { pin: pinError } };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Managers: cashiers in their own branch (RLS enforces the branch and role)
// ---------------------------------------------------------------------------

export async function createCashier(
  values: CashierFormValues,
): Promise<ActionResult<{ id: string; pinError?: string }>> {
  if (!(await withinRateLimit("staff.create_cashier", 30)))
    return TOO_MANY_ATTEMPTS;
  const actor = await getActionStaff(["manager"]);
  if (!actor?.branchId)
    return { ok: false, error: "Only a branch manager can add cashiers here." };
  const parsed = cashierCreateSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("staff")
    .insert({
      full_name: v.fullName,
      role: "cashier",
      branch_id: actor.branchId,
      phone: v.phone,
      discount_limit_bps: v.discountPercent,
      is_active: v.isActive,
    })
    .select("id")
    .single();
  if (error || !row) {
    const message = dbErrorMessage(error);
    return {
      ok: false,
      error: message,
      fieldErrors: /discount/i.test(message)
        ? { discountPercent: message }
        : undefined,
    };
  }
  const pinError = v.pin ? await setPin(supabase, row.id, v.pin) : null;
  return { ok: true, data: { id: row.id, pinError: pinError ?? undefined } };
}

export async function updateCashier(
  id: string,
  values: CashierFormValues,
): Promise<ActionResult> {
  const actor = await getActionStaff(["manager"]);
  if (!actor?.branchId)
    return {
      ok: false,
      error: "Only a branch manager can edit cashiers here.",
    };
  const parsed = cashierSchema.safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: CHECK_FIELDS,
      fieldErrors: fieldErrors(parsed.error),
    };
  }
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("staff")
    .update({
      full_name: v.fullName,
      phone: v.phone,
      discount_limit_bps: v.discountPercent,
      is_active: v.isActive,
    })
    .eq("id", id)
    .eq("role", "cashier")
    .select("id");
  if (error) {
    const message = dbErrorMessage(error);
    return {
      ok: false,
      error: message,
      fieldErrors: /discount/i.test(message)
        ? { discountPercent: message }
        : undefined,
    };
  }
  if (!data?.length)
    return { ok: false, error: "That cashier isn't in your branch." };
  return { ok: true };
}
