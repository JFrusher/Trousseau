"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Guest, Obstacle, Seating, Table, Zone } from "@/lib/model/types";
import {
  buildContainers,
  computeSnap,
  type Guide,
  type SnapBox,
} from "@/lib/seating/alignmentSnap";
import {
  fillColour,
  getAdaptedSeatsForDrag,
  getTableGeometry,
  SEAT_RADIUS,
  type Seat,
  type TableGeometry,
} from "@/lib/seating/geometry";
import { getTableType } from "@/lib/seating/tableTypes";
import type { WarningIndex } from "@/lib/seating/warnings";

/**
 * The room.
 *
 * One SVG, pan and zoom by viewBox. Tables move with pointer events; guests
 * arrive by the browser's own drag and drop, because a guest travels from a
 * list elsewhere on the page onto a seat and HTML5 drag is the one mechanism
 * that already crosses that boundary. No drag library.
 *
 * A table in flight is held in local state and written once on release — a
 * store write per pointermove would reparse the whole document sixty times a
 * second for a gesture the user has not committed to yet.
 */

export const GUEST_DRAG_TYPE = "application/x-trousseau-guest";

export type Selection =
  | { kind: "table"; id: string }
  | { kind: "zone"; id: string }
  | { kind: "obstacle"; id: string }
  | null;

export interface CanvasProps {
  seating: Seating;
  guests: Record<string, Guest>;
  selection: Selection;
  warnings: WarningIndex;
  onSelect: (selection: Selection) => void;
  /** Committed once, on release. `patch` carries any adapted seating. */
  onMoveTable: (id: string, x: number, y: number, patch?: Partial<Table>) => void;
  onMoveZone: (id: string, x: number, y: number) => void;
  onMoveObstacle: (id: string, x: number, y: number) => void;
  onDropGuest: (guestId: string, tableId: string, seatIndex?: number) => void;
}

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface Dragging {
  kind: "table" | "zone" | "obstacle";
  id: string;
  x: number;
  y: number;
  seats: Seat[] | null;
  patch: Partial<Table> | null;
  guides: Guide[];
}

export function RoomCanvas({
  seating,
  guests,
  selection,
  warnings,
  onSelect,
  onMoveTable,
  onMoveZone,
  onMoveObstacle,
  onDropGuest,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [drag, setDrag] = useState<Dragging | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const panFrom = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const { room, settings } = seating;
  const ppu = settings.pixelsPerUnit;

  const geometries = useMemo(() => {
    const out = new Map<string, TableGeometry>();
    for (const table of Object.values(seating.tables)) {
      out.set(table.id, getTableGeometry(table, ppu));
    }
    return out;
  }, [seating.tables, ppu]);

  const containers = useMemo(() => buildContainers(room), [room]);

  const snapToGrid = useCallback(
    (n: number) => (settings.gridSnap ? Math.round(n / settings.gridSize) * settings.gridSize : n),
    [settings.gridSnap, settings.gridSize],
  );

  /** Client pixels to room coordinates. The one conversion everything shares. */
  const toRoom = useCallback(
    (clientX: number, clientY: number) => {
      const box = svgRef.current?.getBoundingClientRect();
      if (!box) return { x: 0, y: 0 };
      return {
        x: (clientX - box.left) / view.scale + view.x,
        y: (clientY - box.top) / view.scale + view.y,
      };
    },
    [view],
  );

  const onWheel = useCallback((e: React.WheelEvent) => {
    setView((v) => {
      const next = Math.min(3, Math.max(0.15, v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const box = svgRef.current?.getBoundingClientRect();
      if (!box) return { ...v, scale: next };
      // Keep whatever is under the pointer under the pointer.
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      return { scale: next, x: v.x + px / v.scale - px / next, y: v.y + py / v.scale - py / next };
    });
  }, []);

  /** Work out where a dragged table lands: grid, then alignment, then chairs. */
  const placeTable = useCallback(
    (table: Table, at: { x: number; y: number }): Dragging => {
      const geometry = geometries.get(table.id);
      const half = { hw: (geometry?.width ?? 0) / 2, hh: (geometry?.height ?? 0) / 2 };
      let x = snapToGrid(at.x);
      let y = snapToGrid(at.y);
      let guides: Guide[] = [];

      if (settings.snapAlign) {
        const others: SnapBox[] = [];
        for (const other of Object.values(seating.tables)) {
          if (other.id === table.id) continue;
          const g = geometries.get(other.id);
          if (!g) continue;
          others.push({ cx: other.x, cy: other.y, hw: g.width / 2, hh: g.height / 2 });
        }
        const snapped = computeSnap({
          moving: { cx: x, cy: y, ...half },
          tables: others,
          containers,
        });
        x = snapped.x ?? x;
        y = snapped.y ?? y;
        guides = snapped.guides;
      }

      // Chairs get out of the way of whatever the table has been pushed against.
      const neighbours = Object.values(seating.tables).flatMap((other) => {
        if (other.id === table.id) return [];
        const g = geometries.get(other.id);
        return g ? [{ cx: other.x, cy: other.y, hw: g.width / 2, hh: g.height / 2 }] : [];
      });
      const adapted = getAdaptedSeatsForDrag({ ...table, x, y }, ppu, neighbours);

      return {
        kind: "table",
        id: table.id,
        x,
        y,
        seats: adapted?.seats ?? null,
        patch: adapted?.patch ?? null,
        guides,
      };
    },
    [geometries, seating.tables, containers, settings.snapAlign, snapToGrid, ppu],
  );

  const grab = useCallback(
    (kind: Dragging["kind"], id: string, e: React.PointerEvent) => {
      e.stopPropagation();
      onSelect({ kind, id } as Selection);
      const at = toRoom(e.clientX, e.clientY);
      if (kind === "table") {
        const table = seating.tables[id];
        if (table) setDrag(placeTable(table, at));
      } else {
        setDrag({
          kind,
          id,
          x: snapToGrid(at.x),
          y: snapToGrid(at.y),
          seats: null,
          patch: null,
          guides: [],
        });
      }
      capture(svgRef.current, e.pointerId);
    },
    [onSelect, toRoom, seating.tables, placeTable, snapToGrid],
  );

  const release = useCallback(() => {
    panFrom.current = null;
    if (!drag) return;
    if (drag.kind === "table") onMoveTable(drag.id, drag.x, drag.y, drag.patch ?? undefined);
    else if (drag.kind === "zone") onMoveZone(drag.id, drag.x, drag.y);
    else onMoveObstacle(drag.id, drag.x, drag.y);
    setDrag(null);
  }, [drag, onMoveTable, onMoveZone, onMoveObstacle]);

  const selectedId = selection?.id ?? null;

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none select-none"
      viewBox={`${view.x} ${view.y} ${room.width / view.scale} ${room.height / view.scale}`}
      preserveAspectRatio="xMidYMid meet"
      onWheel={onWheel}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget && !(e.target as Element).classList.contains("room-floor")) {
          return;
        }
        onSelect(null);
        panFrom.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
        capture(e.currentTarget, e.pointerId);
      }}
      onPointerMove={(e) => {
        const from = panFrom.current;
        if (from) {
          setView((v) => ({
            ...v,
            x: from.x - (e.clientX - from.px) / v.scale,
            y: from.y - (e.clientY - from.py) / v.scale,
          }));
          return;
        }
        if (!drag) return;
        const at = toRoom(e.clientX, e.clientY);
        if (drag.kind === "table") {
          const table = seating.tables[drag.id];
          if (table) setDrag(placeTable(table, at));
        } else {
          setDrag({ ...drag, x: snapToGrid(at.x), y: snapToGrid(at.y) });
        }
      }}
      onPointerUp={release}
      onPointerCancel={() => {
        panFrom.current = null;
        setDrag(null);
      }}
    >
      <rect
        className="room-floor"
        x={-20000}
        y={-20000}
        width={40000}
        height={40000}
        fill="var(--color-stone)"
      />

      {room.spaces.map((space) =>
        space.shape === "rect" ? (
          <rect
            key={space.id}
            className="room-floor"
            x={space.x}
            y={space.y}
            width={space.width}
            height={space.height}
            fill={space.backgroundColour}
            stroke="var(--color-charcoal)"
            strokeOpacity={0.25}
            strokeWidth={2}
          />
        ) : (
          <polygon
            key={space.id}
            className="room-floor"
            points={space.vertices.map((v) => `${space.x + v.x},${space.y + v.y}`).join(" ")}
            fill={space.backgroundColour}
            stroke="var(--color-charcoal)"
            strokeOpacity={0.25}
            strokeWidth={2}
          />
        ),
      )}

      {settings.gridSnap ? <Grid size={settings.gridSize} /> : null}

      {Object.values(seating.zones).map((zone) => (
        <ZoneNode
          key={zone.id}
          zone={drag?.kind === "zone" && drag.id === zone.id ? { ...zone, x: drag.x, y: drag.y } : zone}
          selected={selectedId === zone.id}
          onGrab={(e) => grab("zone", zone.id, e)}
        />
      ))}

      {Object.values(seating.obstacles).map((o) => (
        <ObstacleNode
          key={o.id}
          obstacle={drag?.kind === "obstacle" && drag.id === o.id ? { ...o, x: drag.x, y: drag.y } : o}
          selected={selectedId === o.id}
          onGrab={(e) => grab("obstacle", o.id, e)}
        />
      ))}

      {Object.values(seating.tables).map((table) => {
        const live =
          drag?.kind === "table" && drag.id === table.id
            ? { ...table, x: drag.x, y: drag.y, ...(drag.patch ?? {}) }
            : table;
        const geometry =
          drag?.kind === "table" && drag.id === table.id && drag.seats
            ? { ...geometries.get(table.id)!, seats: drag.seats }
            : geometries.get(table.id)!;

        return (
          <TableNode
            key={table.id}
            table={live}
            geometry={geometry}
            guests={guests}
            seating={seating}
            selected={selectedId === table.id}
            hovered={hover === table.id}
            warned={(warnings.byTable.get(table.id) ?? []).some((w) => w.level === "warn")}
            onGrab={(e) => grab("table", table.id, e)}
            onGuestOver={(over) => setHover(over ? table.id : null)}
            onGuestDrop={(guestId, seatIndex) => {
              setHover(null);
              onDropGuest(guestId, table.id, seatIndex);
            }}
          />
        );
      })}

      {drag?.guides.map((guide, i) => (
        <GuideLine key={i} guide={guide} />
      ))}
    </svg>
  );
}

/**
 * Take the pointer, or carry on without it.
 *
 * `setPointerCapture` throws when the pointer is no longer active — a touch
 * lifted between the event firing and this running, a synthetic event, a stylus
 * leaving range. The drag still works without capture; it only stops tracking
 * if the pointer leaves the element. Letting the throw escape would abort the
 * handler and leave the table stuck to the cursor.
 */
function capture(element: Element | null, pointerId: number): void {
  try {
    element?.setPointerCapture(pointerId);
  } catch {
    // Not capturable. Nothing to do about it, and nothing worth saying.
  }
}

function Grid({ size }: { size: number }) {
  return (
    <>
      <defs>
        <pattern id="room-grid" width={size} height={size} patternUnits="userSpaceOnUse">
          <path
            d={`M ${size} 0 L 0 0 0 ${size}`}
            fill="none"
            stroke="var(--color-charcoal)"
            strokeOpacity={0.05}
            strokeWidth={1}
          />
        </pattern>
      </defs>
      <rect
        className="room-floor"
        x={-20000}
        y={-20000}
        width={40000}
        height={40000}
        fill="url(#room-grid)"
      />
    </>
  );
}

function GuideLine({ guide }: { guide: Guide }) {
  if (guide.kind === "spacing") {
    return (
      <g stroke="var(--color-gold)" strokeWidth={1} strokeDasharray="3 3">
        {guide.segments.map(([from, to], i) =>
          guide.axis === "x" ? (
            <line key={i} x1={from} y1={guide.perp} x2={to} y2={guide.perp} />
          ) : (
            <line key={i} x1={guide.perp} y1={from} x2={guide.perp} y2={to} />
          ),
        )}
      </g>
    );
  }

  const colour = guide.variant === "wall" ? "var(--color-sage)" : "var(--color-gold)";
  return guide.axis === "v" ? (
    <line
      x1={guide.pos}
      y1={guide.start}
      x2={guide.pos}
      y2={guide.end}
      stroke={colour}
      strokeWidth={1}
      strokeDasharray="4 3"
    />
  ) : (
    <line
      x1={guide.start}
      y1={guide.pos}
      x2={guide.end}
      y2={guide.pos}
      stroke={colour}
      strokeWidth={1}
      strokeDasharray="4 3"
    />
  );
}

function ZoneNode({
  zone,
  selected,
  onGrab,
}: {
  zone: Zone;
  selected: boolean;
  onGrab: (e: React.PointerEvent) => void;
}) {
  return (
    <g onPointerDown={onGrab} className="cursor-grab">
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill={zone.colour}
        fillOpacity={0.12}
        stroke={selected ? "var(--color-gold)" : zone.colour}
        strokeWidth={selected ? 2 : 1}
        strokeDasharray="6 4"
      />
      <text
        x={zone.x + zone.width / 2}
        y={zone.y + 18}
        textAnchor="middle"
        fontSize={13}
        fill="var(--color-slate)"
        pointerEvents="none"
      >
        {zone.label}
      </text>
    </g>
  );
}

function ObstacleNode({
  obstacle,
  selected,
  onGrab,
}: {
  obstacle: Obstacle;
  selected: boolean;
  onGrab: (e: React.PointerEvent) => void;
}) {
  const stroke = selected ? "var(--color-gold)" : "transparent";
  return (
    <g
      onPointerDown={onGrab}
      transform={`translate(${obstacle.x} ${obstacle.y}) rotate(${obstacle.rotation})`}
      className="cursor-grab"
    >
      {obstacle.kind === "pillar" ? (
        <ellipse
          rx={obstacle.width / 2}
          ry={obstacle.height / 2}
          fill="var(--color-slate)"
          fillOpacity={0.5}
          stroke={stroke}
          strokeWidth={2}
        />
      ) : (
        <rect
          x={-obstacle.width / 2}
          y={-obstacle.height / 2}
          width={obstacle.width}
          height={obstacle.height}
          fill="var(--color-slate)"
          fillOpacity={0.5}
          stroke={stroke}
          strokeWidth={2}
        />
      )}
    </g>
  );
}

function TableNode({
  table,
  geometry,
  guests,
  seating,
  selected,
  hovered,
  warned,
  onGrab,
  onGuestOver,
  onGuestDrop,
}: {
  table: Table;
  geometry: TableGeometry;
  guests: Record<string, Guest>;
  seating: Seating;
  selected: boolean;
  hovered: boolean;
  warned: boolean;
  onGrab: (e: React.PointerEvent) => void;
  onGuestOver: (over: boolean) => void;
  onGuestDrop: (guestId: string, seatIndex?: number) => void;
}) {
  const def = getTableType(table.type);
  const taken = table.assignedGuestIds.filter((id) => id !== null).length;
  const ratio = table.capacity > 0 ? taken / table.capacity : 0;
  const { showChairs, chairSizeUnits, pixelsPerUnit, showGroupColours, showDietaryBadges } =
    seating.settings;
  const chairR = (chairSizeUnits * pixelsPerUnit) / 2;

  const accept = (e: React.DragEvent): string | null =>
    e.dataTransfer.getData(GUEST_DRAG_TYPE) || null;

  return (
    <g
      transform={`translate(${table.x} ${table.y}) rotate(${table.rotation})`}
      onPointerDown={onGrab}
      onDragOver={(e) => {
        // Only a preventDefault here makes this a drop target at all.
        e.preventDefault();
        onGuestOver(true);
      }}
      onDragLeave={() => onGuestOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        const id = accept(e);
        if (id) onGuestDrop(id);
      }}
      className="cursor-grab"
    >
      {showChairs
        ? geometry.seats.map((seat, i) => (
            <circle
              key={`chair${i}`}
              cx={seat.x}
              cy={seat.y}
              r={chairR}
              fill="var(--color-charcoal)"
              fillOpacity={0.06}
            />
          ))
        : null}

      <Shape
        geometry={geometry}
        selected={selected}
        hovered={hovered}
        warned={warned}
        colour={table.colour ?? def.distinctColour ?? null}
      />

      {geometry.seats.map((seat, index) => {
        const guestId = table.assignedGuestIds[index] ?? null;
        const guest = guestId === null ? undefined : guests[guestId];
        const groupColour =
          showGroupColours && guest?.groupId ? seating.groups[guest.groupId]?.colour : undefined;

        return (
          <g
            key={index}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const id = accept(e);
              if (id) onGuestDrop(id, index);
            }}
          >
            <circle
              cx={seat.x}
              cy={seat.y}
              r={SEAT_RADIUS}
              fill={groupColour ?? (guest ? "var(--color-stone)" : "var(--color-parchment)")}
              fillOpacity={groupColour ? 0.55 : 1}
              stroke="var(--color-charcoal)"
              strokeOpacity={guest ? 0.35 : 0.15}
              strokeWidth={1}
            />
            {guest ? (
              <text
                x={seat.x}
                y={seat.y + 3}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-slate)"
                pointerEvents="none"
              >
                {initials(guest)}
              </text>
            ) : null}
            {showDietaryBadges && guest?.dietary ? (
              <circle
                cx={seat.x + SEAT_RADIUS * 0.7}
                cy={seat.y - SEAT_RADIUS * 0.7}
                r={3.5}
                fill="var(--color-sage)"
                pointerEvents="none"
              />
            ) : null}
          </g>
        );
      })}

      <text
        y={geometry.shape === "half-circle" ? geometry.height / 4 : 0}
        textAnchor="middle"
        fontSize={13}
        fill="var(--color-charcoal)"
        pointerEvents="none"
      >
        {table.label}
      </text>
      <text
        y={(geometry.shape === "half-circle" ? geometry.height / 4 : 0) + 14}
        textAnchor="middle"
        fontSize={10}
        fill={fillColour(ratio)}
        pointerEvents="none"
      >
        {taken} / {table.capacity}
      </text>
      {warned ? (
        <text
          y={(geometry.shape === "half-circle" ? geometry.height / 4 : 0) - 14}
          textAnchor="middle"
          fontSize={13}
          fill="var(--color-rose)"
          pointerEvents="none"
        >
          !
        </text>
      ) : null}
    </g>
  );
}

function Shape({
  geometry,
  selected,
  hovered,
  warned,
  colour,
}: {
  geometry: TableGeometry;
  selected: boolean;
  hovered: boolean;
  warned: boolean;
  colour: string | null;
}) {
  const stroke = selected
    ? "var(--color-gold)"
    : hovered
      ? "var(--color-sage)"
      : warned
        ? "var(--color-rose)"
        : "var(--color-charcoal)";
  const common = {
    fill: colour ?? "var(--color-parchment)",
    fillOpacity: colour ? 0.18 : 1,
    stroke,
    strokeOpacity: selected || hovered || warned ? 1 : 0.35,
    strokeWidth: selected || hovered ? 2 : 1.25,
  };

  if (geometry.shape === "circle") return <circle r={geometry.radius} {...common} />;
  if (geometry.shape === "half-circle") {
    const r = geometry.radius;
    const cy = geometry.cy ?? r / 2;
    return <path d={`M ${-r} ${cy} A ${r} ${r} 0 0 1 ${r} ${cy} Z`} {...common} />;
  }
  return (
    <rect
      x={-geometry.width / 2}
      y={-geometry.height / 2}
      width={geometry.width}
      height={geometry.height}
      rx={geometry.rounded ? 14 : 3}
      {...common}
    />
  );
}

function initials(guest: Guest): string {
  const first = guest.firstName.trim()[0] ?? "";
  const last = guest.lastName.trim()[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}
