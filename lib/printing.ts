/**
 * Printing receipts and kitchen tickets, and opening the cash drawer.
 *
 * Browser driver (the default)
 *   Renders the tickets into a print-only area of the page (<PrintHost />)
 *   and calls window.print(). On the till:
 *   - make the receipt printer the default printer, with the paper size set
 *     to the roll (80 mm or 58 mm, matching the receipt.paper_width_mm
 *     setting) and no margins;
 *   - start Chrome with --kiosk-printing so it prints without the dialog.
 *   It can't open the cash drawer. Drawers plug into the receipt printer and
 *   open when the printer gets a "kick" command, which a web page can't send.
 *   Most printer drivers can kick the drawer on every print job instead
 *   (often called "cash drawer: open before printing"); turn that on, or use
 *   the QZ Tray driver.
 *
 * QZ Tray driver (not built yet; see qzTrayDriver below)
 *   QZ Tray (https://qz.io) is a small app installed on the till that lets
 *   the page send raw ESC/POS bytes straight to the printer: no dialog, much
 *   faster, and it can kick the drawer.
 */
import type { OrderSummary } from "./orders";
import type { SalesReport, ShiftSummary } from "./shifts";

export type PaperWidth = 58 | 80;

export type PrintJob =
  | { kind: "receipt"; order: OrderSummary; copy?: boolean }
  | { kind: "kitchen"; order: OrderSummary }
  | { kind: "refund"; order: OrderSummary; refundId: string }
  | { kind: "report"; report: SalesReport }
  | {
      kind: "shift_close";
      shift: ShiftSummary;
      count: Record<string, number>;
      branch: { name: string; currency_code: string; timezone: string };
    };

export interface PrinterDriver {
  readonly id: "browser" | "qz-tray";
  /** Prints the jobs in order, one cut each. Resolves when they're sent. */
  print(jobs: PrintJob[], paperWidth: PaperWidth): Promise<void>;
  /** Opens the cash drawer; may do nothing (see the browser driver). */
  openDrawer(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Browser driver: one print request at a time, rendered by <PrintHost />.
// ---------------------------------------------------------------------------

export type PrintRequest = {
  jobs: PrintJob[];
  paperWidth: PaperWidth;
  /** Called by the host once the browser has printed (or given up). */
  done: () => void;
};

let current: PrintRequest | null = null;
let queue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** For <PrintHost />: subscribe to print requests (useSyncExternalStore). */
export function subscribePrintRequests(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    // The host went away mid-print: let later prints through.
    if (listeners.size === 0) current?.done();
  };
}

export function currentPrintRequest(): PrintRequest | null {
  return current;
}

export const browserDriver: PrinterDriver = {
  id: "browser",
  print(jobs, paperWidth) {
    const run = queue.then(
      () =>
        new Promise<void>((resolve) => {
          // No host on this page means nowhere to print from.
          if (jobs.length === 0 || listeners.size === 0) return resolve();
          current = {
            jobs,
            paperWidth,
            done: () => {
              current = null;
              emit();
              resolve();
            },
          };
          emit();
        }),
    );
    queue = run;
    return run;
  },
  async openDrawer() {
    // Browsers can't send the drawer kick. See the notes at the top.
  },
};

// ---------------------------------------------------------------------------
// QZ Tray driver: a stub for later.
// ---------------------------------------------------------------------------

/** ESC/POS commands the QZ Tray driver will need. */
export const ESC_POS = {
  /** ESC @: reset the printer. */
  init: "\x1B\x40",
  /** GS V 1: partial cut. */
  cut: "\x1D\x56\x01",
  /** ESC p 0 25 250: pulse drawer pin 2 (25 × 2 ms on, 250 × 2 ms off). */
  kickDrawer: "\x1B\x70\x00\x19\xFA",
} as const;

/**
 * Not built yet. To build it:
 * 1. Install QZ Tray on the till and load qz-tray.js from its CDN.
 * 2. Sign requests with the shop's certificate (qz.security.*), served by a
 *    server route so the private key never reaches the browser.
 * 3. qz.websocket.connect(), find the printer (qz.printers.find), then send
 *    raw data: ESC_POS.init, the receipt as text lines sized to the paper
 *    (48 characters at 80 mm, 32 at 58 mm), then ESC_POS.cut.
 * 4. openDrawer() sends ESC_POS.kickDrawer the same way.
 */
export const qzTrayDriver: PrinterDriver = {
  id: "qz-tray",
  async print() {
    throw new Error("QZ Tray printing isn't set up yet");
  },
  async openDrawer() {
    throw new Error("QZ Tray printing isn't set up yet");
  },
};

/** The driver this till prints with. */
export function getPrinterDriver(): PrinterDriver {
  return browserDriver;
}

/** A receipt setting value as a paper width (anything else → 80 mm). */
export function toPaperWidth(value: unknown): PaperWidth {
  return value === 58 ? 58 : 80;
}
