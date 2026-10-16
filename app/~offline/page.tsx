import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offline" };

/** Shown for pages this device hasn't kept while it's offline. */
export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        This page isn&apos;t kept on this device. A till that has been opened
        before keeps working offline: go back to the till, or try again when the
        connection is back.
      </p>
      <a
        href="/till"
        className="inline-flex h-14 items-center rounded-xl bg-foreground px-6 text-lg font-medium text-background"
      >
        Back to the till
      </a>
    </main>
  );
}
