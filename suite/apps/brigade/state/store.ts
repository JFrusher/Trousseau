import { create } from "zustand";
import { parseDay } from "../core/import/day";
import { describe, reconcile } from "../core/import/reconcile";
import { coverage, warningsByJob, type Warning } from "../core/jobs/coverage";
import { emptyDoc } from "../core/model/defaults";
import { newId } from "../core/model/ids";
import type { BrigadeDoc, Job, Person, Team } from "../core/model/types";
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

export interface Cover {
  warnings: Warning[];
  byJob: Map<string, Warning[]>;
}

let cache: { doc: BrigadeDoc; cover: Cover } | null = null;

/**
 * The single derived view of a document, memoised on document identity. Every
 * edit replaces the document, so a stale cache is impossible, and the screen
 * and the printed sheets cannot disagree because both read this.
 */
export function coverFor(doc: BrigadeDoc): Cover {
  if (cache && cache.doc === doc) return cache.cover;
  const warnings = coverage(doc);
  const cover: Cover = { warnings, byJob: warningsByJob(warnings) };
  cache = { doc, cover };
  return cover;
}

/** Which jobs the board shows. */
export interface Filter {
  personId: string | null;
  teamId: string | null;
  unassignedOnly: boolean;
}

export interface StoreState {
  history: History<BrigadeDoc>;
  selectedJobId: string | null;
  filter: Filter;
  notice: string | null;

  importDay: (json: string) => void;
  loadDoc: (doc: BrigadeDoc) => void;

  addTeam: (seed?: Partial<Team>) => string;
  updateTeam: (id: string, patch: Partial<Team>) => void;
  deleteTeam: (id: string) => void;

  addPerson: (seed?: Partial<Person>) => string;
  updatePerson: (id: string, patch: Partial<Person>) => void;
  deletePerson: (id: string) => void;

  addJob: (blockId: string, seed?: Partial<Job>) => string;
  updateJob: (id: string, patch: Partial<Job>) => void;
  deleteJob: (id: string) => void;
  toggleAssignment: (jobId: string, personId: string) => void;

  select: (id: string | null) => void;
  setFilter: (patch: Partial<Filter>) => void;
  setNotice: (notice: string | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const getDoc = (state: StoreState): BrigadeDoc => state.history.present;
export const selectCover = (state: StoreState): Cover => coverFor(state.history.present);

export const useStore = create<StoreState>((set, get) => {
  const commit = (next: BrigadeDoc) => set((state) => ({ history: push(state.history, next) }));
  const edit = (change: (doc: BrigadeDoc) => BrigadeDoc) => commit(change(getDoc(get())));

  return {
    history: initHistory(emptyDoc()),
    selectedJobId: null,
    filter: { personId: null, teamId: null, unassignedOnly: false },
    notice: null,

    importDay: (json) => {
      const parsed = parseDay(json);
      if (parsed.error !== undefined) {
        set({ notice: parsed.error });
        return;
      }

      const { doc, report } = reconcile(getDoc(get()), parsed.day, parsed.teams);
      commit(doc);
      set({
        notice:
          describe(report, doc) +
          (parsed.fromFuture ? " It came from a newer Cadence than this Brigade knows." : ""),
      });
    },

    loadDoc: (doc) => set({ history: reset(doc), selectedJobId: null, notice: null }),

    addTeam: (seed = {}) => {
      const id = seed.id ?? newId("team");
      edit((doc) => ({
        ...doc,
        teams: [...doc.teams, { id, tag: null, name: "New team", phone: "", notes: "", ...seed }],
      }));
      return id;
    },

    updateTeam: (id, patch) =>
      edit((doc) => ({
        ...doc,
        teams: doc.teams.map((team) => (team.id === id ? { ...team, ...patch } : team)),
      })),

    // People keep their jobs when their team goes: the work did not stop
    // existing because the supplier's row did.
    deleteTeam: (id) =>
      edit((doc) => ({
        ...doc,
        teams: doc.teams.filter((team) => team.id !== id),
        people: doc.people.map((person) =>
          person.teamId === id ? { ...person, teamId: null } : person,
        ),
        jobs: doc.jobs.map((job) => (job.teamId === id ? { ...job, teamId: null } : job)),
      })),

    addPerson: (seed = {}) => {
      const id = seed.id ?? newId("per");
      edit((doc) => ({
        ...doc,
        people: [
          ...doc.people,
          { id, name: "New person", teamId: null, phone: "", notes: "", guestId: null, ...seed },
        ],
      }));
      return id;
    },

    updatePerson: (id, patch) =>
      edit((doc) => ({
        ...doc,
        people: doc.people.map((person) => (person.id === id ? { ...person, ...patch } : person)),
      })),

    deletePerson: (id) =>
      edit((doc) => ({
        ...doc,
        people: doc.people.filter((person) => person.id !== id),
        jobs: doc.jobs.map((job) =>
          job.personIds.includes(id)
            ? { ...job, personIds: job.personIds.filter((personId) => personId !== id) }
            : job,
        ),
      })),

    addJob: (blockId, seed = {}) => {
      const id = seed.id ?? newId("job");
      edit((doc) => ({
        ...doc,
        jobs: [
          ...doc.jobs,
          { id, blockId, label: "New job", notes: "", teamId: null, personIds: [], ...seed },
        ],
      }));
      set({ selectedJobId: id });
      return id;
    },

    updateJob: (id, patch) =>
      edit((doc) => ({
        ...doc,
        jobs: doc.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)),
      })),

    deleteJob: (id) => {
      edit((doc) => ({ ...doc, jobs: doc.jobs.filter((job) => job.id !== id) }));
      if (get().selectedJobId === id) set({ selectedJobId: null });
    },

    toggleAssignment: (jobId, personId) =>
      edit((doc) => ({
        ...doc,
        jobs: doc.jobs.map((job) =>
          job.id === jobId
            ? {
                ...job,
                personIds: job.personIds.includes(personId)
                  ? job.personIds.filter((id) => id !== personId)
                  : [...job.personIds, personId],
              }
            : job,
        ),
      })),

    select: (id) => set({ selectedJobId: id }),
    setFilter: (patch) => set((state) => ({ filter: { ...state.filter, ...patch } })),
    setNotice: (notice) => set({ notice }),

    undo: () => set((state) => ({ history: undo(state.history) })),
    redo: () => set((state) => ({ history: redo(state.history) })),
    canUndo: () => canUndo(get().history),
    canRedo: () => canRedo(get().history),
  };
});
