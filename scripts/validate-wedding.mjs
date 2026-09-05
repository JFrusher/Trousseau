// The gate on the canonical wedding file.
//
// Trousseau's zod schema validates the envelope: kind, version, event, and the
// fact that each slice is an object. It deliberately cannot validate slice
// interiors — that shape belongs to the owning app (see src/slices.ts). The
// cross-slice invariants live here instead, because they are the ones no single
// app can check: an app only ever sees its own slice.
//
//   node scripts/validate-wedding.mjs [data/wedding.trousseau.json]
//
// Exit 1 on any error. Warnings print and exit 0.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "../dist/index.js";

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Every cross-slice invariant, as a pure function so it can be tested without
 * a file or a process exit.
 *
 * @param doc a parsed trousseau
 * @returns {{errors: string[], warnings: string[], facts: string[]}}
 */
export function check(doc) {
  const errors = [];
  const warnings = [];
  const facts = [];
  const fail = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  const tableaux = isObj(doc.sources?.tableaux) ? doc.sources.tableaux : null;
  const cadence = isObj(doc.sources?.cadence) ? doc.sources.cadence : null;

  // -------------------------------------------------------------- event date
  // One wedding, one date. bundle.mjs reports a disagreement as a note on
  // stdout and keeps the first claim; nothing has ever stopped that note being
  // scrolled past. This is that note, promoted to a failure.
  const claims = [
    ["event.date", doc.event?.date],
    ["day.day.date", doc.day?.day?.date],
    ["sources.tableaux.meta.date", tableaux?.meta?.date],
    ["sources.cadence.day.date", cadence?.day?.date],
  ].filter(([, v]) => typeof v === "string" && v !== "");

  const distinctDates = [...new Set(claims.map(([, v]) => v))];
  if (distinctDates.length > 1) {
    fail(
      `the wedding has ${distinctDates.length} different dates:\n` +
        claims.map(([where, v]) => `      ${v}  <- ${where}`).join("\n"),
    );
  }

  // ------------------------------------------------------------ seating slice
  // The suite publishes resolved `guests` and `seating` slices, which is what
  // this reads. `sources.tableaux` is the fallback, for a bundle the collector
  // built from the four standalone apps before the suite existed — those files
  // still have to validate, and their interior shape is the same.
  const seated = (() => {
    if (isObj(doc.guests) && isObj(doc.seating?.tables)) {
      return { guests: doc.guests, tables: doc.seating.tables, from: "slices" };
    }
    if (tableaux && isObj(tableaux.guests) && isObj(tableaux.tables)) {
      return { guests: tableaux.guests, tables: tableaux.tables, from: "sources.tableaux" };
    }
    return null;
  })();

  if (seated) {
    const guests = Object.values(seated.guests);
    const tables = Object.values(seated.tables);
    const guestIds = new Set(guests.map((g) => g.id));
    const tableById = new Map(tables.map((t) => [t.id, t]));
    const name = (g) => g.fullName || `${g.firstName ?? ""} ${g.lastName ?? ""}`.trim() || g.id;

    // A seat holding two people is the failure that only shows up on the day.
    const bySeat = new Map();
    for (const g of guests) {
      if (!g.assignedSeatId) continue;
      const held = bySeat.get(g.assignedSeatId);
      if (held) fail(`seat ${g.assignedSeatId} is assigned to both ${name(held)} and ${name(g)}`);
      else bySeat.set(g.assignedSeatId, g);
    }

    for (const t of tables) {
      // In seat mode `assignedGuestIds` is positional and always as long as the
      // table has seats, with null for an empty one. Filter before counting, or
      // every unfilled seat reads as a missing guest.
      const slots = Array.isArray(t.assignedGuestIds) ? t.assignedGuestIds : [];
      const ids = slots.filter((id) => id !== null && id !== undefined && id !== "");
      const where = t.label ?? t.id;

      for (const id of ids) {
        if (!guestIds.has(id)) fail(`table ${where} holds guest ${id}, who does not exist`);
      }
      for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
        fail(`table ${where} lists guest ${id} twice`);
      }
      if (typeof t.capacity === "number" && ids.length > t.capacity) {
        fail(`table ${where} seats ${ids.length} people but has ${t.capacity} seats`);
      }
    }

    // The two directions of the same fact, which drift apart independently.
    for (const g of guests) {
      if (!g.assignedTableId) continue;
      const t = tableById.get(g.assignedTableId);
      if (!t) {
        fail(`${name(g)} is assigned to table ${g.assignedTableId}, which does not exist`);
      } else if (!(t.assignedGuestIds ?? []).includes(g.id)) {
        fail(`${name(g)} thinks they sit at ${t.label ?? t.id}, but that table does not list them`);
      }
    }

    const unseated = guests.filter((g) => g.rsvpStatus === "confirmed" && !g.assignedTableId);
    if (unseated.length > 0) {
      warn(`${unseated.length} confirmed guest(s) have no table: ${unseated.map(name).join(", ")}`);
    }

    const noDietary = guests.filter(
      (g) => g.rsvpStatus === "confirmed" && !g.dietary && !g.dietaryRaw,
    );
    if (noDietary.length > 0) {
      warn(
        `${noDietary.length} confirmed guest(s) have no dietary answer at all: ${noDietary.map(name).join(", ")}`,
      );
    }

    facts.push(`seating: ${guests.length} guests, ${tables.length} tables (${seated.from})`);
  }

  // ---------------------------------------------------------------- day slice
  if (doc.day) {
    const blocks = Array.isArray(doc.day.blocks) ? doc.day.blocks : [];
    // Cadence names lanes with plain strings, and a block refers to one by name.
    const lanes = new Set(doc.day.lanes ?? []);
    for (const b of blocks) {
      if (b.lane && !lanes.has(b.lane)) {
        fail(`block "${b.label ?? b.id}" sits in lane "${b.lane}", which does not exist`);
      }
    }
    const empty = [...lanes].filter((l) => !blocks.some((b) => b.lane === l));
    if (empty.length > 0) warn(`lane(s) with nothing in them: ${empty.join(", ")}`);
    facts.push(`day: ${blocks.length} blocks, ${lanes.size} lanes`);
  }

  // --------------------------------------------------------------- shots slice
  if (isObj(doc.shots)) {
    const guestIds = new Set(Object.keys(isObj(doc.guests) ? doc.guests : {}));
    const familyIds = new Set(Object.keys(doc.seating?.families ?? {}));
    const groupIds = new Set([
      ...Object.keys(doc.seating?.groups ?? {}),
      ...Object.keys(doc.seating?.subgroups ?? {}),
    ]);
    const cast = isObj(doc.shots.cast) ? doc.shots.cast : {};

    for (const [role, ids] of Object.entries(cast)) {
      for (const id of Array.isArray(ids) ? ids : []) {
        if (!guestIds.has(id)) fail(`the cast's ${role} names guest ${id}, who does not exist`);
      }
    }

    let shotCount = 0;
    let emptySections = 0;
    for (const section of Array.isArray(doc.shots.sections) ? doc.shots.sections : []) {
      const shots = Array.isArray(section.shots) ? section.shots : [];
      if (shots.length === 0) emptySections += 1;
      for (const shot of shots) {
        shotCount += 1;
        const members = Array.isArray(shot.members) ? shot.members : [];
        if (members.length === 0) warn(`"${shot.label || "an untitled shot"}" has nobody in it`);
        for (const member of members) {
          if (member.kind === "guest" && !guestIds.has(member.ref)) {
            fail(`"${shot.label || shot.id}" names guest ${member.ref}, who does not exist`);
          }
          if (member.kind === "family" && !familyIds.has(member.ref)) {
            fail(`"${shot.label || shot.id}" names family ${member.ref}, which does not exist`);
          }
          if (member.kind === "group" && !groupIds.has(member.ref)) {
            fail(`"${shot.label || shot.id}" names group ${member.ref}, which does not exist`);
          }
          if (member.kind === "guest" && guestIds.has(member.ref) && doc.guests[member.ref]?.rsvpStatus === "declined") {
            warn(`"${shot.label || shot.id}" includes ${member.ref}, who has declined`);
          }
        }
      }
    }
    if (emptySections > 0) warn(`${emptySections} shot section(s) with nothing in them`);
    if (shotCount > 0) facts.push(`shots: ${shotCount} planned`);
  }

  return { errors, warnings, facts };
}

// Not run when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? "data/wedding.trousseau.json";
  let doc;
  try {
    doc = parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`${file} does not parse against the trousseau schema:\n  ${e.message}`);
    process.exit(1);
  }

  const { errors, warnings, facts } = check(doc);
  for (const f of facts) console.log(`  ${f}`);
  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (errors.length > 0) {
    console.error(`\n${file} has ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  error: ${e}`);
    process.exit(1);
  }
  console.log(`\n${file} is valid${warnings.length ? ` (${warnings.length} warning(s))` : ""}.`);
}
