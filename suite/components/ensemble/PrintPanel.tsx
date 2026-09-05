"use client";

import { useState } from "react";
import { browserFontSource } from "@/apps/brigade/render/pdf/fontSource";
import { Button, Empty, Panel, Segmented } from "@/components/ui/controls";
import { download } from "@/lib/data/file";
import { shotListCsv } from "@/lib/ensemble/exports";
import { renderShotSheet } from "@/lib/ensemble/render/pdf/shotSheet";
import { resolveShot } from "@/lib/ensemble/resolve";
import type { Guest, Seating, Shots } from "@/lib/model/types";

export function PrintPanel({
  shots,
  guests,
  seating,
  coupleNames,
}: {
  shots: Shots;
  guests: Record<string, Guest>;
  seating: Seating;
  coupleNames: string;
}) {
  const [pageSize, setPageSize] = useState<"A4" | "A5">("A4");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problems = shots.sections.flatMap((section) =>
    section.shots.flatMap((shot) => {
      const resolved = resolveShot(shot, guests, seating, shots.cast);
      return resolved.problems.map((problem) => ({
        shotLabel: resolved.label,
        text:
          problem.kind === "dangling"
            ? problem.detail
            : problem.kind === "declined"
              ? `${problem.name} has declined`
              : "Nobody is in this shot yet",
      }));
    }),
  );

  const slug = () =>
    (coupleNames || "wedding").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "wedding";

  const makePdf = async () => {
    setBusy(true);
    setError(null);
    try {
      const bytes = await renderShotSheet(shots.sections, guests, seating, shots.cast, {
        fontSource: browserFontSource(),
        pageSize,
        coupleNames,
        generatedOn: `Made with Trousseau, ${new Date().toLocaleDateString()}`,
      });
      download(`${slug()}-group-shots.pdf`, new Blob([bytes as BlobPart], { type: "application/pdf" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PDF could not be made.");
    } finally {
      setBusy(false);
    }
  };

  const makeCsv = () => {
    setError(null);
    try {
      download(`${slug()}-group-shots.csv`, shotListCsv(shots.sections, guests, seating, shots.cast), "text/csv");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The CSV could not be made.");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Panel title="Problems">
        {problems.length === 0 ? (
          <Empty>Nothing wrong that this list can see.</Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {problems.map((problem, index) => (
              <li key={index} className="text-sm text-rose">
                "{problem.shotLabel}" — {problem.text}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Page size">
        <Segmented
          value={pageSize}
          onChange={setPageSize}
          options={[
            { value: "A4", label: "A4" },
            { value: "A5", label: "A5" },
          ]}
        />
      </Panel>

      <div className="flex gap-2">
        <Button tone="primary" disabled={busy} onClick={() => void makePdf()}>
          {busy ? "Making the PDF…" : "Download PDF"}
        </Button>
        <Button tone="quiet" onClick={makeCsv}>
          Download CSV
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose">
          {error}
        </p>
      )}
    </div>
  );
}
