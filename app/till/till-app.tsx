"use client";

import { LockIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PinKeypad } from "@/components/pin-keypad";
import { PrintHost } from "@/components/print-host";
import { OrderScreen } from "@/components/till/order-screen";
import { ShiftGate } from "@/components/till/shift-gate";
import { SyncBadge } from "@/components/till/sync-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  OfflineProvider,
  useOffline,
  useSyncState,
} from "@/lib/offline/context";
import { raiseOfflineCounter, readCache, writeCache } from "@/lib/offline/db";
import {
  findStaffByPin,
  OfflineLockout,
  parseOfflineBundle,
  type OfflineBundle,
} from "@/lib/offline/pin";
import { can } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import {
  isReadableError,
  parseStartSession,
  pinFailureMessage,
  type StaffRole,
  type TillSession,
  type TillSettings,
} from "@/lib/till";
import { TillSessionProvider } from "@/lib/till-session";
import { useIdleTimer } from "@/lib/use-idle-timer";

type TillAppProps = {
  branchId: string;
  deviceId: string;
  deviceName: string;
  deviceCode: string;
  branchName: string;
  currency: string;
  timezone: string;
  settings: TillSettings;
};

export function TillApp(props: TillAppProps) {
  return (
    <OfflineProvider deviceId={props.deviceId} deviceCode={props.deviceCode}>
      <TillShell {...props} />
    </OfflineProvider>
  );
}

const TEN_MINUTES = 10 * 60_000;

function TillShell({
  branchId,
  deviceId,
  deviceName,
  deviceCode,
  branchName,
  currency,
  timezone,
  settings,
}: TillAppProps) {
  const { autoLockMinutes } = settings;
  const [supabase] = useState(createClient);
  const { db, engine } = useOffline();
  const sync = useSyncState();
  const [session, setSession] = useState<TillSession | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const offlineRef = useRef(false);
  useEffect(() => {
    sessionIdRef.current = session?.sessionId ?? null;
    offlineRef.current = session?.offline ?? false;
  }, [session]);

  // Tell head office this till is online and how much it still has to send
  // (shown on the admin devices page).
  const pending = sync.pending + sync.failed;
  useEffect(() => {
    const beat = () =>
      void supabase.rpc("device_heartbeat", { p_pending: pending });
    beat();
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [supabase, pending]);

  // Keep who can sign in (with PIN hashes) for signing in offline: on start,
  // when the connection comes back, and every ten minutes.
  useEffect(() => {
    if (!sync.online) return;
    const refresh = () =>
      void supabase.rpc("get_offline_bundle").then(({ data, error }) => {
        const bundle = error ? null : parseOfflineBundle(data);
        if (!bundle) return;
        void writeCache(db, "bundle", bundle);
        if (bundle.offline_numbers)
          void raiseOfflineCounter(
            db,
            bundle.offline_numbers.business_date,
            bundle.offline_numbers.last,
          );
      });
    refresh();
    const timer = setInterval(refresh, TEN_MINUTES);
    return () => clearInterval(timer);
  }, [supabase, db, sync.online]);

  const lock = useCallback(
    (reason?: string) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        sessionIdRef.current = null;
        // Best effort: the next PIN sign-in ends it anyway. (Offline
        // sessions are never open on the server.)
        if (!offlineRef.current)
          void supabase.rpc("end_pos_session", { p_session_id: sessionId });
      }
      setSession(null);
      setLockNotice(reason ?? null);
    },
    [supabase],
  );

  useIdleTimer(
    autoLockMinutes * 60_000,
    () =>
      lock(`Locked after ${formatMinutes(autoLockMinutes)} without activity.`),
    session !== null,
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <span className="font-semibold">
          {branchName} · {deviceName} ({deviceCode})
        </span>
        <div className="flex items-center gap-3">
          <SyncBadge
            canDiscard={
              session !== null && can(session.permissions, "shift.reconcile")
            }
          />
          {session ? (
            <SignedInBar session={session} onSwitch={() => lock()} />
          ) : null}
        </div>
      </header>

      {session ? (
        <TillSessionProvider session={session} lock={lock}>
          <ShiftGate
            branch={{ name: branchName, currency_code: currency, timezone }}
            settings={settings}
          >
            {(shift, reload) => (
              <OrderScreen
                branchId={branchId}
                deviceId={deviceId}
                settings={settings}
                shift={shift}
                onShiftEnded={reload}
              />
            )}
          </ShiftGate>
        </TillSessionProvider>
      ) : (
        <LockScreen
          notice={lockNotice}
          onUnlocked={(next) => {
            setLockNotice(null);
            setSession(next);
          }}
          offlineSignIn={async (pin) => {
            const bundle = await readCache<OfflineBundle>(db, "bundle");
            if (!bundle) return { error: "offline_unavailable" as const };
            const person = await findStaffByPin(
              bundle.staff,
              pin,
              (s) =>
                s.permissions.includes("order.create") || s.role === "admin",
            );
            if (!person) return { error: "invalid_pin" as const };
            const sessionId = crypto.randomUUID();
            await engine.enqueue({
              id: sessionId,
              kind: "start_offline_session",
              args: {
                p_session_id: sessionId,
                p_staff_id: person.id,
                p_started_at: new Date().toISOString(),
              },
              label: `${person.full_name} signed in offline`,
              staffId: person.id,
            });
            return {
              session: {
                sessionId,
                offline: true,
                staff: {
                  id: person.id,
                  fullName: person.full_name,
                  role: person.role as StaffRole,
                  discountLimitBps: person.discount_limit_bps,
                },
                permissions: person.permissions,
              },
            };
          }}
        />
      )}
      <PrintHost />
    </div>
  );
}

function formatMinutes(minutes: number) {
  if (minutes < 1) return `${Math.round(minutes * 60)} seconds`;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function SignedInBar({
  session,
  onSwitch,
}: {
  session: TillSession;
  onSwitch: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-lg" data-testid="till-staff-name">
        {session.staff.fullName}
      </span>
      <Badge variant="secondary" className="capitalize">
        {session.staff.role}
      </Badge>
      <Button size="touch" variant="outline" onClick={onSwitch}>
        <LockIcon />
        Switch user
      </Button>
    </div>
  );
}

type OfflineSignIn = (
  pin: string,
) => Promise<
  { session: TillSession } | { error: "invalid_pin" | "offline_unavailable" }
>;

function LockScreen({
  notice,
  onUnlocked,
  offlineSignIn,
}: {
  notice: string | null;
  onUnlocked: (session: TillSession) => void;
  offlineSignIn: OfflineSignIn;
}) {
  const [supabase] = useState(createClient);
  const { engine } = useOffline();
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState(0);
  const [lockout] = useState(() => new OfflineLockout());

  // Count down a lockout, then let the cashier try again.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setTimeout(() => setLockedFor((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockedFor]);

  /** No connection: check the PIN against the hashes kept on the till. */
  async function signInOffline(pin: string) {
    const now = Date.now();
    const wait = lockout.lockedFor(now);
    if (wait) {
      setLockedFor(wait);
      return;
    }
    const result = await offlineSignIn(pin);
    if ("session" in result) {
      lockout.succeed();
      onUnlocked(result.session);
      return;
    }
    if (result.error === "offline_unavailable") {
      setError(
        "This till is offline and hasn't kept anyone's PIN yet. Connect it once first.",
      );
      return;
    }
    lockout.fail(now);
    const locked = lockout.lockedFor(now);
    if (locked) setLockedFor(locked);
    else setError("Wrong PIN. Try again.");
  }

  async function signIn(pin: string) {
    setError(null);
    if (!engine.getState().online) return signInOffline(pin);
    const { data, error: rpcError } = await supabase.rpc("start_pos_session", {
      p_pin: pin,
    });
    if (rpcError && !isReadableError(rpcError)) {
      engine.reportReachable(false);
      return signInOffline(pin);
    }
    if (rpcError) {
      setError("Couldn't check the PIN. Try again.");
      return;
    }
    engine.reportReachable(true);
    const result = parseStartSession(data);
    if (!result.ok) {
      setError(pinFailureMessage(result));
      if (result.error === "locked_out") setLockedFor(result.retryAfterSeconds);
      return;
    }
    onUnlocked({
      sessionId: result.sessionId,
      staff: result.staff,
      permissions: result.permissions,
    });
  }

  const message =
    lockedFor > 0
      ? pinFailureMessage({
          ok: false,
          error: "locked_out",
          retryAfterSeconds: lockedFor,
        })
      : error;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">Enter your PIN</h1>
      <div className="min-h-14 w-full max-w-xs">
        {message ? (
          <Alert variant="destructive" aria-live="polite">
            <AlertDescription
              className="text-base"
              data-testid="till-pin-error"
            >
              {message}
            </AlertDescription>
          </Alert>
        ) : notice ? (
          <Alert aria-live="polite">
            <AlertDescription className="text-base">{notice}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <PinKeypad
        onSubmit={signIn}
        disabled={lockedFor > 0}
        submitLabel="Sign in"
      />
    </main>
  );
}
