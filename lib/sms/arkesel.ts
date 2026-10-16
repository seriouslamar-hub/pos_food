import "server-only";

/**
 * Sends a text message through Arkesel (Ghana). Needs ARKESEL_API_KEY and
 * ARKESEL_SENDER_ID (the sender name approved in your Arkesel account, at
 * most 11 letters or digits).
 */
export async function sendArkeselSms(
  to: string,
  message: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.ARKESEL_API_KEY;
  const sender = process.env.ARKESEL_SENDER_ID;
  if (!apiKey || !sender)
    return {
      ok: false,
      error: "Arkesel isn't set up (ARKESEL_API_KEY, ARKESEL_SENDER_ID).",
    };
  const recipient = to.replace(/\D/g, "");
  try {
    const res = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ sender, message, recipients: [recipient] }),
      signal: AbortSignal.timeout(10000),
    });
    const body = (await res.json().catch(() => null)) as {
      status?: string;
      message?: string;
    } | null;
    if (!res.ok || body?.status !== "success")
      return {
        ok: false,
        error: body?.message ?? `Arkesel answered ${res.status}`,
      };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Arkesel didn't answer: ${String(e)}` };
  }
}
