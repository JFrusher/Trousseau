"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Download, Info } from "lucide-react";
import { download } from "@/lib/data/file";
import type { BrigadeDoc } from "@/lib/crew/core/model/types";
import { blocking, coverage, type Warning } from "@/lib/crew/core/jobs/coverage";
import { browserFontSource } from "@/lib/crew/render/pdf/fontSource";
import {
  peopleWithJobs,
  renderAllPersonSheets,
  renderAllTeamSheets,
  renderJobList,
} from "@/lib/crew/render/pdf/jobSheets";
import { Button, Empty, Panel } from "@/components/ui/controls";

/**
 * What is wrong with the assignment, and the paper that fixes it.
 *
 * One person in two places at once holds the print run — that is a real clash
 * and printing it would put it on paper. Work with nobody on it does not: the
 * sheets are how those gaps get filled, and a tool that refuses to print until
 * every job has a name is one nobody can use before the crew is confirmed.
 */
export function CrewPrintPanel({
  doc,
  title,
  onFocus,
}: {
  doc: BrigadeDoc;
  title: string;
  onFocus: (jobId: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const warnings = useMemo(() => coverage(doc), [doc]);
  const blockers = useMemo(() => blocking(warnings), [warnings]);
  const named = useMemo(() => peopleWithJobs(doc), [doc]);

  const slug =
    title
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "wedding";

  const make = useCallback(
    async (id: string, render: () => Promise<Uint8Array>) => {
      setBusy(id);
      setProblem(null);
      try {
        const bytes = await render();
        download(`${slug}-${id}.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }));
      } catch (cause) {
        setProblem(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [slug],
  );

  const options = { fontSource: browserFontSource() };
  const held = blockers.length > 0;

  return (
    <>
      <Panel title={`Coverage (${warnings.length})`}>
        {warnings.length === 0 ? (
          <Empty>Every job has somebody, and nobody is in two places at once.</Empty>
        ) : (
          <ul className="space-y-1">
            {warnings.map((warning, i) => (
              <WarningRow key={i} warning={warning} onFocus={onFocus} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Print">
        {problem ? (
          <p className="mb-2 flex gap-2 rounded border border-rose/40 bg-rose/10 px-2 py-1.5 text-xs">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose" />
            <span className="text-charcoal">{problem}</span>
          </p>
        ) : null}

        {held ? (
          <p className="mb-2 flex gap-2 rounded border border-rose/40 bg-rose/10 px-2 py-1.5 text-xs">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose" />
            <span className="text-charcoal">
              {blockers.length === 1 ? "One clash holds" : `${blockers.length} clashes hold`} the
              print run. Printing them would put somebody in two places on paper.
            </span>
          </p>
        ) : null}

        <div className="space-y-1.5">
          <div>
            <Button
              icon={Download}
              disabled={busy !== null || held || doc.jobs.length === 0}
              onClick={() => void make("job-list", () => renderJobList(doc, options))}
            >
              {busy === "job-list" ? "Writing…" : "The whole job list"}
            </Button>
            <p className="mt-0.5 text-xs text-slate">Every job in the order it happens.</p>
          </div>

          <div>
            <Button
              icon={Download}
              disabled={busy !== null || held || named.length === 0}
              onClick={() => void make("person-sheets", () => renderAllPersonSheets(doc, options))}
            >
              {busy === "person-sheets" ? "Writing…" : "A sheet each"}
            </Button>
            <p className="mt-0.5 text-xs text-slate">
              One page per person — {named.length} {named.length === 1 ? "sheet" : "sheets"}. Their
              jobs, in order, and nothing else.
            </p>
          </div>

          <div>
            <Button
              icon={Download}
              disabled={busy !== null || held || doc.teams.length === 0}
              onClick={() => void make("team-sheets", () => renderAllTeamSheets(doc, options))}
            >
              {busy === "team-sheets" ? "Writing…" : "A sheet per team"}
            </Button>
            <p className="mt-0.5 text-xs text-slate">For handing to a supplier on arrival.</p>
          </div>
        </div>
      </Panel>
    </>
  );
}

function WarningRow({
  warning,
  onFocus,
}: {
  warning: Warning;
  onFocus: (jobId: string) => void;
}) {
  const alarm = warning.severity === "conflict";
  return (
    <li>
      <button
        type="button"
        onClick={() => warning.jobIds[0] && onFocus(warning.jobIds[0])}
        className={`flex w-full gap-1.5 rounded border px-2 py-1.5 text-left text-xs ${
          alarm ? "border-rose/40 bg-rose/10 text-charcoal" : "border-charcoal/10 bg-stone text-slate"
        }`}
      >
        {alarm ? (
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose" />
        ) : (
          <Info size={13} className="mt-0.5 shrink-0" />
        )}
        <span>{warning.message}</span>
      </button>
    </li>
  );
}
