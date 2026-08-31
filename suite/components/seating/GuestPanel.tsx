"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Trash2, UserPlus, X } from "lucide-react";
import { newGuest } from "@/lib/model/factories";
import { guestName } from "@/lib/model/slices";
import type { Guest, Seating } from "@/lib/model/types";
import type { Plan } from "@/lib/seating/actions";
import {
  allGuestTags,
  assignToGroup,
  EMPTY_FILTER,
  filterGuests,
  type GuestFilter,
} from "@/lib/seating/organise";
import type { WarningIndex } from "@/lib/seating/warnings";
import {
  Check,
  IconButton,
  SelectField,
  Segmented,
  TextArea,
  TextField,
} from "@/components/ui/controls";
import { GUEST_DRAG_TYPE } from "./RoomCanvas";

/**
 * The guest list.
 *
 * Grouped by whatever the couple actually organises by, filtered by everything
 * that gets asked ("who has not replied?", "who is coeliac?"), and the source of
 * every drag onto the room. Clicking a name opens it for editing in place —
 * dietary requirements arrive late and change often, and sending someone to a
 * different screen to record one is how they end up in a separate spreadsheet.
 */

export interface GuestPanelProps {
  plan: Plan;
  selectedTable: string | null;
  warnings: WarningIndex;
  onCommit: (next: Plan, label: string) => void;
  onSetGuests: (guests: Record<string, Guest>, label: string) => void;
  onSeat: (guestId: string) => void;
  onUnseat: (guestId: string) => void;
}

type GroupBy = "none" | "groups" | "subgroups" | "families" | "table";

export function GuestPanel({
  plan,
  selectedTable,
  warnings,
  onCommit,
  onSetGuests,
  onSeat,
  onUnseat,
}: GuestPanelProps) {
  const [filter, setFilter] = useState<GuestFilter>(EMPTY_FILTER);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [name, setName] = useState("");

  const all = useMemo(() => Object.values(plan.guests), [plan.guests]);
  const tags = useMemo(() => allGuestTags(all), [all]);
  const shown = useMemo(() => filterGuests(all, filter), [all, filter]);

  const sections = useMemo(
    () => groupGuests(shown, plan.seating, groupBy),
    [shown, plan.seating, groupBy],
  );

  const filtered =
    filter.query !== "" ||
    filter.rsvp !== "all" ||
    filter.side !== "all" ||
    filter.seated !== "all" ||
    filter.groupId !== null ||
    filter.tags.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-charcoal/10 p-3">
        <label className="flex items-center gap-2 rounded border border-charcoal/15 px-2 py-1.5">
          <Search size={15} className="shrink-0 text-slate" />
          <input
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            placeholder={
              selectedTable ? "Click a name to seat them" : `${shown.length} of ${all.length}`
            }
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          {filtered ? (
            <IconButton onClick={() => setFilter(EMPTY_FILTER)} icon={X} label="Clear filters" />
          ) : null}
        </label>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-1 text-xs text-slate transition hover:text-charcoal"
        >
          {showFilters ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Filter and group
        </button>

        {showFilters ? (
          <div className="space-y-2 pt-1">
            <Segmented
              value={filter.seated}
              onChange={(seated) => setFilter({ ...filter, seated })}
              options={[
                { value: "all", label: "All" },
                { value: "unseated", label: "Unseated" },
                { value: "seated", label: "Seated" },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <SelectField
                value={filter.rsvp}
                onChange={(rsvp) => setFilter({ ...filter, rsvp })}
                options={[
                  { value: "all", label: "Any RSVP" },
                  { value: "confirmed", label: "Confirmed" },
                  { value: "pending", label: "Awaiting" },
                  { value: "declined", label: "Declined" },
                ]}
              />
              <SelectField
                value={filter.side}
                onChange={(side) => setFilter({ ...filter, side })}
                options={[
                  { value: "all", label: "Either side" },
                  { value: "bride", label: "Bride" },
                  { value: "groom", label: "Groom" },
                  { value: "both", label: "Both" },
                ]}
              />
            </div>
            <SelectField
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: "none", label: "No grouping" },
                { value: "groups", label: "By group" },
                { value: "subgroups", label: "By subgroup" },
                { value: "families", label: "By family" },
                { value: "table", label: "By table" },
              ]}
            />
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() =>
                      setFilter({
                        ...filter,
                        tags: filter.tags.includes(tag)
                          ? filter.tags.filter((t) => t !== tag)
                          : [...filter.tags, tag],
                      })
                    }
                    className={`rounded-full border px-2 py-0.5 text-xs transition ${
                      filter.tags.includes(tag)
                        ? "border-gold bg-gold/20 text-charcoal"
                        : "border-charcoal/15 text-slate hover:border-charcoal/30"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className="min-h-32 flex-1 overflow-y-auto p-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(GUEST_DRAG_TYPE);
          if (id) onUnseat(id);
        }}
      >
        {shown.length === 0 ? (
          <p className="p-3 text-sm text-slate">
            {all.length === 0
              ? "Nobody on the list yet. Add someone below, or upload a list from the Data button in the header."
              : "Nobody matches that. Clear the filters to see everyone again."}
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.key} className="mb-2">
              {section.label === null ? null : (
                <h4 className="px-1 py-1 text-xs tracking-wide text-slate uppercase">
                  {section.label} · {section.guests.length}
                </h4>
              )}
              {section.guests.map((guest) => (
                <GuestRow
                  key={guest.id}
                  guest={guest}
                  plan={plan}
                  open={openId === guest.id}
                  seatAt={selectedTable}
                  warned={(warnings.byGuest.get(guest.id) ?? []).some((w) => w.level === "warn")}
                  onToggle={() => setOpenId(openId === guest.id ? null : guest.id)}
                  onSeat={() => onSeat(guest.id)}
                  onCommit={onCommit}
                  onSetGuests={onSetGuests}
                />
              ))}
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const parts = name.trim().split(/\s+/).filter(Boolean);
          if (parts.length === 0) return;
          const guest = newGuest({
            firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0]!,
            lastName: parts.length > 1 ? parts[parts.length - 1]! : "",
            rsvpStatus: "confirmed",
          });
          onSetGuests({ ...plan.guests, [guest.id]: guest }, "adding a guest");
          setName("");
        }}
        className="flex gap-2 border-t border-charcoal/10 p-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a guest"
          className="min-w-0 flex-1 rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-sm outline-none focus:border-gold"
        />
        <button
          type="submit"
          aria-label="Add this guest"
          className="rounded border border-charcoal/15 px-2 text-slate transition hover:border-gold hover:text-charcoal"
        >
          <UserPlus size={15} />
        </button>
      </form>
    </div>
  );
}

function GuestRow({
  guest,
  plan,
  open,
  seatAt,
  warned,
  onToggle,
  onSeat,
  onCommit,
  onSetGuests,
}: {
  guest: Guest;
  plan: Plan;
  open: boolean;
  seatAt: string | null;
  warned: boolean;
  onToggle: () => void;
  onSeat: () => void;
  onCommit: (next: Plan, label: string) => void;
  onSetGuests: (guests: Record<string, Guest>, label: string) => void;
}) {
  const table = guest.assignedTableId ? plan.seating.tables[guest.assignedTableId] : null;

  const patch = (fields: Partial<Guest>) =>
    onSetGuests({ ...plan.guests, [guest.id]: { ...guest, ...fields } }, "editing a guest");

  return (
    <div className={`mb-1 rounded border ${open ? "border-charcoal/20 bg-parchment" : "border-transparent"}`}>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(GUEST_DRAG_TYPE, guest.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        className="flex cursor-grab items-center gap-1.5 px-2.5 py-1.5 active:cursor-grabbing"
      >
        <button
          type="button"
          onClick={seatAt && guest.assignedTableId === null ? onSeat : onToggle}
          title={
            seatAt && guest.assignedTableId === null
              ? "Seat at the selected table"
              : "Open this guest"
          }
          className="min-w-0 flex-1 text-left text-sm"
        >
          <span className={warned ? "text-rose" : "text-charcoal"}>{guestName(guest)}</span>
          <span className="ml-2 text-xs text-slate">
            {table ? table.label : ""}
            {guest.rsvpStatus === "pending" ? " · awaiting" : ""}
            {guest.rsvpStatus === "declined" ? " · declined" : ""}
          </span>
          {guest.dietary ? <span className="ml-2 text-xs text-sage">{guest.dietary}</span> : null}
        </button>
        <IconButton onClick={onToggle} icon={open ? ChevronDown : ChevronRight} label="Details" />
      </div>

      {open ? (
        <div className="space-y-2 border-t border-charcoal/10 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="First"
              value={guest.firstName}
              onChange={(firstName) => patch({ firstName })}
            />
            <TextField
              label="Last"
              value={guest.lastName}
              onChange={(lastName) => patch({ lastName })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="RSVP"
              value={guest.rsvpStatus}
              onChange={(rsvpStatus) => patch({ rsvpStatus })}
              options={[
                { value: "pending", label: "Awaiting" },
                { value: "confirmed", label: "Coming" },
                { value: "declined", label: "Not coming" },
              ]}
            />
            <SelectField
              label="Side"
              value={guest.side}
              onChange={(side) => patch({ side })}
              options={[
                { value: "", label: "—" },
                { value: "bride", label: "Bride" },
                { value: "groom", label: "Groom" },
                { value: "both", label: "Both" },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Dietary"
              value={guest.dietary}
              onChange={(dietary) => patch({ dietary })}
              placeholder="Vegetarian"
            />
            <TextField
              label="Main course"
              value={guest.entree}
              onChange={(entree) => patch({ entree })}
              placeholder="Beef"
            />
          </div>
          <TextField
            label="Email"
            type="email"
            value={guest.email}
            onChange={(email) => patch({ email })}
          />

          {(["groups", "subgroups", "families"] as const).map((kind) => {
            const field = kind === "groups" ? "groupId" : kind === "subgroups" ? "subgroupId" : "familyId";
            const entries = Object.values(plan.seating[kind]);
            if (entries.length === 0) return null;
            return (
              <SelectField
                key={kind}
                label={kind === "groups" ? "Group" : kind === "subgroups" ? "Subgroup" : "Family"}
                value={(guest[field] ?? "") as string}
                onChange={(id) =>
                  onCommit(assignToGroup(plan, guest.id, kind, id || null), "grouping a guest")
                }
                options={[
                  { value: "", label: "—" },
                  ...entries.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            );
          })}

          <TextField
            label="Tags — comma separated"
            value={guest.tags.join(", ")}
            onChange={(raw) =>
              patch({ tags: raw.split(",").map((t) => t.trim()).filter(Boolean) })
            }
          />
          <TextArea label="Notes" rows={2} value={guest.notes} onChange={(notes) => patch({ notes })} />

          <div className="flex items-center justify-between pt-1">
            <Check
              label="A plus-one"
              checked={guest.plusOneOf !== null}
              onChange={(on) => patch({ plusOneOf: on ? "" : null })}
            />
            <button
              type="button"
              onClick={() => {
                const guests = { ...plan.guests };
                delete guests[guest.id];
                // Through the plan, so the table they sat at forgets them too.
                onCommit(
                  {
                    guests,
                    seating: {
                      ...plan.seating,
                      tables: Object.fromEntries(
                        Object.entries(plan.seating.tables).map(([id, t]) => [
                          id,
                          {
                            ...t,
                            assignedGuestIds: t.assignedGuestIds.map((g) =>
                              g === guest.id ? null : g,
                            ),
                          },
                        ]),
                      ),
                    },
                  },
                  "removing a guest",
                );
              }}
              className="inline-flex items-center gap-1.5 text-xs text-slate transition hover:text-rose"
            >
              <Trash2 size={13} />
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface Section {
  key: string;
  label: string | null;
  guests: Guest[];
}

function groupGuests(guests: Guest[], seating: Seating, by: GroupBy): Section[] {
  const sorted = [...guests].sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName) ||
      a.firstName.localeCompare(b.firstName) ||
      a.id.localeCompare(b.id),
  );

  if (by === "none") return [{ key: "all", label: null, guests: sorted }];

  const nameOf = (guest: Guest): { key: string; label: string } => {
    if (by === "table") {
      const table = guest.assignedTableId ? seating.tables[guest.assignedTableId] : null;
      return table ? { key: table.id, label: table.label } : { key: "", label: "No table" };
    }
    const field = by === "groups" ? "groupId" : by === "subgroups" ? "subgroupId" : "familyId";
    const id = guest[field];
    const entry = id ? seating[by][id] : null;
    return entry ? { key: entry.id, label: entry.name } : { key: "", label: "Ungrouped" };
  };

  const sections = new Map<string, Section>();
  for (const guest of sorted) {
    const { key, label } = nameOf(guest);
    const section = sections.get(key);
    if (section) section.guests.push(guest);
    else sections.set(key, { key, label, guests: [guest] });
  }

  // The unassigned bucket last: it is the one being emptied, not the one being read.
  return [...sections.values()].sort((a, b) => {
    if (a.key === "") return 1;
    if (b.key === "") return -1;
    return (a.label ?? "").localeCompare(b.label ?? "", undefined, { numeric: true });
  });
}
