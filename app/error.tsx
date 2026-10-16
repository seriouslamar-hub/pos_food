"use client";

import { useEffect } from "react";
import { sendClientError } from "@/components/error-reporter";
import { Button } from "@/components/ui/button";

/** Shown when a page fails; the rest of the app keeps working. */
export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    sendClientError(error);
  }, [error]);
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        The problem has been reported. Try again; if it keeps happening, tell
        your manager.
        {error.digest ? ` (Reference ${error.digest})` : ""}
      </p>
      <Button size="lg" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
