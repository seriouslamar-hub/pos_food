import { describe, expect, it } from "vitest";
import { applyCash, quickCashAmounts } from "./cash";
import { formatInZone } from "./datetime";
import type { MenuPaymentMethod } from "./menu";
import { manualProvider, providerFor } from "./payments/provider";
import {
  amountDue,
  amountPaid,
  changeDue,
  tender,
  toRecordPayments,
  type PendingPayment,
} from "./payments/tender";
import {
  browserDriver,
  currentPrintRequest,
  subscribePrintRequests,
  toPaperWidth,
} from "./printing";
import type { OrderSummary } from "./orders";

const cash: MenuPaymentMethod = {
  id: "m-cash",
  type: "cash",
  name: "Cash",
  requires_reference: false,
};
const card: MenuPaymentMethod = {
  id: "m-card",
  type: "card",
  name: "Card",
  requires_reference: true,
};
const momo: MenuPaymentMethod = {
  id: "m-momo",
  type: "mobile_money",
  name: "Mobile money",
  requires_reference: false,
};

describe("quickCashAmounts", () => {
  it("offers the exact amount, then the next round amounts", () => {
    expect(quickCashAmounts(6930, "USD")).toEqual([6930, 7000, 8000, 10000]);
    expect(quickCashAmounts(1250, "GHS")).toEqual([1250, 1300, 1500, 2000]);
    expect(quickCashAmounts(123456, "USD")).toEqual([
      123456, 123500, 124000, 125000,
    ]);
  });

  it("skips round amounts equal to what's due", () => {
    expect(quickCashAmounts(2000, "USD")).toEqual([2000, 5000, 10000, 20000]);
    expect(quickCashAmounts(100, "USD")).toEqual([100, 500, 1000, 2000]);
  });

  it("uses whole units for currencies without decimals", () => {
    expect(quickCashAmounts(1280, "JPY")).toEqual([1280, 1300, 1400, 1500]);
  });

  it("offers nothing when nothing is due", () => {
    expect(quickCashAmounts(0, "USD")).toEqual([]);
    expect(quickCashAmounts(-50, "USD")).toEqual([]);
  });

  it("gives the right change for every button", () => {
    for (const due of [1, 99, 1250, 6930, 9999, 10000, 123456]) {
      for (const tendered of quickCashAmounts(due, "USD")) {
        const { amount, change } = applyCash(due, tendered);
        expect(amount).toBe(due);
        expect(change).toBe(tendered - due);
        expect(amount + change).toBe(tendered);
      }
    }
    // 69.30 paid with 100.00 → 30.70 change.
    expect(applyCash(6930, 10000)).toEqual({ amount: 6930, change: 3070 });
  });

  it("pays part of the total when the cash is short", () => {
    expect(applyCash(6930, 2000)).toEqual({ amount: 2000, change: 0 });
  });
});

describe("tender", () => {
  const base = { id: "p1", due: 6930, currency: "USD" };

  it("keeps the cash handed over and works out the change", () => {
    const result = tender({ ...base, method: cash, entered: 10000 });
    expect(result).toEqual({
      ok: true,
      payment: {
        id: "p1",
        method: cash,
        amount: 6930,
        tendered: 10000,
        reference: null,
      },
    });
  });

  it("takes part in cash for a split", () => {
    const result = tender({ ...base, method: cash, entered: 2000 });
    expect(result.ok && result.payment.amount).toBe(2000);
  });

  it("needs a reference when the method says so", () => {
    expect(tender({ ...base, method: card, entered: 6930 })).toEqual({
      ok: false,
      error: "Card needs a reference number.",
    });
    const ok = tender({
      ...base,
      method: card,
      entered: 6930,
      reference: " AUTH1 ",
    });
    expect(ok.ok && ok.payment.reference).toBe("AUTH1");
    expect(tender({ ...base, method: momo, entered: 100 }).ok).toBe(true);
  });

  it("won't charge a card more than what's left", () => {
    expect(
      tender({ ...base, method: card, entered: 7000, reference: "X" }),
    ).toEqual({
      ok: false,
      error: "Card can't be more than the $69.30 left to pay.",
    });
  });

  it("refuses empty amounts and paid-up orders", () => {
    expect(tender({ ...base, method: cash, entered: 0 })).toMatchObject({
      ok: false,
      error: "Enter the cash received.",
    });
    expect(tender({ ...base, method: momo, entered: 0 })).toMatchObject({
      ok: false,
      error: "Enter an amount.",
    });
    expect(
      tender({ ...base, due: 0, method: cash, entered: 100 }),
    ).toMatchObject({ ok: false, error: "Nothing is left to pay." });
  });
});

describe("split payments", () => {
  const payments: PendingPayment[] = [
    { id: "a", method: card, amount: 500, tendered: null, reference: "R" },
    { id: "b", method: cash, amount: 1500, tendered: 2000, reference: null },
  ];

  it("adds up what's paid, what's due and the change", () => {
    expect(amountPaid(payments)).toBe(2000);
    expect(amountDue(2000, payments)).toBe(0);
    expect(amountDue(2500, payments)).toBe(500);
    expect(changeDue(payments)).toBe(500);
  });

  it("sends the payments in the shape record_payments expects", () => {
    expect(toRecordPayments(payments, "2026-10-16T10:00:00.000Z")).toEqual([
      {
        id: "a",
        payment_method_id: "m-card",
        amount: 500,
        tendered: null,
        reference: "R",
        client_created_at: "2026-10-16T10:00:00.000Z",
      },
      {
        id: "b",
        payment_method_id: "m-cash",
        amount: 1500,
        tendered: 2000,
        reference: null,
        client_created_at: "2026-10-16T10:00:00.000Z",
      },
    ]);
  });
});

describe("payment providers", () => {
  it("records manual payments with the typed reference", async () => {
    expect(providerFor(card)).toBe(manualProvider);
    expect(providerFor(cash).id).toBe("cash");
    await expect(
      manualProvider.capture({
        method: card,
        amount: 100,
        currency: "USD",
        reference: " 1234 ",
      }),
    ).resolves.toEqual({ ok: true, reference: "1234" });
  });
});

describe("browser printing", () => {
  const order = { id: "o1" } as OrderSummary;

  it("prints one request at a time, in order", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribePrintRequests(() => {
      const request = currentPrintRequest();
      if (request) {
        seen.push(request.jobs.map((j) => j.kind).join("+"));
        queueMicrotask(request.done);
      }
    });
    await Promise.all([
      browserDriver.print(
        [
          { kind: "kitchen", order },
          { kind: "receipt", order },
        ],
        80,
      ),
      browserDriver.print([{ kind: "receipt", order, copy: true }], 58),
    ]);
    unsubscribe();
    expect(seen).toEqual(["kitchen+receipt", "receipt"]);
    expect(currentPrintRequest()).toBeNull();
  });

  it("doesn't wait when nothing can print", async () => {
    await expect(
      browserDriver.print([{ kind: "receipt", order }], 80),
    ).resolves.toBeUndefined();
  });

  it("reads the paper width setting", () => {
    expect(toPaperWidth(58)).toBe(58);
    expect(toPaperWidth(80)).toBe(80);
    expect(toPaperWidth("58")).toBe(80);
  });
});

describe("formatInZone", () => {
  it("shows times in the branch's timezone", () => {
    const iso = "2026-10-16T23:30:00Z";
    expect(formatInZone(iso, "Africa/Accra")).toBe("16 Oct 2026, 23:30");
    expect(formatInZone(iso, "Asia/Tokyo")).toBe("17 Oct 2026, 08:30");
    expect(formatInZone(iso, "Not/AZone")).toBe("16 Oct 2026, 23:30");
  });
});
