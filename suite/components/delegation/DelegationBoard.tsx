"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Printer, Plus, Trash2, UserPlus, Wand2 } from "lucide-react";
import { formatClock } from "@/lib/timeline/core/time/minutes";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { brigadeDoc } from "@/lib/crew/bridge";
import { warningsByJob } from "@/lib/crew/core/jobs/coverage";
import { coverage } from "@/lib/crew/core/jobs/coverage";
import { CrewPrintPanel } from "./CrewPrintPanel";
import type { Job, JobStatus } from "@/lib/model/types";
import { JOB_STATUSES } from "@/lib/model/types";
import { useCrew, useEvent, useResolvedDay, useTimeline, useWriters } from "@/lib/model/useSuite";
import {
  addJob,
  addPerson,
  assigneeNames,
  orphanJobs,
  patchJob,
  personSheets,
  removeJob,
  removePerson,
  seedTeamsFromTags,
  setJobStatus,
  toggleAssignment,
} from "@/lib/crew/actions";

const COLUMN_LABEL: Record<JobStatus, string> = {
  todo: "To do",
  doing: "On the day",
  done: "Done",
};

/**
 * The jobs board.
 *
 * Jobs hang off blocks of the timeline, so the board is only as useful as the
 * day is built — which is why an empty timeline says so rather than showing an
 * empty kanban and letting the user wonder what they did wrong.
 */
export function DelegationBoard() {
  const crew = useCrew();
  const timeline = useTimeline();
  const resolved = useResolvedDay();
  const { setCrew } = useWriters();
  const event = useEvent();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"job" | "review">("job");

  // Brigade's own document, assembled from the slices. Its coverage checks and
  // its three renderers read this and nothing else.
  const brigade = useTrousseauStore((s) => brigadeDoc(s.doc));
  const warnings = useMemo(() => coverage(brigade), [brigade]);
  const warnedJobs = useMemo(() => warningsByJob(warnings), [warnings]);

  const startOf = useMemo(
    () => new Map(resolved.map((r) => [r.id, r.startMin])),
    [resolved],
  );
  const blockIds = useMemo(() => new Set(timeline.blocks.map((b) => b.id)), [timeline.blocks]);
  const labelOf = useMemo(
    () => new Map(timeline.blocks.map((b) => [b.id, b.label])),
    [timeline.blocks],
  );
  const orphans = useMemo(() => orphanJobs(crew, blockIds), [crew, blockIds]);

  const columns = useMemo(() => {
    const sorted = [...crew.jobs].sort(
      (a, b) =>
        (startOf.get(a.blockId) ?? Infinity) - (startOf.get(b.blockId) ?? Infinity) ||
        a.label.localeCompare(b.label),
    );
    return JOB_STATUSES.map((status) => ({
      status,
      jobs: sorted.filter((j) => j.status === status),
    }));
  }, [crew.jobs, startOf]);

  const selected = crew.jobs.find((j) => j.id === selectedId) ?? null;

  if (timeline.blocks.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="mb-3 text-2xl">Nothing to hang work off yet</h1>
        <p className="text-slate">
          A job happens when its block of the day happens. Build the run of the day in the Timeline
          first, then come back and put names against the work.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col xl:flex-row">
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-wrap items-center gap-2 border-b border-charcoal/10 px-4 py-3">
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              const next = addJob(crew, e.target.value);
              setCrew(next);
              setSelectedId(next.jobs[next.jobs.length - 1]?.id ?? null);
            }}
            className="rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-sm outline-none focus:border-gold"
          >
            <option value="">Add a job to…</option>
            {timeline.blocks.map((block) => (
              <option key={block.id} value={block.id}>
                {formatClock(startOf.get(block.id) ?? 0)} · {block.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setCrew(seedTeamsFromTags(crew, timeline))}
            title="Make a team for every supplier tag on the timeline that has not got one"
            className="inline-flex items-center gap-1.5 rounded border border-charcoal/15 px-2 py-1.5 text-sm text-slate transition hover:border-gold hover:text-charcoal"
          >
            <Wand2 size={14} />
            Teams from tags
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-charcoal/15 px-2 py-1.5 text-sm text-slate transition hover:border-gold hover:text-charcoal"
          >
            <Printer size={14} />
            Print role sheets
          </button>
        </header>

        {orphans.length > 0 ? (
          <p className="flex gap-2 border-b border-rose/40 bg-rose/10 px-4 py-2 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose" />
            <span>
              {orphans.length} {orphans.length === 1 ? "job hangs" : "jobs hang"} off a block that
              is no longer in the day. They are kept here, never dropped — move them or delete them.
            </span>
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-4 md:grid-cols-3">
          {columns.map(({ status, jobs }) => (
            <section
              key={status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/plain");
                if (id) setCrew(setJobStatus(crew, id, status));
              }}
              className="flex min-h-40 flex-col rounded border border-charcoal/10 bg-stone/40 p-2"
            >
              <h2 className="mb-2 px-1 text-xs tracking-widest text-slate uppercase">
                {COLUMN_LABEL[status]} · {jobs.length}
              </h2>
              {jobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  when={startOf.get(job.blockId)}
                  where={labelOf.get(job.blockId) ?? "— block gone —"}
                  who={assigneeNames(crew, job)}
                  warned={(warnedJobs.get(job.id) ?? []).some((w) => w.severity === "conflict")}
                  selected={selectedId === job.id}
                  onSelect={() => {
                    setSelectedId(job.id);
                    setTab("job");
                  }}
                />
              ))}
            </section>
          ))}
        </div>
      </main>

      <aside className="flex w-full shrink-0 flex-col border-t border-charcoal/10 xl:w-80 xl:border-t-0 xl:border-l">
        <nav className="flex shrink-0 border-b border-charcoal/10">
          {(
            [
              ["job", "Job"],
              ["review", "Coverage"],
            ] as Array<["job" | "review", string]>
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
              {id === "review" && warnings.some((w) => w.severity === "conflict") ? (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-rose align-middle" />
              ) : null}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "job" ? (
            selected ? (
              <JobInspector
                key={selected.id}
                job={selected}
                onPatch={(patch) => setCrew(patchJob(crew, selected.id, patch))}
                onToggle={(personId) => setCrew(toggleAssignment(crew, selected.id, personId))}
                onDelete={() => {
                  setCrew(removeJob(crew, selected.id));
                  setSelectedId(null);
                }}
              />
            ) : (
              <People />
            )
          ) : (
            <CrewPrintPanel
              doc={brigade}
              title={event.coupleNames || "Our wedding"}
              onFocus={(jobId) => {
                setSelectedId(jobId);
                setTab("job");
              }}
            />
          )}
        </div>
      </aside>

      <PrintSheets order={startOf} labelOf={labelOf} />
    </div>
  );
}

function JobCard({
  job,
  when,
  where,
  who,
  warned,
  selected,
  onSelect,
}: {
  job: Job;
  when: number | undefined;
  where: string;
  who: string[];
  warned: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", job.id)}
      onClick={onSelect}
      className={`mb-2 w-full cursor-grab rounded border bg-parchment p-2.5 text-left transition active:cursor-grabbing ${
        selected
          ? "border-gold"
          : warned
            ? "border-rose"
            : "border-charcoal/10 hover:border-charcoal/25"
      }`}
    >
      <span className="block text-sm text-charcoal">{job.label}</span>
      <span className="mt-0.5 block text-xs text-slate">
        {when === undefined ? "—" : formatClock(when)} · {where}
      </span>
      {who.length > 0 ? (
        <span className="mt-1 block text-xs text-sage">{who.join(", ")}</span>
      ) : (
        <span className="mt-1 block text-xs text-rose">Nobody yet</span>
      )}
    </button>
  );
}

function JobInspector({
  job,
  onPatch,
  onToggle,
  onDelete,
}: {
  job: Job;
  onPatch: (patch: Partial<Job>) => void;
  onToggle: (personId: string) => void;
  onDelete: () => void;
}) {
  const crew = useCrew();
  const timeline = useTimeline();

  return (
    <div>
      <h2 className="mb-3 text-sm tracking-widest text-slate uppercase">Job</h2>

      <input
        value={job.label}
        onChange={(e) => onPatch({ label: e.target.value })}
        className="mb-3 w-full rounded border border-charcoal/15 bg-parchment px-2 py-1.5 outline-none focus:border-gold"
      />

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-slate">Happens during</span>
        <select
          value={job.blockId}
          onChange={(e) => onPatch({ blockId: e.target.value })}
          className="w-full rounded border border-charcoal/15 bg-parchment px-2 py-1.5 outline-none focus:border-gold"
        >
          {timeline.blocks.map((block) => (
            <option key={block.id} value={block.id}>
              {block.label}
            </option>
          ))}
          {timeline.blocks.some((b) => b.id === job.blockId) ? null : (
            <option value={job.blockId}>— block no longer in the day —</option>
          )}
        </select>
      </label>

      <label className="mb-3 block text-sm">
        <span className="mb-1 block text-slate">Team</span>
        <select
          value={job.teamId ?? ""}
          onChange={(e) => onPatch({ teamId: e.target.value || null })}
          className="w-full rounded border border-charcoal/15 bg-parchment px-2 py-1.5 outline-none focus:border-gold"
        >
          <option value="">—</option>
          {crew.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </label>

      <h3 className="mb-2 text-xs tracking-widest text-slate uppercase">Hands on it</h3>
      {crew.people.length === 0 ? (
        <p className="mb-3 text-sm text-slate">Nobody on the crew yet — add people below.</p>
      ) : (
        <ul className="mb-3">
          {crew.people.map((person) => (
            <li key={person.id}>
              <label className="flex items-center gap-2 py-0.5 text-sm">
                <input
                  type="checkbox"
                  checked={job.personIds.includes(person.id)}
                  onChange={() => onToggle(person.id)}
                />
                <span className="text-charcoal">{person.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <label className="mb-4 block text-sm">
        <span className="mb-1 block text-slate">Notes</span>
        <textarea
          value={job.notes}
          rows={3}
          onChange={(e) => onPatch({ notes: e.target.value })}
          className="w-full rounded border border-charcoal/15 bg-parchment px-2 py-1.5 outline-none focus:border-gold"
        />
      </label>

      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center gap-1.5 text-sm text-slate transition hover:text-rose"
      >
        <Trash2 size={14} />
        Delete job
      </button>
    </div>
  );
}

function People() {
  const crew = useCrew();
  const { setCrew } = useWriters();
  const [name, setName] = useState("");

  return (
    <div>
      <h2 className="mb-3 text-sm tracking-widest text-slate uppercase">The crew</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setCrew(addPerson(crew, name, null));
          setName("");
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="min-w-0 flex-1 rounded border border-charcoal/15 bg-parchment px-2 py-1.5 text-sm outline-none focus:border-gold"
        />
        <button
          type="submit"
          aria-label="Add this person"
          className="rounded border border-charcoal/15 px-2 text-slate transition hover:border-gold hover:text-charcoal"
        >
          <UserPlus size={15} />
        </button>
      </form>

      <ul className="mb-6">
        {crew.people.map((person) => (
          <li key={person.id} className="flex items-center gap-2 py-0.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-charcoal">{person.name}</span>
            <span className="shrink-0 text-xs text-slate">
              {crew.jobs.filter((j) => j.personIds.includes(person.id)).length} jobs
            </span>
            <button
              type="button"
              onClick={() => setCrew(removePerson(crew, person.id))}
              aria-label={`Remove ${person.name}`}
              className="shrink-0 text-slate transition hover:text-rose"
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        {crew.people.length === 0 ? <li className="text-sm text-slate">Nobody yet.</li> : null}
      </ul>

      <h2 className="mb-2 text-sm tracking-widest text-slate uppercase">Teams</h2>
      <ul>
        {crew.teams.map((team) => (
          <li key={team.id} className="py-0.5 text-sm text-charcoal">
            {team.name}
            {team.phone ? <span className="ml-2 text-xs text-slate">{team.phone}</span> : null}
          </li>
        ))}
        {crew.teams.length === 0 ? (
          <li className="text-sm text-slate">
            None. <Plus size={12} className="inline" /> Teams from tags builds them from the
            timeline&rsquo;s supplier tags.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * One page per person, rendered off-screen and shown only to the printer.
 *
 * The browser's own print pipeline rather than a generated PDF: these sheets
 * are plain text in a fixed order, and pdf-lib would be several hundred lines
 * of page layout to produce the same page. The place cards are a different
 * matter — those need vector output at an exact physical size.
 */
function PrintSheets({
  order,
  labelOf,
}: {
  order: ReadonlyMap<string, number>;
  labelOf: ReadonlyMap<string, string>;
}) {
  const crew = useCrew();
  const sheets = useMemo(() => personSheets(crew, order), [crew, order]);

  return (
    <div className="hidden print:block">
      {sheets.map(({ person, teamName, jobs }) => (
        <article key={person.id} className="break-after-page p-8">
          <h1 className="font-display text-3xl">{person.name}</h1>
          {teamName ? <p className="mb-6 text-slate">{teamName}</p> : <div className="mb-6" />}
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-charcoal/30">
                <th className="w-20 py-1">When</th>
                <th className="py-1">What</th>
                <th className="py-1">During</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-b border-charcoal/10 align-top">
                  <td className="py-1.5">
                    {order.has(job.blockId) ? formatClock(order.get(job.blockId)!) : "—"}
                  </td>
                  <td className="py-1.5">
                    {job.label}
                    {job.notes ? <div className="text-slate">{job.notes}</div> : null}
                  </td>
                  <td className="py-1.5">{labelOf.get(job.blockId) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ))}
    </div>
  );
}
