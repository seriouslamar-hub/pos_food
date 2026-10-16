"use client";

import { useEffect } from "react";

/** Sends one browser error to /api/client-errors (best effort, no retries). */
export function sendClientError(error: unknown, where?: string) {
  const err = error instanceof Error ? error : new Error(String(error));
  const body = JSON.stringify({
    message: err.message,
    stack: err.stack,
    digest: (err as Error & { digest?: string }).digest,
    where: where ?? window.location.pathname,
  });
  try {
    if (
      navigator.sendBeacon?.(
        "/api/client-errors",
        new Blob([body], { type: "application/json" }),
      )
    )
      return;
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Offline or blocked: nothing more to do.
  }
}

/** Reports uncaught errors and rejected promises, at most 10 per page load. */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();
    const report = (error: unknown) => {
      const key = error instanceof Error ? error.message : String(error);
      if (sent >= 10 || seen.has(key)) return;
      seen.add(key);
      sent += 1;
      sendClientError(error);
    };
    const onError = (event: ErrorEvent) => report(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
