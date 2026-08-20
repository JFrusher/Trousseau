import {
  DAY_KIND,
  DAY_VERSION,
  TROUSSEAU_KIND,
  TROUSSEAU_VERSION,
  TROUSSEAU_EXTENSION,
  SLICE_NAMES,
  crewSchema,
  dayBlockSchema,
  daySchema,
  dayTeamSchema,
  emptyTrousseau,
  eventSchema,
  guestsSchema,
  isFromFuture,
  mergeSlice,
  migrate,
  parse,
  seatingSchema,
  serialise,
  stationerySchema,
  suggestedFilename,
  trousseauSchema,
  type Crew,
  type Day,
  type DayBlock,
  type DayTeam,
  type Event,
  type Guests,
  type Seating,
  type SliceName,
  type Stationery,
  type Trousseau,
} from "@jfrusher/trousseau";

// A slice name is assignable from a literal.
const slice: SliceName = "day";

// The envelope's fields have the types an app expects.
const doc: Trousseau = emptyTrousseau();
const event: Event = doc.event;
const names: string = event.coupleNames;
const curfew: number | null = event.curfewMin;

// `day` is nullable, and narrowing works.
const day: Day | null = doc.day;
if (day !== null) {
  const future: boolean = isFromFuture(day);
  // noUncheckedIndexedAccess: indexing an array yields `| undefined`.
  const first = day.blocks[0];
  const label: string = first?.label ?? "";
  void future;
  void label;

  // arrivalMin must stay a required property of a nullable type. If it ever
  // becomes optional, `number | undefined` stops being assignable here and this
  // gate fails — which is the whole reason this file exists.
  const teams: DayTeam[] = day.teams;
  const firstTeam = teams[0];
  const arrival: number | null = firstTeam ? firstTeam.arrivalMin : null;
  void arrival;

  // Asserts the flag is doing its job: with noUncheckedIndexedAccess on, this
  // assignment must fail. If the flag is ever dropped from verify/tsconfig.json,
  // there is no error, and @ts-expect-error then fails the build itself.
  // @ts-expect-error indexing an array must yield `| undefined`
  const mustBeUndefinable: DayBlock = day.blocks[0];
  void mustBeUndefinable;
}

// The file functions compose.
const text: string = serialise(doc);
const back: Trousseau = parse(text);
const name: string = suggestedFilename(back);

// mergeSlice takes raw data and a slice name.
const merged: Record<string, unknown> = mergeSlice(back, slice, {});
const remigrated: Trousseau = migrate(merged);

void names;
void curfew;
void name;
void remigrated;

// Every remaining public export, so a rename or a dropped export fails here
// rather than in someone else's application.
const kinds: readonly [string, number, string, number] = [
  DAY_KIND,
  DAY_VERSION,
  TROUSSEAU_KIND,
  TROUSSEAU_VERSION,
];
const extension: string = TROUSSEAU_EXTENSION;
const everySlice: readonly SliceName[] = SLICE_NAMES;
const schemas = [
  eventSchema,
  daySchema,
  dayBlockSchema,
  dayTeamSchema,
  trousseauSchema,
  guestsSchema,
  seatingSchema,
  crewSchema,
  stationerySchema,
];
const slices: [Guests, Seating, Crew, Stationery] = [
  doc.guests,
  doc.seating,
  doc.crew,
  doc.stationery,
];

void kinds;
void extension;
void everySlice;
void schemas;
void slices;
