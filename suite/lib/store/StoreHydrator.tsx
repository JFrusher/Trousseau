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
  useEffect(() => {
    void hydrate().then(reconcileLoadedDocument);
  }, [hydrate]);
  return null;
}
