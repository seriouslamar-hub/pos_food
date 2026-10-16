import { onlineProvider } from "@/lib/payments/online";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where the provider sends the customer back. If the webhook hasn't arrived
 * yet, ask the provider directly, then go on to the order's page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference =
    url.searchParams.get("reference") ?? url.searchParams.get("trxref") ?? "";
  const next = url.searchParams.get("next") ?? "/order";
  const safeNext = /^\/(order|kiosk)(\/|$|\?)/.test(next) ? next : "/order";
  const provider = onlineProvider();
  if (provider && reference) {
    try {
      const payment = await provider.lookup(reference);
      if (payment)
        await createAdminClient().rpc("confirm_online_payment", {
          p_reference: payment.reference,
          p_amount: payment.amount,
          p_currency: payment.currency,
        });
    } catch {
      // The webhook will still confirm it.
    }
  }
  return Response.redirect(new URL(safeNext, url.origin), 303);
}
