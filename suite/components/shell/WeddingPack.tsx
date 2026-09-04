"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { assemblePack, type PackSection } from "@/lib/export/weddingPack";
import { readGuests, readSeating, readShots, readTimeline } from "@/lib/model/slices";

/**
 * The one button that produces everything you carry on the day.
 *
 * It lives here rather than in any of the four tools because it is the only
 * thing in the suite that is not any one tool's job: the plan comes from the
 * room, the running order from the day, the jobs from the crew, and the whole
 * point is that they are printed from the same wedding at the same moment.
 *
 * Sections are gathered one at a time and a failure is reported rather than
 * thrown away, because "your pack has no job sheets in it" is a useful thing to
 * be told while you still have time to find out why.
 */
export function WeddingPack() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const hasDay = useTrousseauStore((s) => readTimeline(s.doc).blocks.length > 0);
  const couple = useTrousseauStore((s) => s.doc.event.coupleNames);

  async function build() {
    setBusy(true);
    setNote(null);
    setProblem(null);

    const sections: PackSection[] = [];
    const missing: string[] = [];

    // Imported here rather than at the top of the file: each of these pulls in
    // a PDF library and a tool's whole rendering stack, and none of it is
    // wanted until somebody actually asks for a pack.
    for (const [title, make] of [
      ["The room", floorPlan],
      ["The day", runSheet],
      ["The jobs", jobList],
      ["The shots", shotSheet],
    ] as const) {
      try {
        const bytes = await make();
        if (bytes) sections.push({ title, bytes });
        else missing.push(title.toLowerCase());
      } catch {
        missing.push(title.toLowerCase());
      }
    }

    if (sections.length === 0) {
      setProblem("Nothing to print yet. Start with the room or the day.");
      setBusy(false);
      return;
    }

    const pack = await assemblePack(sections);
    const name = (couple || "wedding").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const url = URL.createObjectURL(new Blob([pack.bytes as BlobPart], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name || "wedding"}-pack.pdf`;
    link.click();
    URL.revokeObjectURL(url);

    setNote(
      `${pack.contents.map((part) => `${part.title} (${part.pages})`).join(", ")}.` +
        (missing.length > 0 ? ` Left out: ${missing.join(", ")}.` : ""),
    );
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-charcoal/10 bg-stone/60 p-6">
      <h2 className="mb-1 text-lg text-charcoal">The wedding pack</h2>
      <p className="mb-4 max-w-prose text-sm text-slate">
        The floor plan, the run sheet, the job list and the group shot list as one document,
        printed from the wedding as it stands right now. Place cards are a separate print — they
        go on card stock, not in a binder.
      </p>

      <button
        type="button"
        onClick={() => void build()}
        disabled={busy || !hasDay}
        className="inline-flex items-center gap-2 rounded border border-gold bg-gold/15 px-4 py-2 text-sm text-charcoal transition hover:bg-gold/25 disabled:pointer-events-none disabled:opacity-40"
      >
        <FileDown size={16} />
        {busy ? "Making the pack…" : "Download the pack"}
      </button>

      {!hasDay && (
        <p className="mt-3 text-xs text-slate">
          There is no day planned yet, and the pack is mostly the day.
        </p>
      )}
      {note && <p className="mt-3 text-xs text-slate">{note}</p>}
      {problem && (
        <p role="alert" className="mt-3 text-xs text-rose">
          {problem}
        </p>
      )}
    </div>
  );
}

async function floorPlan(): Promise<Uint8Array | null> {
  const [{ buildFloorPlanPdf }, { readDoc }] = await Promise.all([
    import("@/apps/tableaux/utils/exportPdf.js"),
    import("@/apps/tableaux/store/sliceBridge.js"),
  ]);
  const doc = readDoc();
  if (Object.keys(doc.tables ?? {}).length === 0) return null;

  const pdf = await buildFloorPlanPdf(doc, doc.meta?.weddingName ?? "Seating plan", {});
  return new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
}

async function runSheet(): Promise<Uint8Array | null> {
  const [{ renderRunSheet }, { browserFontSource }, { readSlice }, { getBlob }] = await Promise.all(
    [
      import("@/apps/cadence/render/pdf/runSheet"),
      import("@/apps/cadence/render/pdf/fontSource"),
      import("@/apps/cadence/state/sliceBridge"),
      import("@/apps/cadence/state/blobStore"),
    ],
  );
  const doc = readSlice();
  if (doc.blocks.length === 0) return null;

  // Any typeface uploaded for the printed pieces, by family name. Without this
  // the pack would quietly fall back to the bundled faces and look like a
  // different document to the one Cadence exports on its own.
  const uploaded = new Map<string, Uint8Array>();
  for (const font of doc.fonts) {
    const blob = await getBlob(font.blobKey).catch(() => null);
    if (blob) uploaded.set(font.family, new Uint8Array(await blob.arrayBuffer()));
  }

  return renderRunSheet(doc, {
    fontSource: browserFontSource(uploaded),
    generatedOn: `Made with Trousseau, ${new Date().toLocaleDateString()}`,
  });
}

async function jobList(): Promise<Uint8Array | null> {
  const [{ renderJobList }, { browserFontSource }, { readSlice }] = await Promise.all([
    import("@/apps/brigade/render/pdf/jobSheets"),
    import("@/apps/brigade/render/pdf/fontSource"),
    import("@/apps/brigade/state/sliceBridge"),
  ]);
  const doc = readSlice();
  if (doc.jobs.length === 0) return null;

  return renderJobList(doc, {
    fontSource: browserFontSource(),
    generatedOn: `Made with Trousseau, ${new Date().toLocaleDateString()}`,
  });
}

async function shotSheet(): Promise<Uint8Array | null> {
  const { doc } = useTrousseauStore.getState();
  const shots = readShots(doc);
  const total = shots.sections.reduce((sum, section) => sum + section.shots.length, 0);
  if (total === 0) return null;

  const [{ renderShotSheet }, { browserFontSource }] = await Promise.all([
    import("@/lib/ensemble/render/pdf/shotSheet"),
    import("@/apps/brigade/render/pdf/fontSource"),
  ]);

  return renderShotSheet(shots.sections, readGuests(doc), readSeating(doc), shots.cast, {
    fontSource: browserFontSource(),
    coupleNames: doc.event.coupleNames,
    generatedOn: `Made with Trousseau, ${new Date().toLocaleDateString()}`,
  });
}
