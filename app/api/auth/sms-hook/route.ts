import { reportError } from "@/lib/monitoring/report";
import { sendArkeselSms } from "@/lib/sms/arkesel";
import { verifyStandardWebhook } from "@/lib/sms/webhook-signature";

/**
 * Supabase Auth's "Send SMS" hook: Supabase calls this with the sign-in
 * code, and it goes out through Arkesel. Only requests signed with
 * SMS_HOOK_SECRET (the hook's secret in Supabase) are accepted.
 */
export async function POST(request: Request) {
  const secret = process.env.SMS_HOOK_SECRET;
  if (!secret) return hookError(500, "SMS sending isn't set up.");
  const body = await request.text();
  const valid = verifyStandardWebhook(
    body,
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    secret,
  );
  if (!valid) return hookError(401, "Not signed by Supabase.");

  const payload = JSON.parse(body) as {
    user?: { phone?: string };
    sms?: { otp?: string };
  };
  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) return hookError(400, "No phone number or code.");
  const sent = await sendArkeselSms(
    phone,
    `${otp} is your order code. It expires in 5 minutes.`,
  );
  if (!sent.ok) {
    await reportError({
      source: "server",
      message: sent.error,
      where: "sms hook",
    });
    return hookError(502, "We couldn't send the text message. Try again.");
  }
  return Response.json({});
}

/** The error shape Supabase Auth hooks expect. */
function hookError(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status });
}
