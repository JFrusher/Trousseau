"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Places in the header that the tool on screen fills in.
 *
 * Each tool arrived with a complete header of its own, so every page carried
 * two: the suite's, and then the tool's own wordmark with its own undo, its own
 * save, its own everything. Two undo buttons on one screen is not a cosmetic
 * problem — the top one did nothing to the edit you had just made, because the
 * tools write their slices silently and the document's history never saw them.
 *
 * So there is one header, and the tool puts its controls into it.
 *
 * By portal rather than by context, which was the obvious first design and the
 * wrong one. Handing the shell a description of the tool's controls means the
 * tool pushing new state up on every render that changes whether undo is
 * available — a render loop waiting to happen, in a codebase that has met
 * React error #185 three times already. A portal moves the rendered nodes and
 * nothing else: each tool keeps its own undo, its own disabled logic and its
 * own handlers, and the shell only lends it somewhere to appear.
 */

/** Somewhere for a tool to render into. `contents` so it adds no box of its own. */
export function ChromeSlot({ name }: { name: string }) {
  return <div data-chrome-slot={name} className="contents" />;
}

/**
 * Renders `children` into the named slot, or nowhere if the header has none —
 * which is the case on the pages that are not a tool, and is not an error.
 */
export function ChromeFill({
  name,
  tokens,
  children,
}: {
  name: string;
  /**
   * The tool's token class — `plaque-tokens` and so on.
   *
   * A portal moves the nodes out of the tool and into the header, which is
   * outside the tool's scope, so the variables its stylesheets read stop
   * resolving and the controls arrive with no border, no padding and no
   * colour. This carries the palette across with them.
   */
  tokens?: string;
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<Element | null>(null);

  useEffect(() => {
    // After mount: the header is above the tools in the tree, so by the time a
    // tool runs this the slot is already on the page.
    setSlot(document.querySelector(`[data-chrome-slot="${name}"]`));
    return () => setSlot(null);
  }, [name]);

  if (!slot) return null;
  // `contents` so the wrapper carries variables without adding a box to the
  // header's own flex layout.
  return createPortal(
    tokens ? <div className={`${tokens} contents`}>{children}</div> : children,
    slot,
  );
}
