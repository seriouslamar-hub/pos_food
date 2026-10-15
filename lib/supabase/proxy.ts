import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  canOpenBackOfficePath,
  deviceHome,
  isBackOfficePath,
  isDeviceScreenPath,
  staffHome,
} from "@/lib/routes";
import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/**
 * Runs on every request (from the root proxy.ts):
 * 1. Refreshes the Supabase auth session and writes updated auth cookies to
 *    both the request (for Server Components) and the response (for the
 *    browser).
 * 2. Keeps people out of screens they can't use: /admin is admin-only,
 *    /manager is for managers and admins, and /till, /kds and /pickup need a
 *    device login. Pages repeat the check with requireStaff(); this one just
 *    redirects early.
 */
export async function updateSession(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  const hadSessionCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Stops CDNs from caching a response that carries a session token.
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Don't add code between creating the client and this call: getClaims()
  // validates the JWT and refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  const path = request.nextUrl.pathname;

  // A redirect that keeps any refreshed auth cookies and no-cache headers.
  const redirectTo = (target: string, params: Record<string, string> = {}) => {
    const redirectUrl = new URL(target, request.url);
    for (const [key, value] of Object.entries(params)) {
      redirectUrl.searchParams.set(key, value);
    }
    const redirect = NextResponse.redirect(redirectUrl);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    for (const key of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(key);
      if (value) redirect.headers.set(key, value);
    }
    return redirect;
  };

  if (isBackOfficePath(path)) {
    if (!userId) {
      const params: Record<string, string> = {
        next: `${path}${request.nextUrl.search}`,
      };
      if (hadSessionCookie) params.reason = "expired";
      return redirectTo("/login", params);
    }

    const { data: staff } = await supabase
      .from("staff")
      .select("role")
      .eq("auth_user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    const role = staff?.role;

    if (role === "admin" || role === "manager") {
      return canOpenBackOfficePath(role, path)
        ? response
        : redirectTo(staffHome(role));
    }

    const { data: device } = await supabase
      .from("devices")
      .select("type")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (device) return redirectTo(deviceHome(device.type));
    return redirectTo("/login", { error: "not_allowed" });
  }

  if (isDeviceScreenPath(path) && !userId) {
    return redirectTo("/device/setup");
  }

  return response;
}
