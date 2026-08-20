import {
  emptyTrousseau,
  isFromFuture,
  mergeSlice,
  migrate,
  parse,
  serialise,
  suggestedFilename,
  type Day,
  type Event,
  type SliceName,
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
