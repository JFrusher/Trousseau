"use client";

import { useEffect } from "react";
import { reconcileLoadedDocument } from "@/lib/seating/normalise";
import { useTrousseauStore } from "./useTrousseauStore";

/** How often to check for the other partner's changes while the tab is open. */
const PULL_INTERVAL_MS = 20_000;

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

  useEffect(() => {
    if (typeof window === "undefined") return;

    const pull = () => void useTrousseauStore.getState().pullFromCloud();
    const interval = setInterval(pull, PULL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
