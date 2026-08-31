import { PDFDocument } from "pdf-lib";
import { detailFor, tagLabel, usedTags } from "../../core/model/tags";
import type { TimelineDoc } from "../../core/model/types";
import { formatClock } from "../../core/time/minutes";
import type { FontSource } from "./fontSource";
import { renderRunSheet } from "./runSheet";

export interface CallSheetOptions {
  fontSource: FontSource;
  generatedOn?: string;
}

/** The heading line a supplier reads first: who they are, when they are due. */
function subtitleFor(doc: TimelineDoc, tag: string): string {
  const detail = detailFor(doc, tag);
  const parts = [tagLabel(doc, tag)];
  if (detail?.arrivalMin != null) parts.push(`arrives ${formatClock(detail.arrivalMin)}`);
  if (detail?.phone) parts.push(detail.phone);
  return parts.join("  ·  ");
}

/** One supplier's day: the same layout, filtered to their tag. */
export async function renderCallSheet(
  doc: TimelineDoc,
  tag: string,
  options: CallSheetOptions,
): Promise<Uint8Array> {
  return renderRunSheet(doc, {
    fontSource: options.fontSource,
    tag,
    subtitle: subtitleFor(doc, tag),
    ...(options.generatedOn === undefined ? {} : { generatedOn: options.generatedOn }),
  });
}

/** Every supplier's sheet in one PDF, each starting on a fresh page. */
export async function renderAllCallSheets(
  doc: TimelineDoc,
  options: CallSheetOptions,
): Promise<Uint8Array> {
  const tags = callSheetTags(doc);
  const bundle = await PDFDocument.create();

  for (const tag of tags) {
    const single = await PDFDocument.load(await renderCallSheet(doc, tag, options));
    const pages = await bundle.copyPages(single, single.getPageIndices());
    for (const page of pages) bundle.addPage(page);
  }

  if (tags.length === 0) bundle.addPage();
  return bundle.save();
}

/** Tags that actually have blocks on the call sheet. */
export function callSheetTags(doc: TimelineDoc): string[] {
  return usedTags(doc)
    .map((summary) => summary.tag)
    .filter((tag) =>
      doc.blocks.some((block) => block.tags.includes(tag) && block.outputs.includes("call-sheet")),
    );
}
