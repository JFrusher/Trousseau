"use client";

import { Copy, Trash2 } from "lucide-react";
import { BUNDLED_FONTS } from "@/lib/placecards/assets/fonts";
import { BUNDLED_ICONS } from "@/lib/placecards/assets/icons";
import { distinctValues, unmappedValues } from "@/lib/placecards/template/icons";
import type { GuestRow } from "@/lib/placecards/csv/parse";
import type { CardElement, ElementPatch, FitMode } from "@/lib/placecards/types";
import {
  Button,
  Check,
  NumberField,
  Panel,
  SelectField,
  TextArea,
  TextField,
} from "@/components/ui/controls";

/**
 * Every property of whatever is selected.
 *
 * One panel switching on `kind` rather than five components, because the fields
 * they share — position, size, colour — are most of each one, and five copies
 * of a millimetre box is five places for the rounding to differ.
 */

const FIT_MODES: Array<{ value: FitMode; label: string }> = [
  { value: "shrink", label: "Shrink to fit" },
  { value: "wrap", label: "Wrap onto more lines" },
  { value: "shrink-then-wrap", label: "Wrap, then shrink" },
  { value: "none", label: "Leave it and warn me" },
];

export function ElementInspector({
  element,
  headers,
  rows,
  uploadedFonts,
  uploadedIcons,
  onPatch,
  onDuplicate,
  onDelete,
}: {
  element: CardElement;
  headers: string[];
  rows: GuestRow[];
  uploadedFonts: Record<string, string>;
  uploadedIcons: Record<string, string>;
  onPatch: (patch: ElementPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const fontOptions = [
    ...BUNDLED_FONTS.map((f) => ({ value: f.id, label: f.label })),
    ...Object.entries(uploadedFonts).map(([id, family]) => ({ value: id, label: `${family} (yours)` })),
  ];

  return (
    <>
      <Panel title={`${element.kind} · position`}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" suffix="mm" step={0.5} value={round(element.x)} onChange={(x) => onPatch({ x })} />
          <NumberField label="Y" suffix="mm" step={0.5} value={round(element.y)} onChange={(y) => onPatch({ y })} />
          <NumberField label="Width" suffix="mm" step={0.5} value={round(element.w)} onChange={(w) => onPatch({ w })} />
          <NumberField label="Height" suffix="mm" step={0.5} value={round(element.h)} onChange={(h) => onPatch({ h })} />
        </div>
        <p className="mt-1 text-xs text-slate">
          Drag to get close, type to be exact. Arrow keys nudge 1mm; hold shift for 0.1mm.
        </p>
      </Panel>

      {element.kind === "text" || element.kind === "list" ? (
        <Panel title="Words">
          {element.kind === "text" ? (
            <TextArea
              label="Content — {{Column}} becomes that guest's value"
              rows={2}
              value={element.template}
              onChange={(template) => onPatch({ template })}
            />
          ) : (
            <>
              <TextField
                label="One line per row"
                value={element.itemTemplate}
                onChange={(itemTemplate) => onPatch({ itemTemplate })}
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <TextField label="Bullet" value={element.bullet} onChange={(bullet) => onPatch({ bullet })} />
                <div className="flex items-end pb-1.5">
                  <Check
                    label="Skip blank rows"
                    checked={element.skipEmpty}
                    onChange={(skipEmpty) => onPatch({ skipEmpty })}
                  />
                </div>
              </div>
            </>
          )}

          <div className="mt-2 flex flex-wrap gap-1">
            {headers.map((header) => (
              <button
                key={header}
                type="button"
                onClick={() => {
                  const token = `{{${header}}}`;
                  if (element.kind === "text") onPatch({ template: `${element.template}${token}` });
                  else onPatch({ itemTemplate: `${element.itemTemplate}${token}` });
                }}
                className="rounded-full border border-charcoal/15 px-2 py-0.5 text-xs text-slate transition hover:border-gold hover:text-charcoal"
              >
                {header}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      {element.kind === "text" || element.kind === "list" ? (
        <Panel title="Type">
          <div className="space-y-2">
            <SelectField
              label="Face"
              value={element.fontId}
              onChange={(fontId) => onPatch({ fontId })}
              options={fontOptions}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Size"
                suffix="pt"
                step={0.5}
                value={element.fontSizePt}
                onChange={(fontSizePt) => onPatch({ fontSizePt })}
              />
              <NumberField
                label="Line height"
                step={0.05}
                value={element.lineHeight}
                onChange={(lineHeight) => onPatch({ lineHeight })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                label="Across"
                value={element.align}
                onChange={(align) => onPatch({ align })}
                options={[
                  { value: "left", label: "Left" },
                  { value: "center", label: "Centre" },
                  { value: "right", label: "Right" },
                ]}
              />
              <SelectField
                label="Down"
                value={element.vAlign}
                onChange={(vAlign) => onPatch({ vAlign })}
                options={[
                  { value: "top", label: "Top" },
                  { value: "middle", label: "Middle" },
                  { value: "bottom", label: "Bottom" },
                ]}
              />
            </div>
            <NumberField
              label="Letter spacing"
              suffix="mm"
              step={0.05}
              value={element.letterSpacingMm}
              onChange={(letterSpacingMm) => onPatch({ letterSpacingMm })}
            />
            <Colour value={element.colorHex} onChange={(colorHex) => onPatch({ colorHex })} />
          </div>
        </Panel>
      ) : null}

      {element.kind === "text" || element.kind === "list" ? (
        <Panel title="If it does not fit">
          <div className="space-y-2">
            <SelectField
              value={element.fit.mode}
              onChange={(mode) => onPatch({ fit: { ...element.fit, mode } })}
              options={FIT_MODES}
            />
            <NumberField
              label="Never below"
              suffix="pt"
              step={0.5}
              value={element.fit.minFontSizePt}
              onChange={(minFontSizePt) => onPatch({ fit: { ...element.fit, minFontSizePt } })}
            />
            {element.fit.mode === "wrap" || element.fit.mode === "shrink-then-wrap" ? (
              <NumberField
                label="At most"
                suffix="lines"
                min={1}
                value={element.fit.maxLines}
                onChange={(maxLines) => onPatch({ fit: { ...element.fit, maxLines } })}
              />
            ) : null}
            <p className="text-xs text-slate">
              At the floor it prints and tells you which guests, rather than shrinking on into
              illegibility. A 5pt name is not a place card.
            </p>
          </div>
        </Panel>
      ) : null}

      {element.kind === "icon" ? (
        <IconFields
          element={element}
          headers={headers}
          rows={rows}
          uploadedIcons={uploadedIcons}
          onPatch={onPatch}
        />
      ) : null}

      {element.kind === "rect" ? (
        <Panel title="Box">
          <div className="space-y-2">
            <Colour
              value={element.fillHex ?? ""}
              nullable
              label="Fill"
              onChange={(fillHex) => onPatch({ fillHex: fillHex || null })}
            />
            <Colour
              value={element.strokeHex ?? ""}
              nullable
              label="Outline"
              onChange={(strokeHex) => onPatch({ strokeHex: strokeHex || null })}
            />
            <NumberField
              label="Outline width"
              suffix="mm"
              step={0.1}
              value={element.strokeWidthMm}
              onChange={(strokeWidthMm) => onPatch({ strokeWidthMm })}
            />
            <Check label="Dashed" checked={element.dashed} onChange={(dashed) => onPatch({ dashed })} />
          </div>
        </Panel>
      ) : null}

      {element.kind === "line" ? (
        <Panel title="Line">
          <div className="space-y-2">
            <Colour value={element.strokeHex} onChange={(strokeHex) => onPatch({ strokeHex })} />
            <NumberField
              label="Width"
              suffix="mm"
              step={0.1}
              value={element.strokeWidthMm}
              onChange={(strokeWidthMm) => onPatch({ strokeWidthMm })}
            />
            <Check label="Dashed" checked={element.dashed} onChange={(dashed) => onPatch({ dashed })} />
          </div>
        </Panel>
      ) : null}

      {element.kind === "image" ? (
        <Panel title="Picture">
          <div className="space-y-2">
            <SelectField
              label="How it fills the box"
              value={element.fit}
              onChange={(fit) => onPatch({ fit })}
              options={[
                { value: "contain", label: "Fit inside, keep shape" },
                { value: "cover", label: "Fill the box, crop" },
                { value: "stretch", label: "Stretch to fill" },
              ]}
            />
            <label className="block">
              <span className="mb-1 block text-xs text-slate">
                Opacity — {Math.round(element.opacity * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={element.opacity}
                onChange={(e) => onPatch({ opacity: Number(e.target.value) })}
                className="w-full accent-[var(--color-gold)]"
              />
            </label>
            {element.fit === "cover" ? (
              <p className="text-xs text-slate">
                Double-click the picture on the card to pan and zoom the artwork inside its box.
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="This element">
        <div className="flex gap-2">
          <Button onClick={onDuplicate} icon={Copy}>
            Duplicate
          </Button>
          <Button onClick={onDelete} icon={Trash2} tone="danger">
            Delete
          </Button>
        </div>
      </Panel>
    </>
  );
}

function IconFields({
  element,
  headers,
  rows,
  uploadedIcons,
  onPatch,
}: {
  element: Extract<CardElement, { kind: "icon" }>;
  headers: string[];
  rows: GuestRow[];
  uploadedIcons: Record<string, string>;
  onPatch: (patch: ElementPatch) => void;
}) {
  const values = distinctValues(rows, element.sourceField);
  const unmapped = unmappedValues(rows, element.sourceField, element.rules, element.fallbackIconId);
  const iconOptions = [
    { value: "", label: "Nothing" },
    ...BUNDLED_ICONS.map((icon) => ({ value: icon.id, label: icon.label })),
    ...Object.keys(uploadedIcons).map((id) => ({ value: id, label: `${id} (yours)` })),
  ];

  return (
    <>
      <Panel title="Icon">
        <div className="space-y-2">
          <SelectField
            label="Reads which column"
            value={element.sourceField}
            onChange={(sourceField) => onPatch({ sourceField })}
            options={headers.map((h) => ({ value: h, label: h }))}
          />
          <Colour value={element.colorHex} onChange={(colorHex) => onPatch({ colorHex })} />
        </div>
      </Panel>

      <Panel title="Which icon for which value">
        {values.length === 0 ? (
          <p className="text-xs text-slate">
            No values in that column yet. Rules appear here once there are some to map.
          </p>
        ) : (
          <div className="space-y-1.5">
            {values.map((value) => {
              const rule = element.rules.find(
                (r) => r.match.trim().toLowerCase() === value.trim().toLowerCase(),
              );
              return (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 truncate text-slate" title={value}>
                    {value}
                  </span>
                  <select
                    value={rule?.iconId ?? ""}
                    onChange={(e) => {
                      const iconId = e.target.value;
                      const rest = element.rules.filter(
                        (r) => r.match.trim().toLowerCase() !== value.trim().toLowerCase(),
                      );
                      onPatch({ rules: iconId ? [...rest, { match: value, iconId }] : rest });
                    }}
                    className="min-w-0 flex-1 rounded border border-charcoal/15 bg-parchment px-2 py-1 text-sm text-charcoal outline-none focus:border-gold"
                  >
                    {iconOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        )}
        {unmapped.length > 0 ? (
          <p className="mt-2 text-xs text-slate">
            {unmapped.length} value{unmapped.length === 1 ? "" : "s"} print nothing. That is usually
            what you want for &ldquo;None&rdquo;.
          </p>
        ) : null}
      </Panel>
    </>
  );
}

function Colour({
  value,
  onChange,
  label = "Colour",
  nullable = false,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  nullable?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate">{label}</span>
      <div className="flex gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-12 shrink-0 rounded border border-charcoal/15 bg-parchment"
        />
        {nullable ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className={`rounded border px-2 text-xs transition ${
              value === ""
                ? "border-gold bg-gold/15 text-charcoal"
                : "border-charcoal/15 text-slate hover:border-charcoal/30"
            }`}
          >
            None
          </button>
        ) : null}
      </div>
    </label>
  );
}

const round = (n: number): number => Math.round(n * 10) / 10;
