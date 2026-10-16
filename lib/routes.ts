/**
 * Route rules shared by proxy.ts, Server Actions and pages. Pure functions,
 * safe to import anywhere.
 */

export type BackOfficeRole = "admin" | "manager";
export type DeviceKind = "till" | "kds" | "pickup" | "kiosk";

function isUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

export function isAdminPath(path: string): boolean {
  return isUnder(path, "/admin");
}

/** /admin (admins only) and /manager (managers and admins). */
export function isBackOfficePath(path: string): boolean {
  return isAdminPath(path) || isUnder(path, "/manager");
}

/** Screens that need a device login. */
export function isDeviceScreenPath(path: string): boolean {
  return (
    isUnder(path, "/till") ||
    isUnder(path, "/kds") ||
    isUnder(path, "/pickup") ||
    isUnder(path, "/kiosk")
  );
}

export function canOpenBackOfficePath(
  role: BackOfficeRole,
  path: string,
): boolean {
  return role === "admin" || !isAdminPath(path);
}

export function staffHome(role: BackOfficeRole): string {
  return role === "admin" ? "/admin" : "/manager";
}

export function deviceHome(type: DeviceKind): string {
  switch (type) {
    case "till":
      return "/till";
    case "kds":
      return "/kds";
    case "pickup":
      return "/pickup";
    case "kiosk":
      return "/kiosk";
  }
}

/**
 * Where to send someone after they sign in. Only same-site back-office paths
 * (and device setup) are allowed, so a crafted ?next= link can't redirect to
 * another site. Returns null when `next` isn't usable.
 */
export function safeNextPath(
  next: string | null | undefined,
  role: BackOfficeRole,
): string | null {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.includes("\\")
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(next, "http://local.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://local.invalid") return null;
  const path = url.pathname;
  const allowed =
    (isBackOfficePath(path) && canOpenBackOfficePath(role, path)) ||
    isUnder(path, "/device/setup");
  return allowed ? `${path}${url.search}` : null;
}
