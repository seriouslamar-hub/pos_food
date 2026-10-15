"use client";

import { DeleteIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PinKeypadProps = {
  onSubmit: (pin: string) => void | Promise<void>;
  disabled?: boolean;
  minLength?: number;
  maxLength?: number;
  submitLabel?: string;
  /** Listen for number keys on the physical keyboard too. */
  keyboard?: boolean;
  className?: string;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * Big touch keypad for PINs. Shows dots, never digits. Works with a
 * physical keyboard: digits, Backspace, Enter and Escape.
 */
export function PinKeypad({
  onSubmit,
  disabled = false,
  minLength = 4,
  maxLength = 6,
  submitLabel = "Enter",
  keyboard = true,
  className,
}: PinKeypadProps) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = disabled || busy;

  const press = useCallback(
    (digit: string) => setPin((p) => (p.length < maxLength ? p + digit : p)),
    [maxLength],
  );
  const backspace = useCallback(() => setPin((p) => p.slice(0, -1)), []);
  const clear = useCallback(() => setPin(""), []);

  const submit = useCallback(async () => {
    if (locked || pin.length < minLength) return;
    const value = pin;
    setPin("");
    setBusy(true);
    try {
      await onSubmit(value);
    } finally {
      setBusy(false);
    }
  }, [locked, pin, minLength, onSubmit]);

  useEffect(() => {
    if (!keyboard) return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]"))
        return;
      if (locked) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        backspace();
      } else if (event.key === "Escape") {
        clear();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, locked, press, backspace, clear, submit]);

  return (
    <div className={cn("flex w-full max-w-xs flex-col gap-4", className)}>
      <div
        className="flex h-8 items-center justify-center gap-3"
        role="status"
        aria-label={`${pin.length} of ${maxLength} PIN digits entered`}
        data-testid="pin-dots"
        data-length={pin.length}
      >
        {Array.from({ length: maxLength }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-4 rounded-full border-2 border-foreground/40 transition-colors",
              i < pin.length && "border-foreground bg-foreground",
            )}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => (
          <KeypadButton
            key={key}
            label={key}
            onPress={() => press(key)}
            disabled={locked}
          />
        ))}
        <KeypadButton label="Clear" onPress={clear} disabled={locked} small />
        <KeypadButton label="0" onPress={() => press("0")} disabled={locked} />
        <KeypadButton
          label={<DeleteIcon className="size-7" />}
          ariaLabel="Delete last digit"
          onPress={backspace}
          disabled={locked}
        />
      </div>

      <Button
        size="touch"
        className="h-16 text-xl"
        onClick={() => void submit()}
        disabled={locked || pin.length < minLength}
      >
        {busy ? "Checking…" : submitLabel}
      </Button>
    </div>
  );
}

function KeypadButton({
  label,
  ariaLabel,
  onPress,
  disabled,
  small,
}: {
  label: React.ReactNode;
  ariaLabel?: string;
  onPress: () => void;
  disabled: boolean;
  small?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      aria-label={ariaLabel}
      onClick={onPress}
      disabled={disabled}
      className={cn(
        "h-20 rounded-2xl text-3xl font-medium tabular-nums",
        small && "text-lg",
      )}
    >
      {label}
    </Button>
  );
}
