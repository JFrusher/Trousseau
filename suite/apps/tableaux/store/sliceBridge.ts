import { eventSchema } from '@jfrusher/trousseau'
import { mayWrite, noteRead } from '@/lib/store/toolGeneration'
import { useTrousseauStore } from '@/lib/store/useTrousseauStore'
import type { Guest, TableEntity } from './planSchema'

/**
 * A build-time check that the three `event` fields this file reads still exist
 * in the contract package.
 *
 * Typing the file is not enough on its own, which is worth writing down because
 * it is genuinely counter-intuitive. `eventSchema` is a `looseObject`, so the
 * `Event` type it infers carries a catch-all index signature — which means
 * `doc.event.anythingAtAll` type-checks happily as `unknown`, and renaming a
 * field in the contract produces no error anywhere. Verified by doing it:
 * renaming `coupleNames` in the contract and rebuilding gave a clean `tsc`.
 *
 * `eventSchema.shape` has no index signature, so asserting against its keys is
 * the check the inferred type cannot give. Rename one of these in the contract
 * and this file stops compiling, which is the whole point.
 *
 * The same blind spot applies to every loose slice, in every app — this guards
 * only the three fields read below.
 */
type EventKeys = keyof typeof eventSchema.shape
type Assert<T extends true> = T
type _CoupleNamesExists = Assert<'coupleNames' extends EventKeys ? true : false>
type _VenueNameExists = Assert<'venueName' extends EventKeys ? true : false>
type _DateExists = Assert<'date' extends EventKeys ? true : false>

/**
 * Where Tableaux's document actually lives.
 *
 * Tableaux was the one tool with a back end of its own: an Express server, a
 * Supabase account, plan revisions and optimistic concurrency. All of that is
 * the shell's job now — it stores the wedding locally, syncs it end-to-end
 * encrypted, and resolves conflicts across devices — so what is left here is
 * the part that was always Tableaux's: the document itself.
 *
 * It is split across two slices rather than one, because the guest list is not
 * Tableaux's alone. Plaque prints place cards from it, the delegation board
 * counts heads with it, and a guest following their own link adds themselves to
 * it. Keeping it in the shared `guests` slice means all of that reads and
 * writes one list. Everything else — tables, zones, room, groups, settings,
 * snapshots — is seating, and nothing outside Tableaux edits it.
 *
 * The seating half is read and written raw. Tableaux's document is the richer
 * of the two shapes and the suite's typed reader is a narrowing of it, so
 * passing the document through that reader would quietly drop the parts the
 * suite has no opinion about.
 *
 * The exception is `meta`. Tableaux kept its own record of what the wedding is
 * called, where it is and when — the same three facts the `event` slice holds
 * for everything else, and they had already drifted apart: Tableaux showed "Our
 * Wedding" while Cadence showed the couple's names. There is one answer to each
 * of those questions, so `meta` is overlaid from `event` on the way in and
 * written back on the way out, and Tableaux's copy is an echo rather than a
 * second opinion.
 */

/** Everything Tableaux keeps out of its own document, minus the guest list. */
const SEATING_KEYS = [
  'meta',
  'groups',
  'subgroups',
  'families',
  'tables',
  'zones',
  'room',
  'wallElements',
  'pillars',
  'canvas',
  'snapshots',
  'constraints',
  'settings',
]

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Tableaux's factory name for a plan nobody has named yet.
 *
 * Treated as absence rather than as an answer: propagating it would put "Our
 * Wedding" in the couple's name on the run sheet and the place cards, which is
 * worse than leaving the field empty for them to fill in.
 */
const UNNAMED = 'Our Wedding'

/**
 * The plan as Tableaux's own store holds it.
 *
 * Deliberately not `PlanDoc` from `planSchema.ts`: that is the validated
 * *saved* shape, and this is the live in-memory one, which carries whatever
 * the store happens to hold. The two agree on the parts named here and this
 * type stays open about the rest — the seating half is read and written raw
 * on purpose, as the comment above explains.
 */
export interface TableauxDoc extends Record<string, unknown> {
  guests: Record<string, Guest>
  tables?: Record<string, TableEntity>
  meta?: Record<string, unknown>
}

/**
 * Give every guest a `fullName`, because this panel is the only thing that
 * displays them and it displays that field.
 *
 * Tableaux derives `fullName` in its own `addGuest` and `updateGuest`, so a
 * guest created here has always had one. A guest arriving any other way — the
 * suite's CSV import, a restored backup, the example wedding — did not, and
 * the guest panel showed a hundred blank rows above a count of a hundred
 * guests, with nobody seatable.
 *
 * A name the guest already carries is never overwritten: Tableaux allows one
 * that is not simply first plus last, and deriving over the top would quietly
 * rewrite it.
 */
function named(guests: Record<string, Guest>): Record<string, Guest> {
  const out: Record<string, Guest> = {};
  for (const [id, guest] of Object.entries(guests)) {
    if (typeof guest?.fullName === "string" && guest.fullName.trim() !== "") {
      out[id] = guest;
      continue;
    }
    const first = typeof guest?.firstName === "string" ? guest.firstName : "";
    const last = typeof guest?.lastName === "string" ? guest.lastName : "";
    out[id] = { ...guest, fullName: `${first} ${last}`.trim() || "New guest" };
  }
  return out;
}

/** The plan as Tableaux's store wants it, assembled from the shared wedding. */
export function readDoc(): TableauxDoc {
  noteRead('tableaux')
  const { raw, doc } = useTrousseauStore.getState()
  const seating = isRecord(raw.seating) ? raw.seating : {}
  const guests = named(isRecord(raw.guests) ? (raw.guests as Record<string, Guest>) : {})
  const meta = isRecord(seating.meta) ? seating.meta : {}

  return {
    ...seating,
    guests,
    meta: {
      ...meta,
      // These three names are held to the contract by the assertions at the
      // top of this file, not by `Event` itself — see the comment there.
      weddingName: doc.event.coupleNames || meta.weddingName || UNNAMED,
      venue: doc.event.venueName || meta.venue || '',
      date: doc.event.date || meta.date || '',
    },
  }
}

/** True when this wedding has nothing in it yet, so a fresh plan is not overwritten. */
export function isEmpty(): boolean {
  const doc = readDoc()
  return Object.keys(doc.guests).length === 0 && Object.keys(doc.tables ?? {}).length === 0
}

export function writeDoc(doc: TableauxDoc): void {
  // Refused when the document has been replaced since this was read — see
  // `toolGeneration`. Writing here would put the previous wedding back.
  if (!mayWrite('tableaux')) return
  const seating: Record<string, unknown> = {}
  for (const key of SEATING_KEYS) {
    if (doc[key] !== undefined) seating[key] = doc[key]
  }

  // `meta` was overlaid from `event` on the way in, so writing it back is a
  // no-op unless it was edited here — in which case the edit is meant, and the
  // rest of the suite should see it.
  const { event } = useTrousseauStore.getState().doc
  const meta = isRecord(doc.meta) ? doc.meta : {}
  // The `typeof` check is what the JavaScript's truthiness already meant: a
  // non-empty string. Made explicit because `meta` is a Record of `unknown`.
  const named = typeof meta.weddingName === 'string' && meta.weddingName !== UNNAMED

  useTrousseauStore.getState().setSlices(
    [
      ['guests', doc.guests ?? {}],
      ['seating', seating],
      [
        'event',
        {
          ...event,
          coupleNames: named ? meta.weddingName : event.coupleNames,
          venueName: meta.venue || event.venueName,
          date: meta.date || event.date,
        },
      ],
    ],
    { label: 'the room', silent: true },
  )
}
