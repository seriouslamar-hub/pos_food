import { reportError } from "@/lib/monitoring/report";
import { withinRateLimit } from "@/lib/rate-limit";

/** POST /api/client-errors: an error from a browser (tills, back office). */
export async function POST(request: Request) {
  let body: {
    message?: unknown;
    where?: unknown;
    stack?: unknown;
    digest?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof body.message !== "string" || !body.message) {
    return new Response(null, { status: 400 });
  }
  // A broken page can fire errors in a loop: keep it to a trickle.
  if (!(await withinRateLimit("client_error", 30, 300))) {
    return new Response(null, { status: 429 });
  }
  await reportError({
    source: "browser",
    message: body.message.slice(0, 2000),
    where:
      typeof body.where === "string" ? body.where.slice(0, 300) : undefined,
    stack:
      typeof body.stack === "string" ? body.stack.slice(0, 4000) : undefined,
    digest:
      typeof body.digest === "string" ? body.digest.slice(0, 100) : undefined,
  });
  return new Response(null, { status: 204 });
}
