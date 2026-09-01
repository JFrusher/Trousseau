import { create } from "zustand";
import { emptyDoc, DEFAULT_BLOCK_OUTPUTS } from "../core/model/defaults";
import { newId } from "../core/model/ids";
import type { Block, DaySettings, OutputId, StyleSpec, TagDetail, TimelineDoc } from "../core/model/types";

/** The zoom range, in pixels per minute, and the ratio each press moves it by. */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 6;
export const ZOOM_STEP = 1.25;

function clampZoom(pxPerMin: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPerMin));
}
import {
  conflicts as computeConflicts,
  conflictsByBlock,
  type Conflict,
} from "../core/schedule/conflicts";
import { byId, resolve, type ResolvedBlock } from "../core/schedule/resolve";
import { slack as computeSlack, type SlackReport } from "../core/schedule/slack";
import { whatIf, type Change, type WhatIf } from "../core/schedule/whatIf";
import { sunForDay, type SunTimes } from "../core/sun/solar";
import {
  canRedo,
  canUndo,
  initHistory,
  push,
  redo,
  reset,
  undo,
  type History,
} from "./history";

export interface Schedule {
  resolved: ResolvedBlock[];
  positions: Map<string, ResolvedBlock>;
  conflicts: Conflict[];
  byBlock: Map<string, Conflict[]>;
  slack: SlackReport;
  sun: SunTimes | null;
}

let cache: { doc: TimelineDoc; schedule: Schedule } | null = null;
let computeCount = 0;

/**
 * The single derived view of a document. Memoised on document identity: every
 * edit replaces the document, so a stale cache is impossible, and screen and
 * PDF cannot disagree because they both read this.
 */
export function scheduleFor(doc: TimelineDoc): Schedule {
  if (cache && cache.doc === doc) return cache.schedule;

  computeCount += 1;
  const resolved = resolve(doc);
  const sun = sunForDay(doc.day);
  const conflicts = computeConflicts(
    resolved,
    doc,
    sun?.goldenHourEndMin === null || sun?.goldenHourEndMin === undefined
      ? {}
      : { goldenHourEndMin: sun.goldenHourEndMin },
  );

  const schedule: Schedule = {
    resolved,
    positions: byId(resolved),
    conflicts,
    byBlock: conflictsByBlock(conflicts),
    slack: computeSlack(resolved, doc),
    sun,
  };
  cache = { doc, schedule };
  return schedule;
}

/** Test hook: how many times the schedule has actually been computed. */
export function scheduleComputeCount(): number {
  return computeCount;
}

export interface UiState {
  pxPerMin: number;
  presentation: boolean;
  sheetOutput: OutputId;
}

export interface StoreState {
  history: History<TimelineDoc>;
  selectedId: string | null;
  /** The live drag preview. Never committed until the drag ends. */
  preview: WhatIf | null;
  ui: UiState;
  notice: string | null;

  addBlock: (lane: string, seed?: Partial<Block>) => string;
  updateBlock: (id: string, patch: Partial<Block>) => void;
  deleteBlock: (id: string) => void;
  reorderBlock: (id: string, delta: number) => void;
  toggleAnchor: (id: string) => void;
  setAnchor: (id: string, anchorMin: number | null) => void;
  setDay: (patch: Partial<DaySettings>) => void;
  setTagDetail: (detail: TagDetail) => void;
  removeTagDetail: (tag: string) => void;
  setStyle: (output: OutputId, patch: Partial<StyleSpec>) => void;
  addLane: (name: string) => void;
  renameLane: (from: string, to: string) => void;
  deleteLane: (name: string) => void;

  select: (id: string | null) => void;
  setUi: (patch: Partial<UiState>) => void;
  setNotice: (notice: string | null) => void;
  zoomBy: (factor: number) => void;
  fitDay: (viewportPx: number, spanMin: number) => void;

  previewChange: (change: Change) => void;
  commitPreview: () => void;
  cancelPreview: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  loadDoc: (doc: TimelineDoc) => void;
  replaceDoc: (doc: TimelineDoc) => void;
}

/** The document currently on screen. */
export function getDoc(state: StoreState): TimelineDoc {
  return state.history.present;
}

export const selectDoc = (state: StoreState): TimelineDoc => state.history.present;
export const selectSchedule = (state: StoreState): Schedule =>
  scheduleFor(state.history.present);

function withBlocks(doc: TimelineDoc, blocks: Block[]): TimelineDoc {
  return { ...doc, blocks };
}

export const useStore = create<StoreState>((set, get) => {
  /** Every document edit goes through here, so undo never misses one. */
  const commit = (next: TimelineDoc) =>
    set((state) => ({ history: push(state.history, next) }));

  const edit = (change: (doc: TimelineDoc) => TimelineDoc) => commit(change(getDoc(get())));

  return {
    history: initHistory(emptyDoc()),
    selectedId: null,
    preview: null,
    ui: { pxPerMin: 1.3, presentation: false, sheetOutput: "run-sheet" },
    notice: null,

    addBlock: (lane, seed = {}) => {
      const id = seed.id ?? newId("blk");
      const block: Block = {
        id,
        label: "New block",
        durationMin: 30,
        anchorMin: null,
        gapMin: 0,
        bufferMin: 0,
        lane,
        tags: [],
        location: "",
        notes: "",
        outputs: [...DEFAULT_BLOCK_OUTPUTS],
        ...seed,
      };
      // Land it at the end of its own lane, not the end of the document.
      const doc = getDoc(get());
      const lastInLane = doc.blocks.reduce(
        (last, entry, index) => (entry.lane === lane ? index : last),
        -1,
      );
      const at = lastInLane === -1 ? doc.blocks.length : lastInLane + 1;
      edit((current) =>
        withBlocks(current, [
          ...current.blocks.slice(0, at),
          block,
          ...current.blocks.slice(at),
        ]),
      );
      set({ selectedId: id });
      return id;
    },

    updateBlock: (id, patch) =>
      edit((doc) =>
        withBlocks(
          doc,
          doc.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)),
        ),
      ),

    deleteBlock: (id) => {
      edit((doc) => withBlocks(doc, doc.blocks.filter((block) => block.id !== id)));
      if (get().selectedId === id) set({ selectedId: null });
    },

    reorderBlock: (id, delta) =>
      edit((doc) => {
        const blocks = [...doc.blocks];
        const from = blocks.findIndex((block) => block.id === id);
        const moving = blocks[from];
        if (!moving) return doc;

        // Move past the next block in the same lane, wherever it sits in the array.
        const step = Math.sign(delta);
        let to = from;
        for (let i = from + step; i >= 0 && i < blocks.length; i += step) {
          if (blocks[i]?.lane === moving.lane) {
            to = i;
            break;
          }
        }
        if (to === from) return doc;
        blocks.splice(from, 1);
        blocks.splice(to, 0, moving);
        return withBlocks(doc, blocks);
      }),

    toggleAnchor: (id) => {
      const doc = getDoc(get());
      const block = doc.blocks.find((entry) => entry.id === id);
      if (!block) return;
      if (block.anchorMin !== null) {
        get().setAnchor(id, null);
        return;
      }
      // Pin it where it already sits, rather than jumping it somewhere arbitrary.
      const resolvedStart = scheduleFor(doc).positions.get(id)?.startMin ?? 0;
      get().setAnchor(id, resolvedStart);
    },

    setAnchor: (id, anchorMin) => get().updateBlock(id, { anchorMin }),

    setDay: (patch) => edit((doc) => ({ ...doc, day: { ...doc.day, ...patch } })),

    setTagDetail: (detail) =>
      edit((doc) => {
        const exists = doc.tagDetails.some((entry) => entry.tag === detail.tag);
        return {
          ...doc,
          tagDetails: exists
            ? doc.tagDetails.map((entry) =>
                entry.tag === detail.tag ? { ...entry, ...detail } : entry,
              )
            : [...doc.tagDetails, detail],
        };
      }),

    removeTagDetail: (tag) =>
      edit((doc) => ({
        ...doc,
        tagDetails: doc.tagDetails.filter((entry) => entry.tag !== tag),
      })),

    setStyle: (output, patch) =>
      edit((doc) => ({
        ...doc,
        styles: { ...doc.styles, [output]: { ...doc.styles[output], ...patch } },
      })),

    addLane: (name) =>
      edit((doc) => {
        const lane = name.trim();
        return !lane || doc.lanes.includes(lane) ? doc : { ...doc, lanes: [...doc.lanes, lane] };
      }),

    renameLane: (from, to) =>
      edit((doc) => {
        const lane = to.trim();
        if (!lane || lane === from || !doc.lanes.includes(from) || doc.lanes.includes(lane)) {
          return doc;
        }
        return {
          ...doc,
          lanes: doc.lanes.map((entry) => (entry === from ? lane : entry)),
          blocks: doc.blocks.map((block) =>
            block.lane === from ? { ...block, lane } : block,
          ),
        };
      }),

    /**
     * Refuses while the lane still holds blocks. Emptying it first is one more
     * click; a lane that took its blocks with it is a day silently missing an
     * hour, which is the failure this app exists to prevent.
     */
    deleteLane: (name) => {
      const doc = getDoc(get());
      if (doc.blocks.some((block) => block.lane === name)) {
        set({ notice: `“${name}” still has blocks. Move or delete them first.` });
        return;
      }
      if (doc.lanes.length <= 1) {
        set({ notice: "A day needs at least one lane." });
        return;
      }
      edit((current) => ({ ...current, lanes: current.lanes.filter((lane) => lane !== name) }));
    },

    select: (id) => set({ selectedId: id }),
    setUi: (patch) => set((state) => ({ ui: { ...state.ui, ...patch } })),
    setNotice: (notice) => set({ notice }),

    zoomBy: (factor) =>
      set((state) => ({ ui: { ...state.ui, pxPerMin: clampZoom(state.ui.pxPerMin * factor) } })),

    // A day that will not fit is not a reason to divide by nothing.
    fitDay: (viewportPx, spanMin) =>
      set((state) =>
        viewportPx <= 0 || spanMin <= 0
          ? state
          : { ui: { ...state.ui, pxPerMin: clampZoom(viewportPx / spanMin) } },
      ),

    previewChange: (change) => {
      const doc = getDoc(get());
      const sun = scheduleFor(doc).sun;
      set({
        preview: whatIf(
          doc,
          change,
          sun?.goldenHourEndMin == null ? {} : { goldenHourEndMin: sun.goldenHourEndMin },
        ),
      });
    },

    commitPreview: () => {
      const preview = get().preview;
      if (!preview) return;
      commit(preview.doc);
      set({ preview: null });
    },

    cancelPreview: () => set({ preview: null }),

    undo: () => set((state) => ({ history: undo(state.history), preview: null })),
    redo: () => set((state) => ({ history: redo(state.history), preview: null })),
    canUndo: () => canUndo(get().history),
    canRedo: () => canRedo(get().history),

    loadDoc: (doc) => set({ history: reset(doc), selectedId: null, preview: null }),
    replaceDoc: (doc) => commit(doc),
  };
});
