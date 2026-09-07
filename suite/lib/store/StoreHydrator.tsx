"use client";

import { useEffect } from "react";
import { reconcileLoadedDocument } from "@/lib/seating/normalise";
import { useTrousseauStore } from "./useTrousseauStore";

/**
 * Reads the stored wedding once, on the client.
 *
 * A component rather than a module side effect because IndexedDB does not
 * exist while Next prerenders, and zustand's `persist` middleware would reach
 * for it at import time.
 */
export function StoreHydrator() {
  const hydrate = useTrousseauStore((s) => s.hydrate);
  const startCloudSync = useTrousseauStore((s) => s.startCloudSync);
  useEffect(() => {
    // Cloud sync starts only after the local read has finished. Starting them
    // together would race the two documents, and the local one is what the
    // user already has on this device.
    void hydrate()
      .then(reconcileLoadedDocument)
      .then(() => startCloudSync());
  }, [hydrate, startCloudSync]);

  useEffect(() => {
    // Guarded the same way `schedulePersist` is: this file is imported by
    // tests that run without a `window`.
    if (typeof window === "undefined") return;
    const onOnline = () => void useTrousseauStore.getState().syncToCloud();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  return null;
}
