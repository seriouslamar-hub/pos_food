"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { currentPrintRequest, subscribePrintRequests } from "@/lib/printing";
import { KitchenTicket } from "./kitchen-ticket";
import { Receipt } from "./receipt";

/**
 * Where the browser printer driver prints from: renders the requested
 * tickets into a print-only area (see .print-area in globals.css), then
 * calls window.print(). Mount it once on pages that print.
 */
export function PrintHost() {
  const request = useSyncExternalStore(
    subscribePrintRequests,
    currentPrintRequest,
    () => null,
  );

  useEffect(() => {
    if (!request) return;
    let finished = false;
    let fallback: number | undefined;
    const finish = () => {
      if (finished) return;
      finished = true;
      request.done();
    };
    window.addEventListener("afterprint", finish, { once: true });
    // Print once the tickets are laid out.
    const frame = requestAnimationFrame(() => {
      window.print();
      // Some browsers print without firing afterprint.
      fallback = window.setTimeout(finish, 2000);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fallback);
      window.removeEventListener("afterprint", finish);
    };
  }, [request]);

  if (!request) return null;
  return createPortal(
    <div className="print-area" aria-hidden="true" data-testid="print-area">
      {request.jobs.map((job, i) =>
        job.kind === "receipt" ? (
          <Receipt
            key={i}
            order={job.order}
            paperWidth={request.paperWidth}
            copy={job.copy}
          />
        ) : (
          <KitchenTicket
            key={i}
            order={job.order}
            paperWidth={request.paperWidth}
          />
        ),
      )}
    </div>,
    document.body,
  );
}
