"use client";

import { createContext, useContext, useMemo } from "react";
import { can, type Permission } from "@/lib/permissions";
import type { TillSession } from "@/lib/till";

type TillSessionValue = {
  session: TillSession;
  permissions: ReadonlySet<string>;
  /** Ends the session and returns to the lock screen. */
  lock: (reason?: string) => void;
};

const TillSessionContext = createContext<TillSessionValue | null>(null);

export function TillSessionProvider({
  session,
  lock,
  children,
}: {
  session: TillSession;
  lock: (reason?: string) => void;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ session, permissions: new Set(session.permissions), lock }),
    [session, lock],
  );
  return <TillSessionContext value={value}>{children}</TillSessionContext>;
}

export function useTillSession(): TillSessionValue {
  const value = useContext(TillSessionContext);
  if (!value)
    throw new Error("useTillSession must be used inside TillSessionProvider");
  return value;
}

/** True if the signed-in till user has the permission themselves. */
export function usePermission(permission: Permission): boolean {
  return can(useTillSession().permissions, permission);
}
