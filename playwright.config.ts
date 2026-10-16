import { execSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run the app against the LOCAL Supabase stack only
 * (`npm run db:start`, then `npm run db:reset` for fresh seed data). The
 * keys come from `supabase status`, never from .env.local, and the config
 * refuses to run against anything that isn't localhost.
 */
function localSupabase() {
  const out = execSync("npx supabase status -o env", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const env: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.API_URL ?? "")) {
    throw new Error(
      "End-to-end tests need the local Supabase stack. Run `npm run db:start` first.",
    );
  }
  return {
    url: env.API_URL,
    anonKey: env.PUBLISHABLE_KEY || env.ANON_KEY,
    serviceKey: env.SECRET_KEY || env.SERVICE_ROLE_KEY,
  };
}

const supabase = localSupabase();
process.env.E2E_SUPABASE_URL = supabase.url;
process.env.E2E_SUPABASE_SERVICE_KEY = supabase.serviceKey;

const PORT = 3100;
// localhost, not 127.0.0.1: the Next dev server only serves its scripts to
// the hostname it started on.
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Tests share the seeded till and its PIN lockout state, so run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    // A 10" tablet in landscape, as the till runs on.
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: baseURL,
    // Never reuse a server: one started elsewhere might point at production.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: supabase.serviceKey,
      // The pretend payment provider (refused unless the database is local).
      PAYMENTS_PROVIDER: "test",
    },
  },
});
