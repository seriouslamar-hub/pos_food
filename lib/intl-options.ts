/** Timezone and currency choices for branch forms. */

export function timezoneOptions(current?: string): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  const list = zones.includes("UTC") ? zones : ["UTC", ...zones];
  return current && !list.includes(current) ? [current, ...list] : list;
}

export function currencyOptions(): { value: string; label: string }[] {
  const names = new Intl.DisplayNames("en", { type: "currency" });
  return Intl.supportedValuesOf("currency").map((code) => ({
    value: code,
    label: `${code} – ${names.of(code) ?? code}`,
  }));
}
