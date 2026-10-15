"use server";

import { redirect } from "next/navigation";
import { safeNextPath, staffHome } from "@/lib/routes";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null; email: string };

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.user) {
    return { error: "That email and password don't match. Try again.", email };
  }

  // RLS only shows this row to active admins and managers, so cashiers,
  // device accounts and deactivated staff get nothing back.
  const { data: staff } = await supabase
    .from("staff")
    .select("role")
    .eq("auth_user_id", data.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!staff || (staff.role !== "admin" && staff.role !== "manager")) {
    await supabase.auth.signOut({ scope: "local" });
    return {
      error:
        "This account can't use the back office. Cashiers sign in with their PIN on the till.",
      email,
    };
  }

  redirect(safeNextPath(next, staff.role) ?? staffHome(staff.role));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
