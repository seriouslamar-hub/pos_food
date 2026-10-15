import { describe, expect, it } from "vitest";
import {
  currencyFractionDigits,
  currencySymbol,
  formatAmount,
  formatMoney,
  MoneyParseError,
  parseMoney,
  toMoneyInput,
} from "./money";

describe("formatMoney", () => {
  it("formats minor units as currency", () => {
    expect(formatMoney(1250, "USD", "en-US")).toBe("$12.50");
    expect(formatMoney(5, "USD", "en-US")).toBe("$0.05");
    expect(formatMoney(0, "USD", "en-US")).toBe("$0.00");
    expect(formatMoney(123456789, "USD", "en-US")).toBe("$1,234,567.89");
  });

  it("formats negative values", () => {
    expect(formatMoney(-1250, "USD", "en-US")).toBe("-$12.50");
    expect(formatMoney(-5, "USD", "en-US")).toBe("-$0.05");
  });

  it("respects each currency's minor-unit digits", () => {
    expect(formatMoney(1250, "JPY", "en-US")).toBe("¥1,250");
    expect(formatMoney(1250, "KWD", "en-US")).toContain("1.250");
    expect(formatMoney(1250, "GHS", "en-GH")).toContain("12.50");
  });

  it("accepts lowercase currency codes", () => {
    expect(formatMoney(1250, "usd", "en-US")).toBe("$12.50");
  });

  it("formats the largest safe integer exactly", () => {
    expect(formatMoney(Number.MAX_SAFE_INTEGER, "USD", "en-US")).toBe(
      "$90,071,992,547,409.91",
    );
  });

  it("rejects non-integer and unsafe amounts", () => {
    expect(() => formatMoney(12.5, "USD")).toThrow(TypeError);
    expect(() => formatMoney(Number.NaN, "USD")).toThrow(TypeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY, "USD")).toThrow(
      TypeError,
    );
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow(
      TypeError,
    );
  });

  it("rejects an invalid currency code", () => {
    expect(() => formatMoney(100, "NOTACODE")).toThrow(RangeError);
  });
});

describe("parseMoney", () => {
  it("parses plain amounts into minor units", () => {
    expect(parseMoney("12.50")).toBe(1250);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("12")).toBe(1200);
    expect(parseMoney("12.")).toBe(1200);
    expect(parseMoney(".5")).toBe(50);
    expect(parseMoney("0")).toBe(0);
    expect(parseMoney("  7.25 ")).toBe(725);
  });

  it("parses thousands separators", () => {
    expect(parseMoney("1,250.00")).toBe(125000);
    expect(parseMoney("1,234,567.89")).toBe(123456789);
  });

  it("rounds extra decimals half away from zero", () => {
    expect(parseMoney("12.345")).toBe(1235);
    expect(parseMoney("12.344")).toBe(1234);
    expect(parseMoney("0.005")).toBe(1);
    expect(parseMoney("0.004")).toBe(0);
    // 19.995 * 100 is 1999.4999… as a float; string rounding gets it right.
    expect(parseMoney("19.995")).toBe(2000);
    expect(parseMoney("1.00999")).toBe(101);
  });

  it("parses negative values", () => {
    expect(parseMoney("-5")).toBe(-500);
    expect(parseMoney("-12.50")).toBe(-1250);
    expect(parseMoney("-12.345")).toBe(-1235);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parseMoney("-0"), 0)).toBe(true);
    expect(Object.is(parseMoney("-0.004"), 0)).toBe(true);
  });

  it("uses the currency's minor-unit digits", () => {
    expect(parseMoney("1250", "JPY")).toBe(1250);
    expect(parseMoney("12.5", "JPY")).toBe(13);
    expect(parseMoney("1.2345", "KWD")).toBe(1235);
    expect(parseMoney("12.50", "GHS")).toBe(1250);
  });

  it("rejects invalid input", () => {
    for (const input of [
      "",
      "   ",
      "abc",
      "12.3.4",
      "1,25",
      "12,50",
      "--5",
      "5-",
      "+5",
      "$12",
      "12 50",
      ".",
      "-",
      "-.",
      "1e3",
      "NaN",
      "Infinity",
    ]) {
      expect(() => parseMoney(input), `input "${input}"`).toThrow(
        MoneyParseError,
      );
    }
  });

  it("rejects amounts too large to store safely", () => {
    expect(() => parseMoney("90071992547409.92")).toThrow(MoneyParseError);
    expect(parseMoney("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("round-trips with formatMoney", () => {
    for (const minor of [0, 1, 99, 1250, -1250, 123456789]) {
      const formatted = formatMoney(minor, "USD", "en-US").replace("$", "");
      expect(parseMoney(formatted)).toBe(minor);
    }
  });
});

describe("currencyFractionDigits", () => {
  it("returns ISO minor-unit digits", () => {
    expect(currencyFractionDigits("USD")).toBe(2);
    expect(currencyFractionDigits("GHS")).toBe(2);
    expect(currencyFractionDigits("JPY")).toBe(0);
    expect(currencyFractionDigits("KWD")).toBe(3);
  });
});

describe("app formatting helpers", () => {
  it("formats in the fixed app locale", () => {
    expect(formatAmount(1250, "GHS")).toBe("GH₵12.50");
    expect(formatAmount(1250, "USD")).toBe("$12.50");
    expect(formatAmount(-1250, "GHS")).toBe("-GH₵12.50");
  });
  it("gives short currency symbols", () => {
    expect(currencySymbol("GHS")).toBe("GH₵");
    expect(currencySymbol("USD")).toBe("$");
  });
  it("turns minor units into editable text", () => {
    expect(toMoneyInput(1250, "GHS")).toBe("12.50");
    expect(toMoneyInput(5, "USD")).toBe("0.05");
    expect(toMoneyInput(-300, "USD")).toBe("-3.00");
    expect(toMoneyInput(1250, "JPY")).toBe("1250");
  });
});
