/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * The service worker: keeps the app's files so tills, kitchen screens and
 * pickup boards start without a connection. Pages are fetched from the
 * network first and kept, so a till that loaded /till once can reload it
 * offline; anything never loaded falls back to /~offline. The till's sales
 * themselves wait in its outbox (lib/offline), not here.
 */
import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
