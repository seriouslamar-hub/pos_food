import { headers } from "next/headers";
import { newReference, onlineProvider } from "@/lib/payments/online";
import { withinRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * POST {orderId}: starts paying an unpaid online order (by the customer who
 * placed it) or kiosk order (by the kiosk that took it). Returns the
 * provider's checkout URL.
 */
export async function POST(request: Request) {
  const provider = onlineProvider();
  if (!provider)
    return Response.json(
      { error: "Online payment isn't set up." },
      { status: 503 },
    );
  const { orderId } = (await request.json().catch(() => ({}))) as {
    orderId?: string;
  };
  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId))
    return Response.json({ error: "Which order?" }, { status: 400 });
  if (!(await withinRateLimit("online_payment.start", 20)))
    return Response.json(
      { error: "Too many attempts. Wait a few minutes." },
      { status: 429 },
    );

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user)
    return Response.json({ error: "Sign in first." }, { status: 401 });
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, channel, branch_id, online_user_id, device_id, paid_at")
    .eq("id", orderId)
    .maybeSingle();
  const { data: device } = await admin
    .from("devices")
    .select("id, branch_id, type")
    .eq("auth_user_id", auth.user.id)
    .maybeSingle();
  const allowed =
    order &&
    ((order.channel === "online" && order.online_user_id === auth.user.id) ||
      (order.channel === "kiosk" &&
        device?.type === "kiosk" &&
        device.branch_id === order.branch_id));
  if (!allowed)
    return Response.json({ error: "Order not found." }, { status: 404 });

  const reference = newReference(orderId);
  const { data: started, error } = await admin.rpc("start_online_payment", {
    p_order_id: orderId,
    p_provider: provider.name,
    p_reference: reference,
  });
  if (error) return Response.json({ error: error.message }, { status: 409 });
  const s = started as {
    amount: number;
    currency_code: string;
    customer_phone: string | null;
  };
  const origin =
    new URL(request.url).origin || (await headers()).get("origin") || "";
  const back = order.channel === "kiosk" ? "/kiosk" : `/order/track/${orderId}`;
  try {
    const checkout = await provider.createCheckout({
      reference,
      amount: s.amount,
      currency: s.currency_code,
      customerPhone: s.customer_phone,
      callbackUrl: `${origin}/order/return?reference=${encodeURIComponent(reference)}&next=${encodeURIComponent(back)}`,
    });
    return Response.json({ url: checkout.url, reference });
  } catch (e) {
    console.error("Payment provider refused the checkout", e);
    return Response.json(
      { error: "The payment provider didn't respond. Try again." },
      { status: 502 },
    );
  }
}
