"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Camera, Download, History, Info, RotateCcw, Trash2 } from "lucide-react";
import { download } from "@/lib/data/file";
import type { Seating } from "@/lib/model/types";
import type { Plan } from "@/lib/seating/actions";
import {
  floorPlanSvg,
  guestListCsv,
  summaryCsv,
  tablePlanCsv,
} from "@/lib/seating/exports";
import { getTableGeometry } from "@/lib/seating/geometry";
import { removeSnapshot, restoreSnapshot, takeSnapshot } from "@/lib/seating/roomActions";
import { computeStats } from "@/lib/seating/stats";
import type { Warning } from "@/lib/seating/warnings";
import { Button, Empty, IconButton, Panel, TextField } from "@/components/ui/controls";

/**
 * What the plan adds up to, what is wrong with it, and how to get it out.
 */
export function InsightPanel({
  plan,
  warnings,
  title,
  onSetSeating,
  onCommit,
  onFocus,
}: {
  plan: Plan;
  warnings: Warning[];
  title: string;
  onSetSeating: (next: Seating, label: string) => void;
  onCommit: (next: Plan, label: string) => void;
  onFocus: (tableId: string) => void;
}) {
  const stats = useMemo(() => computeStats(plan.guests, plan.seating), [plan]);
  const [label, setLabel] = useState("");

  const slug =
    title
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "wedding";

  return (
    <>
      <Panel title="Where things stand">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Stat label="Guests" value={stats.guests} />
          <Stat label="Coming" value={stats.confirmed} />
          <Stat label="Awaiting reply" value={stats.pending} />
          <Stat label="Not coming" value={stats.declined} />
          <Stat label="Seated" value={`${stats.seated} / ${stats.confirmed}`} />
          <Stat
            label="Still to seat"
            value={stats.outstanding}
            tone={stats.outstanding > 0 ? "warn" : "calm"}
          />
          <Stat label="Tables" value={stats.tables} />
          <Stat
            label="Seats spare"
            value={stats.spare}
            tone={stats.spare < 0 ? "warn" : "calm"}
          />
        </dl>

        {stats.dietary.length > 0 ? (
          <Tallies title="Dietary — those coming" rows={stats.dietary} />
        ) : null}
        {stats.entrees.length > 0 ? <Tallies title="Main course" rows={stats.entrees} /> : null}
      </Panel>

      <Panel title={`Worth a look (${warnings.length})`}>
        {warnings.length === 0 ? (
          <Empty>Nothing outstanding.</Empty>
        ) : (
          <ul className="space-y-1">
            {warnings.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => w.tableId && onFocus(w.tableId)}
                  className={`flex w-full gap-1.5 rounded border px-2 py-1.5 text-left text-xs ${
                    w.level === "warn"
                      ? "border-rose/40 bg-rose/10 text-charcoal"
                      : "border-charcoal/10 bg-stone text-slate"
                  }`}
                >
                  {w.level === "warn" ? (
                    <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose" />
                  ) : (
                    <Info size={13} className="mt-0.5 shrink-0" />
                  )}
                  <span>{w.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Take it away">
        <div className="grid gap-1.5">
          <Button
            icon={Download}
            onClick={() =>
              download(`${slug}-guests.csv`, guestListCsv(plan.guests, plan.seating), "text/csv")
            }
          >
            Guest list (CSV)
          </Button>
          <Button
            icon={Download}
            onClick={() =>
              download(`${slug}-table-plan.csv`, tablePlanCsv(plan.guests, plan.seating), "text/csv")
            }
          >
            Table plan (CSV)
          </Button>
          <Button
            icon={Download}
            onClick={() =>
              download(`${slug}-summary.csv`, summaryCsv(plan.guests, plan.seating), "text/csv")
            }
          >
            Counts for the caterer (CSV)
          </Button>
          <Button
            icon={Download}
            onClick={() =>
              download(
                `${slug}-floor-plan.svg`,
                floorPlanSvg(
                  plan.guests,
                  plan.seating,
                  (id) => {
                    const table = plan.seating.tables[id]!;
                    return getTableGeometry(table, plan.seating.settings.pixelsPerUnit);
                  },
                  title,
                ),
                "image/svg+xml",
              )
            }
          >
            Floor plan (SVG)
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-slate">
          The floor plan is vector — it prints at any size, and File → Print makes it a PDF.
        </p>
      </Panel>

      <Panel title="Kept versions">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSetSeating(takeSnapshot(plan, label), "keeping a version");
            setLabel("");
          }}
          className="flex gap-2"
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Before the shuffle"
            className="min-w-0 flex-1 rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-sm outline-none focus:border-gold"
          />
          <button
            type="submit"
            aria-label="Keep this version"
            className="rounded border border-charcoal/15 px-2 text-slate transition hover:border-gold hover:text-charcoal"
          >
            <Camera size={15} />
          </button>
        </form>

        {plan.seating.snapshots.length === 0 ? (
          <p className="mt-2 text-xs text-slate">
            Undo covers the last few minutes. A kept version covers &ldquo;before I moved everyone
            around on Tuesday&rdquo;.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {plan.seating.snapshots.map((snapshot) => (
              <li key={snapshot.id} className="flex items-center gap-1.5 text-sm">
                <History size={13} className="shrink-0 text-slate" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-charcoal">{snapshot.label}</span>
                  <span className="block text-xs text-slate">
                    {snapshot.at ? new Date(snapshot.at).toLocaleString() : ""}
                  </span>
                </span>
                <IconButton
                  onClick={() => {
                    const restored = restoreSnapshot(plan, snapshot.id);
                    if (restored) onCommit(restored, "restoring a version");
                  }}
                  icon={RotateCcw}
                  label={`Go back to "${snapshot.label}"`}
                />
                <IconButton
                  onClick={() =>
                    onSetSeating(removeSnapshot(plan.seating, snapshot.id), "deleting a version")
                  }
                  icon={Trash2}
                  label={`Delete "${snapshot.label}"`}
                  tone="danger"
                />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Stat({
  label,
  value,
  tone = "calm",
}: {
  label: string;
  value: number | string;
  tone?: "calm" | "warn";
}) {
  return (
    <div>
      <dt className="text-xs text-slate">{label}</dt>
      <dd className={`font-display text-xl ${tone === "warn" ? "text-rose" : "text-charcoal"}`}>
        {value}
      </dd>
    </div>
  );
}

function Tallies({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  return (
    <div className="mt-3">
      <h4 className="mb-1 text-xs text-slate">{title}</h4>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-charcoal">{row.label}</span>
            <span className="shrink-0 text-slate">{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { TextField };
