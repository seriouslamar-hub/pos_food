"use client";

import { useEffect } from "react";

/**
 * Sets data-hydrated on <html> once React is interactive. End-to-end tests
 * wait for it so their taps aren't lost before event handlers attach.
 */
export function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return null;
}
