#!/usr/bin/env node
/**
 * Promotes a collected wedding into one the apps can open.
 *
 * `bundle.mjs` gathers what each tool exported and files it under `sources`,
 * which is the right shape for keeping a record but not the shape the apps
 * read. They read the slices — `guests`, `seating`, `timeline` — and on a
 * collected document those are empty, so the app opens to an empty room while
 * the guest list sits in the file untouched.
 *
 * This moves the contents into place. Two jobs:
 *
 *   1. The Tableaux export is split the way the app splits it: the guest list
 *      into `guests`, where the place cards and the crew list can read it, and
 *      everything else into `seating`.
 *
 *   2. A timeline is reconstructed from the published day. The day holds what
 *      the times worked out to; the source that produced them — which block was
 *      anchored, which followed after a gap — was not part of the export, so it
 *      cannot be recovered. Every block is therefore pinned to the time it
 *      already has, which reproduces the same day exactly. See the note printed
 *      at the end for what that costs.
 *
 * Writes a new file and never touches the input, because the input is the copy
 * that is under version control and this is not the kind of thing to find out
 * you got wrong afterwards.
 *
 *   node scripts/promote-sources.mjs [in.json] [out.json]
 */

import { readFileSync, writeFileSync } from "node:fs";

const IN = process.argv[2] ?? "data/wedding.trousseau.json";
const OUT = process.argv[3] ?? IN.replace(/\.json$/, "") + ".import.json";

/** The keys Tableaux keeps outside its guest list. Mirrors the app's own split. */
const SEATING_KEYS = [
  "meta",
  "groups",
  "subgroups",
  "families",
  "tables",
  "zones",
  "room",
  "wallElements",
  "pillars",
  "canvas",
  "snapshots",
  "constraints",
  "settings",
];

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v) => (isRecord(v) ? Object.keys(v).length : Array.isArray(v) ? v.length : 0);

const doc = JSON.parse(readFileSync(IN, "utf8"));
const sources = isRecord(doc.sources) ? doc.sources : {};
const notes = [];

// ── The room and the guest list ───────────────────────────────────────────
const tableaux = isRecord(sources.tableaux) ? sources.tableaux : null;

if (tableaux) {
  const seating = { ...(isRecord(doc.seating) ? doc.seating : {}) };
  for (const key of SEATING_KEYS) {
    if (tableaux[key] !== undefined) seating[key] = tableaux[key];
  }

  doc.seating = seating;
  doc.guests = isRecord(tableaux.guests) ? tableaux.guests : (doc.guests ?? {});

  notes.push(
    `guests    ${count(doc.guests)} from the Tableaux export`,
    `seating   ${count(seating.tables)} tables, ${count(seating.room?.spaces)} named space(s)`,
  );
} else {
  notes.push("guests    no Tableaux export found, left as it was");
}

// ── The day ───────────────────────────────────────────────────────────────
const published = isRecord(doc.day) ? doc.day : null;
const blocks = published && Array.isArray(published.blocks) ? published.blocks : [];
const already = isRecord(doc.timeline) && Array.isArray(doc.timeline.blocks) ? doc.timeline.blocks : [];

if (already.length > 0) {
  notes.push(`timeline  left alone, it already has ${already.length} block(s)`);
} else if (blocks.length > 0) {
  const settings = isRecord(published.day) ? published.day : {};

  doc.timeline = {
    schemaVersion: 1,
    appVersion: published.appVersion ?? "0.1.0",
    day: {
      // The envelope owns these; the day keeps an echo of them.
      date: doc.event?.date || settings.date || "",
      coupleNames: doc.event?.coupleNames || settings.coupleNames || "",
      venueName: doc.event?.venueName || settings.venueName || "",
      curfewMin: doc.event?.curfewMin ?? settings.curfewMin ?? 1500,
      utcOffsetMin: doc.event?.utcOffsetMin ?? settings.utcOffsetMin ?? 0,
      latitude: settings.latitude ?? 51.5,
      longitude: settings.longitude ?? -0.12,
      logoKey: settings.logoKey ?? null,
    },
    lanes: Array.isArray(published.lanes) && published.lanes.length
      ? [...published.lanes]
      : ["Main day"],
    blocks: blocks.map((block) => ({
      id: String(block.id),
      label: String(block.label ?? "Untitled"),
      durationMin: Math.max(0, Number(block.endMin ?? 0) - Number(block.startMin ?? 0)),
      // Pinned to the time it already has, so the day resolves to what it was.
      anchorMin: Number(block.startMin ?? 0),
      gapMin: 0,
      bufferMin: 0,
      squeezeToMin: null,
      lane: String(block.lane ?? "Main day"),
      tags: Array.isArray(block.tags) ? block.tags.map(String) : [],
      location: String(block.location ?? ""),
      notes: String(block.notes ?? ""),
      outputs: ["run-sheet"],
    })),
    tagDetails: [],
    fonts: [],
    styles: {},
    outputs: {},
  };

  notes.push(`timeline  ${blocks.length} block(s) rebuilt from the published day`);
} else {
  notes.push("timeline  nothing to rebuild from");
}

// ── Anything that was already there ───────────────────────────────────────
for (const [slice, label] of [["crew", "crew     "], ["stationery", "stationery"]]) {
  const held = doc[slice];
  const size = isRecord(held) ? Object.keys(held).length : 0;
  if (size === 0) notes.push(`${label} empty, nothing to promote`);
}

writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n", "utf8");

console.log(`Read  ${IN}`);
console.log(`Wrote ${OUT}\n`);
for (const note of notes) console.log("  " + note);
console.log(`
Import ${OUT} through the Data button in the app.

One thing to know about the day: every block is pinned to its own start time,
because the export recorded what the times came out as and not how they were
arrived at. The day will open reading exactly as it does now. What it will not
do is ripple — move the ceremony and nothing after it follows, until you clear
the anchors on the blocks that should hang off what comes before them.`);
