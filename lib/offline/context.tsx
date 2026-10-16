"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { tillDb, type TillDb } from "./db";
import { SyncEngine, type RpcCall, type SyncState } from "./sync";

type Offline = { db: TillDb; engine: SyncEngine; deviceCode: string };

const OfflineContext = createContext<Offline | null>(null);

/** The till's local database and outbox sync, for everything under it. */
export function OfflineProvider({
  deviceId,
  deviceCode,
  children,
}: {
  deviceId: string;
  deviceCode: string;
  children: ReactNode;
}) {
  const [value] = useState<Offline>(() => {
    const supabase = createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as RpcCall;
    const db = tillDb(deviceId);
    return { db, engine: new SyncEngine(db, rpc), deviceCode };
  });

  useEffect(() => {
    value.engine.start();
    return () => value.engine.stop();
  }, [value]);

  return (
    <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
  );
}

export function useOffline(): Offline {
  const value = useContext(OfflineContext);
  if (!value) throw new Error("useOffline needs an <OfflineProvider>");
  return value;
}

const SERVER_STATE: SyncState = {
  online: true,
  pending: 0,
  failed: 0,
  syncing: false,
};

export function useSyncState(): SyncState {
  const { engine } = useOffline();
  return useSyncExternalStore(
    engine.subscribe,
    engine.getState,
    () => SERVER_STATE,
  );
}

const OutboxDepsContext = createContext<string[]>([]);

/**
 * Outbox items that what's done below needs first: the offline sign-in and
 * an offline-opened shift, while they haven't been sent.
 */
export function OutboxDepsProvider({
  deps,
  children,
}: {
  deps: string[];
  children: ReactNode;
}) {
  return (
    <OutboxDepsContext.Provider value={deps}>
      {children}
    </OutboxDepsContext.Provider>
  );
}

export function useOutboxDeps(): string[] {
  return useContext(OutboxDepsContext);
}
