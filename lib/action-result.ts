/** What Server Actions return to forms. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; notice?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** A Postgres/PostgREST error as returned by supabase-js. */
type DbError =
  | { code?: string; message?: string; details?: string | null }
  | null
  | undefined;

const CONSTRAINT_MESSAGES: Record<string, string> = {
  devices_code_unique_per_branch:
    "Another device in this branch already uses that code.",
  payment_methods_one_cash: "There is already a cash payment method.",
  payment_methods_name_unique: "Another payment method already has that name.",
  staff_auth_user_id_key: "That login already belongs to someone else.",
  settings_branch_key_unique: "That setting already exists.",
};

/**
 * Turns a database error into something a person can act on. Messages raised
 * by our own SQL functions and triggers are already written for people, so
 * they pass through; generic errors get a friendly fallback.
 */
export function dbErrorMessage(
  error: DbError,
  fallback = "Something went wrong. Try again.",
): string {
  if (!error) return fallback;
  const text = `${error.message ?? ""} ${error.details ?? ""}`;
  for (const [constraint, message] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (text.includes(constraint)) return message;
  }
  switch (error.code) {
    case "42501":
      if (/row-level security|permission denied/i.test(error.message ?? "")) {
        return "You don't have permission to do that.";
      }
      return error.message ?? fallback;
    case "22023":
    case "P0002":
    case "PS401":
    case "PS403":
      return error.message ?? fallback;
    case "23505":
      return error.message?.startsWith("duplicate key")
        ? "That already exists."
        : (error.message ?? fallback);
    case "23514":
      return "One of the values isn't allowed. Check the form and try again.";
    default:
      return fallback;
  }
}
