/**
 * Money helpers. Amounts are always integers in the currency's minor units
 * (1250 = 12.50 for a 2-decimal currency). Floats never touch money: parsing
 * and formatting work on decimal strings.
 */

export class MoneyParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid money amount "${input}": ${reason}`);
    this.name = "MoneyParseError";
  }
}

const fractionDigitsCache = new Map<string, number>();
const formatterCache = new Map<string, Intl.NumberFormat>();

/** Number of minor-unit digits for a currency (USD 2, JPY 0, KWD 3). */
export function currencyFractionDigits(currencyCode: string): number {
  const code = currencyCode.toUpperCase();
  let digits = fractionDigitsCache.get(code);
  if (digits === undefined) {
    // Throws RangeError for an invalid currency code.
    digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
    }).resolvedOptions().maximumFractionDigits;
    fractionDigitsCache.set(code, digits ?? 2);
  }
  return digits ?? 2;
}

function getFormatter(
  currencyCode: string,
  locale?: string,
): Intl.NumberFormat {
  const key = `${locale ?? ""}|${currencyCode}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

/** Formats integer minor units for display, e.g. formatMoney(1250, "USD", "en-US") → "$12.50". */
export function formatMoney(
  minorUnits: number,
  currencyCode: string,
  locale?: string,
): string {
  if (!Number.isSafeInteger(minorUnits)) {
    throw new TypeError(
      `formatMoney expects an integer number of minor units, got ${minorUnits}`,
    );
  }
  const code = currencyCode.toUpperCase();
  const digits = currencyFractionDigits(code);
  const sign = minorUnits < 0 ? "-" : "";
  const magnitude = Math.abs(minorUnits)
    .toString()
    .padStart(digits + 1, "0");
  const decimal =
    digits === 0
      ? magnitude
      : `${magnitude.slice(0, -digits)}.${magnitude.slice(-digits)}`;
  // Intl formats decimal strings exactly, so no float conversion happens here.
  return getFormatter(code, locale).format(
    `${sign}${decimal}` as Intl.StringNumericLiteral,
  );
}

// Optional minus, whole part (plain or grouped with commas in threes), optional decimals.
const AMOUNT_PATTERN = /^(-)?(\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d*))?$/;

/**
 * Parses a typed amount ("12.50", "1,250", "-3.5") into integer minor units.
 * Extra decimals round half away from zero ("12.345" → 1235 for USD).
 * Throws MoneyParseError for anything that isn't a plain amount.
 */
export function parseMoney(input: string, currencyCode?: string): number {
  const digits = currencyCode ? currencyFractionDigits(currencyCode) : 2;
  const cleaned = input.trim();
  const match = AMOUNT_PATTERN.exec(cleaned);
  if (!match || !/\d/.test(cleaned)) {
    throw new MoneyParseError(input, "expected a number like 12.50");
  }

  const [, minus, wholePart = "0", fractionPart = ""] = match;
  const whole = wholePart.replaceAll(",", "");
  const kept = fractionPart.slice(0, digits).padEnd(digits, "0");
  const roundingDigit = fractionPart.charAt(digits);

  let magnitude = BigInt(whole + kept);
  if (roundingDigit >= "5") magnitude += 1n;

  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyParseError(input, "amount is too large");
  }
  const value = Number(magnitude);
  return minus && value !== 0 ? -value : value;
}
