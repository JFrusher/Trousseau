"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/controls";
import { newId } from "@/lib/model/ids";
import type { Cast, CustomRole, Guest, Seating, Shot, Shots } from "@/lib/model/types";
import { resolveShot } from "@/lib/ensemble/resolve";
import {
  addSection,
  addShot,
  duplicateShot,
  removeSection,
  removeShot,
  renameSection,
  reorderSections,
  reorderShot,
} from "@/lib/ensemble/actions";

export function ShotList({
  shots,
  guests,
  seating,
  selectedId,
  onSelect,
  onChange,
}: {
  shots: Shots;
  guests: Record<string, Guest>;
  seating: Seating;
  selectedId: string | null;
  onSelect: (shotId: string) => void;
  onChange: (next: Shots) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Arrow keys move a shot to the next position rather than a few pixels.
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * Shot id to its number across the whole list, not within its section — the
   * same running count `shotSheet.ts` and `exports.ts` print, so the screen and
   * the sheet in the photographer's hand agree about which shot is number six.
   */
  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    let number = 0;
    for (const section of shots.sections) {
      for (const shot of section.shots) map.set(shot.id, (number += 1));
    }
    return map;
  }, [shots.sections]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      {shots.sections.map((section, index) => (
        <div key={section.id} className="rounded border border-charcoal/10">
          <div className="flex items-center gap-1 border-b border-charcoal/10 bg-stone/60 px-2 py-1.5">
            <IconButton
              icon={collapsed.has(section.id) ? ChevronDown : ChevronUp}
              label={collapsed.has(section.id) ? "Expand section" : "Collapse section"}
              onClick={() => toggle(section.id)}
            />
            <input
              aria-label="Section name"
              value={section.name}
              onChange={(e) => onChange(renameSection(shots, section.id, e.target.value))}
              className="min-w-0 flex-1 bg-transparent text-sm text-charcoal focus:outline-none"
            />
            <span className="shrink-0 text-xs text-slate">{section.shots.length}</span>
            <IconButton
              icon={ChevronUp}
              label="Move section up"
              onClick={() => index > 0 && onChange(reorderSections(shots, index, index - 1))}
            />
            <IconButton
              icon={ChevronDown}
              label="Move section down"
              onClick={() =>
                index < shots.sections.length - 1 && onChange(reorderSections(shots, index, index + 1))
              }
            />
            <IconButton
              icon={Trash2}
              label="Remove section"
              tone="danger"
              onClick={() => onChange(removeSection(shots, section.id))}
            />
          </div>

          {!collapsed.has(section.id) && (
            <div className="p-1.5">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  const { active, over } = event;
                  if (!over || active.id === over.id) return;
                  const from = section.shots.findIndex((s) => s.id === active.id);
                  const to = section.shots.findIndex((s) => s.id === over.id);
                  if (from !== -1 && to !== -1) onChange(reorderShot(shots, section.id, from, to));
                }}
              >
                <SortableContext items={section.shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col gap-0.5">
                    {section.shots.map((shot) => (
                      <ShotRow
                        key={shot.id}
                        shot={shot}
                        number={numbers.get(shot.id) ?? 0}
                        guests={guests}
                        seating={seating}
                        cast={shots.cast}
                        customRoles={shots.customRoles}
                        selected={shot.id === selectedId}
                        onSelect={() => onSelect(shot.id)}
                        onRemove={() => onChange(removeShot(shots, shot.id))}
                        onDuplicate={() => {
                          const copyId = newId("shot");
                          onChange(duplicateShot(shots, shot.id, copyId));
                          onSelect(copyId);
                        }}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>

              <button
                type="button"
                onClick={() => onChange(addShot(shots, section.id))}
                className="mt-1 flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-slate hover:text-charcoal"
              >
                <Plus size={13} /> Add shot
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange(addSection(shots))}
        className="flex items-center justify-center gap-1.5 rounded border border-dashed border-charcoal/20 py-2 text-sm text-slate hover:border-gold hover:text-charcoal"
      >
        <Plus size={14} /> Add section
      </button>
    </div>
  );
}

function ShotRow({
  shot,
  number,
  guests,
  seating,
  cast,
  customRoles,
  selected,
  onSelect,
  onRemove,
  onDuplicate,
}: {
  shot: Shot;
  /** Its place across the whole list, as printed. */
  number: number;
  guests: Record<string, Guest>;
  seating: Seating;
  cast: Cast;
  customRoles: CustomRole[];
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: shot.id });
  const resolved = resolveShot(shot, guests, seating, cast, customRoles);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-start gap-1.5 rounded px-1.5 py-1 ${selected ? "bg-gold/15" : "hover:bg-stone"}`}
    >
      <button
        {...attributes}
        {...listeners}
        // Without this the browser scrolls the list instead of dragging the row.
        style={{ touchAction: "none" }}
        className="mt-0.5 shrink-0 cursor-grab text-slate"
        aria-label="Reorder"
      >
        <GripVertical size={13} />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm text-charcoal">
          {number}. {resolved.label}
          {resolved.problems.length > 0 && <span className="ml-1 text-rose">●</span>}
        </div>
        <div className="truncate text-xs text-slate">
          {resolved.people.map((p) => p.name).join(", ") || "Nobody yet"}
        </div>
      </button>
      <IconButton icon={Copy} label="Duplicate shot" onClick={onDuplicate} />
      <IconButton icon={Trash2} label="Remove shot" tone="danger" onClick={onRemove} />
    </li>
  );
}
