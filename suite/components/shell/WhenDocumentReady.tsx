"use client";

import { Fragment } from "react";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";

/**
 * Holds a tool back until the stored wedding has actually been read.
 *
 * The document is loaded from IndexedDB by an effect, so for the first moments
 * after the page appears the store is empty but perfectly willing to answer
 * questions about itself. A tool mounted into that window sees a wedding with
 * nothing in it, decides that is the truth, and autosaves it — writing an empty
 * day over a real one. The store refuses writes until it is ready, which turns
 * the loud version of that bug into a silent one: the edit simply vanishes.
 *
 * Each tool is loaded as its own chunk, so whether it arrives before or after
 * the document is a race between a network fetch and a database read. Nothing
 * here should depend on who wins.
 *
 * A gate rather than a fix inside each tool, because all four have the same
 * shape — read the document on mount, autosave on change — and none of them
 * should have to know that the thing they are reading arrives late.
 *
 * It also handles the document arriving *twice*. Restoring from a file, or
 * opening a wedding shared from another machine, swaps the whole document while
 * a tool is on screen — and a tool only reads on mount, so it carries on
 * showing the previous wedding. Keying the children on the generation remounts
 * the tool, which sends it back down the path that already works rather than
 * teaching each of the four to re-read.
 */
export function WhenDocumentReady({ children }: { children: React.ReactNode }) {
  const status = useTrousseauStore((s) => s.status);
  const error = useTrousseauStore((s) => s.error);
  const generation = useTrousseauStore((s) => s.generation);

  if (status === "error") {
    return (
      <p role="alert" className="p-6 text-sm text-slate">
        {error ?? "The saved wedding could not be read."}
      </p>
    );
  }

  // Deliberately blank rather than a spinner: this is a local database read,
  // over in a frame or two, and a flash of loading text is worse than nothing.
  if (status !== "ready") return null;

  return <Fragment key={generation}>{children}</Fragment>;
}
