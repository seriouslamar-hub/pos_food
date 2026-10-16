import { APP_LOCALE } from "./money";

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A stored UTC time shown in a branch's timezone (plan rule 11), e.g.
 * "16 Oct 2026, 14:05". Falls back to UTC for an unknown timezone.
 */
export function formatInZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(APP_LOCALE, { ...options, timeZone });
    } catch {
      formatter = new Intl.DateTimeFormat(APP_LOCALE, {
        ...options,
        timeZone: "UTC",
      });
    }
    formatters.set(key, formatter);
  }
  return formatter.format(new Date(iso));
}

/** The date (YYYY-MM-DD) at `now` in a timezone. Falls back to UTC. */
export function dateInZone(now: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(now);
  }
}

/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whether a string is a real YYYY-MM-DD date. */
export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()) &&
    new Date(`${value}T12:00:00Z`).toISOString().startsWith(value)
  );
}
