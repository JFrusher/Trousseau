#!/usr/bin/env node
// Bundle a handful of native app files into one .trousseau.json, and take it
// apart again at the other end.
//
// Nothing reads a .trousseau.json yet — the apps gain that in Phase 1a. Until
// they do, this is only useful because it goes both ways: pack on one machine,
// unpack on the other, open the native files as normal.
//
//   node scripts/bundle.mjs pack <files-or-dirs...> [-o wedding.trousseau.json]
//   node scripts/bundle.mjs pack --working [-o …]      (the configured working folder)
//   node scripts/bundle.mjs unpack <file.trousseau.json> [-d outdir]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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


/**
 * The folder the apps write their working documents into — a OneDrive folder,
 * so both machines see the same files without anyone running a command.
 *
 * Per-device, and deliberately not committed: it names a path on one machine
 * and this repo is public. Same arrangement as .dvc/config.local.
 */
function workingDir() {
  const fromEnv = process.env.WEDDING_WORKING;
  if (fromEnv) return fromEnv;
  const file = resolve(".working-path");
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").trim();
    if (line) return line;
  }
  console.error("No working folder configured. Either:");
  console.error("  set WEDDING_WORKING=<path>, or");
  console.error("  write the path into Trousseau/.working-path (one line, git-ignored)");
  process.exit(1);
}

/** Expand any directory argument into the .json files inside it. */
function expand(args) {
  const out = [];
  for (const arg of args) {
    const path = arg === "--working" ? workingDir() : arg;
    if (existsSync(path) && statSync(path).isDirectory()) {
      const found = readdirSync(path)
        .filter((f) => f.toLowerCase().endsWith(".json"))
        .map((f) => join(path, f));
      if (found.length === 0) console.log(`  note: ${path} holds no .json files`);
      out.push(...found);
    } else {
      out.push(path);
    }
  }
  return out;
}

const DAY = 24 * 60 * 60 * 1000;
const mtime = (f) => (existsSync(f) ? statSync(f).mtimeMs : 0);

/**
 * A file nobody has exported for days is the quiet failure this whole setup is
 * prone to: three of the four apps keep their real work in browser local
 * storage, so what is on disk is only as fresh as the last manual export.
 */
function reportAges(files) {
  const seen = files.filter((f) => existsSync(f)).map((f) => ({ f, at: statSync(f).mtimeMs }));
  if (seen.length === 0) return;
  const newest = Math.max(...seen.map((s) => s.at));
  for (const { f, at } of seen) {
    const days = (newest - at) / DAY;
    const age = new Date(at).toISOString().slice(0, 10);
    const flag = days >= 3 ? `  <-- ${Math.floor(days)} days older than the newest file` : "";
    console.log(`  ${basename(f).padEnd(32)} ${age}${flag}`);
  }
}

/**
 * pack() rebuilds the whole bundle from only the files it is given, so leaving
 * one out silently deletes that slice. Refuse rather than write a smaller
 * wedding over a larger one.
 */
function refuseToShrink(out, next, allowShrink) {
  if (!existsSync(out)) return;
  let prev;
  try {
    prev = JSON.parse(readFileSync(out, "utf8"));
  } catch {
    return; // Unreadable: nothing trustworthy to compare against.
  }
  const slices = (d) => {
    const s = new Set(Object.keys(d.sources ?? {}));
    if (d.day) s.add("day");
    return s;
  };
  const lost = [...slices(prev)].filter((k) => !slices(next).has(k));
  if (lost.length === 0) return;

  console.error(`
refusing to write ${out}: it would lose ${lost.join(", ")}.`);
  console.error("pack() builds the bundle from only the files you give it, so a");
  console.error("missing file deletes its slice. Pass every file, not just the ones");
  console.error("you changed. If the loss is deliberate, re-run with --allow-shrink.");
  if (!allowShrink) process.exit(1);
  console.error("(--allow-shrink given, continuing)");
  console.error();
}

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

function pack(files, out, { allowShrink = false } = {}) {
  let raw = emptyTrousseau();
  const sources = {};
  const sourceFiles = {};
  const claims = [];
  const notes = [];

  console.log("sources:");
  reportAges(files);
  console.log();

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

    // Two files claiming the same app is now routine — the working folder can
    // hold a seed or an old export beside the live one. Keep the newer, by the
    // clock rather than by whatever order the directory happened to list them.
    if (sources[seen.app]) {
      const kept = mtime(file) >= mtime(sourceFiles[seen.app]) ? file : sourceFiles[seen.app];
      const dropped = kept === file ? sourceFiles[seen.app] : file;
      notes.push(`two ${seen.app} files given; kept the newer (${basename(kept)}), ignored ${basename(dropped)}`);
      if (kept !== file) continue;
    }
    sources[seen.app] = doc;
    sourceFiles[seen.app] = file;
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
  const doc = migrate(raw);
  refuseToShrink(out, doc, allowShrink);
  const text = serialise(doc);
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
const allowShrink = rest.includes("--allow-shrink");
// --working stands in for "every .json in the configured working folder".
const packArgs = rest.includes("--working") ? ["--working"] : positional;

if (mode === "pack" && packArgs.length > 0) {
  pack(expand(packArgs), flag("-o", "wedding.trousseau.json"), { allowShrink });
} else if (mode === "unpack" && positional.length === 1) {
  unpack(positional[0], flag("-d", "unpacked"));
} else {
  console.error("usage: node scripts/bundle.mjs pack <files-or-dirs...> [-o out.trousseau.json]");
  console.error("       node scripts/bundle.mjs pack --working [-o out.trousseau.json]");
  console.error("       node scripts/bundle.mjs unpack <file.trousseau.json> [-d outdir]");
  process.exit(1);
}
