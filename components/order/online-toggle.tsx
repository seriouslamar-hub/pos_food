"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/** Pause or resume online ordering at the branch (busy times, closing). */
export function OnlineOrderingToggle({
  branchId,
  paused: initial,
}: {
  branchId: string;
  paused: boolean;
}) {
  const [supabase] = useState(createClient);
  const [paused, setPaused] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("set_online_ordering", {
      p_branch_id: branchId,
      p_paused: !paused,
    });
    setBusy(false);
    if (e) return setError(e.message);
    setPaused((data as { paused: boolean }).paused);
  }
  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-xl border p-4"
      aria-label="Online ordering"
      data-testid="online-toggle"
    >
      <span className="font-semibold">Online ordering</span>
      {paused ? (
        <Badge variant="destructive">Paused</Badge>
      ) : (
        <Badge>Taking orders</Badge>
      )}
      <Button
        size="lg"
        variant={paused ? "default" : "outline"}
        disabled={busy}
        onClick={() => void toggle()}
      >
        {paused ? "Resume online orders" : "Pause online orders"}
      </Button>
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </section>
  );
}
