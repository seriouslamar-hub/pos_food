/**
 * How a payment is taken.
 *
 * Today every method is "manual": the customer pays on a separate card
 * terminal or on their phone, and the cashier types the reference shown
 * there. Integrated providers (card terminals, mobile money prompts) plug in
 * here later. They start the charge through a Supabase Edge Function, which
 * hears back from the provider by webhook; the till records the payment only
 * once the provider has confirmed it.
 */
import type { MenuPaymentMethod } from "../menu";

export type CaptureRequest = {
  method: MenuPaymentMethod;
  amount: number;
  currency: string;
  /** What the cashier typed, for manual providers. */
  reference: string | null;
};

export type CaptureResult =
  { ok: true; reference: string | null } | { ok: false; error: string };

export interface PaymentProvider {
  readonly id: "cash" | "manual";
  /** Whether the cashier types the reference from another device. */
  readonly typedReference: boolean;
  capture(request: CaptureRequest): Promise<CaptureResult>;
}

/** Cash is taken by putting it in the drawer. */
export const cashProvider: PaymentProvider = {
  id: "cash",
  typedReference: false,
  async capture() {
    return { ok: true, reference: null };
  },
};

/** The payment was taken elsewhere; the cashier types its reference. */
export const manualProvider: PaymentProvider = {
  id: "manual",
  typedReference: true,
  async capture({ reference }) {
    return { ok: true, reference: reference?.trim() || null };
  },
};

/**
 * The provider for a payment method. An integrated card or mobile money
 * provider would be picked here, by method type and branch settings.
 */
export function providerFor(method: MenuPaymentMethod): PaymentProvider {
  return method.type === "cash" ? cashProvider : manualProvider;
}
