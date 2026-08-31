"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Pin,
  PinOff,
  Plus,
  Sun,
  Trash2,
} from "lucide-react";
import { useEvent, useResolvedDay, useTimeline, useWriters } from "@/lib/model/useSuite";
import { conflicts, conflictsByBlock, type Conflict } from "@/lib/timeline/core/schedule/conflicts";
import { slack } from "@/lib/timeline/core/schedule/slack";
import { sunForDay } from "@/lib/timeline/core/sun/solar";
import { formatClock, formatDuration, parseClock } from "@/lib/timeline/core/time/minutes";
import type { Block, TimelineDoc } from "@/lib/timeline/core/model/types";
import {
  addBlock,
  addLane,
  allTags,
  moveBlock,
  patchBlock,
  removeBlock,
  removeLane,
  setTagDetail,
  setVenuePosition,
} from "@/lib/timeline/actions";
import {
  Button,
  Check,
  Empty,
  NumberField,
  Panel,
  SelectField,
  TextArea,
  TextField,
} from "@/components/ui/controls";
import { PrintPanel } from "./PrintPanel";

/**
 * The run of the day.
 *
 * Nothing here works out when anything happens: Cadence's `resolve` does, once,
 * and the screen draws what it returns. That is the rule the whole scheduling
 * model rests on — a second implementation of it in a component is how the paper
 * and the screen come to disagree.
 */

type Tab = "block" | "suppliers" | "print";

export function TimelineBoard() {
  const doc = useTimeline();
  const resolved = useResolvedDay();
  const event = useEvent();
  const { setTimeline, setEvent } = useWriters();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("block");

  const write = useCallback(
    (next: TimelineDoc, label: string) => setTimeline(next, { label }),
    [setTimeline],
  );

  const placed = useMemo(() => new Map(resolved.map((r) => [r.id, r])), [resolved]);
  const sun = useMemo(() => sunForDay(doc.day), [doc.day]);
  const found = useMemo(
    () =>
      conflicts(
        resolved,
        doc,
        // Null in polar day or night, where there is no golden hour to be past.
        sun?.goldenHourEndMin == null ? {} : { goldenHourEndMin: sun.goldenHourEndMin },
      ),
    [resolved, doc, sun],
  );
  const byBlock = useMemo(() => conflictsByBlock(found), [found]);
  const headroom = useMemo(() => slack(resolved, doc), [resolved, doc]);
  const tags = useMemo(() => allTags(doc), [doc]);

  const domain = useMemo(() => {
    if (resolved.length === 0) return { start: 9 * 60, end: 23 * 60 };
    const start = Math.min(...resolved.map((r) => r.startMin));
    const end = Math.max(...resolved.map((r) => r.endMin), doc.day.curfewMin);
    return { start: Math.floor(start / 60) * 60, end: Math.ceil(end / 60) * 60 };
  }, [resolved, doc.day.curfewMin]);

  const span = Math.max(60, domain.end - domain.start);
  const pct = (min: number) => ((min - domain.start) / span) * 100;
  const selected = doc.blocks.find((b) => b.id === selectedId) ?? null;
  const clashes = found.filter((c) => c.severity === "conflict").length;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col xl:flex-row">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-3 border-b border-charcoal/10 px-4 py-2.5">
          <label className="text-sm">
            <span className="mr-2 text-slate">Curfew</span>
            <input
              defaultValue={formatClock(doc.day.curfewMin)}
              onBlur={(e) => {
                const min = parseClock(e.target.value);
                if (min !== null) setEvent({ curfewMin: min }, { label: "the curfew" });
                else e.target.value = formatClock(doc.day.curfewMin);
              }}
              className="w-20 rounded border border-charcoal/15 bg-parchment px-2 py-1 outline-none focus:border-gold"
            />
          </label>

          <span
            className={`text-xs ${headroom.toCurfewMin < 0 ? "text-rose" : "text-slate"}`}
            title="Time between the end of the day and the curfew"
          >
            {headroom.toCurfewMin < 0
              ? `${formatDuration(-headroom.toCurfewMin)} past curfew`
              : `${formatDuration(headroom.toCurfewMin)} to spare`}
          </span>

          {sun?.goldenHourEndMin != null ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-slate"
              title="Worked out from the venue's coordinates and the date — no network, no timezone database"
            >
              <Sun size={13} className="text-gold" />
              light goes {formatClock(sun.goldenHourEndMin)}
            </span>
          ) : null}

          {tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs tracking-widest text-slate uppercase">Suppliers</span>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setFilter(filter === tag ? null : tag)}
                  className={`rounded-full border px-2 py-0.5 text-xs transition ${
                    filter === tag
                      ? "border-gold bg-gold/20 text-charcoal"
                      : "border-charcoal/15 text-slate hover:border-charcoal/30"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}

          <span className="ml-auto text-xs text-slate">
            {doc.blocks.length} blocks · {clashes} {clashes === 1 ? "clash" : "clashes"}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <Ruler start={domain.start} end={domain.end} />

          {doc.lanes.map((lane) => (
            <section key={lane} className="mb-4">
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-sm text-charcoal">{lane}</h2>
                <button
                  type="button"
                  onClick={() => {
                    const next = addBlock(doc, lane);
                    write(next, "adding a block");
                    setSelectedId(next.blocks[next.blocks.length - 1]?.id ?? null);
                    setTab("block");
                  }}
                  aria-label={`Add a block to ${lane}`}
                  className="text-slate transition hover:text-charcoal"
                >
                  <Plus size={14} />
                </button>
                {doc.lanes.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => write(removeLane(doc, lane), "removing a lane")}
                    aria-label={`Remove the ${lane} lane`}
                    className="text-slate transition hover:text-rose"
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>

              <div className="relative h-14 rounded border border-charcoal/10 bg-stone/50">
                {doc.blocks
                  .filter((b) => b.lane === lane)
                  .map((block) => {
                    const entry = placed.get(block.id);
                    if (!entry) return null;
                    const dim = filter !== null && !block.tags.includes(filter);
                    const clash = (byBlock.get(block.id) ?? []).some(
                      (c) => c.severity === "conflict",
                    );
                    const moment = block.durationMin <= 0;
                    const left = pct(entry.startMin);
                    const width = Math.max(moment ? 0 : 1.2, pct(entry.endMin) - left);

                    return (
                      <button
                        key={block.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(block.id);
                          setTab("block");
                        }}
                        title={`${block.label} — ${formatClock(entry.startMin)}${
                          entry.squeezedMin > 0
                            ? `, squeezed by ${formatDuration(entry.squeezedMin)}`
                            : ""
                        }`}
                        style={{ left: `${left}%`, width: moment ? undefined : `${width}%` }}
                        className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded px-1.5 text-left text-xs transition ${
                          moment ? "w-2 border-l-2" : "border"
                        } ${dim ? "opacity-25" : ""} ${
                          clash
                            ? "border-rose bg-rose/20"
                            : selectedId === block.id
                              ? "border-gold bg-gold/20"
                              : "border-charcoal/20 bg-parchment hover:border-charcoal/40"
                        }`}
                      >
                        {moment ? null : (
                          <>
                            <span className="block truncate text-charcoal">{block.label}</span>
                            <span className="block truncate text-slate">
                              {formatClock(entry.startMin)}
                              {entry.anchored ? " ·" : ""}
                              {entry.squeezedMin > 0 ? " ⤡" : ""}
                            </span>
                          </>
                        )}
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}

          <AddLane onAdd={(name) => write(addLane(doc, name), "adding a lane")} />

          {found.length > 0 ? (
            <ul className="mt-6 space-y-1.5">
              {found.map((conflict, i) => (
                <ConflictRow
                  key={i}
                  conflict={conflict}
                  onPick={(id) => {
                    setSelectedId(id);
                    setTab("block");
                  }}
                />
              ))}
            </ul>
          ) : null}
        </div>
      </main>

      <aside className="flex w-full shrink-0 flex-col border-t border-charcoal/10 xl:w-80 xl:border-t-0 xl:border-l">
        <nav className="flex shrink-0 border-b border-charcoal/10">
          {(
            [
              ["block", "Block"],
              ["suppliers", "Suppliers"],
              ["print", "Print"],
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
          {tab === "block" ? (
            selected ? (
              <BlockInspector
                key={selected.id}
                block={selected}
                lanes={doc.lanes}
                startMin={placed.get(selected.id)?.startMin ?? null}
                squeezedMin={placed.get(selected.id)?.squeezedMin ?? 0}
                slackMin={headroom.byBlock.get(selected.id) ?? null}
                onPatch={(patch) => write(patchBlock(doc, selected.id, patch), "editing a block")}
                onMove={(d) => write(moveBlock(doc, selected.id, d), "reordering the day")}
                onDelete={() => {
                  write(removeBlock(doc, selected.id), "deleting a block");
                  setSelectedId(null);
                }}
              />
            ) : (
              <Empty>
                Pick a block to change its length, pin it to a clock time, or tag the supplier it
                belongs to. Anchored blocks stay put; everything else follows what comes before it.
              </Empty>
            )
          ) : null}

          {tab === "suppliers" ? (
            <SupplierPanel
              doc={doc}
              onWrite={write}
              onPosition={(lat, lon) => write(setVenuePosition(doc, lat, lon), "the venue")}
            />
          ) : null}

          {tab === "print" ? (
            <PrintPanel doc={doc} title={event.coupleNames || "Our wedding"} />
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Ruler({ start, end }: { start: number; end: number }) {
  const hours: number[] = [];
  for (let min = start; min <= end; min += 60) hours.push(min);
  return (
    <div className="relative mb-2 h-5 border-b border-charcoal/10">
      {hours.map((min) => (
        <span
          key={min}
          style={{ left: `${((min - start) / Math.max(60, end - start)) * 100}%` }}
          className="absolute -translate-x-1/2 text-[10px] text-slate"
        >
          {formatClock(min)}
        </span>
      ))}
    </div>
  );
}

function ConflictRow({ conflict, onPick }: { conflict: Conflict; onPick: (id: string) => void }) {
  const alarm = conflict.severity === "conflict";
  return (
    <li>
      <button
        type="button"
        onClick={() => conflict.blockIds[0] && onPick(conflict.blockIds[0])}
        className={`flex w-full gap-2 rounded border px-3 py-1.5 text-left text-sm ${
          alarm ? "border-rose/50 bg-rose/10" : "border-charcoal/10 bg-stone/60"
        }`}
      >
        {alarm ? (
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-rose" />
        ) : (
          <Info size={15} className="mt-0.5 shrink-0 text-slate" />
        )}
        <span className="text-charcoal">{conflict.message}</span>
      </button>
    </li>
  );
}

function AddLane({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(name);
        setName("");
      }}
      className="flex gap-2"
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New lane — Photographer, Band…"
        className="w-56 rounded border border-charcoal/15 bg-parchment px-2 py-1 text-sm outline-none focus:border-gold"
      />
      <button
        type="submit"
        className="rounded border border-charcoal/15 px-2 py-1 text-sm text-slate transition hover:border-gold hover:text-charcoal"
      >
        Add lane
      </button>
    </form>
  );
}

function BlockInspector({
  block,
  lanes,
  startMin,
  squeezedMin,
  slackMin,
  onPatch,
  onMove,
  onDelete,
}: {
  block: Block;
  lanes: string[];
  startMin: number | null;
  squeezedMin: number;
  slackMin: number | null;
  onPatch: (patch: Partial<Block>) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const anchored = block.anchorMin !== null;
  const squeezable = block.squeezeToMin !== null && block.squeezeToMin !== undefined;

  return (
    <>
      <Panel title="Block">
        <div className="space-y-2">
          <TextField value={block.label} onChange={(label) => onPatch({ label })} />

          <div className="flex items-center gap-2">
            <Button
              icon={anchored ? Pin : PinOff}
              tone={anchored ? "primary" : "quiet"}
              onClick={() => onPatch({ anchorMin: anchored ? null : (startMin ?? 12 * 60) })}
            >
              {anchored ? "Pinned" : "Floating"}
            </Button>
            {anchored ? (
              <input
                defaultValue={formatClock(block.anchorMin ?? 0)}
                onBlur={(e) => {
                  const min = parseClock(e.target.value);
                  if (min !== null) onPatch({ anchorMin: min });
                  else e.target.value = formatClock(block.anchorMin ?? 0);
                }}
                className="w-20 rounded border border-charcoal/15 bg-parchment px-2 py-1 text-sm outline-none focus:border-gold"
              />
            ) : (
              <span className="text-sm text-slate">
                starts {startMin === null ? "—" : formatClock(startMin)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <NumberField
              label="Length"
              suffix="m"
              min={0}
              value={block.durationMin}
              onChange={(durationMin) => onPatch({ durationMin: Math.max(0, durationMin) })}
            />
            <NumberField
              label="Gap"
              suffix="m"
              min={0}
              value={block.gapMin}
              onChange={(gapMin) => onPatch({ gapMin: Math.max(0, gapMin) })}
            />
            <NumberField
              label="Buffer"
              suffix="m"
              min={0}
              value={block.bufferMin}
              onChange={(bufferMin) => onPatch({ bufferMin: Math.max(0, bufferMin) })}
            />
          </div>

          {block.durationMin <= 0 ? (
            <p className="text-xs text-slate">
              No length: this sits on the clock as a mark, takes no time from its lane, and can be
              pinned inside something already running.
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Check
              label="May be squeezed to"
              checked={squeezable}
              onChange={(on) =>
                onPatch({
                  squeezeToMin: on ? Math.max(5, Math.round(block.durationMin / 2)) : null,
                })
              }
            />
            {squeezable ? (
              <input
                type="number"
                min={0}
                value={block.squeezeToMin ?? 0}
                onChange={(e) => onPatch({ squeezeToMin: Math.max(0, Number(e.target.value)) })}
                className="w-16 rounded border border-charcoal/15 bg-parchment px-2 py-1 text-sm outline-none focus:border-gold"
              />
            ) : null}
          </div>

          {squeezedMin > 0 ? (
            <p className="text-xs text-rose">
              Shortened by {formatDuration(squeezedMin)} to make the next pinned block.
            </p>
          ) : null}
          {slackMin !== null ? (
            <p className={`text-xs ${slackMin < 0 ? "text-rose" : "text-slate"}`}>
              {slackMin < 0
                ? `${formatDuration(-slackMin)} over the next pinned block.`
                : `${formatDuration(slackMin)} of headroom before the next pinned block.`}
            </p>
          ) : null}

          <SelectField
            label="Lane"
            value={block.lane}
            onChange={(lane) => onPatch({ lane })}
            options={lanes.map((l) => ({ value: l, label: l }))}
          />

          <TextField
            label="Suppliers — comma separated"
            value={block.tags.join(", ")}
            onChange={(raw) =>
              onPatch({ tags: raw.split(",").map((t) => t.trim()).filter(Boolean) })
            }
            placeholder="caterer, photo"
          />
          <TextField
            label="Where"
            value={block.location}
            onChange={(location) => onPatch({ location })}
          />
          <TextArea
            label="Notes"
            rows={2}
            value={block.notes}
            onChange={(notes) => onPatch({ notes })}
          />
        </div>
      </Panel>

      <Panel title="Appears on">
        <div className="space-y-1.5">
          {(
            [
              ["run-sheet", "Master run-sheet"],
              ["call-sheet", "Call sheets"],
              ["order-of-day", "Order of the day"],
              ["contact-sheet", "Contact sheet"],
            ] as const
          ).map(([id, label]) => (
            <Check
              key={id}
              label={label}
              checked={block.outputs.includes(id)}
              onChange={(on) =>
                onPatch({
                  outputs: on ? [...block.outputs, id] : block.outputs.filter((o) => o !== id),
                })
              }
            />
          ))}
        </div>
      </Panel>

      <Panel title="Order">
        <div className="flex items-center gap-3">
          <Button icon={ChevronUp} onClick={() => onMove(-1)} title="Earlier in this lane" />
          <Button icon={ChevronDown} onClick={() => onMove(1)} title="Later in this lane" />
          <span className="ml-auto">
            <Button icon={Trash2} tone="danger" onClick={onDelete}>
              Delete
            </Button>
          </span>
        </div>
        <p className="mt-1 text-xs text-slate">
          A floating block starts when the one before it ends, so order is how the day is arranged.
        </p>
      </Panel>
    </>
  );
}

function SupplierPanel({
  doc,
  onWrite,
  onPosition,
}: {
  doc: TimelineDoc;
  onWrite: (next: TimelineDoc, label: string) => void;
  onPosition: (latitude: number, longitude: number) => void;
}) {
  const tags = allTags(doc);

  return (
    <>
      <Panel title="Who to ring">
        {tags.length === 0 ? (
          <Empty>Tag a block with a supplier and they will appear here.</Empty>
        ) : (
          <div className="space-y-3">
            {tags.map((tag) => {
              const detail = doc.tagDetails.find((d) => d.tag === tag);
              const base = detail ?? { tag };
              return (
                <div
                  key={tag}
                  className="space-y-1.5 border-t border-charcoal/10 pt-2 first:border-t-0 first:pt-0"
                >
                  <h4 className="text-sm text-charcoal">{tag}</h4>
                  <TextField
                    label="Name"
                    value={detail?.displayName ?? ""}
                    placeholder={tag}
                    onChange={(displayName) =>
                      onWrite(setTagDetail(doc, { ...base, displayName }), "supplier details")
                    }
                  />
                  <TextField
                    label="Phone"
                    value={detail?.phone ?? ""}
                    onChange={(phone) =>
                      onWrite(setTagDetail(doc, { ...base, phone }), "supplier details")
                    }
                  />
                  <label className="block">
                    <span className="mb-1 block text-xs text-slate">Arrives</span>
                    <input
                      defaultValue={
                        detail?.arrivalMin === null || detail?.arrivalMin === undefined
                          ? ""
                          : formatClock(detail.arrivalMin)
                      }
                      placeholder="—"
                      onBlur={(e) => {
                        const min =
                          e.target.value.trim() === "" ? null : parseClock(e.target.value);
                        onWrite(setTagDetail(doc, { ...base, arrivalMin: min }), "supplier details");
                      }}
                      className="w-full rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-sm outline-none focus:border-gold"
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Where the light goes">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Latitude"
            step={0.0001}
            value={doc.day.latitude}
            onChange={(lat) => onPosition(lat, doc.day.longitude)}
          />
          <NumberField
            label="Longitude"
            step={0.0001}
            value={doc.day.longitude}
            onChange={(lon) => onPosition(doc.day.latitude, lon)}
          />
        </div>
        <p className="mt-1 text-xs text-slate">
          The venue&rsquo;s coordinates. Sunset is worked out from them and the date — no network,
          no timezone database — and the portraits are flagged if they drift past the light.
        </p>
      </Panel>
    </>
  );
}
