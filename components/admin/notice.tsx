"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Shows a one-line confirmation after a redirect, from ?notice=<key>. Only
 * keys listed in `messages` are shown, so the URL can't inject text.
 */
export function Notice({ messages }: { messages: Record<string, string> }) {
  return (
    <Suspense fallback={null}>
      <NoticeFromQuery messages={messages} />
    </Suspense>
  );
}

function NoticeFromQuery({ messages }: { messages: Record<string, string> }) {
  const key = useSearchParams().get("notice");
  const message = key ? messages[key] : undefined;
  if (!message) return null;
  return (
    <Alert aria-live="polite" data-testid="notice">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
