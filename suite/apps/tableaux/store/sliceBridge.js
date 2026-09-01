import { mayWrite, noteRead } from '@/lib/store/toolGeneration'
import { useTrousseauStore } from '@/lib/store/useTrousseauStore'

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

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Tableaux's factory name for a plan nobody has named yet.
 *
 * Treated as absence rather than as an answer: propagating it would put "Our
 * Wedding" in the couple's name on the run sheet and the place cards, which is
 * worse than leaving the field empty for them to fill in.
 */
const UNNAMED = 'Our Wedding'

/** The plan as Tableaux's store wants it, assembled from the shared wedding. */
export function readDoc() {
  noteRead('tableaux')
  const { raw, doc } = useTrousseauStore.getState()
  const seating = isRecord(raw.seating) ? raw.seating : {}
  const guests = isRecord(raw.guests) ? raw.guests : {}
  const meta = isRecord(seating.meta) ? seating.meta : {}

  return {
    ...seating,
    guests,
    meta: {
      ...meta,
      weddingName: doc.event.coupleNames || meta.weddingName || UNNAMED,
      venue: doc.event.venueName || meta.venue || '',
      date: doc.event.date || meta.date || '',
    },
  }
}

/** True when this wedding has nothing in it yet, so a fresh plan is not overwritten. */
export function isEmpty() {
  const doc = readDoc()
  return Object.keys(doc.guests).length === 0 && Object.keys(doc.tables ?? {}).length === 0
}

export function writeDoc(doc) {
  // Refused when the document has been replaced since this was read — see
  // `toolGeneration`. Writing here would put the previous wedding back.
  if (!mayWrite('tableaux')) return
  const seating = {}
  for (const key of SEATING_KEYS) {
    if (doc[key] !== undefined) seating[key] = doc[key]
  }

  // `meta` was overlaid from `event` on the way in, so writing it back is a
  // no-op unless it was edited here — in which case the edit is meant, and the
  // rest of the suite should see it.
  const { event } = useTrousseauStore.getState().doc
  const meta = isRecord(doc.meta) ? doc.meta : {}
  const named = meta.weddingName && meta.weddingName !== UNNAMED

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
