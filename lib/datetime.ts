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
