import { describe, expect, it } from "vitest";
import {
  signStandardWebhook,
  verifyStandardWebhook,
} from "./webhook-signature";

const secret = `v1,whsec_${Buffer.from("a-very-secret-key-for-tests").toString("base64")}`;
const body = JSON.stringify({
  user: { phone: "233240000001" },
  sms: { otp: "123456" },
});
const now = 1_790_000_000;

describe("verifyStandardWebhook", () => {
  it("accepts a correctly signed, fresh message", () => {
    const signature = signStandardWebhook(body, "msg_1", now, secret);
    expect(
      verifyStandardWebhook(
        body,
        { id: "msg_1", timestamp: String(now), signature },
        secret,
        now,
      ),
    ).toBe(true);
  });

  it("accepts it among several signatures (secret rotation)", () => {
    const signature = `v1,bm90LWl0 ${signStandardWebhook(body, "msg_1", now, secret)}`;
    expect(
      verifyStandardWebhook(
        body,
        { id: "msg_1", timestamp: String(now), signature },
        secret,
        now,
      ),
    ).toBe(true);
  });

  it("refuses a changed body, a wrong secret or an old message", () => {
    const signature = signStandardWebhook(body, "msg_1", now, secret);
    const h = { id: "msg_1", timestamp: String(now), signature };
    expect(
      verifyStandardWebhook(body.replace("123456", "000000"), h, secret, now),
    ).toBe(false);
    expect(
      verifyStandardWebhook(
        body,
        h,
        `v1,whsec_${Buffer.from("other").toString("base64")}`,
        now,
      ),
    ).toBe(false);
    expect(verifyStandardWebhook(body, h, secret, now + 600)).toBe(false);
    expect(
      verifyStandardWebhook(body, { ...h, signature: null }, secret, now),
    ).toBe(false);
  });
});
