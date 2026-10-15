/**
 * Payments taken on the payment screen before they're saved. The order is
 * paid once they add up to its total; record_payments checks it all again.
 */
import { applyCash } from "../cash";
import type { MenuPaymentMethod } from "../menu";
import { formatAmount } from "../money";

export type PendingPayment = {
  /** Made on the device, so sending the payments again is safe. */
  id: string;
  method: MenuPaymentMethod;
  amount: number;
  /** Cash handed over (cash only); the change is tendered − amount. */
  tendered: number | null;
  reference: string | null;
};

export function amountPaid(payments: PendingPayment[]): number {
  return payments.reduce((sum, p) => sum + p.amount, 0);
}

/** Still to pay. Negative only if the total went down after paying. */
export function amountDue(total: number, payments: PendingPayment[]): number {
  return total - amountPaid(payments);
}

export function changeDue(payments: PendingPayment[]): number {
  return payments.reduce(
    (sum, p) => sum + (p.tendered === null ? 0 : p.tendered - p.amount),
    0,
  );
}

export type TenderResult =
  { ok: true; payment: PendingPayment } | { ok: false; error: string };

/**
 * The next payment toward what's due. For cash, `entered` is the cash handed
 * over: anything above what's due is change. For other methods it's the
 * amount to charge, which can't be more than what's due.
 */
export function tender({
  id,
  method,
  due,
  entered,
  reference = "",
  currency,
}: {
  id: string;
  method: MenuPaymentMethod;
  due: number;
  entered: number;
  reference?: string;
  currency: string;
}): TenderResult {
  if (due <= 0) return { ok: false, error: "Nothing is left to pay." };
  if (!Number.isSafeInteger(entered) || entered <= 0) {
    return {
      ok: false,
      error:
        method.type === "cash"
          ? "Enter the cash received."
          : "Enter an amount.",
    };
  }
  const ref = reference.trim() || null;
  if (method.type === "cash") {
    const { amount } = applyCash(due, entered);
    return {
      ok: true,
      payment: { id, method, amount, tendered: entered, reference: ref },
    };
  }
  if (entered > due) {
    return {
      ok: false,
      error: `${method.name} can't be more than the ${formatAmount(due, currency)} left to pay.`,
    };
  }
  if (method.requires_reference && !ref) {
    return { ok: false, error: `${method.name} needs a reference number.` };
  }
  return {
    ok: true,
    payment: { id, method, amount: entered, tendered: null, reference: ref },
  };
}

export type RecordPaymentsPayload = {
  id: string;
  payment_method_id: string;
  amount: number;
  tendered: number | null;
  reference: string | null;
  client_created_at: string;
}[];

/** What the till sends to record_payments. */
export function toRecordPayments(
  payments: PendingPayment[],
  clientCreatedAt: string,
): RecordPaymentsPayload {
  return payments.map((p) => ({
    id: p.id,
    payment_method_id: p.method.id,
    amount: p.amount,
    tendered: p.tendered,
    reference: p.reference,
    client_created_at: clientCreatedAt,
  }));
}
