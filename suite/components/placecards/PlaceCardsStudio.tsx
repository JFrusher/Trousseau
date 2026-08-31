"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Info,
  Layers,
  Minus,
  Plus,
  Square,
  Type,
} from "lucide-react";
import { download } from "@/lib/data/file";
import { useEvent } from "@/lib/model/useSuite";
import { contentId, putBlob } from "@/lib/placecards/blobStore";
import { acceptFont } from "@/lib/placecards/fontLoader";
import { CardCanvas } from "@/lib/placecards/render/svg/CardCanvas";
import { SheetPreview } from "@/lib/placecards/render/svg/SheetPreview";
import { renderPdf } from "@/lib/placecards/render/pdf/renderPdf";
import { buildJob } from "@/lib/placecards/job";
import { makeResolveOptions } from "@/lib/placecards/template/resolve";
import { ELEMENT_KINDS } from "@/lib/placecards/template/registry";
import { newId } from "@/lib/model/ids";
import type { CardElement, ElementId, ElementPatch, Rect } from "@/lib/placecards/types";
import { Button, Empty, Panel } from "@/components/ui/controls";
import { CardPanel } from "./CardPanel";
import { ElementInspector } from "./ElementInspector";
import { useStationery, useStationeryWriter } from "./useStationery";

/**
 * The stationery studio.
 *
 * Plaque, on the suite's own guest list. The card editor, the sheet preview and
 * the whole imposition pipeline are Plaque's, ported unaltered; what changed is
 * where the rows come from — the seating plan, live, instead of a CSV somebody
 * exported an hour ago and has since invalidated.
 */

type Tab = "card" | "elements" | "selected";

export function PlaceCardsStudio() {
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<ElementId | null>(null);
  const [artefactIndex, setArtefactIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [cropId, setCropId] = useState<ElementId | null>(null);
  const [tab, setTab] = useState<Tab>("card");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const view = useStationery(page);
  const write = useStationeryWriter();
  const event = useEvent();

  const { design, rows, headers, artefacts, fonts, images, sheets, sheetCount, warnings, ready } =
    view;
  const artefact = artefacts[Math.min(artefactIndex, Math.max(0, artefacts.length - 1))];
  const selected = design.template.elements.find((el) => el.id === selectedId) ?? null;

  const resolveOptions = useMemo(
    () => makeResolveOptions(fonts, design.uploadedIcons, images, design.assetNames),
    [fonts, design.uploadedIcons, images, design.assetNames],
  );

  // A design change can leave the visible page past the end of the job.
  useEffect(() => {
    if (page > 0 && page >= sheetCount) setPage(Math.max(0, sheetCount - 1));
  }, [page, sheetCount]);

  const patchElement = useCallback(
    (id: ElementId, patch: ElementPatch, label = "editing an element") => {
      write(
        (current) => ({
          ...current,
          template: {
            ...current.template,
            elements: current.template.elements.map((el) =>
              el.id === id ? ({ ...el, ...patch } as CardElement) : el,
            ),
          },
        }),
        label,
      );
    },
    [write],
  );

  const addElement = useCallback(
    (kind: CardElement["kind"]) => {
      const spec = ELEMENT_KINDS.find((k) => k.kind === kind);
      if (!spec) return;
      const id = newId("el");
      write((current) => {
        const z = current.template.elements.reduce((max, el) => Math.max(max, el.z), 0) + 1;
        const element = spec.create({ id, z, card: current.card, headers });
        return {
          ...current,
          template: { ...current.template, elements: [...current.template.elements, element] },
        };
      }, `adding ${kind}`);
      setSelectedId(id);
      setTab("selected");
    },
    [write, headers],
  );

  const savePdf = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      // The whole job this time, not just the visible page: the preview builds
      // one sheet to stay responsive, the export has to build all of them. Same
      // function either way, so the two cannot diverge.
      const job = buildJob({
        template: design.template,
        card: design.card,
        sheet: design.sheet,
        rows: rows.rows,
        headers: rows.headers,
        rowIds: rows.ids,
        resolve: resolveOptions,
        scale: design.printer.scale,
        duplex: {
          flipEdge: design.printer.flipEdge ?? "long",
          backOffsetXMm: design.printer.backOffsetXMm ?? 0,
          backOffsetYMm: design.printer.backOffsetYMm ?? 0,
        },
      });

      if (job.sheets.length === 0) {
        setProblem("No cards fit this sheet. Reduce the margins, or choose a smaller card.");
        return;
      }

      // A silently blank card is the failure this refuses to ship: artwork the
      // design names but this device does not have would print as a gap.
      const missing = job.warnings.filter((w) => w.kind === "missing-image");
      if (missing.length > 0) {
        setProblem(
          `${missing[0]?.detail ?? "A picture is missing."} Export stopped rather than printing a gap.`,
        );
        return;
      }

      const result = await renderPdf({
        sheets: job.sheets,
        fonts,
        scale: design.printer.scale,
        title: `${event.coupleNames || "Wedding"} — stationery`,
        ...(design.sheet.slugLine
          ? { slug: { ruleMm: job.slugRuleMm, texts: job.slugTexts } }
          : {}),
      });

      download(
        `${slugOf(event.coupleNames)}-stationery.pdf`,
        new Blob([result.bytes as BlobPart], { type: "application/pdf" }),
      );
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [design, rows, fonts, resolveOptions, event.coupleNames]);

  const overflowed = warnings.filter((w) => w.kind === "overflow");
  const sheet = sheets[0] ?? null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-charcoal/10 px-4 py-2">
          <Button icon={Type} onClick={() => addElement("text")}>
            Text
          </Button>
          <Button icon={Layers} onClick={() => addElement("list")}>
            List
          </Button>
          <Button icon={Square} onClick={() => addElement("rect")}>
            Box
          </Button>
          <Button icon={Minus} onClick={() => addElement("line")}>
            Line
          </Button>
          <Button icon={ImageIcon} onClick={() => addElement("icon")}>
            Icon
          </Button>
          <Button icon={ImageIcon} onClick={() => addElement("image")}>
            Picture
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Button icon={Minus} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} />
            <span className="text-xs text-slate">{Math.round(zoom * 100)}%</span>
            <Button icon={Plus} onClick={() => setZoom((z) => Math.min(4, z + 0.25))} />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-2 gap-3 overflow-auto p-4 xl:grid-cols-2 xl:grid-rows-1">
          <section className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 rounded border border-charcoal/10 bg-parchment p-3">
              {ready && artefact ? (
                <CardCanvas
                  card={design.card}
                  template={design.template}
                  row={artefact.row}
                  rows={artefact.rows}
                  fonts={fonts}
                  resolveOptions={resolveOptions}
                  selectedId={selectedId}
                  snapEnabled
                  cropId={cropId}
                  zoom={zoom}
                  onSelect={(id) => {
                    setSelectedId(id);
                    if (id) setTab("selected");
                  }}
                  onEditStart={() => undefined}
                  onChange={(id, box: Rect) =>
                    patchElement(id, box as ElementPatch, "moving an element")
                  }
                  onCrop={(id, patch) => patchElement(id, patch as ElementPatch, "cropping")}
                  onZoomChange={setZoom}
                  onRequestCrop={setCropId}
                />
              ) : (
                <Empty>
                  {artefacts.length === 0
                    ? "Nobody to print for yet. Seat some guests, or switch the source to a CSV below."
                    : "Loading the typefaces…"}
                </Empty>
              )}
            </div>
            <nav className="mt-2 flex items-center gap-2 text-xs text-slate">
              <button
                type="button"
                onClick={() => setArtefactIndex((i) => Math.max(0, i - 1))}
                disabled={artefactIndex <= 0}
                aria-label="Previous guest"
                className="disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {artefacts.length === 0
                  ? "No rows"
                  : `${Math.min(artefactIndex, artefacts.length - 1) + 1} of ${artefacts.length}`}
              </span>
              <button
                type="button"
                onClick={() => setArtefactIndex((i) => Math.min(artefacts.length - 1, i + 1))}
                disabled={artefactIndex >= artefacts.length - 1}
                aria-label="Next guest"
                className="disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
              <span className="ml-2">
                Page through to your longest name — if it holds there, it holds everywhere.
              </span>
            </nav>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 rounded border border-charcoal/10 bg-stone/50 p-3">
              {sheet ? (
                <SheetPreview sheet={sheet} fonts={fonts} className="h-full w-full" />
              ) : (
                <Empty>
                  No cards fit this sheet. Reduce the margins, or choose a smaller card.
                </Empty>
              )}
            </div>
            <nav className="mt-2 flex items-center gap-2 text-xs text-slate">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page <= 0}
                aria-label="Previous sheet"
                className="disabled:opacity-30"
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {sheetCount === 0 ? "No sheets" : `Sheet ${Math.min(page, sheetCount - 1) + 1} of ${sheetCount}`}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(sheetCount - 1, p + 1))}
                disabled={page >= sheetCount - 1}
                aria-label="Next sheet"
                className="disabled:opacity-30"
              >
                <ChevronRight size={16} />
              </button>
            </nav>
          </section>
        </div>

        {problem ? (
          <p className="flex gap-2 border-t border-rose/40 bg-rose/10 px-4 py-2 text-sm">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose" />
            <span className="text-charcoal">{problem}</span>
          </p>
        ) : null}
        {overflowed.length > 0 ? (
          <p className="flex gap-2 border-t border-rose/40 bg-rose/10 px-4 py-2 text-sm">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose" />
            <span className="text-charcoal">
              Will not fit, even at the floor size:{" "}
              {overflowed
                .slice(0, 4)
                .map((w) => w.detail)
                .join("; ")}
              {overflowed.length > 4 ? ` and ${overflowed.length - 4} more` : ""}.
            </span>
          </p>
        ) : null}
        {warnings.some((w) => w.kind !== "overflow") ? (
          <p className="flex gap-2 border-t border-charcoal/10 bg-stone px-4 py-2 text-sm">
            <Info size={15} className="mt-0.5 shrink-0 text-slate" />
            <span className="text-slate">
              {warnings.find((w) => w.kind !== "overflow")?.detail}
            </span>
          </p>
        ) : null}
      </main>

      <aside className="flex w-full shrink-0 flex-col border-t border-charcoal/10 lg:w-80 lg:border-t-0 lg:border-l">
        <nav className="flex shrink-0 border-b border-charcoal/10">
          {(
            [
              ["card", "Card & sheet"],
              ["elements", "Layers"],
              ["selected", "Selected"],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "true" : undefined}
              className={`flex-1 px-2 py-2.5 text-xs transition ${
                tab === id ? "border-b-2 border-gold text-charcoal" : "text-slate hover:text-charcoal"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "card" ? <CardPanel view={view} write={write} onProblem={setProblem} /> : null}

          {tab === "elements" ? (
            <Panel title={`Layers (${design.template.elements.length})`}>
              {design.template.elements.length === 0 ? (
                <Empty>Nothing on the card. Add something from the bar above.</Empty>
              ) : (
                <ul className="space-y-1">
                  {[...design.template.elements]
                    .sort((a, b) => b.z - a.z)
                    .map((element) => (
                      <li key={element.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(element.id);
                            setTab("selected");
                          }}
                          className={`w-full truncate rounded border px-2 py-1.5 text-left text-sm transition ${
                            selectedId === element.id
                              ? "border-gold bg-gold/10 text-charcoal"
                              : "border-charcoal/10 text-slate hover:border-charcoal/25"
                          }`}
                        >
                          <span className="mr-2 text-xs text-slate">{element.kind}</span>
                          {describe(element)}
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          ) : null}

          {tab === "selected" ? (
            selected ? (
              <ElementInspector
                element={selected}
                headers={headers}
                rows={artefact?.rows ?? []}
                uploadedFonts={design.fonts}
                uploadedIcons={design.uploadedIcons}
                onPatch={(patch) => patchElement(selected.id, patch)}
                onDuplicate={() => {
                  const id = newId("el");
                  write((current) => {
                    const source = current.template.elements.find((el) => el.id === selected.id);
                    if (!source) return current;
                    const z = current.template.elements.reduce((m, el) => Math.max(m, el.z), 0) + 1;
                    return {
                      ...current,
                      template: {
                        ...current.template,
                        elements: [
                          ...current.template.elements,
                          { ...source, id, z, x: source.x + 3, y: source.y + 3 },
                        ],
                      },
                    };
                  }, "duplicating an element");
                  setSelectedId(id);
                }}
                onDelete={() => {
                  write(
                    (current) => ({
                      ...current,
                      template: {
                        ...current.template,
                        elements: current.template.elements.filter((el) => el.id !== selected.id),
                      },
                    }),
                    "deleting an element",
                  );
                  setSelectedId(null);
                }}
              />
            ) : (
              <Empty>Pick something on the card, or a layer, to change it.</Empty>
            )
          ) : null}
        </div>

        <div className="shrink-0 border-t border-charcoal/10 p-4">
          <button
            type="button"
            disabled={busy || sheetCount === 0}
            onClick={() => void savePdf()}
            className="inline-flex w-full items-center justify-center gap-2 rounded border border-gold bg-gold/15 px-3 py-2 text-charcoal transition hover:bg-gold/25 disabled:opacity-40"
          >
            <Download size={16} />
            {busy ? "Writing…" : `Download ${sheetCount} sheet${sheetCount === 1 ? "" : "s"}`}
          </button>
          <p className="mt-1.5 text-xs text-slate">
            Print at 100% — not &ldquo;fit to page&rdquo;. It matters more than anything else here.
          </p>
          <input ref={imageInput} type="file" accept="image/png,image/jpeg" className="hidden" />
        </div>
      </aside>
    </div>
  );
}

function describe(element: CardElement): string {
  const spec = ELEMENT_KINDS.find((k) => k.kind === element.kind);
  return spec?.describe(element) || element.kind;
}

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "wedding";

export { contentId, putBlob, acceptFont };
