import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Checks a Standard Webhooks signature (what Supabase Auth hooks send):
 * HMAC-SHA256 of "<id>.<timestamp>.<body>" with the secret ("v1,whsec_…",
 * base64 after the prefix), in the webhook-signature header as one or more
 * "v1,<base64>". Refuses messages older or newer than 5 minutes.
 */
export function verifyStandardWebhook(
  body: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const key = Buffer.from(
    secret.replace(/^v1,/, "").replace(/^whsec_/, ""),
    "base64",
  );
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  return signature
    .split(" ")
    .map((part) => part.split(","))
    .some(([version, sig]) => {
      if (version !== "v1" || !sig) return false;
      const given = Buffer.from(sig, "base64");
      return (
        given.length === expected.length && timingSafeEqual(given, expected)
      );
    });
}

/** Signs a body the same way (tests, and checking a set-up). */
export function signStandardWebhook(
  body: string,
  id: string,
  timestamp: number,
  secret: string,
): string {
  const key = Buffer.from(
    secret.replace(/^v1,/, "").replace(/^whsec_/, ""),
    "base64",
  );
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}
