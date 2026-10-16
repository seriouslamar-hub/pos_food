"use client";

import { useState, useTransition } from "react";
import { FormError } from "@/components/admin/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setDeviceTraining } from "@/lib/actions/devices";

/** Training mode for one device: practice sales go to a training branch. */
export function TrainingPanel({
  deviceId,
  training,
  homeBranchName,
}: {
  deviceId: string;
  training: boolean;
  homeBranchName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setDeviceTraining(deviceId, !training);
      if (!result.ok) setError(result.error);
    });
  }
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-4"
      data-testid="training-panel"
    >
      <div className="flex flex-wrap items-center gap-3">
        {training ? (
          <Badge variant="destructive">Training mode on</Badge>
        ) : (
          <Badge variant="outline">Live</Badge>
        )}
        <p className="text-sm text-muted-foreground">
          In training, the device sells into “{homeBranchName} (training)”:
          staff practise with their own PINs, and nothing counts in{" "}
          {homeBranchName}&apos;s reports, cash, stock, customers&apos; points
          or coupon limits. Receipts say TRAINING. Close any open shift on the
          device first; its till signs out.
        </p>
      </div>
      <FormError message={error} />
      <div>
        <Button
          variant={training ? "default" : "outline"}
          size="lg"
          disabled={pending}
          onClick={toggle}
        >
          {pending
            ? "Switching…"
            : training
              ? "Back to live selling"
              : "Switch to training mode"}
        </Button>
      </div>
    </div>
  );
}
