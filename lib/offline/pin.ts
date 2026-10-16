/**
 * PIN checks while the till is offline, against the bcrypt hashes the till
 * keeps (get_offline_bundle). PINs are unique within a branch, so at most
 * one person matches.
 */
import bcrypt from "bcryptjs";
import type { StaffRole } from "../till";

export type OfflineStaff = {
  id: string;
  full_name: string;
  role: StaffRole;
  pin_hash: string;
  discount_limit_bps: number;
  permissions: string[];
};

export type OfflineBundle = {
  generated_at: string;
  branch_id: string;
  staff: OfflineStaff[];
  /** The highest offline number the server has from this till today. */
  offline_numbers: { business_date: string; last: number } | null;
};

export function parseOfflineBundle(json: unknown): OfflineBundle | null {
  const bundle = json as Partial<OfflineBundle> | null;
  if (!bundle || !Array.isArray(bundle.staff) || !bundle.branch_id) return null;
  return bundle as OfflineBundle;
}

/** Whoever has this PIN (and, if given, passes `allowed`), or null. */
export async function findStaffByPin(
  staff: OfflineStaff[],
  pin: string,
  allowed: (s: OfflineStaff) => boolean = () => true,
): Promise<OfflineStaff | null> {
  if (!/^\d{4,6}$/.test(pin)) return null;
  for (const person of staff) {
    if (!allowed(person)) continue;
    // pgcrypto writes $2a$ hashes, which bcryptjs reads.
    if (await bcrypt.compare(pin, person.pin_hash)) return person;
  }
  return null;
}

/** Five wrong PINs within 5 minutes lock the till for a minute (as online). */
export class OfflineLockout {
  private failures: number[] = [];

  /** Seconds until another try is allowed; 0 if not locked. */
  lockedFor(now: number): number {
    this.failures = this.failures.filter((t) => now - t < 5 * 60_000);
    if (this.failures.length < 5) return 0;
    const last = Math.max(...this.failures);
    return Math.max(0, Math.ceil((last + 60_000 - now) / 1000));
  }

  fail(now: number) {
    this.failures.push(now);
  }

  succeed() {
    this.failures = [];
  }
}
