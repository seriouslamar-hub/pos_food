"use client";

import { useState } from "react";
import { Field } from "@/components/admin/form";
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
import { Input } from "@/components/ui/input";
import { countTotal, toCountPayload, type CashCount } from "@/lib/cash";
import { formatAmount, parseMoney } from "@/lib/money";
import { useOffline, useOutboxDeps, useSyncState } from "@/lib/offline/context";
import { getPrinterDriver } from "@/lib/printing";
import {
  CASH_MOVEMENTS,
  parseReport,
  type CashMovementType,
  type SalesReport,
  type ShiftSummary,
} from "@/lib/shifts";
import { createClient } from "@/lib/supabase/client";
import {
  isReadableError,
  isSessionEndedError,
  rpcErrorMessage,
  type TillSettings,
} from "@/lib/till";
import { usePermission, useTillSession } from "@/lib/till-session";
import { useFieldIds } from "@/lib/use-field-ids";
import { CashCountForm } from "./cash-count";
import { ReportDialog } from "./report-dialog";

type Branch = { name: string; currency_code: string; timezone: string };

const DESCRIPTIONS: Record<CashMovementType, string> = {
  drop: "Cash taken out of the drawer to the safe during the shift.",
  paid_in: "Cash put into the drawer, e.g. extra change from the bank.",
  paid_out: "Cash paid out of the drawer, e.g. for a delivery.",
  no_sale: "Opens the drawer without a sale, e.g. to change a note.",
};

/**
 * The till's Cash button: drops, paid in/out, no-sale, the X report and
 * closing the shift with a blind count.
 */
export function CashActions({
  shift,
  branch,
  settings,
  onShiftClosed,
}: {
  shift: ShiftSummary;
  branch: Branch;
  settings: TillSettings;
  onShiftClosed: (closed: ShiftSummary) => void;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const canXReport = usePermission("reports.own_shift");
  const canClose = usePermission("shift.close_own");
  const sync = useSyncState();
  // The shift's figures live on the server: everything must be sent first.
  const allSent =
    sync.online && sync.pending === 0 && sync.failed === 0 && !session.offline;
  const [menuOpen, setMenuOpen] = useState(false);
  const [movement, setMovement] = useState<CashMovementType | null>(null);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function showXReport() {
    const { data, error } = await supabase.rpc("x_report", {
      p_session_id: session.sessionId,
    });
    if (isSessionEndedError(error)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (error) {
      setResult(rpcErrorMessage(error));
      return;
    }
    setReport(parseReport(data));
  }

  return (
    <>
      <Button
        size="lg"
        variant="outline"
        className="h-12 px-4 text-base"
        onClick={() => {
          setResult(null);
          setMenuOpen(true);
        }}
      >
        Cash
      </Button>
      {result ? (
        <Alert aria-live="polite" className="order-last basis-full">
          <AlertDescription
            className="text-base"
            data-testid="till-action-result"
          >
            {result}
          </AlertDescription>
        </Alert>
      ) : null}

      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Cash</DialogTitle>
            <DialogDescription>
              {shift.staff_name}&apos;s shift on till {shift.device_code}.
              {allSent
                ? ""
                : " The X report and closing the shift wait until the till is online and everything is sent."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(CASH_MOVEMENTS) as CashMovementType[]).map((type) => (
              <Button
                key={type}
                variant="outline"
                size="touch"
                className="h-16"
                onClick={() => {
                  setMenuOpen(false);
                  setMovement(type);
                }}
              >
                {CASH_MOVEMENTS[type].label}
              </Button>
            ))}
            <Button
              variant="outline"
              size="touch"
              className="h-16"
              disabled={!canXReport || !allSent}
              onClick={() => {
                setMenuOpen(false);
                void showXReport();
              }}
            >
              X report
            </Button>
            <Button
              size="touch"
              className="h-16"
              disabled={!canClose || !allSent}
              onClick={() => {
                setMenuOpen(false);
                setClosing(true);
              }}
            >
              Close my shift
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {movement ? (
        <CashMovementDialog
          type={movement}
          currency={branch.currency_code}
          onClose={() => setMovement(null)}
          onDone={(message) => {
            setMovement(null);
            setResult(message);
          }}
        />
      ) : null}
      {report ? (
        <ReportDialog
          report={report}
          paperWidth={settings.paperWidth}
          onClose={() => setReport(null)}
        />
      ) : null}
      {closing ? (
        <CloseShiftDialog
          branch={branch}
          settings={settings}
          onClose={() => setClosing(false)}
          onClosed={onShiftClosed}
        />
      ) : null}
    </>
  );
}

function CashMovementDialog({
  type,
  currency,
  onClose,
  onDone,
}: {
  type: CashMovementType;
  currency: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const { engine } = useOffline();
  const outboxDeps = useOutboxDeps();
  const [supabase] = useState(createClient);
  const info = CASH_MOVEMENTS[type];
  const allowed = usePermission(info.permission);
  // One id for this movement, so sending it again never records it twice.
  const [id] = useState(() => crypto.randomUUID());
  const [amountInput, setAmountInput] = useState("");
  const [reason, setReason] = useState("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function amount(): number | null {
    if (!info.hasAmount) return 0;
    try {
      const value = parseMoney(amountInput, currency);
      return value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const value = amount();
    if (value === null) {
      setError("Enter an amount.");
      return;
    }
    if (info.reasonRequired && !reason.trim()) {
      setError("Give a reason.");
      return;
    }
    if (allowed) void record(value);
    else setApprovalOpen(true);
  }

  async function record(
    value: number,
    approval?: { overrideId: string; approverName: string; offline?: boolean },
  ) {
    setBusy(true);
    setError(null);
    const args = {
      p_session_id: session.sessionId,
      p_movement: {
        id,
        type,
        amount: value,
        reason: reason.trim() || null,
        override_id: approval?.overrideId ?? null,
        client_created_at: new Date().toISOString(),
      },
    };
    let queued = session.offline === true || !engine.canSendDirectly();
    if (!queued) {
      const { error: rpcError } = await supabase.rpc(
        "record_cash_movement",
        args,
      );
      if (isSessionEndedError(rpcError)) {
        setBusy(false);
        lock("Your session ended. Sign in again.");
        return;
      }
      if (rpcError && isReadableError(rpcError)) {
        setBusy(false);
        setError(rpcErrorMessage(rpcError));
        return;
      }
      // Couldn't reach the server: keep it for later (same id, so it can't
      // be recorded twice).
      if (rpcError) {
        engine.reportReachable(false);
        queued = true;
      }
    }
    if (queued) {
      await engine.enqueue({
        id,
        kind: "record_cash_movement",
        args,
        label:
          type === "no_sale"
            ? "No sale"
            : `${info.label} of ${formatAmount(value, currency)}`,
        staffId: session.staff.id,
        dependsOn: [
          ...outboxDeps,
          ...(approval?.offline ? [approval.overrideId] : []),
        ],
      });
    }
    setBusy(false);
    void getPrinterDriver().openDrawer();
    const approved = approval ? `, approved by ${approval.approverName}` : "";
    const later = queued
      ? " It will be sent when the till is back online."
      : "";
    onDone(
      type === "no_sale"
        ? `No sale recorded${approved}. The drawer is open.${later}`
        : `${info.label} of ${formatAmount(value, currency)} recorded${approved}.${later}`,
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{info.label}</DialogTitle>
          <DialogDescription>{DESCRIPTIONS[type]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {info.hasAmount ? (
            <Field id={fid("amount")} label="Amount">
              <Input
                id={fid("amount")}
                inputMode="decimal"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="h-14 text-2xl"
                autoComplete="off"
                autoFocus
              />
            </Field>
          ) : null}
          <Field
            id={fid("reason")}
            label={info.reasonRequired ? "Reason" : "Reason (optional)"}
          >
            <Input
              id={fid("reason")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-12 text-base"
              maxLength={200}
              autoComplete="off"
              autoFocus={!info.hasAmount}
            />
          </Field>
          {error ? (
            <Alert variant="destructive" aria-live="polite">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" size="touch" disabled={busy}>
            {busy ? "Saving…" : `Record ${info.label.toLowerCase()}`}
          </Button>
        </form>
        <ManagerOverride
          open={approvalOpen}
          onOpenChange={setApprovalOpen}
          permission={info.permission}
          actionLabel={info.action}
          reason={reason.trim()}
          onApproved={(approval) => {
            const value = amount();
            if (value !== null) void record(value, approval);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The blind count: the cashier never sees what the drawer should hold. */
function CloseShiftDialog({
  branch,
  settings,
  onClose,
  onClosed,
}: {
  branch: Branch;
  settings: TillSettings;
  onClose: () => void;
  onClosed: (closed: ShiftSummary) => void;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const [count, setCount] = useState<CashCount>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = countTotal(count);
  const money = (amount: number) => formatAmount(amount, branch.currency_code);

  async function close() {
    setBusy(true);
    setError(null);
    const payload = toCountPayload(count);
    const { data, error: rpcError } = await supabase.rpc("close_shift", {
      p_session_id: session.sessionId,
      p_counted_denominations: payload,
    });
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError(rpcErrorMessage(rpcError));
      setConfirming(false);
      return;
    }
    const closed = data as ShiftSummary;
    void getPrinterDriver().print(
      [{ kind: "shift_close", shift: closed, count: payload, branch }],
      settings.paperWidth,
    );
    onClosed(closed);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[94dvh] w-[min(56rem,97vw)] max-w-none flex-col gap-4 overflow-y-auto p-5 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-2xl">Close your shift</DialogTitle>
          <DialogDescription className="text-base">
            Count all the cash in the drawer, float included. The till
            doesn&apos;t show what it expects: your manager checks the count.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription className="text-base">{error}</AlertDescription>
          </Alert>
        ) : null}
        {confirming ? (
          <div className="flex flex-col gap-4">
            <p className="text-2xl">
              You counted{" "}
              <strong data-testid="close-shift-total">{money(total)}</strong>.
              Closing the shift can&apos;t be undone.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="touch"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Back to counting
              </Button>
              <Button size="touch" disabled={busy} onClick={() => void close()}>
                {busy ? "Closing…" : "Close shift"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <CashCountForm
              denominations={settings.denominations}
              currency={branch.currency_code}
              value={count}
              onChange={setCount}
            />
            <Button size="touch" onClick={() => setConfirming(true)}>
              Done counting
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
