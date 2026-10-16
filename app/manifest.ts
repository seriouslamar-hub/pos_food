import type { MetadataRoute } from "next";

/** Lets tills, kitchen screens and pickup boards be installed as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fast-Food POS",
    short_name: "POS",
    description:
      "Point of sale, kitchen display and back office for fast-food branches.",
    start_url: "/till",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
