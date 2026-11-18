import type { MetadataRoute } from "next";

/** Lets browsers install Orbit as an app. The colors match the light theme's `themeColor`. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Orbit",
    short_name: "Orbit",
    description: "Your private, self-hosted personal assistant.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fdfaf6",
    theme_color: "#fdfaf6",
    categories: ["productivity", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
