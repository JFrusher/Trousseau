"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { download } from "@/lib/data/file";
import type { OutputId, StyleSpec, TimelineDoc } from "@/lib/timeline/core/model/types";
import { browserFontSource } from "@/lib/timeline/render/pdf/fontSource";
import { renderAllCallSheets, callSheetTags } from "@/lib/timeline/render/pdf/callSheet";
import { renderContactSheet } from "@/lib/timeline/render/pdf/contactSheet";
import { renderOrderOfDay } from "@/lib/timeline/render/pdf/orderOfDay";
import { renderRunSheet } from "@/lib/timeline/render/pdf/runSheet";
import { renderTimeline } from "@/lib/timeline/render/pdf/timeline";
import { BUNDLED_FONTS } from "@/lib/timeline/assets/fonts";
import { Button, NumberField, Panel, SelectField } from "@/components/ui/controls";

/**
 * The paper that runs the day.
 *
 * Five pieces, all of them Cadence's own renderers, all reading the resolved
 * day rather than the document — so the printed times and the times on screen
 * come from the same function and cannot disagree.
 */

interface Piece {
  id: string;
  label: string;
  note: string;
  render: (doc: TimelineDoc) => Promise<Uint8Array>;
}

const PIECES: Piece[] = [
  {
    id: "run-sheet",
    label: "Master run-sheet",
    note: "Everything, in order, with the clashes marked.",
    render: (doc) => renderRunSheet(doc, { fontSource: browserFontSource() }),
  },
  {
    id: "call-sheet",
    label: "Call sheets",
    note: "One per supplier — only what they need, and when.",
    render: (doc) => renderAllCallSheets(doc, { fontSource: browserFontSource() }),
  },
  {
    id: "order-of-day",
    label: "Order of the day",
    note: "The guest-facing piece. No supplier detail on it.",
    render: (doc) => renderOrderOfDay(doc, { fontSource: browserFontSource() }),
  },
  {
    id: "contact-sheet",
    label: "Contact sheet",
    note: "Who to ring, and when they arrive.",
    render: (doc) => renderContactSheet(doc, { fontSource: browserFontSource() }),
  },
  {
    id: "timeline",
    label: "The day to scale",
    note: "One page, a column per lane, the whole day at a glance.",
    render: (doc) => renderTimeline(doc, { fontSource: browserFontSource() }),
  },
];

export function PrintPanel({ doc, title }: { doc: TimelineDoc; title: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const slug =
    title
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "wedding";

  const make = useCallback(
    async (piece: Piece) => {
      setBusy(piece.id);
      setProblem(null);
      try {
        const bytes = await piece.render(doc);
        download(`${slug}-${piece.id}.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }));
      } catch (cause) {
        setProblem(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [doc, slug],
  );

  const suppliers = callSheetTags(doc);

  return (
    <>
      <Panel title="Print">
        {problem ? (
          <p className="mb-2 flex gap-2 rounded border border-rose/40 bg-rose/10 px-2 py-1.5 text-xs">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose" />
            <span className="text-charcoal">{problem}</span>
          </p>
        ) : null}

        <div className="space-y-1.5">
          {PIECES.map((piece) => (
            <div key={piece.id}>
              <Button
                icon={Download}
                onClick={() => void make(piece)}
                disabled={busy !== null || doc.blocks.length === 0}
              >
                {busy === piece.id ? "Writing…" : piece.label}
              </Button>
              <p className="mt-0.5 text-xs text-slate">
                {piece.note}
                {piece.id === "call-sheet" && suppliers.length > 0
                  ? ` ${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"}.`
                  : ""}
              </p>
            </div>
          ))}
        </div>

        {doc.blocks.length === 0 ? (
          <p className="mt-2 text-xs text-slate">Build the day first — there is nothing to print.</p>
        ) : (
          <p className="mt-2 text-xs text-slate">
            Vector PDFs with the fonts embedded. Text stays text: selectable, sharp, and the same on
            the print shop&rsquo;s machine as on yours.
          </p>
        )}
      </Panel>

      <StylePanel doc={doc} />
    </>
  );
}

/**
 * How each piece is set.
 *
 * Per piece rather than per document, because the order of the day is a
 * guest-facing thing that wants a different face from the run-sheet the
 * coordinator is holding in the rain.
 */
function StylePanel({ doc }: { doc: TimelineDoc }) {
  const [which, setWhich] = useState<OutputId>("run-sheet");
  const style: StyleSpec | undefined = doc.styles[which];
  if (!style) return null;

  return (
    <Panel title="How it is set">
      <div className="space-y-2">
        <SelectField
          value={which}
          onChange={setWhich}
          options={doc.outputs.map((o) => ({ value: o.id, label: o.label }))}
        />
        <SelectField
          label="Face"
          value={style.fontFamily}
          onChange={() => undefined}
          options={BUNDLED_FONTS.map((f) => ({ value: f.family, label: f.family }))}
        />
        <NumberField
          label="Type scale"
          step={0.05}
          value={style.typeScale}
          onChange={() => undefined}
        />
        <p className="text-xs text-slate">
          {/* ponytail: read-only for now. The renderers take these from the
              document already, so wiring the writes is a one-line change to the
              timeline slice — but nobody has asked to restyle a run-sheet yet,
              and a control that writes nothing is worse than one that is
              plainly not editable. */}
          Shown as the piece is currently set. Restyling is not wired up yet.
        </p>
      </div>
    </Panel>
  );
}
