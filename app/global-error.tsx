"use client";

import { useEffect } from "react";
import { sendClientError } from "@/components/error-reporter";

/** The last-resort error page (the root layout itself failed). */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    sendClientError(error, "global-error");
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
        <h1 style={{ fontSize: 28 }}>Something went wrong</h1>
        <p style={{ fontSize: 18 }}>
          The problem has been reported. Try again; if it keeps happening, tell
          your manager.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{ fontSize: 20, padding: "12px 24px", marginTop: 16 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
