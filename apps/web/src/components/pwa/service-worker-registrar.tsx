"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/pwa";

/** Registers the service worker once the page has loaded. Renders nothing. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return null;
}
