"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { FormError, SecretPanel } from "@/components/admin/form";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  newSetupCode,
  resetDeviceLogin,
  type SetupCode,
} from "@/lib/actions/devices";

function setupUrl() {
  return typeof window === "undefined"
    ? "/device/setup"
    : `${window.location.origin}/device/setup`;
}

/** Shows a one-time setup code with instructions. */
export function SetupCodePanel({
  deviceName,
  setupCode,
  doneHref,
  onDone,
}: {
  deviceName: string;
  setupCode: SetupCode | null;
  doneHref?: string;
  onDone?: () => void;
}) {
  if (!setupCode) {
    return (
      <div className="flex flex-col gap-3">
        <FormError message="The device was saved, but its setup code couldn't be created. Open the device and choose “New setup code”." />
        {doneHref ? (
          <Link
            href={doneHref}
            className={buttonVariants({ size: "lg", className: "self-start" })}
          >
            Done
          </Link>
        ) : null}
      </div>
    );
  }
  const expires = new Date(setupCode.expiresAt).toLocaleString();
  return (
    <SecretPanel
      title={`Set up ${deviceName}`}
      rows={[
        { label: "Setup code", value: setupCode.code, testId: "setup-code" },
      ]}
    >
      <ol className="list-decimal pl-5 text-sm">
        <li>
          On the device, open <strong>{setupUrl()}</strong>.
        </li>
        <li>Enter the code. It works once, until {expires}.</li>
      </ol>
      {doneHref ? (
        <Link
          href={doneHref}
          className={buttonVariants({ size: "lg", className: "self-start" })}
        >
          Done
        </Link>
      ) : (
        <Button
          variant="outline"
          size="lg"
          className="self-start"
          onClick={onDone}
        >
          Done
        </Button>
      )}
    </SecretPanel>
  );
}

/** Device page tools: a new setup code, or sign the device out everywhere. */
export function DeviceAccessPanel({
  deviceId,
  deviceName,
  isActive,
}: {
  deviceId: string;
  deviceName: string;
  isActive: boolean;
}) {
  const [code, setCode] = useState<SetupCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (code) {
    return (
      <SetupCodePanel
        deviceName={deviceName}
        setupCode={code}
        onDone={() => setCode(null)}
      />
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Use a setup code to connect a tablet or screen without anyone signing in
        on it. If a device is lost or replaced, sign it out everywhere first.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="lg"
          disabled={pending || !isActive}
          onClick={() => {
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await newSetupCode(deviceId);
              if (!result.ok) setError(result.error);
              else if (result.data) setCode(result.data);
            });
          }}
        >
          New setup code
        </Button>
        <Button
          variant="destructive"
          size="lg"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                `Sign ${deviceName} out everywhere? It will need setting up again.`,
              )
            )
              return;
            setError(null);
            setMessage(null);
            startTransition(async () => {
              const result = await resetDeviceLogin(deviceId);
              if (!result.ok) setError(result.error);
              else if (result.data) setCode(result.data);
              else setMessage(`${deviceName} is signed out everywhere.`);
            });
          }}
        >
          Sign out everywhere
        </Button>
      </div>
      {!isActive ? (
        <p className="text-sm text-muted-foreground">
          Activate the device to get a setup code.
        </p>
      ) : null}
      <FormError message={error} />
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  );
}
