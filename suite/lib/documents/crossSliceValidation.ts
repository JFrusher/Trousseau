/**
 * The cross-slice invariant gate — a faithful port of `check()` from
 * `scripts/validate-wedding.mjs`. That script validates the file on disk
 * before a DVC commit; this validates a document before it is accepted into
 * `wedding_documents`. The logic itself does not change: an error blocks the
 * write outright, a warning does not.
 *
 * Kept as a deliberate duplication rather than an import across the
 * suite/scripts boundary — `scripts/validate-wedding.mjs` is plain ESM
 * outside the `suite` Next.js app's module root, and importing it directly
 * would tie this app's build to a sibling directory's bundling behavior for
 * no real benefit. If `scripts/validate-wedding.mjs` changes, this file needs
 * the same change made twice; subsystem C (suite de-duplication) is the
 * place a shared package for this would belong, not this plan.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface CrossSliceResult {
  errors: string[];
  warnings: string[];
  facts: string[];
}

export function checkCrossSlice(doc: unknown): CrossSliceResult {
  const d = isObj(doc) ? doc : {};
  const errors: string[] = [];
  const warnings: string[] = [];
  const facts: string[] = [];
  const fail = (m: string) => errors.push(m);
  const warn = (m: string) => warnings.push(m);

  const sources = isObj(d.sources) ? d.sources : {};
  const tableaux = isObj(sources.tableaux) ? sources.tableaux : null;
  const cadence = isObj(sources.cadence) ? sources.cadence : null;
  const event = isObj(d.event) ? d.event : {};
  const day = isObj(d.day) ? d.day : null;
  const dayInner = day && isObj(day.day) ? day.day : null;
  const tableauxMeta = tableaux && isObj(tableaux.meta) ? tableaux.meta : null;
  const cadenceDay = cadence && isObj(cadence.day) ? cadence.day : null;

  // -------------------------------------------------------------- event date
  const claims: Array<[string, unknown]> = [
    ["event.date", event.date],
    ["day.day.date", dayInner?.date],
    ["sources.tableaux.meta.date", tableauxMeta?.date],
    ["sources.cadence.day.date", cadenceDay?.date],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "");

  const distinctDates = [...new Set(claims.map(([, v]) => v as string))];
  if (distinctDates.length > 1) {
    fail(
      `the wedding has ${distinctDates.length} different dates:\n` +
        claims.map(([where, v]) => `      ${v}  <- ${where}`).join("\n"),
    );
  }

  // ------------------------------------------------------------ seating slice
  const docGuests = isObj(d.guests) ? d.guests : null;
  const docSeatingTables = isObj(d.seating) && isObj((d.seating as Obj).tables)
    ? ((d.seating as Obj).tables as Obj)
    : null;

  const seated = (() => {
    if (docGuests && docSeatingTables) {
      return { guests: docGuests, tables: docSeatingTables, from: "slices" };
    }
    if (tableaux && isObj(tableaux.guests) && isObj(tableaux.tables)) {
      return { guests: tableaux.guests as Obj, tables: tableaux.tables as Obj, from: "sources.tableaux" };
    }
    return null;
  })();

  if (seated) {
    const guests = Object.values(seated.guests) as Obj[];
    const tables = Object.values(seated.tables) as Obj[];
    const guestIds = new Set(guests.map((g) => g.id as string));
    const tableById = new Map(tables.map((t) => [t.id as string, t]));
    const name = (g: Obj) =>
      (g.fullName as string) ||
      `${(g.firstName as string) ?? ""} ${(g.lastName as string) ?? ""}`.trim() ||
      (g.id as string);

    const bySeat = new Map<string, Obj>();
    for (const g of guests) {
      const seatId = g.assignedSeatId as string | undefined;
      if (!seatId) continue;
      const held = bySeat.get(seatId);
      if (held) fail(`seat ${seatId} is assigned to both ${name(held)} and ${name(g)}`);
      else bySeat.set(seatId, g);
    }

    for (const t of tables) {
      const slots = Array.isArray(t.assignedGuestIds) ? (t.assignedGuestIds as unknown[]) : [];
      const ids = slots.filter((id) => id !== null && id !== undefined && id !== "") as string[];
      const where = (t.label as string) ?? (t.id as string);

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

    for (const g of guests) {
      const assignedTableId = g.assignedTableId as string | undefined;
      if (!assignedTableId) continue;
      const t = tableById.get(assignedTableId);
      if (!t) {
        fail(`${name(g)} is assigned to table ${assignedTableId}, which does not exist`);
      } else if (!((t.assignedGuestIds as unknown[] | undefined) ?? []).includes(g.id)) {
        fail(`${name(g)} thinks they sit at ${(t.label as string) ?? (t.id as string)}, but that table does not list them`);
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
  if (day) {
    const blocks = Array.isArray(day.blocks) ? (day.blocks as Obj[]) : [];
    const lanes = new Set((day.lanes as string[] | undefined) ?? []);
    for (const b of blocks) {
      const lane = b.lane as string | undefined;
      if (lane && !lanes.has(lane)) {
        fail(`block "${(b.label as string) ?? (b.id as string)}" sits in lane "${lane}", which does not exist`);
      }
    }
    const empty = [...lanes].filter((l) => !blocks.some((b) => b.lane === l));
    if (empty.length > 0) warn(`lane(s) with nothing in them: ${empty.join(", ")}`);
    facts.push(`day: ${blocks.length} blocks, ${lanes.size} lanes`);
  }

  return { errors, warnings, facts };
}
