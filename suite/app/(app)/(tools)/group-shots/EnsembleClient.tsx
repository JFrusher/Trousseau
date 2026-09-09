"use client";

import dynamic from "next/dynamic";

/**
 * Ensemble, split out of the main bundle.
 *
 * It is already a self-contained client component with no scoped CSS and no
 * `WhenDocumentReady`-style readiness gate to carry over — this file exists
 * only because `next/dynamic(..., { ssr: false })` is a Client Component API,
 * and `page.tsx` has to stay a Server Component to keep its `metadata` export.
 */
const EnsembleBoard = dynamic(
  () => import("@/components/ensemble/EnsembleBoard").then((m) => m.EnsembleBoard),
  { ssr: false },
);

export function EnsembleClient() {
  return <EnsembleBoard />;
}
