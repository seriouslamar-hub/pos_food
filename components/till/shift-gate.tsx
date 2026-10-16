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
import { OutboxDepsProvider, useOffline } from "@/lib/offline/context";
import { readCache, writeCache, type TillDb } from "@/lib/offline/db";
import { createClient } from "@/lib/supabase/client";
import {
  isReadableError,
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
  | { status: "ready"; till: TillState; offline: boolean };

/**
 * The day and this person's shift as last seen online, for working offline.
 * Null when the till has never seen them.
 */
async function cachedTillState(
  db: TillDb,
  staffId: string,
): Promise<TillState | null> {
  const day = await readCache<{ day: DaySummary | null }>(db, "day");
  if (!day) return null;
  const shift = await readCache<{ shift: ShiftSummary | null }>(
    db,
    `shift:${staffId}`,
  );
  return { day: day.day, shift: shift?.shift ?? null };
}

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
  const { db, engine } = useOffline();
  const [supabase] = useState(createClient);
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [zReport, setZReport] = useState<SalesReport | null>(null);

  // Bumped to check the day and shift again (after opening or closing).
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let current = true;
    const offline = () =>
      void cachedTillState(db, session.staff.id).then((till) => {
        if (!current) return;
        setState(
          till
            ? { status: "ready", till, offline: true }
            : {
                status: "error",
                message:
                  "This till is offline and hasn't seen today's business day yet. Connect it to start.",
              },
        );
      });
    if (session.offline || !engine.getState().online) {
      offline();
      return () => {
        current = false;
      };
    }
    void supabase
      .rpc("till_state", { p_session_id: session.sessionId })
      .then(({ data, error }) => {
        if (!current) return;
        if (isSessionEndedError(error)) {
          lock("Your session ended. Sign in again.");
          return;
        }
        if (error && !isReadableError(error)) {
          engine.reportReachable(false);
          offline();
          return;
        }
        if (error) {
          setState({ status: "error", message: rpcErrorMessage(error) });
          return;
        }
        const till = parseTillState(data);
        void writeCache(db, "day", { day: till.day });
        void writeCache(db, `shift:${session.staff.id}`, { shift: till.shift });
        setState({ status: "ready", till, offline: false });
      });
    return () => {
      current = false;
    };
  }, [supabase, db, engine, session, lock, version]);

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
          {state.offline
            ? "The till is offline. The day can be opened once the connection is back."
            : "A manager opens the day before anyone starts a shift."}
        </p>
        {state.offline ? (
          <Button size="touch" onClick={reload}>
            Check again
          </Button>
        ) : (
          <DayControlButton
            action="open"
            onDone={reload}
            className="w-full max-w-sm"
          />
        )}
      </Centered>
    );
  } else if (!state.till.shift) {
    content = (
      <OpenShift
        day={state.till.day}
        branch={branch}
        settings={settings}
        offline={state.offline}
        onOpened={reload}
        onDayClosed={(report) => {
          setZReport(report);
          reload();
        }}
      />
    );
  } else {
    const deps = [
      ...(session.offline ? [session.sessionId] : []),
      ...(state.till.shift.outbox_item_id
        ? [state.till.shift.outbox_item_id]
        : []),
    ];
    content = (
      <OutboxDepsProvider deps={deps}>
        {children(state.till.shift, reload)}
      </OutboxDepsProvider>
    );
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
  offline,
  onOpened,
  onDayClosed,
}: {
  day: DaySummary;
  branch: Branch;
  settings: TillSettings;
  offline: boolean;
  onOpened: () => void;
  onDayClosed: (report: SalesReport) => void;
}) {
  const { session, lock } = useTillSession();
  const { db, engine, deviceCode } = useOffline();
  const [supabase] = useState(createClient);
  const [count, setCount] = useState<CashCount>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = countTotal(count);
  const money = (amount: number) => formatAmount(amount, branch.currency_code);

  /** Offline: the shift opens on the till and reaches the server later. */
  async function openOffline() {
    const itemId = crypto.randomUUID();
    const openedAt = new Date().toISOString();
    await engine.enqueue({
      id: itemId,
      kind: "open_shift",
      args: {
        p_session_id: session.sessionId,
        p_opening_float: total,
        p_denominations: toCountPayload(count),
        p_opened_at: openedAt,
      },
      label: `${session.staff.fullName} opened a shift`,
      staffId: session.staff.id,
      dependsOn: session.offline ? [session.sessionId] : [],
    });
    const shift: ShiftSummary = {
      id: itemId,
      business_day_id: day.id,
      business_date: day.business_date,
      staff_id: session.staff.id,
      staff_name: session.staff.fullName,
      device_code: deviceCode,
      status: "open",
      opened_at: openedAt,
      closed_at: null,
      opening_float: total,
      counted_cash: null,
      outbox_item_id: itemId,
    };
    await writeCache(db, `shift:${session.staff.id}`, { shift });
    onOpened();
  }

  async function open() {
    setBusy(true);
    setError(null);
    if (offline || !engine.canSendDirectly()) {
      await openOffline();
      setBusy(false);
      return;
    }
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
    if (rpcError && !isReadableError(rpcError)) {
      engine.reportReachable(false);
      await openOffline();
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
        {offline ? null : (
          <CloseDay
            branch={branch}
            denominations={settings.denominations}
            paperWidth={settings.paperWidth}
            onClosed={onDayClosed}
          />
        )}
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
