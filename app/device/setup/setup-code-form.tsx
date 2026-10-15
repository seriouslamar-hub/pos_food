"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeSetupCode } from "@/lib/setup-code";
import { redeemSetupCode } from "./actions";
import { DEVICE_ID_STORAGE_KEY } from "./device-setup-form";

/** Enter the one-time code an admin got when they created this device. */
export function SetupCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!normalizeSetupCode(code)) {
      setError("Enter the 10-character code, like K7QM2-XH9PD.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await redeemSetupCode(code);
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Label htmlFor="setup-code">Setup code</Label>
      <Input
        id="setup-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="XXXXX-XXXXX"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="h-14 font-mono text-2xl tracking-widest uppercase"
      />
      {error ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" size="touch" disabled={pending}>
        {pending ? "Setting up…" : "Set up this device"}
      </Button>
    </form>
  );
}
