import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * GET /api/health: the app is up and can reach Supabase. Used by the
 * uptime check (.github/workflows/uptime.yml). Says nothing private.
 */
export async function GET() {
  const started = Date.now();
  let database = false;
  try {
    const { url, anonKey } = getSupabaseEnv();
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    database = res.ok;
  } catch {
    database = false;
  }
  return Response.json(
    { ok: database, supabase: database, ms: Date.now() - started },
    { status: database ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
