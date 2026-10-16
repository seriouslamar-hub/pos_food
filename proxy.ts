import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Next.js 16 renamed middleware.ts to proxy.ts. Role-based route protection
// for /admin and /manager is added here in Phase 2.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Every path except static files, images and PWA assets.
    "/((?!_next/static|_next/image|favicon.ico|serwist/|~offline|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
