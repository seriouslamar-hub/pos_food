import "server-only";

export type ErrorReport = {
  source: "server" | "browser";
  message: string;
  /** Where it happened: a route, a page path or a component. */
  where?: string;
  digest?: string;
  stack?: string;
};

/**
 * Records an error: one JSON line in the server log (Vercel keeps these
 * and can forward them), and, when ERROR_WEBHOOK_URL is set, a short
 * message to that webhook (Slack, Discord, Teams or any service that
 * accepts {"text": "..."}). Never throws.
 */
export async function reportError(report: ErrorReport): Promise<void> {
  const entry = {
    level: "error",
    at: new Date().toISOString(),
    env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    ...report,
    message: report.message.slice(0, 2000),
    stack: report.stack?.slice(0, 4000),
  };
  console.error(JSON.stringify(entry));
  const webhook = process.env.ERROR_WEBHOOK_URL;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `POS ${entry.env} ${report.source} error${report.where ? ` at ${report.where}` : ""}: ${entry.message.slice(0, 300)}`,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The log line above is enough.
  }
}
