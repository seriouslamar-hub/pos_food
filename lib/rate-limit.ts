import "server-only";
import { headers } from "next/headers";
import { getSignedInUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const TOO_MANY_ATTEMPTS = {
  ok: false,
  error: "Too many attempts. Wait a few minutes and try again.",
} as const;

/**
 * Counts one attempt at `action` by the signed-in user (or, signed out, the
 * caller's IP address) and says whether it's allowed: at most `max` per
 * `windowSeconds`. Kept in the database (public.rate_limits) because the app
 * runs on many short-lived servers. If the check itself fails, the attempt
 * is allowed and the failure logged, so a hiccup never locks admins out.
 */
export async function withinRateLimit(
  action: string,
  max: number,
  windowSeconds = 600,
): Promise<boolean> {
  const user = await getSignedInUser();
  const who = user ? `user:${user.authUserId}` : `ip:${await clientIp()}`;
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_key: `${action}:${who}`,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limit check failed", action, error.message);
    return true;
  }
  return data === true;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
