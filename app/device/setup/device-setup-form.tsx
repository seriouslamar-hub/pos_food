"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { registerDevice } from "./actions";

export type SetupBranch = { id: string; name: string };
export type SetupDevice = {
  id: string;
  branchId: string;
  name: string;
  type: "till" | "kds" | "pickup" | "kiosk";
  code: string;
  lastSeenAt: string | null;
};

const typeLabels: Record<SetupDevice["type"], string> = {
  till: "Till",
  kds: "Kitchen display",
  pickup: "Pickup board",
  kiosk: "Kiosk",
};

export const DEVICE_ID_STORAGE_KEY = "pos.device_id";

export function DeviceSetupForm({
  branches,
  devices,
  defaultBranchId,
}: {
  branches: SetupBranch[];
  devices: SetupDevice[];
  defaultBranchId: string | null;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(
    defaultBranchId ?? branches[0]?.id ?? "",
  );
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const branchDevices = devices.filter(
    (d) => d.branchId === branchId && d.type !== "kiosk",
  );
  const selected = branchDevices.find((d) => d.id === deviceId) ?? null;

  function setUp() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await registerDevice(selected.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      try {
        localStorage.setItem(DEVICE_ID_STORAGE_KEY, result.deviceId);
      } catch {
        // Storage can be blocked; the device login still works without it.
      }
      router.replace(result.home);
    });
  }

  if (branches.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          There are no active branches yet. An admin needs to create one first.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {branches.length > 1 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="branch">Branch</Label>
          <select
            id="branch"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setDeviceId(null);
            }}
            className="h-12 rounded-lg border bg-background px-3 text-base"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Which device is this?
        </legend>
        {branchDevices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This branch has no devices yet. An admin can add them in Phase
            3&apos;s device page.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {branchDevices.map((device) => (
              <button
                key={device.id}
                type="button"
                aria-pressed={device.id === deviceId}
                onClick={() => setDeviceId(device.id)}
                className={cn(
                  "flex min-h-16 flex-col items-start gap-1 rounded-xl border p-4 text-left transition-colors hover:bg-muted",
                  device.id === deviceId &&
                    "border-primary bg-muted ring-2 ring-primary",
                )}
              >
                <span className="font-medium">
                  {device.name}{" "}
                  <span className="text-muted-foreground">({device.code})</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {typeLabels[device.type]}
                </span>
              </button>
            ))}
          </div>
        )}
      </fieldset>

      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button size="touch" onClick={setUp} disabled={!selected || pending}>
          {pending
            ? "Setting up…"
            : selected
              ? `Set up this browser as ${selected.name}`
              : "Choose a device"}
        </Button>
        <p className="text-sm text-muted-foreground">
          You&apos;ll be signed out of the back office on this browser. It stays
          signed in as the device, even after a restart.
        </p>
      </div>
    </div>
  );
}
