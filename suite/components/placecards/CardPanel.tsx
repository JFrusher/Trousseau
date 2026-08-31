"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, Sparkles } from "lucide-react";
import { readTextFile } from "@/lib/data/file";
import { contentId, putBlob } from "@/lib/placecards/blobStore";
import { ELEMENT_KINDS } from "@/lib/placecards/template/registry";
import { newId } from "@/lib/model/ids";
import { parseCsv } from "@/lib/placecards/csv/parse";
import { GALLERY } from "@/lib/placecards/data/gallery";
import { acceptFont } from "@/lib/placecards/fontLoader";
import { suggestLayouts } from "@/lib/placecards/geometry/suggestLayouts";
import { defaultTemplate } from "@/lib/placecards/template/defaults";
import { rebindTemplate } from "@/lib/placecards/template/rebind";
import { describeScale, isNotableDrift } from "@/lib/placecards/print/printerProfile";
import type { Stationery } from "@/lib/placecards/stationery";
import { PLAN_HEADERS } from "@/lib/placecards/stationery";
import type { CardElement, CardSpec, SheetSpec } from "@/lib/placecards/types";
import {
  Button,
  Check,
  Empty,
  NumberField,
  Panel,
  Segmented,
  SelectField,
} from "@/components/ui/controls";
import type { StationeryView } from "./useStationery";

/**
 * The card, the sheet it prints on, where the words come from, and the printer
 * it is going to.
 *
 * The row source is first because it is the decision that makes this tool part
 * of the suite rather than a separate app: the plan already knows who sits
 * where, and re-uploading a CSV to tell it again is how the two come to
 * disagree.
 */
export function CardPanel({
  view,
  write,
  onProblem,
}: {
  view: StationeryView;
  write: (next: (current: Stationery) => Stationery, label: string) => void;
  onProblem: (message: string | null) => void;
}) {
  const { design, artefacts } = view;
  const csvInput = useRef<HTMLInputElement>(null);
  const fontInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [showGallery, setShowGallery] = useState(false);

  const suggestions = useMemo(
    () =>
      suggestLayouts(design.card, {
        printerMarginMm: design.printer.unprintableMarginMm ?? 5,
        maxResults: 5,
      }),
    [design.card, design.printer.unprintableMarginMm],
  );

  const patchCard = (patch: Partial<CardSpec>) =>
    write((c) => {
      const card = { ...c.card, ...patch };
      // A fold outside the card is not a fold. Keep it inside whichever
      // dimension it runs across.
      if (card.fold !== "none") {
        const span = card.fold === "vertical" ? card.widthMm : card.heightMm;
        card.foldPositionMm = Math.min(Math.max(1, card.foldPositionMm), span - 1);
      }
      return { ...c, card };
    }, "the card");

  const patchSheet = (patch: Partial<SheetSpec>) =>
    write((c) => ({ ...c, sheet: { ...c.sheet, ...patch } }), "the sheet");

  return (
    <>
      <Panel title="Where the words come from">
        <Segmented
          value={design.rowSource}
          onChange={(rowSource) => write((c) => ({ ...c, rowSource }), "the source")}
          options={[
            { value: "plan", label: "The seating plan" },
            { value: "csv", label: "A CSV" },
          ]}
        />
        <p className="mt-2 text-xs text-slate">
          {design.rowSource === "plan" ? (
            <>
              {artefacts.length} card{artefacts.length === 1 ? "" : "s"} from the plan. Move somebody
              in the room and their card follows — nothing is typed twice.
            </>
          ) : (
            <>
              {design.csv
                ? `${design.csv.rows.length} rows from ${design.csv.fileName ?? "an uploaded file"}.`
                : "Nothing uploaded yet."}{" "}
              For a job the plan cannot describe — service dockets, a list that is not this wedding.
            </>
          )}
        </p>

        {design.rowSource === "csv" ? (
          <div className="mt-2">
            <Button icon={FileUp} onClick={() => csvInput.current?.click()}>
              Upload CSV
            </Button>
            <input
              ref={csvInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void readTextFile(file).then((text) => {
                  const parsed = parseCsv(text);
                  const fatal = parsed.issues.find((i) => i.row === null && parsed.rows.length === 0);
                  if (fatal) {
                    onProblem(fatal.message);
                    return;
                  }
                  onProblem(null);
                  write(
                    (c) => ({
                      ...c,
                      csv: { headers: parsed.headers, rows: parsed.rows, fileName: file.name },
                      // The design keeps its shape and its bindings move onto
                      // whatever this file calls the same things.
                      template: rebindTemplate(c.template, [...PLAN_HEADERS], parsed.headers)
                        .template,
                    }),
                    "the guest list",
                  );
                });
              }}
            />
          </div>
        ) : null}
      </Panel>

      <Panel title="Start from a design" right={
        <button
          type="button"
          onClick={() => setShowGallery((v) => !v)}
          className="text-xs text-slate transition hover:text-charcoal"
        >
          {showGallery ? "Hide" : "Show"}
        </button>
      }>
        {showGallery ? (
          <div className="space-y-1.5">
            {GALLERY.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() =>
                  write(
                    (c) => ({
                      ...c,
                      card: { ...c.card, ...entry.card },
                      template: rebindTemplate(
                        entry.template,
                        // The gallery is written against these column names.
                        ["First Name", "Last Name", "Table", "Dietary", "Entree"],
                        view.headers,
                      ).template,
                    }),
                    "starting a design",
                  )
                }
                className="w-full rounded border border-charcoal/10 px-2 py-1.5 text-left transition hover:border-gold"
              >
                <span className="block text-sm text-charcoal">{entry.name}</span>
                <span className="block text-xs text-slate">{entry.description}</span>
              </button>
            ))}
            <Button
              onClick={() =>
                write(
                  (c) => ({ ...c, template: defaultTemplate(view.headers, c.card) }),
                  "starting a design",
                )
              }
            >
              Plain start
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate">
            {GALLERY.length} starting points, each rebound onto your own columns.
          </p>
        )}
      </Panel>

      <Panel title="Card">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Width"
              suffix="mm"
              step={0.5}
              value={design.card.widthMm}
              onChange={(widthMm) => patchCard({ widthMm })}
            />
            <NumberField
              label="Height"
              suffix="mm"
              step={0.5}
              value={design.card.heightMm}
              onChange={(heightMm) => patchCard({ heightMm })}
            />
          </div>
          <SelectField
            label="Fold"
            value={design.card.fold}
            onChange={(fold) =>
              patchCard({
                fold,
                foldPositionMm:
                  fold === "vertical" ? design.card.widthMm / 2 : design.card.heightMm / 2,
              })
            }
            options={[
              { value: "none", label: "Flat" },
              { value: "horizontal", label: "Tent — folds across" },
              { value: "vertical", label: "Folds down the middle" },
            ]}
          />
          {design.card.fold !== "none" ? (
            <>
              <NumberField
                label="Fold at"
                suffix="mm"
                step={0.5}
                value={design.card.foldPositionMm}
                onChange={(foldPositionMm) => patchCard({ foldPositionMm })}
              />
              {design.card.fold === "horizontal" ? (
                <>
                  <Check
                    label="Turn the back panel 180°"
                    checked={design.card.invertBackPanel}
                    onChange={(invertBackPanel) => patchCard({ invertBackPanel })}
                  />
                  <p className="text-xs text-slate">
                    So the name reads from across the table once the card is stood up.
                  </p>
                </>
              ) : (
                <p className="text-xs text-slate">
                  A fold down the middle mirrors the back panel rather than rotating it, and no
                  rotation fixes mirrored text — so the turn is not offered here.
                </p>
              )}
            </>
          ) : null}
          <NumberField
            label="Bleed"
            suffix="mm"
            step={0.5}
            min={0}
            value={design.card.bleedMm}
            onChange={(bleedMm) => patchCard({ bleedMm })}
          />
          <p className="text-xs text-slate">
            Bleed only matters if colour runs to the edge. 3mm is standard, and gaps then need to be
            at least twice it.
          </p>
        </div>
      </Panel>

      <Panel title="Fits best">
        {suggestions.length === 0 ? (
          <Empty>Nothing fits this card. Try a smaller one, or a bigger page.</Empty>
        ) : (
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => patchSheet(s.patch)}
                  className="flex w-full items-center gap-2 rounded border border-charcoal/10 px-2 py-1.5 text-left text-sm transition hover:border-gold"
                >
                  <Sparkles size={13} className="shrink-0 text-gold" />
                  <span className="min-w-0 flex-1 truncate text-charcoal">{s.label}</span>
                  <span className="shrink-0 text-xs text-slate">{s.perSheet}/sheet</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Sheet">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              value={design.sheet.page}
              onChange={(page) => patchSheet({ page })}
              options={[
                { value: "A4", label: "A4" },
                { value: "LETTER", label: "US Letter" },
              ]}
            />
            <SelectField
              value={design.sheet.orientation}
              onChange={(orientation) => patchSheet({ orientation })}
              options={[
                { value: "portrait", label: "Portrait" },
                { value: "landscape", label: "Landscape" },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Margin"
              suffix="mm"
              step={0.5}
              value={design.sheet.marginTopMm}
              onChange={(m) =>
                patchSheet({
                  marginTopMm: m,
                  marginBottomMm: m,
                  marginLeftMm: m,
                  marginRightMm: m,
                })
              }
            />
            <NumberField
              label="Gap"
              suffix="mm"
              step={0.5}
              value={design.sheet.gapXMm}
              onChange={(g) => patchSheet({ gapXMm: g, gapYMm: g })}
            />
          </div>
          <div className="space-y-1.5">
            <Check
              label="Crop marks"
              checked={design.sheet.cropMarks}
              onChange={(cropMarks) => patchSheet({ cropMarks })}
            />
            <Check
              label="Cut lines"
              checked={design.sheet.cutLines}
              onChange={(cutLines) => patchSheet({ cutLines })}
            />
            <Check
              label="Fold guides"
              checked={design.sheet.foldGuides}
              onChange={(foldGuides) => patchSheet({ foldGuides })}
            />
            <Check
              label="Bleed boundary — on screen only"
              checked={design.sheet.bleedGuides}
              onChange={(bleedGuides) => patchSheet({ bleedGuides })}
            />
            <Check
              label="Turn each card 90° to fit more"
              checked={design.sheet.cardRotationDeg === 90}
              onChange={(on) => patchSheet({ cardRotationDeg: on ? 90 : 0 })}
            />
            <Check
              label="Print the backs on the reverse"
              checked={design.sheet.duplex}
              onChange={(duplex) => patchSheet({ duplex })}
            />
            <Check
              label="Print a settings strip on each sheet"
              checked={design.sheet.slugLine}
              onChange={(slugLine) => patchSheet({ slugLine })}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Your printer">
        <div className="space-y-2">
          <NumberField
            label="Border it cannot reach"
            suffix="mm"
            step={0.5}
            min={0}
            value={design.printer.unprintableMarginMm ?? 5}
            onChange={(unprintableMarginMm) =>
              write((c) => ({ ...c, printer: { ...c.printer, unprintableMarginMm } }), "the printer")
            }
          />
          <NumberField
            label="Scale correction"
            step={0.001}
            value={design.printer.scale}
            onChange={(scale) =>
              write((c) => ({ ...c, printer: { ...c.printer, scale } }), "the printer")
            }
          />
          <p className="text-xs text-slate">
            {isNotableDrift(design.printer.scale)
              ? describeScale(design.printer.scale)
              : "Leave at 1 unless you have printed a sheet and measured a card with a ruler."}
          </p>
        </div>
      </Panel>

      <Panel title="Your own fonts and pictures">
        <div className="flex flex-wrap gap-2">
          <Button icon={FileUp} onClick={() => fontInput.current?.click()}>
            Font
          </Button>
          <Button icon={FileUp} onClick={() => imageInput.current?.click()}>
            Picture
          </Button>
        </div>
        <input
          ref={fontInput}
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void file.arrayBuffer().then(async (buffer) => {
              const bytes = new Uint8Array(buffer);
              const id = `upload:${contentId(bytes)}`;
              const family = file.name.replace(/\.[a-z0-9]+$/i, "");
              try {
                acceptFont(id, family, bytes);
              } catch (cause) {
                onProblem(cause instanceof Error ? cause.message : String(cause));
                return;
              }
              await putBlob(id, bytes);
              onProblem(null);
              write(
                (c) => ({
                  ...c,
                  fonts: { ...c.fonts, [id]: family },
                  assetNames: { ...c.assetNames, [id]: file.name },
                }),
                "adding a font",
              );
            });
          }}
        />
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void file.arrayBuffer().then(async (buffer) => {
              const bytes = new Uint8Array(buffer);
              const id = contentId(bytes);
              await putBlob(id, bytes);
              onProblem(null);
              write(
                (c) => ({
                  ...c,
                  assetNames: { ...c.assetNames, [id]: file.name },
                  template: {
                    ...c.template,
                    elements: attachImage(c.template.elements, id, c.card),
                  },
                }),
                "adding a picture",
              );
            });
          }}
        />
        <p className="mt-1.5 text-xs text-slate">
          PNG and JPEG — those are the formats a PDF can carry. Web fonts (.woff) cannot be
          embedded; find the .ttf or .otf the font shipped with.
        </p>
      </Panel>
    </>
  );
}

/**
 * Put newly uploaded artwork on the card.
 *
 * Onto the first picture element with nothing in it, or onto a new one. An
 * upload that stored the bytes and then quietly did nothing — because the card
 * happened to have no picture element — looked exactly like a failure.
 */
function attachImage(
  elements: CardElement[],
  imageId: string,
  card: { widthMm: number; heightMm: number },
): CardElement[] {
  const target = elements.find((el) => el.kind === "image" && el.imageId === null);
  if (target) return elements.map((el) => (el === target ? { ...el, imageId } : el));

  const spec = ELEMENT_KINDS.find((k) => k.kind === "image");
  if (!spec) return elements;
  const z = elements.reduce((max, el) => Math.max(max, el.z), 0) + 1;
  const created = spec.create({ id: newId("el"), z, card: card as never, headers: [] });
  return [...elements, { ...created, imageId } as CardElement];
}
