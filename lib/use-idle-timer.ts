"use client";

import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "wheel",
] as const;

/** Calls onIdle after timeoutMs without a touch, click or key press. */
export function useIdleTimer(
  timeoutMs: number,
  onIdle: () => void,
  enabled = true,
) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  });

  useEffect(() => {
    if (!enabled || !(timeoutMs > 0)) return;
    let timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onIdleRef.current(), timeoutMs);
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, reset, { passive: true });
    }
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY_EVENTS)
        window.removeEventListener(event, reset);
    };
  }, [enabled, timeoutMs]);
}
