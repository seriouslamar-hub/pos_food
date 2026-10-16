import { expect, test } from "@playwright/test";

test.describe("monitoring", () => {
  test("the health check reports the app can reach Supabase", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, supabase: true });
    expect(res.headers()["cache-control"]).toBe("no-store");
  });

  test("browser errors are accepted, and junk is refused", async ({
    request,
  }) => {
    const bad = await request.post("/api/client-errors", { data: { nope: 1 } });
    expect(bad.status()).toBe(400);
    const good = await request.post("/api/client-errors", {
      data: { message: "Test error from the monitoring spec", where: "/till" },
    });
    expect(good.status()).toBe(204);
  });
});
