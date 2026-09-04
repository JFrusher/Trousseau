"use client";

import { useState } from "react";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/controls";
import type { Cast, Guest, Seating, Shot, Shots } from "@/lib/model/types";
import { resolveShot } from "@/lib/ensemble/resolve";
import {
  addSection,
  addShot,
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
                    {section.shots.map((shot, shotIndex) => (
                      <ShotRow
                        key={shot.id}
                        shot={shot}
                        index={shotIndex}
                        guests={guests}
                        seating={seating}
                        cast={shots.cast}
                        selected={shot.id === selectedId}
                        onSelect={() => onSelect(shot.id)}
                        onRemove={() => onChange(removeShot(shots, shot.id))}
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
  index,
  guests,
  seating,
  cast,
  selected,
  onSelect,
  onRemove,
}: {
  shot: Shot;
  index: number;
  guests: Record<string, Guest>;
  seating: Seating;
  cast: Cast;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: shot.id });
  const resolved = resolveShot(shot, guests, seating, cast);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-start gap-1.5 rounded px-1.5 py-1 ${selected ? "bg-gold/15" : "hover:bg-stone"}`}
    >
      <button {...attributes} {...listeners} className="mt-0.5 shrink-0 cursor-grab text-slate" aria-label="Reorder">
        <GripVertical size={13} />
      </button>
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm text-charcoal">
          {index + 1}. {resolved.label}
          {resolved.problems.length > 0 && <span className="ml-1 text-rose">●</span>}
        </div>
        <div className="truncate text-xs text-slate">
          {resolved.people.map((p) => p.name).join(", ") || "Nobody yet"}
        </div>
      </button>
      <IconButton icon={Trash2} label="Remove shot" tone="danger" onClick={onRemove} />
    </li>
  );
}
