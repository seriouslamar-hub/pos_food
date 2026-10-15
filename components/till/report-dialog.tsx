"use client";

import { CashReport } from "@/components/cash-report";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPrinterDriver, type PaperWidth } from "@/lib/printing";
import type { SalesReport } from "@/lib/shifts";

/** An X or Z report on screen, with Print. */
export function ReportDialog({
  report,
  paperWidth,
  onClose,
}: {
  report: SalesReport;
  paperWidth: PaperWidth;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(36rem,97vw)] max-w-none flex-col gap-4 p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {report.kind === "x" ? "X report" : "Z report"}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto rounded-lg border bg-white p-3 shadow-sm">
          <CashReport report={report} paperWidth={paperWidth} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="touch"
            onClick={() =>
              void getPrinterDriver().print(
                [{ kind: "report", report }],
                paperWidth,
              )
            }
          >
            Print
          </Button>
          <Button size="touch" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
