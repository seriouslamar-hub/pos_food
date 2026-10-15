"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { countTotal, toCountPayload, type CashCount } from "@/lib/cash";
import { formatInZone } from "@/lib/datetime";
import { formatAmount } from "@/lib/money";
import {
  DAY_NOT_OPEN_CODE,
  parseTillState,
  type DaySummary,
  type SalesReport,
  type ShiftSummary,
  type TillState,
} from "@/lib/shifts";
import { createClient } from "@/lib/supabase/client";
import {
  isSessionEndedError,
  rpcErrorMessage,
  type TillSettings,
} from "@/lib/till";
import { useTillSession } from "@/lib/till-session";
import { CashCountForm } from "./cash-count";
import { CloseDay, DayControlButton } from "./day-control";
import { ReportDialog } from "./report-dialog";

type Branch = { name: string; currency_code: string; timezone: string };

type GateState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; till: TillState };

/**
 * Selling needs an open business day and the cashier's own open shift on
 * this till. Until both exist this shows the steps to get there; then it
 * renders the till with the shift.
 */
export function ShiftGate({
  branch,
  settings,
  children,
}: {
  branch: Branch;
  settings: TillSettings;
  children: (shift: ShiftSummary, reload: () => void) => ReactNode;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [zReport, setZReport] = useState<SalesReport | null>(null);

  // Bumped to check the day and shift again (after opening or closing).
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let current = true;
    void supabase
      .rpc("till_state", { p_session_id: session.sessionId })
      .then(({ data, error }) => {
        if (!current) return;
        if (isSessionEndedError(error)) {
          lock("Your session ended. Sign in again.");
          return;
        }
        setState(
          error
            ? { status: "error", message: rpcErrorMessage(error) }
            : { status: "ready", till: parseTillState(data) },
        );
      });
    return () => {
      current = false;
    };
  }, [supabase, session.sessionId, lock, version]);

  let content: ReactNode;
  if (state.status === "loading") {
    content = (
      <Centered>
        <p className="text-lg text-muted-foreground">Checking your shift…</p>
      </Centered>
    );
  } else if (state.status === "error") {
    content = (
      <Centered>
        <Alert variant="destructive" className="max-w-md">
          <AlertDescription className="text-base">
            {state.message}
          </AlertDescription>
        </Alert>
        <Button size="touch" onClick={reload}>
          Try again
        </Button>
      </Centered>
    );
  } else if (!state.till.day) {
    content = (
      <Centered>
        <h1 className="text-3xl font-semibold">
          The business day isn&apos;t open
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          A manager opens the day before anyone starts a shift.
        </p>
        <DayControlButton
          action="open"
          onDone={reload}
          className="w-full max-w-sm"
        />
      </Centered>
    );
  } else if (!state.till.shift) {
    content = (
      <OpenShift
        day={state.till.day}
        branch={branch}
        settings={settings}
        onOpened={reload}
        onDayClosed={(report) => {
          setZReport(report);
          reload();
        }}
      />
    );
  } else {
    content = children(state.till.shift, reload);
  }

  return (
    <>
      {content}
      {zReport ? (
        <ReportDialog
          report={zReport}
          paperWidth={settings.paperWidth}
          onClose={() => setZReport(null)}
        />
      ) : null}
    </>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      {children}
    </main>
  );
}

/** Counting the float and opening the cashier's shift. */
function OpenShift({
  day,
  branch,
  settings,
  onOpened,
  onDayClosed,
}: {
  day: DaySummary;
  branch: Branch;
  settings: TillSettings;
  onOpened: () => void;
  onDayClosed: (report: SalesReport) => void;
}) {
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const [count, setCount] = useState<CashCount>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = countTotal(count);
  const money = (amount: number) => formatAmount(amount, branch.currency_code);

  async function open() {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("open_shift", {
      p_session_id: session.sessionId,
      p_opening_float: total,
      p_denominations: toCountPayload(count),
    });
    setBusy(false);
    if (isSessionEndedError(rpcError)) {
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError && rpcError.code !== DAY_NOT_OPEN_CODE) {
      setError(rpcErrorMessage(rpcError));
      return;
    }
    // Opened, or the day was closed meanwhile: either way, check again.
    onOpened();
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Open your shift</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Count the float in the drawer: the cash you start with for giving
            change. Business day{" "}
            {formatInZone(`${day.business_date}T12:00:00Z`, "UTC", {
              dateStyle: "medium",
            })}
            , opened by {day.opened_by_name ?? "a manager"} at{" "}
            {formatInZone(day.opened_at, branch.timezone, {
              timeStyle: "short",
            })}
            .
          </p>
        </div>
        <CloseDay
          branch={branch}
          denominations={settings.denominations}
          paperWidth={settings.paperWidth}
          onClosed={onDayClosed}
        />
      </div>
      <CashCountForm
        denominations={settings.denominations}
        currency={branch.currency_code}
        value={count}
        onChange={setCount}
        disabled={busy}
      />
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription className="text-base">{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        size="touch"
        className="h-16 text-xl"
        disabled={busy}
        onClick={() => void open()}
      >
        {busy
          ? "Opening…"
          : total
            ? `Open shift with ${money(total)}`
            : "Open shift with no float"}
      </Button>
    </main>
  );
}
