"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyAvailability,
  parseMenu,
  type AvailabilityChange,
  type MenuDoc,
} from "@/lib/menu";
import { createClient } from "@/lib/supabase/client";

/**
 * The branch menu, kept current through Supabase Realtime: out-of-stock
 * changes apply at once, and any menu change triggers a quiet reload. The
 * menu is reloaded whenever the connection (re)subscribes, so nothing missed
 * while offline is lost.
 */
export function useLiveMenu(branchId: string, initial: MenuDoc | null = null) {
  const [supabase] = useState(createClient);
  const [menu, setMenu] = useState<MenuDoc | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_menu", {
      p_branch_id: branchId,
    });
    if (rpcError) {
      setError("Couldn't load the menu. Check the connection.");
      return;
    }
    try {
      setMenu(parseMenu(data));
      setError(null);
    } catch {
      setError("The menu couldn't be read.");
    }
  }, [supabase, branchId]);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => void load(), 800);
  }, [load]);

  useEffect(() => {
    const channel = supabase
      .channel(`menu-${branchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "branch_menu_items",
          filter: `branch_id=eq.${branchId}`,
        },
        (payload) => {
          const row = payload.new as {
            menu_item_id?: string;
            is_available?: boolean;
          };
          if (row?.menu_item_id && typeof row.is_available === "boolean") {
            const change = {
              kind: "item" as const,
              id: row.menu_item_id,
              isAvailable: row.is_available,
            };
            setMenu((current) => current && applyAvailability(current, change));
          }
          scheduleReload();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "branch_modifiers",
          filter: `branch_id=eq.${branchId}`,
        },
        (payload) => {
          const row = payload.new as {
            modifier_id?: string;
            is_available?: boolean;
          };
          if (row?.modifier_id && typeof row.is_available === "boolean") {
            const change = {
              kind: "modifier" as const,
              id: row.modifier_id,
              isAvailable: row.is_available,
            };
            setMenu((current) => current && applyAvailability(current, change));
          }
          scheduleReload();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items" },
        scheduleReload,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "modifiers" },
        scheduleReload,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
      });

    return () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [supabase, branchId, load, scheduleReload]);

  /** Shows a change straight away (before the server confirms it). */
  const apply = useCallback((change: AvailabilityChange) => {
    setMenu((current) => current && applyAvailability(current, change));
  }, []);

  return { menu, error, reload: load, apply };
}
