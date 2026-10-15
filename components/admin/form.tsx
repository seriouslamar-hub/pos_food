"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A labelled form control with an optional hint and error message. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Props for an input that may be in error. */
export function invalid(id: string, error?: string) {
  return error
    ? { "aria-invalid": true, "aria-describedby": `${id}-error` }
    : {};
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" aria-live="polite">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function FormSuccess({
  message,
}: {
  message: string | null | undefined;
}) {
  if (!message) return null;
  return (
    <Alert aria-live="polite">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** Native select styled like the other inputs (works well on touch screens). */
export function Select({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shows a secret once (a temporary password or a setup code) with a copy
 * button and a warning that it won't be shown again.
 */
export function SecretPanel({
  title,
  rows,
  children,
}: {
  title: string;
  rows: { label: string; value: string; testId?: string }[];
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border-2 border-primary/40 bg-muted/40 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          Copy this now. It won&apos;t be shown again.
        </p>
      </div>
      <dl className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-center gap-3">
            <dt className="w-40 text-sm text-muted-foreground">{row.label}</dt>
            <dd
              className="font-mono text-lg font-medium break-all"
              data-testid={row.testId}
            >
              {row.value}
            </dd>
            <CopyButton value={row.value} />
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked; the value is on screen to copy by hand.
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
