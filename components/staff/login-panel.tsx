"use client";

import { useState, useTransition } from "react";
import { FormError, SecretPanel } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import {
  createStaffLogin,
  resetStaffPassword,
  type Credentials,
} from "@/lib/actions/staff";

/** Admin tools for a back-office login: create one, or reset the password. */
export function LoginPanel({
  staffId,
  hasLogin,
  email,
}: {
  staffId: string;
  hasLogin: boolean;
  email: string | null;
}) {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => ReturnType<typeof resetStaffPassword>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error);
      else if (result.data) setCredentials(result.data.credentials);
    });
  }

  if (credentials) {
    return (
      <SecretPanel
        title="New temporary password"
        rows={[
          {
            label: "Email",
            value: credentials.email,
            testId: "credential-email",
          },
          {
            label: "Temporary password",
            value: credentials.password,
            testId: "credential-password",
          },
        ]}
      >
        <Button
          variant="outline"
          size="lg"
          className="self-start"
          onClick={() => setCredentials(null)}
        >
          Done
        </Button>
      </SecretPanel>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      {hasLogin ? (
        <>
          <p className="text-sm text-muted-foreground">
            Signs in as <strong>{email}</strong>. If they forget their password,
            give them a new temporary one. Their old password stops working.
          </p>
          <Button
            variant="outline"
            size="lg"
            className="self-start"
            disabled={pending}
            onClick={() => run(() => resetStaffPassword(staffId))}
          >
            {pending ? "Resetting…" : "Reset password"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            No login yet, so they can&apos;t sign in to the back office.
          </p>
          <Button
            variant="outline"
            size="lg"
            className="self-start"
            disabled={pending || !email}
            onClick={() => run(() => createStaffLogin(staffId))}
          >
            {pending
              ? "Creating…"
              : email
                ? "Create login"
                : "Add an email first"}
          </Button>
        </>
      )}
      <FormError message={error} />
    </div>
  );
}
