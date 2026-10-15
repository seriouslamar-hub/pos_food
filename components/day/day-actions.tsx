"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { PrintHost } from "@/components/print-host";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { closeDay, openDay, reviewShift } from "@/lib/actions/day";
import { getPrinterDriver, type PaperWidth } from "@/lib/printing";
import type { SalesReport } from "@/lib/shifts";
import { useFieldIds } from "@/lib/use-field-ids";

/** Open or close the branch's business day from the back office. */
export function DayControl({
  branchId,
  dayOpen,
  openShifts,
}: {
  branchId: string;
  dayOpen: boolean;
  openShifts: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {dayOpen ? (
        <Button
          size="lg"
          disabled={pending}
          onClick={() => {
            if (
              window.confirm(
                "Close the business day? Tills can't sell again until a day is opened.",
              )
            )
              run(() => closeDay(branchId));
          }}
        >
          {pending ? "Closing…" : "Close the business day"}
        </Button>
      ) : (
        <Button
          size="lg"
          disabled={pending}
          onClick={() => run(() => openDay(branchId))}
        >
          {pending ? "Opening…" : "Open today's business day"}
        </Button>
      )}
      {dayOpen && openShifts > 0 ? (
        <p className="text-sm text-muted-foreground">
          {openShifts === 1
            ? "1 shift is still open."
            : `${openShifts} shifts are still open.`}{" "}
          Shifts are closed on the till.
        </p>
      ) : null}
      <FormError message={error} />
    </div>
  );
}

/** Approve or flag a closed shift. */
export function ShiftReview({
  shiftId,
  staffName,
}: {
  shiftId: string;
  staffName: string;
}) {
  const fid = useFieldIds();
  const [pending, startTransition] = useTransition();
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function review(status: "approved" | "flagged") {
    setError(null);
    startTransition(async () => {
      const result = await reviewShift(shiftId, status, note);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFlagging(false);
      setNote("");
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => review("approved")}
        aria-label={`Approve ${staffName}'s shift`}
      >
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => setFlagging(true)}
        aria-label={`Flag ${staffName}'s shift`}
      >
        Flag
      </Button>
      {error && !flagging ? <FormError message={error} /> : null}
      <Dialog open={flagging} onOpenChange={setFlagging}>
        <DialogContent className="max-w-md sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Flag {staffName}&apos;s shift</DialogTitle>
            <DialogDescription>
              Say what&apos;s wrong, e.g. the cash is short and why.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              review("flagged");
            }}
          >
            <label htmlFor={fid("note")} className="text-sm font-medium">
              Note
            </label>
            <Textarea
              id={fid("note")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <FormError message={error} />
            <Button type="submit" disabled={pending || !note.trim()}>
              {pending ? "Saving…" : "Flag shift"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Prints the day's report on the browser's printer. */
export function PrintReport({
  report,
  paperWidth,
  label,
}: {
  report: SalesReport;
  paperWidth: PaperWidth;
  label: string;
}) {
  return (
    <>
      <Button
        variant="outline"
        size="lg"
        onClick={() =>
          void getPrinterDriver().print(
            [{ kind: "report", report }],
            paperWidth,
          )
        }
      >
        {label}
      </Button>
      <PrintHost />
    </>
  );
}
