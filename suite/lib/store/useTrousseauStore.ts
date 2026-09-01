import { get as idbGet, set as idbSet } from "idb-keyval";
import { promoteSources } from "@/lib/model/promote";
import { migrateLegacyKeys } from "./migrateKeys";
import { create } from "zustand";
import {
  emptyTrousseau,
  mergeSlice,
  migrate,
  type SliceName,
  type Trousseau,
} from "@jfrusher/trousseau";

/**
 * The slices this app writes.
 *
 * `timeline` is not one of the contract package's `SLICE_NAMES`: the envelope
 * holds the *resolved* day, and editing needs the anchors and gaps it was
 * resolved from. The envelope is a `looseObject` at every level exactly so a
 * new slice can appear without a release of the package, so this is the
 * intended way in — but the package should gain the name when next touched.
 */
export type SuiteSlice = SliceName | "timeline";

/**
 * The one store the whole suite reads.
 *
 * Its shape is the Trousseau envelope — `event`, `guests`, `seating`, `day`,
 * `crew`, `stationery` — rather than a flat bag of guests and tables, because
 * that envelope already exists, is validated by zod, and encodes the rule the
 * four apps were built around: one owner per slice, and every other key copied
 * byte-for-byte. A flat model would have to invent a fifth version of what a
 * guest is, and would drop any key belonging to a tool not yet written.
 *
 * Two copies of the document are held on purpose:
 *
 * - `raw` is what was stored, untouched. Every write goes through `mergeSlice`
 *   on `raw`, so a wrong schema can at worst refuse a read — it can never
 *   destroy a write.
 * - `doc` is `raw` parsed, for reading. Parsed once per mutation rather than
 *   once per render, because zod over a 100 KB document is not free.
 */

/** IndexedDB, via idb-keyval — the same engine the four tools already use. */
export const STORAGE_KEY = "trousseau.document";

/** Trailing write delay. A drag on the seating canvas fires many mutations. */
const PERSIST_DELAY_MS = 250;

export type StoreStatus = "idle" | "loading" | "ready" | "error";

/** How deep undo goes. Fifty documents of a wedding is a few megabytes at most. */
const HISTORY_LIMIT = 50;

/**
 * Two edits carrying the same label within this window become one undo step.
 *
 * Without it, typing "Table 7" into a name field is seven separate undos, and
 * dragging a table across the room is one per frame.
 */
const COALESCE_MS = 700;

export interface HistoryEntry {
  raw: Record<string, unknown>;
  /** What the user did, for the undo tooltip. Also the coalescing key. */
  label: string;
  at: number;
}

export interface WriteOptions {
  /** Shown as "Undo <label>". Edits sharing a label coalesce while typing. */
  label?: string;
  /**
   * Keep this change out of the undo stack entirely. For writes the user did
   * not make — reconciling a restored document, republishing the resolved day.
   */
  silent?: boolean;
}

export interface TrousseauState {
  /**
   * Bumped whenever the whole document is swapped rather than edited — a
   * restore from file, or a shared wedding opened from another machine.
   *
   * The tools each keep a store of their own, seeded once when they mount, so
   * replacing the document underneath a tool leaves it holding the previous
   * wedding with no idea anything happened. It shows the old guest list, and
   * then autosaves it over the new one. This is how anything that read the
   * document can tell that what it read has been thrown away.
   */
  generation: number;

  status: StoreStatus;
  /** Set when the stored bytes could not be read. Writes are refused while it is. */
  error: string | null;
  /** ISO time of the last successful write. Drives the "saved 13:42" notice. */
  savedAt: string | null;
  /** The stored document, exactly as stored. Never the parsed one. */
  raw: Record<string, unknown>;
  /** The stored document, parsed. Read from this. */
  doc: Trousseau;

  /** Whole documents, oldest first. Undo pops the last. */
  past: HistoryEntry[];
  future: HistoryEntry[];

  /** Read the document from IndexedDB. Safe to call more than once. */
  hydrate: () => Promise<void>;
  /** Publish one slice. Every other key survives untouched. */
  setSlice: (slice: SuiteSlice, value: unknown, options?: WriteOptions) => void;
  /**
   * Publish several slices as one change. Editing the timeline also republishes
   * the resolved day, and the two must never be separately observable — a
   * render between them would show a day that disagrees with the blocks it came
   * from.
   */
  setSlices: (entries: Array<[SuiteSlice, unknown]>, options?: WriteOptions) => void;
  /** Replace the whole document — a JSON restore, or a fresh start. */
  replaceDocument: (next: unknown) => void;
  undo: () => void;
  redo: () => void;
}

function freshDoc(): { raw: Record<string, unknown>; doc: Trousseau } {
  const doc = emptyTrousseau();
  return { raw: doc as unknown as Record<string, unknown>, doc };
}

export const useTrousseauStore = create<TrousseauState>()((set, get) => ({
  generation: 0,
  status: "idle",
  error: null,
  savedAt: null,
  ...freshDoc(),

  hydrate: async () => {
    if (get().status !== "idle") return;
    set({ status: "loading" });

    // Data written when the app was briefly called something else lives under
    // the old keys, and is moved before the first read or this opens empty.
    //
    // Deliberately outside the read's own try: a rename is housekeeping, and a
    // failure here must not put the store into its "cannot read the document"
    // state and refuse every write. Worst case the old copy stays where it is
    // and the app opens on whatever the current key holds.
    try {
      await migrateLegacyKeys();
    } catch {
      // Nothing to tell the user. The read below is what actually matters.
    }

    let stored: unknown;
    try {
      stored = await idbGet(STORAGE_KEY);
    } catch (cause) {
      set({ status: "error", error: `Local storage could not be read: ${message(cause)}` });
      return;
    }

    if (stored === undefined) {
      set({ status: "ready", error: null, past: [], future: [] });
      return;
    }

    const raw = asRecord(stored);
    try {
      // A load is where history begins; there is nothing before it to undo to.
      set({ status: "ready", error: null, raw, doc: migrate(raw), past: [], future: [] });
    } catch (cause) {
      // The bytes stay exactly where they are. Refusing to read is recoverable;
      // writing over an unreadable document is not.
      set({
        status: "error",
        error: `The saved wedding could not be read: ${message(cause)}`,
        raw,
      });
    }
  },

  past: [],
  future: [],

  setSlice: (slice, value, options) => get().setSlices([[slice, value]], options),

  setSlices: (entries, options = {}) => {
    const state = get();
    // Refused while the stored document is unreadable. Writing over bytes we
    // could not parse is the one unrecoverable outcome.
    if (state.status !== "ready") return;
    // `mergeSlice` is typed to the contract's own slice names; `timeline` is a
    // slice this app adds, which the loose envelope carries without complaint.
    const raw = entries.reduce<Record<string, unknown>>(
      (acc, [slice, value]) => mergeSlice(acc, slice as SliceName, value),
      state.raw,
    );

    set({
      raw,
      doc: migrate(raw),
      ...(options.silent
        ? {}
        : {
            past: pushHistory(state.past, state.raw, options.label ?? "change"),
            // A new edit after an undo abandons the redo branch. Keeping it
            // would let redo replay changes that never followed this state.
            future: [],
          }),
    });
    schedulePersist(raw);
  },

  replaceDocument: (next) => {
    const state = get();
    // A collected document keeps each tool's export under `sources` and leaves
    // the slices empty. Both shapes are valid and both are called
    // `.trousseau.json`, so accepting either here is the difference between a
    // restore that works and one that reports success over an empty app.
    const raw = promoteSources(asRecord(next)).raw;
    set({
      status: "ready",
      error: null,
      raw,
      doc: migrate(raw),
      generation: state.generation + 1,
      // A restore is undoable: opening the wrong file should not cost the work.
      past: state.status === "ready" ? pushHistory(state.past, state.raw, "restore") : [],
      future: [],
    });
    schedulePersist(raw);
  },

  undo: () => {
    const state = get();
    const previous = state.past[state.past.length - 1];
    if (!previous) return;
    try {
      const doc = migrate(previous.raw);
      set({
        raw: previous.raw,
        doc,
        past: state.past.slice(0, -1),
        future: [...state.future, { raw: state.raw, label: previous.label, at: Date.now() }],
      });
      schedulePersist(previous.raw);
    } catch {
      // A history entry that no longer parses is dropped rather than restored.
      // It can only happen if a schema changed under a live session, and the
      // alternative is putting the store into its unreadable state by hand.
      set({ past: state.past.slice(0, -1) });
    }
  },

  redo: () => {
    const state = get();
    const next = state.future[state.future.length - 1];
    if (!next) return;
    try {
      set({
        raw: next.raw,
        doc: migrate(next.raw),
        past: pushHistory(state.past, state.raw, next.label),
        future: state.future.slice(0, -1),
      });
      schedulePersist(next.raw);
    } catch {
      set({ future: state.future.slice(0, -1) });
    }
  },
}));

/**
 * Add a document to the undo stack, folding it into the last entry when the two
 * are the same action moments apart.
 *
 * Coalescing looks at the entry already on the stack rather than the incoming
 * one, because the stack holds *previous* states: keeping the older of two
 * consecutive keystrokes is what makes one undo jump back to before the word.
 */
function pushHistory(
  past: HistoryEntry[],
  raw: Record<string, unknown>,
  label: string,
): HistoryEntry[] {
  const last = past[past.length - 1];
  if (last && last.label === label && Date.now() - last.at < COALESCE_MS) {
    return [...past.slice(0, -1), { ...last, at: Date.now() }];
  }
  const next = [...past, { raw, label, at: Date.now() }];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

/** Guests are a record keyed by id, so the badge is a key count. */
export const selectGuestCount = (s: TrousseauState): number => Object.keys(s.doc.guests).length;
export const selectTableCount = (s: TrousseauState): number => Object.keys(s.doc.seating).length;
export const selectBlockCount = (s: TrousseauState): number => s.doc.day?.blocks.length ?? 0;

// ponytail: one trailing timer for the whole store. Fine while writes are
// coarse; if a slice ever needs its own cadence, key the timer by slice name.
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function schedulePersist(raw: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void idbSet(STORAGE_KEY, raw).then(
      () => useTrousseauStore.setState({ savedAt: new Date().toISOString(), error: null }),
      // A save the user believes happened and did not is the worst outcome
      // here, so it goes on screen rather than into the console.
      (cause: unknown) =>
        useTrousseauStore.setState({ error: `The wedding could not be saved: ${message(cause)}` }),
    );
  }, PERSIST_DELAY_MS);
}

/** Exposed for tests and for the Data Manager's "save now". */
export async function flushPersist(): Promise<void> {
  clearTimeout(persistTimer);
  if (typeof window === "undefined") return;
  await idbSet(STORAGE_KEY, useTrousseauStore.getState().raw);
  useTrousseauStore.setState({ savedAt: new Date().toISOString() });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
