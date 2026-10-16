import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Versions the precached offline page: the deployment, else the commit.
const revision =
  process.env.VERCEL_DEPLOYMENT_ID ||
  spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).stdout?.trim() ||
  crypto.randomUUID();

// Builds and serves the service worker (app/sw.ts) at /serwist/sw.js.
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    additionalPrecacheEntries: [{ url: "/~offline", revision }],
    swSrc: "app/sw.ts",
    useNativeEsbuild: true,
  });
