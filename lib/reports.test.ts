import { describe, expect, it } from "vitest";
import {
  csvAmount,
  csvCell,
  dateWindows,
  exportRow,
  formatDuration,
  percentChange,
  rangePresets,
  reportRange,
  toCsv,
} from "./reports";

describe("toCsv", () => {
  it("starts with a byte-order mark and ends lines with CRLF", () => {
    expect(
      toCsv([
        ["a", 1],
        ["b", 2],
      ]),
    ).toBe("﻿a,1\r\nb,2\r\n");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('Fries, large "XL"')).toBe('"Fries, large ""XL"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("never lets a spreadsheet run a formula", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-1)).toBe("-1");
  });

  it("leaves empty cells empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("csvAmount", () => {
  it("writes minor units as decimals", () => {
    expect(csvAmount(1250)).toBe("12.50");
    expect(csvAmount(5)).toBe("0.05");
    expect(csvAmount(-1100)).toBe("-11.00");
    expect(csvAmount(1500, 0)).toBe("1500");
    expect(csvAmount(1234, 3)).toBe("1.234");
  });
});

describe("dateWindows", () => {
  it("splits a range into windows of at most 31 days", () => {
    const windows = dateWindows("2026-01-01", "2026-03-05");
    expect(windows).toEqual([
      { from: "2026-01-01", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-03-03" },
      { from: "2026-03-04", to: "2026-03-05" },
    ]);
  });

  it("keeps a single day as one window", () => {
    expect(dateWindows("2026-10-16", "2026-10-16")).toEqual([
      { from: "2026-10-16", to: "2026-10-16" },
    ]);
  });
});

describe("percentChange", () => {
  it("rounds to a whole percent", () => {
    expect(percentChange(1500, 1000)).toBe(50);
    expect(percentChange(900, 1000)).toBe(-10);
    expect(percentChange(1000, 3000)).toBe(-67);
  });

  it("has nothing to compare with zero", () => {
    expect(percentChange(500, 0)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(125)).toBe("2m 05s");
    expect(formatDuration(3700)).toBe("1h 01m");
    expect(formatDuration(null)).toBe("–");
  });
});

describe("reportRange", () => {
  it("defaults to the last 7 days", () => {
    expect(reportRange({}, "2026-10-16")).toEqual({
      from: "2026-10-10",
      to: "2026-10-16",
    });
  });

  it("keeps a valid range and fixes a backwards or too-long one", () => {
    expect(
      reportRange({ from: "2026-10-01", to: "2026-10-05" }, "2026-10-16"),
    ).toEqual({
      from: "2026-10-01",
      to: "2026-10-05",
    });
    expect(
      reportRange({ from: "2026-10-09", to: "2026-10-05" }, "2026-10-16").from,
    ).toBe("2026-10-05");
    expect(
      reportRange({ from: "2020-01-01", to: "2026-10-16" }, "2026-10-16").from,
    ).toBe("2025-10-15");
  });

  it("ignores dates that aren't real", () => {
    expect(
      reportRange({ from: "2026-02-30", to: "nope" }, "2026-10-16").to,
    ).toBe("2026-10-16");
  });
});

describe("rangePresets", () => {
  it("is relative to the branch's today", () => {
    const presets = Object.fromEntries(
      rangePresets("2026-10-16").map((p) => [p.key, p]),
    );
    expect(presets.yesterday).toMatchObject({
      from: "2026-10-15",
      to: "2026-10-15",
    });
    expect(presets.month).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-16",
    });
    expect(presets.year.from).toBe("2026-01-01");
  });
});

describe("exportRow", () => {
  it("writes amounts in the row's currency and yes/no for flags", () => {
    const row = [
      "2026-10-16",
      "Main",
      "042",
      "2026-10-16 12:00",
      "counter",
      "takeaway",
      "paid",
      "Ama",
      5000,
      0,
      500,
      5500,
      1100,
      "USD",
      false,
    ];
    const out = exportRow("sales", row, (c) => (c === "USD" ? 2 : 0));
    expect(out.slice(8)).toEqual([
      "50.00",
      "0.00",
      "5.00",
      "55.00",
      "11.00",
      "USD",
      "No",
    ]);
  });

  it("writes tax rates as percents", () => {
    const row = ["2026-10-16", "Main", "VAT", 1500, false, 10000, 1500, "GHS"];
    expect(exportRow("tax", row, () => 2)).toEqual([
      "2026-10-16",
      "Main",
      "VAT",
      "15.00",
      "No",
      "100.00",
      "15.00",
      "GHS",
    ]);
  });
});
