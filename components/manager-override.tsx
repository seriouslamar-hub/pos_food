"use client";

import { useState } from "react";
import { PinKeypad } from "@/components/pin-keypad";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOffline, useOutboxDeps } from "@/lib/offline/context";
import { readCache } from "@/lib/offline/db";
import { findStaffByPin, type OfflineBundle } from "@/lib/offline/pin";
import { PERMISSION_LABELS, type Permission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import {
  isReadableError,
  isSessionEndedError,
  parseOverride,
  pinFailureMessage,
  type OverrideApproval,
} from "@/lib/till";
import { useTillSession } from "@/lib/till-session";
import { useFieldIds } from "@/lib/use-field-ids";

type ManagerOverrideProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permission: Permission;
  /** What the cashier is trying to do, e.g. "Open the drawer without a sale". */
  actionLabel: string;
  requireReason?: boolean;
  /**
   * A reason the cashier already gave in the action's own form. It's sent
   * with the approval (so the audit log has it) instead of asking again.
   */
  reason?: string;
  onApproved: (approval: OverrideApproval) => void;
};

/**
 * Asks someone with the permission (usually a manager) to approve one action
 * with their PIN. The approval is valid for 2 minutes and can be used once:
 * pass approval.overrideId to the RPC that performs the action.
 */
export function ManagerOverride({
  open,
  onOpenChange,
  permission,
  actionLabel,
  requireReason = false,
  reason: givenReason,
  onApproved,
}: ManagerOverrideProps) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const { db, engine } = useOffline();
  const deps = useOutboxDeps();
  const [supabase] = useState(createClient);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const askReason = requireReason && givenReason === undefined;
  const reasonMissing = askReason && reason.trim().length === 0;

  function changeOpen(next: boolean) {
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  }

  /** Offline: check the PIN on the till; the server records it later. */
  async function approveOffline(pin: string) {
    const bundle = await readCache<OfflineBundle>(db, "bundle");
    if (!bundle) {
      setError("The till is offline and hasn't kept anyone's PIN yet.");
      return;
    }
    const approver = await findStaffByPin(
      bundle.staff,
      pin,
      (s) => s.role === "admin" || s.permissions.includes(permission),
    );
    if (!approver) {
      const someone = await findStaffByPin(bundle.staff, pin);
      setError(
        someone
          ? "That PIN can't approve this. Ask a manager."
          : "Wrong PIN. Try again.",
      );
      return;
    }
    const overrideId = crypto.randomUUID();
    const reasonText = (givenReason ?? reason).trim();
    await engine.enqueue({
      id: overrideId,
      kind: "record_offline_override",
      args: {
        p_override_id: overrideId,
        p_session_id: session.sessionId,
        p_approver_staff_id: approver.id,
        p_permission: permission,
        p_reason: reasonText || null,
        p_approved_at: new Date().toISOString(),
      },
      label: `${approver.full_name} approved: ${actionLabel}`,
      staffId: session.staff.id,
      dependsOn: deps,
    });
    changeOpen(false);
    onApproved({
      ok: true,
      overrideId,
      approverName: approver.full_name,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      offline: true,
    });
  }

  async function approve(pin: string) {
    setError(null);
    if (session.offline || !engine.getState().online)
      return approveOffline(pin);
    const { data, error: rpcError } = await supabase.rpc("verify_override", {
      p_session_id: session.sessionId,
      p_pin: pin,
      p_permission: permission,
      p_reason: (givenReason ?? reason).trim() || undefined,
    });
    if (isSessionEndedError(rpcError)) {
      changeOpen(false);
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError && !isReadableError(rpcError)) {
      engine.reportReachable(false);
      return approveOffline(pin);
    }
    if (rpcError) {
      setError("Couldn't check the PIN. Try again.");
      return;
    }
    const result = parseOverride(data);
    if (!result.ok) {
      setError(pinFailureMessage(result));
      return;
    }
    changeOpen(false);
    onApproved(result);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Manager approval</DialogTitle>
          <DialogDescription>
            {actionLabel} needs someone who can “
            {PERMISSION_LABELS[permission].toLowerCase()}” to enter their PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {askReason ? (
            <div className="flex w-full flex-col gap-2">
              <Label htmlFor={fid("override-reason")}>Reason</Label>
              <Input
                id={fid("override-reason")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this needed?"
                className="h-12 text-base"
                autoComplete="off"
              />
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive" aria-live="polite" className="w-full">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <PinKeypad
            onSubmit={approve}
            disabled={reasonMissing}
            submitLabel={reasonMissing ? "Enter a reason first" : "Approve"}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
