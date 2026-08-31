"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTrousseauStore } from "@/lib/store/useTrousseauStore";
import { readGuests, readSeating } from "@/lib/model/slices";
import { buildArtefacts, defaultRowIds, type Artefact } from "@/lib/placecards/data/artefacts";
import { ensureFonts } from "@/lib/placecards/fontLoader";
import { buildJob } from "@/lib/placecards/job";
import { sheetCountFor, type GuestWarning } from "@/lib/placecards/imposition/paginate";
import { makeResolveOptions } from "@/lib/placecards/template/resolve";
import { getBlob } from "@/lib/placecards/blobStore";
import type { GuestRow } from "@/lib/placecards/csv/parse";
import type { LoadedFont } from "@/lib/placecards/text/measure";
import {
  planRows,
  readStationery,
  type Stationery,
} from "@/lib/placecards/stationery";
import type { ResolvedImageSource, Sheet } from "@/lib/placecards/types";

/**
 * Everything the stationery studio reads, in one hook.
 *
 * The rows are the interesting part: by default they come from the seating
 * plan, live, so a card's `{{Table}}` token answers with wherever that guest is
 * sitting right now. An uploaded CSV is the fallback for a job the plan cannot
 * describe — service dockets, a list that is not the wedding's own guests.
 */

export interface StationeryView {
  design: Stationery;
  /** The rows as they came from the plan or the CSV, before artefact grouping. */
  rows: { headers: string[]; rows: GuestRow[]; ids: string[] };
  headers: string[];
  artefacts: Artefact[];
  rowIds: string[];
  fonts: Map<string, LoadedFont>;
  images: Map<string, ResolvedImageSource>;
  /** Only the visible page is built; the rest is counted, not resolved. */
  sheets: Sheet[];
  sheetCount: number;
  warnings: GuestWarning[];
  ready: boolean;
}

export function useStationery(page: number): StationeryView {
  const design = useTrousseauStore((s) => readStationery(s.doc.stationery));
  const guests = useTrousseauStore((s) => readGuests(s.doc));
  const seating = useTrousseauStore((s) => readSeating(s.doc));

  const [fonts, setFonts] = useState<Map<string, LoadedFont>>(new Map());
  const [images, setImages] = useState<Map<string, ResolvedImageSource>>(new Map());

  // Faces first. Until they are parsed nothing can be fitted honestly, so the
  // studio waits rather than laying out at the requested size and re-flowing.
  useEffect(() => {
    let live = true;
    void ensureFonts(design.fonts).then((loaded) => {
      if (live) setFonts(new Map(loaded));
    });
    return () => {
      live = false;
    };
  }, [design.fonts]);

  const imageIds = useMemo(
    () =>
      design.template.elements
        .flatMap((el) => (el.kind === "image" && el.imageId ? [el.imageId] : []))
        .sort()
        .join(","),
    [design.template.elements],
  );

  useEffect(() => {
    let live = true;
    const ids = imageIds ? imageIds.split(",") : [];
    void Promise.all(
      ids.map(async (id) => {
        const bytes = await getBlob(id);
        return bytes ? ([id, bytes] as const) : null;
      }),
    ).then(async (loaded) => {
      if (!live) return;
      const next = new Map<string, ResolvedImageSource>();
      for (const entry of loaded) {
        if (!entry) continue;
        const [id, bytes] = entry;
        const source = await decodeImage(id, bytes);
        if (source) next.set(id, source);
      }
      if (live) setImages(next);
    });
    return () => {
      live = false;
    };
  }, [imageIds]);

  const source = useMemo(() => {
    if (design.rowSource === "csv" && design.csv) {
      return {
        headers: design.csv.headers,
        rows: design.csv.rows,
        ids: defaultRowIds(design.csv.rows.length),
      };
    }
    return planRows(guests, seating, { includeUnseated: false });
  }, [design.rowSource, design.csv, guests, seating]);

  const artefacts = useMemo(
    () => buildArtefacts(source.rows, design.rowScope, source.headers, source.ids),
    [source, design.rowScope],
  );

  const resolveOptions = useMemo(
    () => makeResolveOptions(fonts, design.uploadedIcons, images, design.assetNames),
    [fonts, design.uploadedIcons, images, design.assetNames],
  );

  const ready = fonts.size > 0;

  const built = useMemo(() => {
    if (!ready) return { sheets: [] as Sheet[], warnings: [] as GuestWarning[] };
    // One page at a time. Resolving 150 guests on every drag frame is exactly
    // what puts this under 60fps, and only the visible sheet is ever drawn.
    return buildJob({
      template: design.template,
      card: design.card,
      sheet: design.sheet,
      rows: source.rows,
      headers: source.headers,
      rowIds: source.ids,
      resolve: resolveOptions,
      scale: design.printer.scale,
      duplex: {
        flipEdge: design.printer.flipEdge ?? "long",
        backOffsetXMm: design.printer.backOffsetXMm ?? 0,
        backOffsetYMm: design.printer.backOffsetYMm ?? 0,
      },
      pages: { from: page, to: page },
    });
  }, [ready, design, source, resolveOptions, page]);

  return {
    design,
    rows: source,
    headers: source.headers,
    artefacts,
    rowIds: source.ids,
    fonts,
    images,
    sheets: built.sheets,
    sheetCount: sheetCountFor(artefacts.length, design.card, design.sheet),
    warnings: built.warnings,
    ready,
  };
}

/** Writes to the stationery slice, all labelled for undo. */
export function useStationeryWriter() {
  const setSlice = useTrousseauStore((s) => s.setSlice);

  return useCallback(
    (next: Stationery | ((current: Stationery) => Stationery), label: string) => {
      const current = readStationery(useTrousseauStore.getState().doc.stationery);
      const value = typeof next === "function" ? next(current) : next;
      setSlice("stationery", value, { label });
    },
    [setSlice],
  );
}

/**
 * Turn stored bytes into something both renderers can draw.
 *
 * The PDF needs the bytes and the format; the preview needs a URL. Both come
 * from the same buffer, so the sheet on screen and the sheet on paper cannot be
 * different pictures.
 */
async function decodeImage(id: string, bytes: Uint8Array): Promise<ResolvedImageSource | null> {
  const format = sniff(bytes);
  if (!format) return null;
  const blob = new Blob([bytes as BlobPart], { type: format });
  const url = URL.createObjectURL(blob);
  const size = await measure(url);
  if (!size) {
    URL.revokeObjectURL(url);
    return null;
  }
  return { id, url, data: bytes, mime: format, naturalW: size.w, naturalH: size.h };
}

/** PNG and JPEG are the two a PDF can carry directly, so they are the two taken. */
function sniff(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  return null;
}

function measure(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
