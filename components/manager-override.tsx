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
import { PERMISSION_LABELS, type Permission } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/client";
import {
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
  onApproved,
}: ManagerOverrideProps) {
  const fid = useFieldIds();
  const { session, lock } = useTillSession();
  const [supabase] = useState(createClient);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reasonMissing = requireReason && reason.trim().length === 0;

  function changeOpen(next: boolean) {
    if (!next) {
      setReason("");
      setError(null);
    }
    onOpenChange(next);
  }

  async function approve(pin: string) {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("verify_override", {
      p_session_id: session.sessionId,
      p_pin: pin,
      p_permission: permission,
      p_reason: reason.trim() || undefined,
    });
    if (isSessionEndedError(rpcError)) {
      changeOpen(false);
      lock("Your session ended. Sign in again.");
      return;
    }
    if (rpcError) {
      setError("Couldn't check the PIN. Check the connection and try again.");
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
          {requireReason ? (
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
