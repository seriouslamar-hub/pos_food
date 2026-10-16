import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Online payment providers (server only). An order is paid only when the
 * provider's webhook (or a check on the customer's return) confirms it to
 * public.confirm_online_payment. Choose one with PAYMENTS_PROVIDER:
 *
 * - "paystack": cards and mobile money (Ghana, Nigeria, Kenya, South
 *   Africa). Needs PAYSTACK_SECRET_KEY. In the Paystack dashboard, set the
 *   webhook URL to https://<your app>/api/payments/webhook/paystack.
 * - "test": a pretend checkout page, for local testing only. Refused unless
 *   the database is the local stack.
 *
 * Unset: online payment is off (kiosks and online orders can still be paid
 * at the counter where the branch allows it).
 */

export type Checkout = { url: string };

export type ConfirmedPayment = {
  reference: string;
  /** Minor units, as the provider reports them. */
  amount: number;
  currency: string;
};

export type OnlineProvider = {
  name: string;
  createCheckout(input: {
    reference: string;
    amount: number;
    currency: string;
    customerPhone: string | null;
    callbackUrl: string;
  }): Promise<Checkout>;
  /** The payment a webhook reports as successful, or null (ignore it). */
  verifyWebhook(
    rawBody: string,
    headers: Headers,
  ): Promise<ConfirmedPayment | null>;
  /** Asks the provider directly whether a payment went through. */
  lookup(reference: string): Promise<ConfirmedPayment | null>;
};

export function newReference(orderId: string): string {
  return `POS-${orderId.slice(0, 8).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function hmac512(secret: string, body: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function paystack(secret: string): OnlineProvider {
  const api = async (path: string, init?: RequestInit) => {
    const res = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    const body = (await res.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: Record<string, unknown>;
    } | null;
    if (!res.ok || !body?.status)
      throw new Error(body?.message ?? `Paystack error ${res.status}`);
    return body.data ?? {};
  };
  const asPayment = (data: Record<string, unknown>): ConfirmedPayment | null =>
    data.status === "success" && typeof data.reference === "string"
      ? {
          reference: data.reference,
          amount: Number(data.amount),
          currency: String(data.currency),
        }
      : null;
  return {
    name: "paystack",
    async createCheckout({
      reference,
      amount,
      currency,
      customerPhone,
      callbackUrl,
    }) {
      // Paystack needs an email; customers here are known by phone.
      const digits =
        (customerPhone ?? "customer").replace(/\D/g, "") || "customer";
      const data = await api("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          reference,
          amount,
          currency,
          email: `${digits}@customers.pos.invalid`,
          callback_url: callbackUrl,
          channels: ["card", "mobile_money"],
          metadata: { phone: customerPhone },
        }),
      });
      return { url: String(data.authorization_url) };
    },
    async verifyWebhook(rawBody, headers) {
      const signature = headers.get("x-paystack-signature") ?? "";
      if (!sameHex(signature, hmac512(secret, rawBody))) return null;
      const event = JSON.parse(rawBody) as {
        event?: string;
        data?: Record<string, unknown>;
      };
      if (event.event !== "charge.success" || !event.data) return null;
      // Ask Paystack too, rather than trusting the message alone.
      return this.lookup(String(event.data.reference));
    },
    async lookup(reference) {
      const data = await api(
        `/transaction/verify/${encodeURIComponent(reference)}`,
      );
      return asPayment(data);
    },
  };
}

export const TEST_WEBHOOK_SECRET = "local-test-webhook-secret";

/** A pretend provider for the local stack: /order/test-pay "pays". */
function testProvider(): OnlineProvider {
  return {
    name: "test",
    async createCheckout({ reference, amount, currency, callbackUrl }) {
      const query = new URLSearchParams({
        reference,
        amount: String(amount),
        currency,
        callback: callbackUrl,
      });
      return { url: `/order/test-pay?${query}` };
    },
    async verifyWebhook(rawBody, headers) {
      const signature = headers.get("x-test-signature") ?? "";
      if (!sameHex(signature, hmac512(TEST_WEBHOOK_SECRET, rawBody)))
        return null;
      const body = JSON.parse(rawBody) as ConfirmedPayment;
      return {
        reference: body.reference,
        amount: Number(body.amount),
        currency: body.currency,
      };
    },
    async lookup() {
      return null;
    },
  };
}

export function testSignature(body: string): string {
  return hmac512(TEST_WEBHOOK_SECRET, body);
}

function isLocalDatabase(): boolean {
  return /^http:\/\/(127\.0\.0\.1|localhost):/.test(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  );
}

/** The configured provider, or null when online payment is off. */
export function onlineProvider(
  name = process.env.PAYMENTS_PROVIDER,
): OnlineProvider | null {
  if (name === "paystack" && process.env.PAYSTACK_SECRET_KEY)
    return paystack(process.env.PAYSTACK_SECRET_KEY);
  if (name === "test" && isLocalDatabase()) return testProvider();
  return null;
}
