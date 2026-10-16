"use client";

import { CloudOffIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOffline, useSyncState } from "@/lib/offline/context";
import type { OutboxItem } from "@/lib/offline/db";
import { cn } from "@/lib/utils";

/**
 * Shows in the till's header while the till is offline or has work still
 * to send; tapping it opens the sync status.
 */
export function SyncBadge({ canDiscard }: { canDiscard: boolean }) {
  const state = useSyncState();
  const [open, setOpen] = useState(false);
  if (state.online && state.pending === 0 && state.failed === 0) return null;

  const label = state.failed
    ? `${state.failed} couldn't be sent`
    : !state.online
      ? `Offline${state.pending ? ` · ${state.pending} to send` : ""}`
      : `Sending ${state.pending}…`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-11 items-center gap-2 rounded-full px-4 text-base font-medium",
          state.failed
            ? "bg-destructive/10 text-destructive"
            : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
        )}
        data-testid="sync-badge"
      >
        {state.failed ? (
          <TriangleAlertIcon className="size-5" />
        ) : !state.online ? (
          <CloudOffIcon className="size-5" />
        ) : (
          <RefreshCwIcon className="size-5 animate-spin" />
        )}
        {label}
      </button>
      {open ? (
        <SyncStatusDialog
          canDiscard={canDiscard}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

const STATUS_LABELS: Record<OutboxItem["status"], string> = {
  pending: "Waiting",
  failed: "Couldn't be sent",
  blocked: "Waiting for another item",
};

/** Everything this till still has to send, with retry (and discard). */
export function SyncStatusDialog({
  canDiscard,
  onClose,
}: {
  canDiscard: boolean;
  onClose: () => void;
}) {
  const { engine } = useOffline();
  const state = useSyncState();
  const [items, setItems] = useState<OutboxItem[] | null>(null);

  useEffect(() => {
    let current = true;
    const load = () =>
      void engine.list().then((list) => {
        if (current) setItems(list);
      });
    load();
    const unsubscribe = engine.subscribe(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [engine]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(48rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-2xl">Sync status</DialogTitle>
          <DialogDescription className="text-base">
            {state.online
              ? "Connected. Everything below is sent in order, once."
              : "Offline. Sales are kept on this till and sent when the connection is back."}
          </DialogDescription>
        </DialogHeader>
        <Button
          size="touch"
          variant="outline"
          onClick={() => engine.trigger()}
          disabled={state.syncing}
        >
          {state.syncing ? "Sending…" : "Send now"}
        </Button>
        {items === null ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground" data-testid="sync-empty">
            Everything has been sent.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
                data-testid="sync-item"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{item.label}</span>
                  <span className="block text-sm text-muted-foreground">
                    {new Date(item.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {item.lastError ? ` · ${item.lastError}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge
                    variant={
                      item.status === "failed" ? "destructive" : "secondary"
                    }
                  >
                    {STATUS_LABELS[item.status]}
                  </Badge>
                  {item.status === "failed" ? (
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-11"
                      onClick={() => void engine.retry(item.id)}
                    >
                      Try again
                    </Button>
                  ) : null}
                  {canDiscard && item.status !== "pending" ? (
                    <Button
                      size="lg"
                      variant="ghost"
                      className="h-11 text-destructive"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Discard “${item.label}” (and anything that needs it)? It will never reach the server.`,
                          )
                        )
                          void engine.discard(item.id);
                      }}
                    >
                      Discard
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
