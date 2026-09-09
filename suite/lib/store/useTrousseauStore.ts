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
import {
  fetchCloudDocument,
  fetchWeddingId,
  getPendingWrite,
  pushDocument,
  replayPendingWrite,
  type PushResult,
} from "@/lib/documents/cloudSync";
import { fingerprintAllSlices, mergeCloudDocument, type SliceConflict } from "@/lib/documents/mergeCloudDocument";
import { fingerprint } from "@/lib/documents/fingerprint";
import { syncAssets } from "@/lib/documents/assets";

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
  setSlice: (slice: SliceName, value: unknown, options?: WriteOptions) => void;
  /**
   * Publish several slices as one change. Editing the timeline also republishes
   * the resolved day, and the two must never be separately observable — a
   * render between them would show a day that disagrees with the blocks it came
   * from.
   */
  setSlices: (entries: Array<[SliceName, unknown]>, options?: WriteOptions) => void;
  /** Replace the whole document — a JSON restore, or a fresh start. */
  replaceDocument: (next: unknown, options?: WriteOptions) => void;
  undo: () => void;
  redo: () => void;

  /**
   * `"disabled"` until `startCloudSync()` runs (accounts configured and the
   * caller has a wedding) — every other state is only reachable after that.
   */
  cloudStatus: "disabled" | "idle" | "syncing" | "queued" | "conflict" | "error";
  cloudError: string | null;
  /** The version this device last confirmed the cloud holds, or null before the first sync. */
  cloudVersion: number | null;
  /** Fingerprint of each slice as last agreed with the server - the merge baseline. */
  cloudAgreed: Partial<Record<SliceName, string>>;
  /** Slices changed on both sides since the last agreement. Surfaced, never auto-merged. */
  cloudConflicts: SliceConflict[];
  /** This device's wedding id, once known. Needed for asset sync's Storage paths. */
  weddingId: string | null;

  /** Called once, after local hydration, when accounts + a wedding are both available. */
  startCloudSync: () => Promise<void>;
  /** Push the current document now. Called after every local write, and on reconnect for the queue. */
  syncToCloud: () => Promise<void>;
  /** Pull the server's current document and merge it in, per slice. Called on an interval and on focus. */
  pullFromCloud: () => Promise<void>;
  /** Settle one slice's conflict: take the server's value, or keep the local one. */
  resolveConflict: (slice: SliceName, choice: "theirs" | "mine") => void;
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
    const raw = entries.reduce<Record<string, unknown>>(
      (acc, [slice, value]) => mergeSlice(acc, slice, value),
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

  replaceDocument: (next, options = {}) => {
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
      // Adopting the cloud's copy is `silent`, though — the user did not make
      // that change, and offering to undo it would offer to overwrite the
      // cloud with the document it just replaced.
      past: options.silent
        ? state.past
        : state.status === "ready"
          ? pushHistory(state.past, state.raw, options.label ?? "restore")
          : [],
      future: options.silent ? state.future : [],
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

  cloudStatus: "disabled",
  cloudError: null,
  cloudVersion: null,
  cloudAgreed: {},
  cloudConflicts: [],
  weddingId: null,

  startCloudSync: async () => {
    set({ cloudStatus: "syncing" });
    const result = await fetchCloudDocument();
    if (!result.ok) {
      // "unavailable" covers both "accounts not configured" and "no wedding
      // yet" — either way, cloud sync simply does not start, and local-only
      // behaviour continues exactly as it already does.
      set({ cloudStatus: result.reason === "unreachable" ? "error" : "disabled" });
      return;
    }

    if (result.document !== null) {
      get().replaceDocument(result.document, { silent: true });
      set({
        cloudStatus: "idle",
        cloudVersion: result.version,
        cloudAgreed: fingerprintAllSlices(result.document as Record<string, unknown>),
        cloudConflicts: [],
        cloudError: null,
      });
    } else {
      // Nothing saved for this account yet. A wedding built entirely offline
      // and then signed into would otherwise sit stranded until the user's
      // next edit — schedulePersist is the only other thing that calls
      // syncToCloud, and it fires on a write, not on sign-in. Empty stays
      // untouched: nothing to lose, and one fewer round trip on a brand-new
      // account.
      const local = get().raw;
      const guests = local["guests"];
      const day = local["day"] as { blocks?: unknown[] } | null | undefined;
      const hasContent =
        (guests !== null && typeof guests === "object" && Object.keys(guests).length > 0) ||
        (day?.blocks?.length ?? 0) > 0;
      if (hasContent) {
        applyCloudResult(await pushDocument(local, 0), local);
      } else {
        set({
          cloudStatus: "idle",
          cloudVersion: result.version,
          cloudAgreed: fingerprintAllSlices(local),
          cloudConflicts: [],
          cloudError: null,
        });
      }
    }

    const { weddingId } = await fetchWeddingId();
    if (weddingId) {
      set({ weddingId });
      void syncAssets(weddingId);
    }

    // Read before the replay, because the replay clears it: the queued
    // document is what gets pushed, so it is what agreement is recorded
    // against (see `applyCloudResult`'s `pushed`).
    const pending = await getPendingWrite();
    const replay = await replayPendingWrite();
    if (replay) applyCloudResult(replay, pending ? asRecord(pending.document) : undefined);
  },

  syncToCloud: async () => {
    const state = get();
    // "conflict" refuses as firmly as "disabled" does. Both conflict paths
    // below call `replaceDocument`, which schedules a persist, whose timer
    // ends here 250ms later — pushing the merged document (still holding
    // *local's* value for every conflicted slice) at the version the server
    // just reported. The compare-and-set would succeed, the partner's edit
    // would be gone, and the conflict UI would clear itself having chosen
    // "keep mine" on the user's behalf. Nothing is pushed until the last
    // conflict is resolved; `resolveConflict` then schedules its own push.
    if (state.cloudStatus === "disabled" || state.cloudStatus === "conflict") return;
    set({ cloudStatus: "syncing" });
    const pushed = state.raw;
    const result = await pushDocument(pushed, state.cloudVersion ?? 0);
    applyCloudResult(result, pushed);
  },

  pullFromCloud: async () => {
    const before = get();
    if (before.cloudStatus === "disabled" || before.cloudStatus === "syncing") return;
    // A pull with nothing agreed yet is not a valid pull: with an empty
    // `cloudAgreed`, every slice classifies as changed-on-both-sides against
    // every other slice. `startCloudSync` leaves exactly that state
    // (`cloudVersion: null`) when its first fetch was unreachable, so the
    // next successful poll would otherwise turn a transient network failure
    // into a document-wide conflict. Wait for a full sync to set a baseline.
    if (before.cloudVersion === null) return;

    const result = await fetchCloudDocument();
    if (!result.ok) {
      if (result.reason === "unreachable") {
        set({ cloudStatus: "error", cloudError: "The cloud could not be reached." });
      }
      return;
    }

    // The one retry for a wedding id `startCloudSync` could not resolve.
    // Cheap, and the alternative is a session with no asset sync at all and
    // nothing on screen to say why.
    if (get().weddingId === null) {
      const resolved = await fetchWeddingId();
      if (resolved.weddingId) set({ weddingId: resolved.weddingId });
    }

    // Re-read after the awaits above. The snapshot taken before the fetch is
    // one network round trip old; merging against it would discard anything
    // the user typed while it was in flight and then push the discard.
    const state = get();
    if (state.cloudStatus === "disabled" || state.cloudStatus === "syncing") return;
    // Nothing has changed on the server since we last agreed - the common
    // case on every tick of the poll.
    if (result.version === state.cloudVersion) return;

    const serverRaw = (result.document ?? {}) as Record<string, unknown>;
    const merged = mergeCloudDocument(state.raw, serverRaw, state.cloudAgreed);

    if (merged.conflicts.length > 0) {
      get().replaceDocument(merged.raw, { silent: true });
      set({
        cloudStatus: "conflict",
        cloudConflicts: merged.conflicts,
        cloudVersion: result.version,
        cloudAgreed: merged.agreed,
      });
    } else if (merged.adopted) {
      get().replaceDocument(merged.raw, { silent: true });
      set({ cloudVersion: result.version, cloudAgreed: merged.agreed });
      void get().syncToCloud();
    } else {
      // The version moved but nothing here changed — usually our own write
      // coming back, or the other tab echoing it. Record the version and
      // stop: replacing the document would remount every tool for nothing,
      // and pushing it back is how two open tabs ping-pong forever.
      set({ cloudVersion: result.version, cloudAgreed: merged.agreed });
    }

    // Something moved elsewhere, so fonts and artwork may have too.
    const { weddingId } = get();
    if (weddingId) void syncAssets(weddingId);
  },

  resolveConflict: (slice, choice) => {
    const state = get();
    const conflict = state.cloudConflicts.find((c) => c.slice === slice);
    if (!conflict) return;
    const remaining = state.cloudConflicts.filter((c) => c.slice !== slice);
    const raw = choice === "theirs" ? mergeSlice(state.raw, slice, conflict.theirs) : state.raw;
    const resolvedValue = raw[slice];

    set({
      raw,
      doc: migrate(raw),
      // Bumped for the same reason `replaceDocument` bumps it: a tool mounted
      // before the resolution still holds the pre-resolution slice, and
      // `toolGeneration`'s `mayWrite()` would let its next autosave write that
      // back — silently undoing the choice and pushing the undo to the cloud.
      generation: state.generation + 1,
      cloudConflicts: remaining,
      cloudAgreed: { ...state.cloudAgreed, [slice]: fingerprint(resolvedValue) },
      // Still "conflict" while any remain, which keeps `syncToCloud` refusing
      // to push a half-resolved document. The last resolution flips it to
      // "idle", and the persist scheduled below then pushes normally.
      cloudStatus: remaining.length > 0 ? "conflict" : "idle",
    });
    schedulePersist(raw);
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
    const noted = (cause: unknown) =>
      // A save the user believes happened and did not is the worst outcome
      // here, so it goes on screen rather than into the console.
      useTrousseauStore.setState({ error: `The wedding could not be saved: ${message(cause)}` });
    try {
      // `idbSet` opens the database synchronously, so a browser that refuses
      // one throws here rather than rejecting. Outside a promise chain and
      // inside a timer, that escapes to the top as an uncaught exception and
      // takes the message below with it.
      void idbSet(STORAGE_KEY, raw).then(() => {
        useTrousseauStore.setState({ savedAt: new Date().toISOString(), error: null });
        // Only after the local write has landed. Local storage is the record
        // of what the user has if the cloud is unreachable, so it goes first.
        void useTrousseauStore.getState().syncToCloud();
      }, noted);
    } catch (cause) {
      noted(cause);
    }
  }, PERSIST_DELAY_MS);
}

/**
 * Fold a write's answer back into the store.
 *
 * Shared by every path that pushes, and deliberately not a store action: it is
 * called from `schedulePersist`'s timer as well as from the actions, and
 * reaching for `setState` directly is what the persist path already does.
 *
 * A conflict is merged per slice, never overwritten wholesale. Slices that
 * changed on both sides are parked in `cloudConflicts` for the user to choose
 * between; every other slice's server value is adopted immediately.
 *
 * `pushed` is the document the caller actually sent. Agreement is recorded
 * against *that*, not against whatever `raw` happens to be when the response
 * lands: a keystroke during the round trip would otherwise be recorded as
 * agreed with a server that never received it, and the next merge would treat
 * that slice as unchanged here and quietly take the partner's value over it.
 */
function applyCloudResult(result: PushResult, pushed?: Record<string, unknown>): void {
  if (result.ok) {
    useTrousseauStore.setState({
      cloudStatus: "idle",
      cloudVersion: result.version,
      cloudConflicts: [],
      cloudAgreed: fingerprintAllSlices(pushed ?? useTrousseauStore.getState().raw),
      cloudError: null,
    });
    // No asset sync here. This runs after every debounced edit burst, and
    // fonts and artwork only change on upload — listing the bucket and
    // reading every blob out of IndexedDB on each keystroke burst buys
    // nothing. `startCloudSync` and `pullFromCloud` cover the two cases where
    // something might actually have changed elsewhere.
    return;
  }
  if (result.reason === "conflict") {
    const state = useTrousseauStore.getState();
    const merged = mergeCloudDocument(
      state.raw,
      result.document as Record<string, unknown>,
      state.cloudAgreed,
    );
    state.replaceDocument(merged.raw, { silent: true });

    if (merged.conflicts.length > 0) {
      useTrousseauStore.setState({
        cloudStatus: "conflict",
        cloudConflicts: merged.conflicts,
        cloudVersion: result.version,
        cloudAgreed: merged.agreed,
      });
    } else {
      // Every differing slice resolved cleanly - finalize by pushing the
      // merged document at the version the server just reported.
      useTrousseauStore.setState({ cloudVersion: result.version, cloudAgreed: merged.agreed });
      void useTrousseauStore.getState().syncToCloud();
    }
    return;
  }
  if (result.reason === "queued") {
    useTrousseauStore.setState({ cloudStatus: "queued" });
    return;
  }
  if (result.reason === "invalid") {
    useTrousseauStore.setState({
      cloudStatus: "error",
      cloudError: `This wedding could not be saved to the cloud: ${result.errors.join("; ")}`,
    });
    return;
  }
  useTrousseauStore.setState({ cloudStatus: "error", cloudError: "The cloud could not be reached." });
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
