import { readGuests, readSeating } from "@/lib/model/slices";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { reconcile } from "./actions";

/**
 * Bring a freshly loaded document's two records of a seat back into agreement.
 *
 * A seat is stored twice — on the table and on the guest — and a document that
 * arrives from somewhere else may already disagree: an older export, a
 * hand-edited file, or two of the original standalone apps that were never
 * reconciled. The Trousseau validator refuses a commit over exactly this, so it
 * is fixed on the way in rather than carried around.
 *
 * Called after a load, never during editing: the actions keep both sides true
 * from then on. A no-op writes nothing, so a clean document is not touched.
 */
export function reconcileLoadedDocument(): void {
  const { doc, status, setSlice } = useTrousseauStore.getState();
  if (status !== "ready") return;

  const before = readGuests(doc);
  const after = reconcile({ guests: before, seating: readSeating(doc) });
  // Silent: the user did not make this change, and undoing back into a
  // knowingly inconsistent document would help nobody.
  if (after.guests !== before) setSlice("guests", after.guests, { silent: true });
}
