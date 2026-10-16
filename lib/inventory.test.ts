import { describe, expect, it } from "vitest";
import { formatQuantity, isLowStock, parseQuantity } from "./inventory";

describe("inventory quantities", () => {
  it("reads quantities with up to three decimals", () => {
    expect(parseQuantity("0.15")).toBe(0.15);
    expect(parseQuantity(" 12 ")).toBe(12);
    expect(parseQuantity("1,5")).toBe(1.5);
    expect(parseQuantity("0.1234")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
  });

  it("shows quantities without trailing zeros", () => {
    expect(formatQuantity(0.15, "kg")).toBe("0.15 kg");
    expect(formatQuantity("12.000", "pc")).toBe("12 pc");
    expect(formatQuantity(-4)).toBe("-4");
  });

  it("knows what's below its reorder level", () => {
    expect(isLowStock(3, 10)).toBe(true);
    expect(isLowStock("10.000", "10")).toBe(false);
    expect(isLowStock(-1, 0)).toBe(false);
  });
});
