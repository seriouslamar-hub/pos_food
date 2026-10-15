"use client";

import { LockIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PinKeypad } from "@/components/pin-keypad";
import { PrintHost } from "@/components/print-host";
import { OrderScreen } from "@/components/till/order-screen";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  parseStartSession,
  pinFailureMessage,
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
  settings: TillSettings;
};

export function TillApp({
  branchId,
  deviceId,
  deviceName,
  deviceCode,
  branchName,
  settings,
}: TillAppProps) {
  const { autoLockMinutes } = settings;
  const [supabase] = useState(createClient);
  const [session, setSession] = useState<TillSession | null>(null);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = session?.sessionId ?? null;
  }, [session]);

  // Tell head office this till is online (shown on the admin devices page).
  useEffect(() => {
    const beat = () => void supabase.rpc("device_heartbeat");
    beat();
    const timer = setInterval(beat, 60_000);
    return () => clearInterval(timer);
  }, [supabase]);

  const lock = useCallback(
    (reason?: string) => {
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        sessionIdRef.current = null;
        // Best effort: the next PIN sign-in ends it anyway.
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
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <span className="font-semibold">
          {branchName} · {deviceName} ({deviceCode})
        </span>
        {session ? (
          <SignedInBar session={session} onSwitch={() => lock()} />
        ) : null}
      </header>

      {session ? (
        <TillSessionProvider session={session} lock={lock}>
          <OrderScreen
            branchId={branchId}
            deviceId={deviceId}
            settings={settings}
          />
        </TillSessionProvider>
      ) : (
        <LockScreen
          notice={lockNotice}
          onUnlocked={(next) => {
            setLockNotice(null);
            setSession(next);
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

function LockScreen({
  notice,
  onUnlocked,
}: {
  notice: string | null;
  onUnlocked: (session: TillSession) => void;
}) {
  const [supabase] = useState(createClient);
  const [error, setError] = useState<string | null>(null);
  const [lockedFor, setLockedFor] = useState(0);

  // Count down a lockout, then let the cashier try again.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setTimeout(() => setLockedFor((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockedFor]);

  async function signIn(pin: string) {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("start_pos_session", {
      p_pin: pin,
    });
    if (rpcError) {
      setError("Couldn't check the PIN. Check the connection and try again.");
      return;
    }
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
