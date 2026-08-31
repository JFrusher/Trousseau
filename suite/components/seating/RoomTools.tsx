"use client";

import { useState } from "react";
import { Circle, Columns2, Plus, Square, Trash2 } from "lucide-react";
import type { PerSideSeats, Seating } from "@/lib/model/types";
import { addTable, type Plan } from "@/lib/seating/actions";
import {
  addCustomPreset,
  addObstacle,
  addSpace,
  addZone,
  recalibrate,
  removeCustomPreset,
  removeSpace,
  seatsInPreset,
} from "@/lib/seating/roomActions";
import { TABLE_TYPE_LIST } from "@/lib/seating/tableTypes";
import {
  Button,
  Check,
  IconButton,
  NumberField,
  Panel,
  Segmented,
  TextField,
} from "@/components/ui/controls";
import type { Selection } from "./RoomCanvas";

/**
 * Everything that puts something new in the room, and everything about how the
 * room is drawn.
 */
export function RoomTools({
  plan,
  onSetSeating,
  onSelect,
}: {
  plan: Plan;
  onSetSeating: (next: Seating, label: string) => void;
  onSelect: (selection: Selection) => void;
}) {
  const { seating } = plan;
  const { settings, room } = seating;
  const centre = { x: room.width / 2, y: room.height / 2 };

  const addAndSelect = (next: Seating, kind: "table" | "zone" | "obstacle", label: string) => {
    const before =
      kind === "table" ? seating.tables : kind === "zone" ? seating.zones : seating.obstacles;
    const after =
      kind === "table" ? next.tables : kind === "zone" ? next.zones : next.obstacles;
    onSetSeating(next, label);
    const added = Object.keys(after).find((id) => !(id in before));
    if (added) onSelect({ kind, id: added } as Selection);
  };

  return (
    <>
      <Panel title="Add a table">
        <div className="grid grid-cols-2 gap-1.5">
          {TABLE_TYPE_LIST.map((type) => (
            <Button
              key={type.id}
              icon={Plus}
              onClick={() => addAndSelect(addTable(seating, type.id, centre), "table", "adding a table")}
            >
              {type.label}
            </Button>
          ))}
        </div>
        {settings.customTablePresets.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {settings.customTablePresets.map((preset) => (
              <li key={preset.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = addTable(seating, "rect", centre);
                    const id = Object.keys(next.tables).find((k) => !(k in seating.tables))!;
                    const table = next.tables[id]!;
                    onSetSeating(
                      {
                        ...next,
                        tables: {
                          ...next.tables,
                          [id]: {
                            ...table,
                            label: preset.label,
                            capacity: seatsInPreset(preset.perSideSeats),
                            perSideSeats: preset.perSideSeats,
                            sizeUnits: {
                              shape: "rect",
                              width: preset.widthUnits,
                              height: preset.heightUnits,
                            },
                          },
                        },
                      },
                      "adding a table",
                    );
                    onSelect({ kind: "table", id });
                  }}
                  className="min-w-0 flex-1 truncate rounded border border-charcoal/15 px-2 py-1 text-left text-xs text-slate transition hover:border-gold hover:text-charcoal"
                >
                  {preset.label} · {seatsInPreset(preset.perSideSeats)} seats
                </button>
                <IconButton
                  onClick={() => onSetSeating(removeCustomPreset(seating, preset.id), "editing presets")}
                  icon={Trash2}
                  label={`Delete the ${preset.label} preset`}
                  tone="danger"
                />
              </li>
            ))}
          </ul>
        ) : null}
        <CustomPreset onAdd={(preset) => onSetSeating(addCustomPreset(seating, preset), "adding a preset")} />
      </Panel>

      <Panel title="The room">
        <div className="grid grid-cols-3 gap-1.5">
          <Button icon={Square} onClick={() => addAndSelect(addZone(seating, "Zone", centre), "zone", "adding a zone")}>
            Zone
          </Button>
          <Button
            icon={Columns2}
            onClick={() => addAndSelect(addObstacle(seating, "wall", centre), "obstacle", "editing the room")}
          >
            Wall
          </Button>
          <Button
            icon={Circle}
            onClick={() => addAndSelect(addObstacle(seating, "pillar", centre), "obstacle", "editing the room")}
          >
            Pillar
          </Button>
        </div>

        <div className="mt-3">
          <h4 className="mb-1 text-xs text-slate">Floor spaces</h4>
          <ul className="space-y-1">
            {room.spaces.map((space) => (
              <li key={space.id} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-sm text-charcoal">{space.label}</span>
                {room.spaces.length > 1 ? (
                  <IconButton
                    onClick={() => onSetSeating(removeSpace(seating, space.id), "editing the room")}
                    icon={Trash2}
                    label={`Delete ${space.label}`}
                    tone="danger"
                  />
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-1.5">
            <Button icon={Plus} onClick={() => onSetSeating(addSpace(seating, "Marquee"), "adding a space")}>
              Another space
            </Button>
          </div>
          <p className="mt-1 text-xs text-slate">
            A barn and a marquee are two spaces, not one box with dead ground between them.
          </p>
        </div>
      </Panel>

      <Panel title="Scale and grid">
        <div className="space-y-2">
          <Calibrate
            pixelsPerUnit={settings.pixelsPerUnit}
            onApply={(ppu) => onSetSeating(recalibrate(seating, ppu), "recalibrating")}
          />
          <Segmented
            value={settings.unitSystem}
            onChange={(unitSystem) =>
              onSetSeating({ ...seating, settings: { ...settings, unitSystem } }, "view settings")
            }
            options={[
              { value: "metric", label: "Metric" },
              { value: "imperial", label: "Imperial" },
            ]}
          />
          <Check
            label="Snap to grid"
            checked={settings.gridSnap}
            onChange={(gridSnap) =>
              onSetSeating({ ...seating, settings: { ...settings, gridSnap } }, "view settings")
            }
          />
          {settings.gridSnap ? (
            <NumberField
              label="Grid"
              suffix="px"
              min={5}
              value={settings.gridSize}
              onChange={(gridSize) =>
                onSetSeating(
                  { ...seating, settings: { ...settings, gridSize: Math.max(5, gridSize) } },
                  "view settings",
                )
              }
            />
          ) : null}
          <Check
            label="Snap to other tables and walls"
            checked={settings.snapAlign}
            onChange={(snapAlign) =>
              onSetSeating({ ...seating, settings: { ...settings, snapAlign } }, "view settings")
            }
          />
        </div>
      </Panel>

      <Panel title="Show">
        <div className="space-y-1.5">
          <Check
            label="Chairs"
            checked={settings.showChairs}
            onChange={(showChairs) =>
              onSetSeating({ ...seating, settings: { ...settings, showChairs } }, "view settings")
            }
          />
          <Check
            label="Group colours"
            checked={settings.showGroupColours}
            onChange={(showGroupColours) =>
              onSetSeating({ ...seating, settings: { ...settings, showGroupColours } }, "view settings")
            }
          />
          <Check
            label="Dietary marks"
            checked={settings.showDietaryBadges}
            onChange={(showDietaryBadges) =>
              onSetSeating({ ...seating, settings: { ...settings, showDietaryBadges } }, "view settings")
            }
          />
          {settings.showChairs ? (
            <NumberField
              label="Chair size"
              suffix="cm"
              min={20}
              value={settings.chairSizeUnits}
              onChange={(chairSizeUnits) =>
                onSetSeating(
                  { ...seating, settings: { ...settings, chairSizeUnits } },
                  "view settings",
                )
              }
            />
          ) : null}
        </div>
      </Panel>
    </>
  );
}

/**
 * Calibration by measurement rather than by ratio.
 *
 * Nobody knows what 0.7 pixels per centimetre means. Everybody knows how wide
 * their room is, so that is what is asked for, and the ratio is worked out.
 */
function Calibrate({
  pixelsPerUnit,
  onApply,
}: {
  pixelsPerUnit: number;
  onApply: (ppu: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [metres, setMetres] = useState(Math.round(1200 / pixelsPerUnit / 100));

  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Set the room&rsquo;s real size</Button>
        <p className="mt-1 text-xs text-slate">
          Currently about {Math.round(1200 / pixelsPerUnit / 100)}m across.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded border border-charcoal/15 p-2">
      <NumberField
        label="How wide is the room?"
        suffix="m"
        min={2}
        value={metres}
        onChange={setMetres}
      />
      <div className="flex gap-2">
        <Button
          tone="primary"
          onClick={() => {
            if (metres > 0) onApply(1200 / (metres * 100));
            setOpen(false);
          }}
        >
          Apply
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      <p className="text-xs text-slate">
        Everything keeps its position and its proportions — only what the ruler says changes.
      </p>
    </div>
  );
}

function CustomPreset({
  onAdd,
}: {
  onAdd: (preset: { label: string; widthUnits: number; heightUnits: number; perSideSeats: PerSideSeats }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [width, setWidth] = useState(180);
  const [height, setHeight] = useState(90);
  const [sides, setSides] = useState<PerSideSeats>({ top: 4, bottom: 4, left: 0, right: 0 });

  if (!open) {
    return (
      <div className="mt-2">
        <Button icon={Plus} onClick={() => setOpen(true)}>
          A table of your own
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded border border-charcoal/15 p-2">
      <TextField label="Name" value={label} onChange={setLabel} placeholder="Long trestle" />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Width" suffix="cm" value={width} onChange={setWidth} />
        <NumberField label="Depth" suffix="cm" value={height} onChange={setHeight} />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {(["top", "bottom", "left", "right"] as const).map((side) => (
          <NumberField
            key={side}
            label={side}
            min={0}
            value={sides[side]}
            onChange={(n) => setSides({ ...sides, [side]: Math.max(0, n) })}
          />
        ))}
      </div>
      <p className="text-xs text-slate">{seatsInPreset(sides)} seats in all.</p>
      <div className="flex gap-2">
        <Button
          tone="primary"
          onClick={() => {
            if (seatsInPreset(sides) === 0) return;
            onAdd({
              label: label.trim() || "Custom table",
              widthUnits: width,
              heightUnits: height,
              perSideSeats: sides,
            });
            setOpen(false);
            setLabel("");
          }}
        >
          Save preset
        </Button>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
