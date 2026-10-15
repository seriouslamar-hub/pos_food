/**
 * The last receipt a till printed or showed, kept in the browser so
 * "Reprint last receipt" works after a reload and offline. Per device.
 */
import { parseOrderSummary, type OrderSummary } from "./orders";

const key = (deviceId: string) => `pos.lastReceipt.${deviceId}`;

export function loadLastReceipt(deviceId: string): OrderSummary | null {
  try {
    const raw = localStorage.getItem(key(deviceId));
    return raw ? parseOrderSummary(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLastReceipt(deviceId: string, order: OrderSummary): void {
  try {
    localStorage.setItem(key(deviceId), JSON.stringify(order));
  } catch {
    // Storage full or blocked: reprint just won't survive a reload.
  }
}
