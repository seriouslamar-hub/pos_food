import { reportError } from "@/lib/monitoring/report";
import { onlineProvider } from "@/lib/payments/online";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The payment provider's webhook. Only a correctly signed "payment
 * succeeded" message for the configured provider pays an order, and paying
 * twice changes nothing. Always answers 200 for messages it understood, so
 * the provider stops resending them.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: name } = await params;
  const provider = onlineProvider();
  if (!provider || provider.name !== name)
    return new Response(null, { status: 404 });
  const raw = await request.text();
  let payment;
  try {
    payment = await provider.verifyWebhook(raw, request.headers);
  } catch (e) {
    await reportError({
      source: "server",
      message: `Webhook check failed: ${String(e)}`,
      where: `webhook ${name}`,
    });
    return new Response(null, { status: 500 });
  }
  if (!payment) return new Response(null, { status: 401 });
  const { error } = await createAdminClient().rpc("confirm_online_payment", {
    p_reference: payment.reference,
    p_amount: payment.amount,
    p_currency: payment.currency,
  });
  if (error) {
    // A mismatch or unknown reference: logged and audited for staff to check.
    await reportError({
      source: "server",
      message: `Online payment ${payment.reference} not applied: ${error.message}`,
      where: `webhook ${name}`,
    });
  }
  return Response.json({ received: true });
}
