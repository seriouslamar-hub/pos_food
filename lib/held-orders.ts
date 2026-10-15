/**
 * Orders put on hold at a till ("customer stepped aside"), kept in the
 * browser so they survive a reload and work offline. Per device.
 */
import type { Cart } from "./cart";

export type HeldOrder = { label: string; heldAt: string; cart: Cart };

const key = (deviceId: string) => `pos.held.${deviceId}`;

export function loadHeld(deviceId: string): HeldOrder[] {
  try {
    const raw = localStorage.getItem(key(deviceId));
    const list = raw ? (JSON.parse(raw) as HeldOrder[]) : [];
    return Array.isArray(list)
      ? list.filter((h) => h?.cart?.id && Array.isArray(h.cart.lines))
      : [];
  } catch {
    return [];
  }
}

export function saveHeld(deviceId: string, held: HeldOrder[]): void {
  try {
    localStorage.setItem(key(deviceId), JSON.stringify(held));
  } catch {
    // Storage full or blocked: holds just won't survive a reload.
  }
}
