"use client";

import { useState } from "react";
import { ManagerOverride } from "@/components/manager-override";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toCountPayload, type CashCount, countTotal } from "@/lib/cash";
import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import { getPrinterDriver, type PaperWidth } from "@/lib/printing";
import { parseReport, type SalesReport, type ShiftSummary } from "@/lib/shifts";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import { isSessionEndedError, rpcErrorMessage } from "@/lib/till";
import { usePermission, useTillSession } from "@/lib/till-session";
import { cn } from "@/lib/utils";
import { CashCountForm } from "./cash-count";

type Branch = { name: string; currency_code: string; timezone: string };

/**
 * Opens or closes the business day from the till. Staff without
 * day.open_close get a manager to approve it with their PIN.
 */
export function DayControlButton({
  action,
  onDone,
  className,
}: {
  action: "open" | "close";
  onDone: (result: Json) => void;
  className?: string;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const allowed = usePermission("day.open_close");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(overrideId?: string) {
    setBusy(true);
    setError(null);
    const args = {
      p_session_id: session.sessionId,
      p_override_id: overrideId,
    };
    const { data, error: rpcError } =
      action === "open"
        ? await supabase.rpc("open_business_day", args)
        : await supabase.rpc("close_business_day", args);
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      return;
    }
    onDone(data);
  }

  const label =
    action === "open" ? "Open the business day" : "Close the business day";
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Button
        size="touch"
        className="h-16 text-xl"
        disabled={busy}
        onClick={() => (allowed ? void run() : setApprovalOpen(true))}
      >
        {busy ? "Working…" : label}
      </Button>
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription className="text-base" data-testid="day-error">
            {error}
          </AlertDescription>
        </Alert>
      ) : null}
      <ManagerOverride
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        permission="day.open_close"
        actionLabel={
          action === "open"
            ? "Opening the business day"
            : "Closing the business day"
        }
        onApproved={(approval) => void run(approval.overrideId)}
      />
    </div>
  );
}

/**
 * End of day on the till: count and close any shift still open (managers),
 * then close the day and print the Z report.
 */
export function CloseDay({
  branch,
  denominations,
  paperWidth,
  onClosed,
}: {
  branch: Branch;
  denominations: number[];
  paperWidth: PaperWidth;
  onClosed: (report: SalesReport) => void;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const canReconcile = usePermission("shift.reconcile");
  const [open, setOpen] = useState(false);
  const [shifts, setShifts] = useState<ShiftSummary[] | null>(null);
  const [counting, setCounting] = useState<ShiftSummary | null>(null);
  const [count, setCount] = useState<CashCount>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (amount: number) => formatAmount(amount, branch.currency_code);

  async function loadShifts() {
    setError(null);
    if (!canReconcile) {
      // Closing will say if shifts are still open.
      setShifts([]);
      return;
    }
    setShifts(null);
    const { data, error: rpcError } = await supabase.rpc("list_open_shifts", {
      p_session_id: session.sessionId,
    });
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      setShifts([]);
      return;
    }
    setShifts((data as ShiftSummary[] | null) ?? []);
  }

  async function closeShift(shift: ShiftSummary) {
    setBusy(true);
    setError(null);
    const payload = toCountPayload(count);
    const { data, error: rpcError } = await supabase.rpc("close_shift", {
      p_session_id: session.sessionId,
      p_counted_denominations: payload,
      p_shift_id: shift.id,
    });
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      return;
    }
    void getPrinterDriver().print(
      [
        {
          kind: "shift_close",
          shift: data as ShiftSummary,
          count: payload,
          branch,
        },
      ],
      paperWidth,
    );
    setCounting(null);
    setCount({});
    await loadShifts();
  }

  return (
    <>
      <Button
        variant="outline"
        size="touch"
        onClick={() => {
          setOpen(true);
          void loadShifts();
        }}
      >
        End of day
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          setCounting(null);
        }}
      >
        <DialogContent className="flex max-h-[94dvh] w-[min(48rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {counting
                ? `Count ${counting.staff_name}'s drawer`
                : "Close the business day"}
            </DialogTitle>
            <DialogDescription className="text-base">
              {counting
                ? `Till ${counting.device_code}, open since ${formatInZone(counting.opened_at, branch.timezone, { timeStyle: "short" })}. Count the cash in it to close the shift.`
                : "Every shift must be closed first. Closing the day prints the Z report."}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}

          {counting ? (
            <>
              <CashCountForm
                denominations={denominations}
                currency={branch.currency_code}
                value={count}
                onChange={setCount}
                disabled={busy}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  size="touch"
                  disabled={busy}
                  onClick={() => {
                    setCounting(null);
                    setCount({});
                  }}
                >
                  Back
                </Button>
                <Button
                  size="touch"
                  disabled={busy}
                  onClick={() => void closeShift(counting)}
                >
                  Close shift with {money(countTotal(count))}
                </Button>
              </div>
            </>
          ) : shifts === null ? (
            <p className="text-muted-foreground">Checking open shifts…</p>
          ) : (
            <>
              {shifts.length ? (
                <ul className="flex flex-col gap-2">
                  {shifts.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded-xl border p-3"
                      data-testid="open-shift"
                    >
                      <span>
                        <strong className="text-lg">{s.staff_name}</strong>
                        <span className="block text-sm text-muted-foreground">
                          Till {s.device_code} · open since{" "}
                          {formatInZone(s.opened_at, branch.timezone, {
                            timeStyle: "short",
                          })}
                        </span>
                      </span>
                      <Button size="touch" onClick={() => setCounting(s)}>
                        Count and close
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <DayControlButton
                action="close"
                onDone={(result) => {
                  const report = parseReport(
                    (result as { z_report?: unknown } | null)?.z_report,
                  );
                  void getPrinterDriver().print(
                    [{ kind: "report", report }],
                    paperWidth,
                  );
                  setOpen(false);
                  onClosed(report);
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
