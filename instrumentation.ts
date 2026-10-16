import type { Instrumentation } from "next";

// Errors thrown while rendering or in server actions and route handlers.
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitoring/report");
  const err = error as Error & { digest?: string };
  await reportError({
    source: "server",
    message: err.message ?? String(error),
    where: `${request.method} ${request.path} (${context.routeType} ${context.routePath})`,
    digest: err.digest,
    stack: err.stack,
  });
};
