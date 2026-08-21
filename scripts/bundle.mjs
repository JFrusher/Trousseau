#!/usr/bin/env node
// Bundle a handful of native app files into one .trousseau.json, and take it
// apart again at the other end.
//
// Nothing reads a .trousseau.json yet — the apps gain that in Phase 1a. Until
// they do, this is only useful because it goes both ways: pack on one machine,
// unpack on the other, open the native files as normal.
//
//   node scripts/bundle.mjs pack <files...> [-o wedding.trousseau.json]
//   node scripts/bundle.mjs unpack <file.trousseau.json> [-d outdir]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { emptyTrousseau, mergeSlice, migrate, parse, serialise } from "../dist/index.js";

// Each app's native file, and how to recognise it. Order matters: the day
// export and the Plaque project carry explicit markers, so they are checked
// before the two formats that share a bare `schemaVersion`.
const APPS = [
  { app: "cadence", ext: ".cadence.json", is: (d) => num(d.schemaVersion) && Array.isArray(d.blocks) },
  { app: "brigade", ext: ".brigade.json", is: (d) => num(d.schemaVersion) && (Array.isArray(d.jobs) || Array.isArray(d.people)) },
  { app: "plaque", ext: ".plaque.json", is: (d) => d.format === "plaque-project" },
  { app: "tableaux", ext: ".tableaux.json", is: (d) => isObj(d.meta) && (isObj(d.guests) || isObj(d.tables)) },
];

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v) => typeof v === "number";
const str = (v) => (typeof v === "string" ? v.trim() : "");

function classify(doc) {
  if (doc.kind === "trousseau") return { kind: "bundle" };
  if (doc.kind === "cadence.day") return { kind: "day" };
  const hit = APPS.find((a) => a.is(doc));
  return hit ? { kind: "source", app: hit.app } : { kind: "unknown" };
}

/**
 * The event fields each file can speak to. Collected from every source rather
 * than taken from the first one found, so that two files describing different
 * weddings are reported instead of silently resolved.
 */
function eventFrom(doc, what) {
  const day = what === "day" ? doc.day : what === "cadence" ? doc.day : null;
  if (isObj(day)) {
    return {
      date: str(day.date),
      coupleNames: str(day.coupleNames),
      venueName: str(day.venueName),
      curfewMin: num(day.curfewMin) ? day.curfewMin : null,
      utcOffsetMin: num(day.utcOffsetMin) ? day.utcOffsetMin : null,
    };
  }
  if (what === "tableaux" && isObj(doc.meta)) {
    return {
      date: str(doc.meta.date),
      coupleNames: str(doc.meta.weddingName),
      venueName: str(doc.meta.venue),
      curfewMin: null,
      utcOffsetMin: null,
    };
  }
  return null;
}

function pack(files, out) {
  let raw = emptyTrousseau();
  const sources = {};
  const claims = [];
  const notes = [];

  for (const file of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      notes.push(`skipped ${basename(file)} — not valid JSON (${e.message})`);
      continue;
    }
    if (!isObj(doc)) {
      notes.push(`skipped ${basename(file)} — not an object`);
      continue;
    }

    const seen = classify(doc);
    if (seen.kind === "unknown") {
      notes.push(`skipped ${basename(file)} — not a file any of the four apps writes`);
      continue;
    }
    if (seen.kind === "bundle") {
      notes.push(`skipped ${basename(file)} — already a .trousseau.json`);
      continue;
    }

    if (seen.kind === "day") {
      // The one file that is already a resolved slice rather than a source.
      raw = mergeSlice(raw, "day", doc);
      claims.push({ from: basename(file), event: eventFrom(doc, "day") });
      console.log(`  day slice     <- ${basename(file)}`);
      continue;
    }

    if (sources[seen.app]) notes.push(`two ${seen.app} files given; kept ${basename(file)}`);
    sources[seen.app] = doc;
    claims.push({ from: basename(file), event: eventFrom(doc, seen.app) });
    console.log(`  sources.${seen.app.padEnd(9)}<- ${basename(file)}`);
  }

  // `event` is nobody's source document, so it is assembled here. Disagreements
  // are reported, never silently resolved: two files claiming different dates
  // usually means two different weddings.
  const event = { ...raw.event };
  for (const field of ["date", "coupleNames", "venueName", "curfewMin", "utcOffsetMin"]) {
    const offered = claims
      .filter((c) => c.event && c.event[field] !== "" && c.event[field] !== null)
      .map((c) => ({ from: c.from, value: c.event[field] }));
    const distinct = [...new Set(offered.map((o) => JSON.stringify(o.value)))];
    if (offered.length > 0) event[field] = offered[0].value;
    if (distinct.length > 1) {
      notes.push(
        `event.${field} disagrees: ${offered.map((o) => `${o.from} says ${JSON.stringify(o.value)}`).join(", ")} — kept the first`,
      );
    }
  }
  raw = mergeSlice(raw, "event", event);
  raw.sources = sources;

  // Through the package's own parse, so the file cannot be one the apps refuse.
  const text = serialise(migrate(raw));
  writeFileSync(out, text);

  const mb = Buffer.byteLength(text) / 1024 / 1024;
  console.log(`\nwrote ${out} — ${mb.toFixed(1)} MB, sources: ${Object.keys(sources).join(", ") || "none"}`);
  if (mb > 20) console.log("  over 20 MB: zip it before emailing, most providers cap attachments at 25 MB");
  for (const note of notes) console.log(`  note: ${note}`);
}

function unpack(file, dir) {
  const doc = parse(readFileSync(file, "utf8"));
  mkdirSync(dir, { recursive: true });

  const slug =
    doc.event.coupleNames
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "wedding";

  for (const [app, native] of Object.entries(doc.sources ?? {})) {
    const ext = APPS.find((a) => a.app === app)?.ext ?? `.${app}.json`;
    const path = join(dir, `${slug}${ext}`);
    writeFileSync(path, JSON.stringify(native, null, 2) + "\n");
    console.log(`  ${path}`);
  }
  if (doc.day !== null) {
    const path = join(dir, `${slug}.day.json`);
    writeFileSync(path, JSON.stringify(doc.day, null, 2) + "\n");
    console.log(`  ${path}`);
  }
  console.log(`\nopen each in its own app as usual. ${doc.event.coupleNames || "(no couple names recorded)"}`);
}

const [mode, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i === -1 ? fallback : rest[i + 1];
};
const positional = rest.filter((a, i) => !a.startsWith("-") && rest[i - 1] !== "-o" && rest[i - 1] !== "-d");

if (mode === "pack" && positional.length > 0) {
  pack(positional, flag("-o", "wedding.trousseau.json"));
} else if (mode === "unpack" && positional.length === 1) {
  unpack(positional[0], flag("-d", "unpacked"));
} else {
  console.error("usage: node scripts/bundle.mjs pack <files...> [-o out.trousseau.json]");
  console.error("       node scripts/bundle.mjs unpack <file.trousseau.json> [-d outdir]");
  process.exit(1);
}
