/** Pure helpers for device screens. */

export const DEVICE_TYPE_LABELS = {
  till: "Till",
  kds: "Kitchen display",
  pickup: "Pickup board",
  kiosk: "Kiosk",
} as const;

export type DeviceKind = keyof typeof DEVICE_TYPE_LABELS;

const CODE_PREFIX: Record<DeviceKind, string> = {
  till: "T",
  kds: "K",
  pickup: "P",
  kiosk: "S",
};

/** The next free short code for a device type, e.g. T3 when T1 and T2 exist. */
export function suggestDeviceCode(
  type: DeviceKind,
  existingCodes: readonly string[],
): string {
  const prefix = CODE_PREFIX[type];
  const taken = new Set(existingCodes.map((c) => c.toUpperCase()));
  for (let n = 1; ; n++) {
    const code = `${prefix}${n}`;
    if (!taken.has(code)) return code;
  }
}

/** Devices send a heartbeat every minute; two missed beats means offline. */
export const ONLINE_WINDOW_MS = 2 * 60_000;

export function deviceStatus(
  lastSeenAt: string | null,
  now: number,
): { online: boolean; label: string } {
  if (!lastSeenAt) return { online: false, label: "Never connected" };
  const age = now - new Date(lastSeenAt).getTime();
  if (age <= ONLINE_WINDOW_MS) return { online: true, label: "Online" };
  return { online: false, label: `Last seen ${timeAgo(age)}` };
}

export function timeAgo(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * The current time for Server Components. They render once per request (after
 * connection()), so reading the clock is safe there; client components should
 * not use this during render.
 */
export function requestTime(): number {
  return Date.now();
}
