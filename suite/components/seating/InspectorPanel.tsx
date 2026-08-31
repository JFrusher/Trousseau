"use client";

import { Trash2, UserMinus } from "lucide-react";
import type { Designation, Obstacle, Seating, Table, Zone } from "@/lib/model/types";
import { patchTable, removeTable, seatedAt, type Plan } from "@/lib/seating/actions";
import { patchObstacle, patchZone, removeObstacle, removeZone } from "@/lib/seating/roomActions";
import { clampCapacity, getTableType, TABLE_TYPE_LIST } from "@/lib/seating/tableTypes";
import type { Warning } from "@/lib/seating/warnings";
import {
  Button,
  Check,
  Empty,
  IconButton,
  NumberField,
  Panel,
  SelectField,
  TextField,
} from "@/components/ui/controls";
import type { Selection } from "./RoomCanvas";

/**
 * Whatever is selected on the canvas, in detail.
 *
 * A table, a zone or an obstacle — one panel rather than three, because the
 * canvas has one selection and a sidebar that changed shape depending on what
 * you clicked would be harder to learn, not easier.
 */

const DESIGNATIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "None" },
  { value: "top-table", label: "Top table" },
  { value: "vip", label: "VIP" },
  { value: "kids", label: "Kids" },
  { value: "band-bar", label: "Band / bar" },
];

export function InspectorPanel({
  selection,
  plan,
  warnings,
  onSetSeating,
  onCommit,
  onClearSelection,
}: {
  selection: Selection;
  plan: Plan;
  warnings: Warning[];
  onSetSeating: (next: Seating, label: string) => void;
  onCommit: (next: Plan, label: string) => void;
  onClearSelection: () => void;
}) {
  if (selection === null) {
    return (
      <Empty>
        Pick something in the room to change it. Drag names from the left onto a table, or onto one
        seat — or select a table first and click a name to seat them without dragging.
      </Empty>
    );
  }

  if (selection.kind === "zone") {
    const zone = plan.seating.zones[selection.id];
    if (!zone) return <Empty>That zone has gone.</Empty>;
    return (
      <ZoneInspector
        zone={zone}
        onPatch={(patch) => onSetSeating(patchZone(plan.seating, zone.id, patch), "editing a zone")}
        onDelete={() => {
          onSetSeating(removeZone(plan.seating, zone.id), "deleting a zone");
          onClearSelection();
        }}
      />
    );
  }

  if (selection.kind === "obstacle") {
    const obstacle = plan.seating.obstacles[selection.id];
    if (!obstacle) return <Empty>That has gone.</Empty>;
    return (
      <ObstacleInspector
        obstacle={obstacle}
        onPatch={(patch) =>
          onSetSeating(patchObstacle(plan.seating, obstacle.id, patch), "editing the room")
        }
        onDelete={() => {
          onSetSeating(removeObstacle(plan.seating, obstacle.id), "editing the room");
          onClearSelection();
        }}
      />
    );
  }

  const table = plan.seating.tables[selection.id];
  if (!table) return <Empty>That table has gone.</Empty>;

  return (
    <TableInspector
      table={table}
      plan={plan}
      warnings={warnings.filter((w) => w.tableId === table.id)}
      onPatch={(patch) =>
        onSetSeating(patchTable(plan.seating, table.id, patch), "editing a table")
      }
      onUnseat={(guestId) =>
        onCommit(
          {
            guests: {
              ...plan.guests,
              [guestId]: { ...plan.guests[guestId]!, assignedTableId: null },
            },
            seating: {
              ...plan.seating,
              tables: {
                ...plan.seating.tables,
                [table.id]: {
                  ...table,
                  assignedGuestIds:
                    table.seatMode === "seat"
                      ? table.assignedGuestIds.map((g) => (g === guestId ? null : g))
                      : table.assignedGuestIds.filter((g) => g !== guestId),
                },
              },
            },
          },
          "the seating",
        )
      }
      onDelete={() => {
        onCommit(removeTable(plan, table.id), "deleting a table");
        onClearSelection();
      }}
    />
  );
}

function TableInspector({
  table,
  plan,
  warnings,
  onPatch,
  onUnseat,
  onDelete,
}: {
  table: Table;
  plan: Plan;
  warnings: Warning[];
  onPatch: (patch: Partial<Table>) => void;
  onUnseat: (guestId: string) => void;
  onDelete: () => void;
}) {
  const def = getTableType(table.type);
  const sitting = seatedAt(plan, table.id);
  const ppu = plan.seating.settings.pixelsPerUnit;
  const size = table.sizeUnits;

  return (
    <>
      <Panel title="Table">
        <div className="space-y-2">
          <TextField value={table.label} onChange={(label) => onPatch({ label })} />

          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Kind"
              value={table.type}
              onChange={(type) => onPatch({ type })}
              options={TABLE_TYPE_LIST.map((t) => ({ value: t.id, label: t.label }))}
            />
            <NumberField
              label={`Seats (${def.minCapacity}–${def.maxCapacity})`}
              value={table.capacity}
              min={def.minCapacity}
              max={def.maxCapacity}
              onChange={(capacity) => onPatch({ capacity: clampCapacity(table.type, capacity) })}
            />
          </div>

          <SelectField
            label="Marked as"
            value={(table.designation ?? "") as string}
            onChange={(d) => onPatch({ designation: (d || null) as Designation })}
            options={DESIGNATIONS}
          />

          <Check
            label="Numbered seats"
            checked={table.seatMode === "seat"}
            onChange={(on) => onPatch({ seatMode: on ? "seat" : "table" })}
          />

          <label className="block">
            <span className="mb-1 block text-xs text-slate">Rotation — {table.rotation}°</span>
            <input
              type="range"
              min={0}
              max={359}
              value={table.rotation}
              onChange={(e) => onPatch({ rotation: Number(e.target.value) })}
              className="w-full accent-[var(--color-gold)]"
            />
          </label>

          {/* Real-world size, in centimetres. Only offered once a table has one:
              a plan authored before units is left on its preset geometry so it
              does not silently resize the moment somebody opens this panel. */}
          {size ? (
            size.shape === "rect" ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Width"
                  suffix="cm"
                  value={Math.round(size.width)}
                  onChange={(width) => onPatch({ sizeUnits: { ...size, width } })}
                />
                <NumberField
                  label="Depth"
                  suffix="cm"
                  value={Math.round(size.height)}
                  onChange={(height) => onPatch({ sizeUnits: { ...size, height } })}
                />
              </div>
            ) : (
              <NumberField
                label="Diameter"
                suffix="cm"
                value={Math.round(size.diameter)}
                onChange={(diameter) => onPatch({ sizeUnits: { ...size, diameter } })}
              />
            )
          ) : (
            <Button
              onClick={() =>
                onPatch({
                  sizeUnits:
                    def.shape === "rect"
                      ? {
                          shape: "rect",
                          width: Math.round((def.width ?? 150) / ppu),
                          height: Math.round((def.height ?? 90) / ppu),
                        }
                      : {
                          shape: def.shape,
                          diameter: Math.round(((def.baseRadius ?? 52) * 2) / ppu),
                        },
                })
              }
            >
              Set a real size
            </Button>
          )}
        </div>
      </Panel>

      {warnings.length > 0 ? (
        <Panel title="Worth a look">
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li
                key={w.id}
                className={`rounded border px-2 py-1 text-xs ${
                  w.level === "warn"
                    ? "border-rose/40 bg-rose/10 text-charcoal"
                    : "border-charcoal/10 bg-stone text-slate"
                }`}
              >
                {w.message}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={`Sitting here (${sitting.length})`}>
        {sitting.length === 0 ? (
          <Empty>Empty.</Empty>
        ) : (
          <ul>
            {sitting.map(({ seat, guest }) => (
              <li key={guest.id} className="flex items-center gap-2 py-0.5 text-sm">
                {table.seatMode === "seat" ? (
                  <span className="w-5 shrink-0 text-xs text-slate">{seat + 1}</span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-charcoal">
                  {guest.firstName} {guest.lastName}
                </span>
                {guest.dietary ? (
                  <span className="shrink-0 text-xs text-sage">{guest.dietary}</span>
                ) : null}
                <IconButton
                  onClick={() => onUnseat(guest.id)}
                  icon={UserMinus}
                  label={`Take ${guest.firstName} off this table`}
                  tone="danger"
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Remove">
        <Button onClick={onDelete} icon={Trash2} tone="danger">
          Delete table
        </Button>
        <p className="mt-1 text-xs text-slate">Anyone on it goes back to the list, not away.</p>
      </Panel>
    </>
  );
}

function ZoneInspector({
  zone,
  onPatch,
  onDelete,
}: {
  zone: Zone;
  onPatch: (patch: Partial<Zone>) => void;
  onDelete: () => void;
}) {
  return (
    <Panel title="Zone">
      <div className="space-y-2">
        <TextField value={zone.label} onChange={(label) => onPatch({ label })} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Width" value={Math.round(zone.width)} onChange={(width) => onPatch({ width })} />
          <NumberField label="Height" value={Math.round(zone.height)} onChange={(height) => onPatch({ height })} />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-slate">Colour</span>
          <input
            type="color"
            value={zone.colour}
            onChange={(e) => onPatch({ colour: e.target.value })}
            className="h-8 w-full rounded border border-charcoal/15 bg-parchment"
          />
        </label>
        <Button onClick={onDelete} icon={Trash2} tone="danger">
          Delete zone
        </Button>
      </div>
    </Panel>
  );
}

function ObstacleInspector({
  obstacle,
  onPatch,
  onDelete,
}: {
  obstacle: Obstacle;
  onPatch: (patch: Partial<Obstacle>) => void;
  onDelete: () => void;
}) {
  return (
    <Panel title={obstacle.kind === "wall" ? "Wall" : "Pillar"}>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={obstacle.kind === "wall" ? "Length" : "Width"}
            value={Math.round(obstacle.width)}
            onChange={(width) => onPatch({ width })}
          />
          <NumberField
            label={obstacle.kind === "wall" ? "Thickness" : "Depth"}
            value={Math.round(obstacle.height)}
            onChange={(height) => onPatch({ height })}
          />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-slate">Rotation — {obstacle.rotation}°</span>
          <input
            type="range"
            min={0}
            max={359}
            value={obstacle.rotation}
            onChange={(e) => onPatch({ rotation: Number(e.target.value) })}
            className="w-full accent-[var(--color-gold)]"
          />
        </label>
        <Button onClick={onDelete} icon={Trash2} tone="danger">
          Delete
        </Button>
      </div>
    </Panel>
  );
}
