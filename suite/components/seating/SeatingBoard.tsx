"use client";

import { useCallback, useMemo, useState } from "react";
import { useEvent, useGuests, useSeating, useWriters } from "@/lib/model/useSuite";
import type { Guest, Seating, Table } from "@/lib/model/types";
import { patchTable, seatGuest, unseatGuest, type Plan } from "@/lib/seating/actions";
import { patchObstacle, patchZone } from "@/lib/seating/roomActions";
import { buildWarningIndex, computeWarnings } from "@/lib/seating/warnings";
import { GuestPanel } from "./GuestPanel";
import { InsightPanel } from "./InsightPanel";
import { InspectorPanel } from "./InspectorPanel";
import { OrganisePanel } from "./OrganisePanel";
import { RoomCanvas, type Selection } from "./RoomCanvas";
import { RoomTools } from "./RoomTools";

/**
 * The seating tool.
 *
 * Guests on the left, the room in the middle, and a sidebar on the right whose
 * four tabs are the four things people do here: put things in the room, change
 * what is selected, sort the list out, and see where it all stands.
 *
 * Every write goes through the pure functions in `lib/seating`, which own both
 * halves of a seat — the table's list and the guest's own record.
 */

type Tab = "add" | "selected" | "organise" | "review";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "add", label: "Room" },
  { id: "selected", label: "Selected" },
  { id: "organise", label: "Groups" },
  { id: "review", label: "Review" },
];

export function SeatingBoard() {
  const guests = useGuests();
  const seating = useSeating();
  const event = useEvent();
  const { setGuests, setSeating, setPlan } = useWriters();

  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>("add");

  const plan: Plan = useMemo(() => ({ guests, seating }), [guests, seating]);
  const warnings = useMemo(() => computeWarnings(guests, seating), [guests, seating]);
  const warningIndex = useMemo(() => buildWarningIndex(warnings), [warnings]);

  /**
   * Anything touching a seat writes both slices, or the two drift apart — and
   * as one change, or undo would put a guest back at a table the table has
   * already forgotten.
   */
  const commit = useCallback(
    (next: Plan, label = "the seating") => {
      if (next.guests === plan.guests && next.seating === plan.seating) return;
      setPlan(next.guests, next.seating, { label });
    },
    [plan, setPlan],
  );

  const writeSeating = useCallback(
    (next: Seating, label: string) => setSeating(next, { label }),
    [setSeating],
  );

  const writeGuests = useCallback(
    (next: Record<string, Guest>, label: string) => setGuests(next, { label }),
    [setGuests],
  );

  const select = useCallback((next: Selection) => {
    setSelection(next);
    if (next !== null) setTab("selected");
  }, []);

  const selectedTable = selection?.kind === "table" ? selection.id : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
      <aside className="w-full shrink-0 border-b border-charcoal/10 lg:w-72 lg:border-r lg:border-b-0">
        <GuestPanel
          plan={plan}
          selectedTable={selectedTable}
          warnings={warningIndex}
          onCommit={commit}
          onSetGuests={writeGuests}
          onSeat={(guestId) => {
            if (selectedTable) commit(seatGuest(plan, guestId, selectedTable));
          }}
          onUnseat={(guestId) => commit(unseatGuest(plan, guestId))}
        />
      </aside>

      <main className="min-h-96 flex-1 bg-stone/40">
        <RoomCanvas
          seating={seating}
          guests={guests}
          selection={selection}
          warnings={warningIndex}
          onSelect={select}
          onMoveTable={(id, x, y, patch) =>
            writeSeating(
              patchTable(seating, id, { x, y, ...(patch as Partial<Table>) }),
              "moving a table",
            )
          }
          onMoveZone={(id, x, y) => writeSeating(patchZone(seating, id, { x, y }), "moving a zone")}
          onMoveObstacle={(id, x, y) =>
            writeSeating(patchObstacle(seating, id, { x, y }), "editing the room")
          }
          onDropGuest={(guestId, tableId, seatIndex) =>
            commit(seatGuest(plan, guestId, tableId, seatIndex))
          }
        />
      </main>

      <aside className="flex w-full shrink-0 flex-col border-t border-charcoal/10 lg:w-80 lg:border-t-0 lg:border-l">
        <nav className="flex shrink-0 border-b border-charcoal/10">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id ? "true" : undefined}
              className={`flex-1 px-2 py-2.5 text-xs transition ${
                tab === entry.id
                  ? "border-b-2 border-gold text-charcoal"
                  : "text-slate hover:text-charcoal"
              }`}
            >
              {entry.label}
              {entry.id === "review" && warnings.some((w) => w.level === "warn") ? (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-rose align-middle" />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "add" ? (
            <RoomTools plan={plan} onSetSeating={writeSeating} onSelect={select} />
          ) : null}
          {tab === "selected" ? (
            <InspectorPanel
              selection={selection}
              plan={plan}
              warnings={warnings}
              onSetSeating={writeSeating}
              onCommit={commit}
              onClearSelection={() => setSelection(null)}
            />
          ) : null}
          {tab === "organise" ? (
            <OrganisePanel plan={plan} onSetSeating={writeSeating} onCommit={commit} />
          ) : null}
          {tab === "review" ? (
            <InsightPanel
              plan={plan}
              warnings={warnings}
              title={event.coupleNames || "Our wedding"}
              onSetSeating={writeSeating}
              onCommit={commit}
              onFocus={(tableId) => select({ kind: "table", id: tableId })}
            />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
